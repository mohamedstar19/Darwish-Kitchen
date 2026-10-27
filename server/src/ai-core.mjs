import Anthropic from '@anthropic-ai/sdk';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Shared pieces of the AI features: the Claude client, safe web fetching, halal filter, URL checks. */

// Pork and alcohol never reach the app (same rule as the TheMealDB search).
export const NOT_HALAL = new RegExp(
  [
    '\\b(pork|bacon|ham|lard|prosciutto|pancetta|chorizo|salami|pepperoni|gammon|wine|beer|rum|brandy|sherry|vodka|whisky|whiskey|bourbon|cognac|liqueur|marsala|sake|mirin|tequila|champagne|vermouth)\\b',
    'خنزير', 'لحم الخنزير', 'بيكون', 'نبيذ', 'خمر', 'بيرة', 'كحول', 'فودكا', 'ويسكي', 'روم ',
  ].join('|'),
  'i',
);
export const isHalal = (recipe) => !NOT_HALAL.test(`${recipe.title} ${recipe.ingredients.join(' ')} ${recipe.steps.join(' ')}`);

export const CATEGORIES = ['food', 'healthy-drink', 'juice'];
export const MEALS = ['breakfast', 'lunch', 'dinner'];
export const nullableInt = { anyOf: [{ type: 'integer' }, { type: 'null' }] };
export const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };

/** JSON schema of one recipe, as Claude writes it (snake_case). */
export const RECIPE_FIELDS = {
  title: { type: 'string' },
  category: { type: 'string', enum: CATEGORIES },
  meal_types: { type: 'array', items: { type: 'string', enum: MEALS } },
  ingredients: { type: 'array', items: { type: 'string' } },
  steps: { type: 'array', items: { type: 'string' } },
  prep_minutes: nullableInt,
  servings: nullableInt,
};

// ---------- network safety: never fetch private/internal addresses ----------

export function isPrivateIp(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateIp(v6.slice(7));
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb') || v6.startsWith('ff');
}

async function assertPublicUrl(url) {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('bad-url');
  const addrs = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('private-address');
}

/** `host` is `domain` or one of its subdomains. */
export const hostIn = (host, domains) => domains.some((d) => host === d || host.endsWith(`.${d}`));

/**
 * GET with redirects followed by hand, so every hop is checked (public address, and `allowHost` when given).
 * Returns the Response of the last hop, or null.
 */
async function safeGet(raw, { allowPrivate = false, allowHost, accept, timeout = 8000, userAgent = 'Mozilla/5.0 (compatible; DarwishKitchen/1.0)' } = {}) {
  let url = new URL(raw);
  for (let hop = 0; hop < 4; hop++) {
    if (allowHost && !allowHost(url.hostname)) return null;
    if (!allowPrivate) await assertPublicUrl(url);
    else if (!['http:', 'https:'].includes(url.protocol)) return null;
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeout),
      headers: { 'User-Agent': userAgent, Accept: accept },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      res.body?.cancel().catch(() => {});
      url = new URL(res.headers.get('location'), url);
      continue;
    }
    return Object.assign(res, { finalUrl: url });
  }
  return null;
}

/** The page's main photo (og:image / twitter:image), or null. */
export async function pagePhoto(pageUrl, options = {}) {
  try {
    const res = await safeGet(pageUrl, { ...options, accept: 'text/html' });
    if (!res?.ok || !String(res.headers.get('content-type')).includes('html')) return null;
    // Only the start of the page is needed (meta tags live in <head>).
    const reader = res.body.getReader();
    let html = '';
    const decoder = new TextDecoder();
    while (html.length < 400_000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    reader.cancel().catch(() => {});
    for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
      if (!/(property|name)\s*=\s*["'](og:image(:secure_url)?|twitter:image)["']/i.test(tag)) continue;
      const content = /content\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
      if (!content) continue;
      const img = new URL(content.replace(/&amp;/g, '&'), res.finalUrl);
      if (img.protocol === 'https:' || img.protocol === 'http:') return img.href;
    }
  } catch {
    // No photo is fine.
  }
  return null;
}

export const isJpeg = (b) => b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
export const isPng = (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
export const isWebp = (b) => b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP';

/** Downloads a JPEG photo (up to `maxBytes`), or returns null. */
export async function downloadJpeg(url, { maxBytes = 5 * 1024 * 1024, ...options } = {}) {
  try {
    // Ask for JPEG only: some image CDNs send WebP/AVIF when the client accepts them.
    const res = await safeGet(url, { ...options, accept: 'image/jpeg', timeout: 15_000 });
    if (!res?.ok || Number(res.headers.get('content-length') ?? 0) > maxBytes) return null;
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > maxBytes) return null;
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    return isJpeg(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

// ---------- URLs Claude saw ----------

export const normalizeUrl = (u) => {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return '';
  }
};

/**
 * Every URL the web tools returned (search results, fetched pages, filtered output) — only tool *results*,
 * never Claude's own text or its submit call, so a guessed link can't vouch for itself.
 */
export function seenUrls(contents) {
  const results = contents.flat().filter((b) => typeof b?.type === 'string' && b.type.endsWith('_tool_result'));
  const text = JSON.stringify(results);
  return new Set((text.match(/https?:\/\/[^\s"'<>\\]+/g) ?? []).map(normalizeUrl).filter(Boolean));
}

// ---------- images sent by the app ----------

/** A photo the app sent as base64 → an image block for Claude. Throws 400-style codes on bad input. */
export function imageBlock(base64) {
  if (typeof base64 !== 'string') return null;
  const data = base64.replace(/^data:image\/\w+;base64,/, '').replace(/\s+/g, '');
  if (!data || data.length > 7_000_000 || !/^[A-Za-z0-9+/]+=*$/.test(data)) throw Object.assign(new Error('bad-image'), { code: 'bad-image' });
  const bytes = Buffer.from(data, 'base64');
  const media_type = isJpeg(bytes) ? 'image/jpeg' : isPng(bytes) ? 'image/png' : isWebp(bytes) ? 'image/webp' : null;
  if (!media_type) throw Object.assign(new Error('bad-image'), { code: 'bad-image' });
  return { type: 'image', source: { type: 'base64', media_type, data } };
}

// ---------- Claude ----------

/**
 * One Claude client for every AI feature. Opus with server-side fallbacks (if a request is declined,
 * the API retries it on another model) and low effort: these are quick, everyday tasks.
 */
export function createClaude({ apiKey, baseURL, model = 'claude-opus-5-5' }) {
  const client = apiKey ? new Anthropic({ apiKey, baseURL, timeout: 150_000, maxRetries: 1 }) : null;
  const base = () => ({
    model,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  });

  /** A single answer in a fixed JSON shape (structured output). Returns the parsed object, or null on refusal. */
  async function json({ system, content, schema, effort = 'low' }) {
    const response = await client.beta.messages.create({
      ...base(),
      output_config: { effort, format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content }],
    });
    if (response.stop_reason === 'refusal') return null;
    if (response.stop_reason === 'max_tokens') throw new Error('ai-truncated');
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return JSON.parse(text);
  }

  /**
   * Lets Claude use web tools until it calls the `submit` tool. Returns { input, contents }
   * (input is null if it never submitted). Paused turns are sent back so the server continues them.
   */
  async function withTools({ system, content, tools, submitName, effort = 'low', maxTurns = 6 }) {
    const messages = [{ role: 'user', content }];
    const contents = [];
    for (let turn = 0; turn < maxTurns; turn++) {
      const response = await client.beta.messages.create({ ...base(), output_config: { effort }, system, tools, messages });
      contents.push(response.content);
      if (response.stop_reason === 'refusal') break;
      const submit = response.content.find((b) => b.type === 'tool_use' && b.name === submitName);
      if (submit) {
        if (response.stop_reason === 'max_tokens') throw new Error('ai-truncated');
        return { input: submit.input, contents };
      }
      if (response.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: response.content });
    }
    return { input: null, contents };
  }

  return { enabled: !!client, json, withTools };
}
