import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { HttpError, readJson, send } from './http.mjs';
import { cleanRecipe } from './recipe.mjs';

/**
 * AI recipe search: Claude searches cooking sites on the web (Arabic and international), reads the pages,
 * and returns up to 6 recipes in Egyptian Arabic with their source links. The server adds each page's photo.
 *
 *   POST /api/ai/search {query, category?}   signed in; daily limit per user; repeated searches are cached.
 *        Answers 200 {recipes} when ready, or 202 {pending} while still searching (Cloudflare cuts requests
 *        after 100 s); the app repeats the same POST until it gets the results.
 *   GET  /api/ai/recipes/:id                 a recipe from an earlier search (public)
 */

const MAX_RESULTS = 6;
const CACHE_DAYS = 7;
const CATEGORIES = ['food', 'healthy-drink', 'juice'];
const MEALS = ['breakfast', 'lunch', 'dinner'];
const ID = /^ai-[a-f0-9]{12}$/;

// Pork and alcohol never reach the app (same rule as the TheMealDB search).
const NOT_HALAL = new RegExp(
  [
    '\\b(pork|bacon|ham|lard|prosciutto|pancetta|chorizo|salami|pepperoni|gammon|wine|beer|rum|brandy|sherry|vodka|whisky|whiskey|bourbon|cognac|liqueur|marsala|sake|mirin|tequila|champagne|vermouth)\\b',
    'خنزير', 'لحم الخنزير', 'بيكون', 'نبيذ', 'خمر', 'بيرة', 'كحول', 'فودكا', 'ويسكي', 'روم ',
  ].join('|'),
  'i',
);

const SYSTEM = `You find home-cooking recipes on the web for Darwish Kitchen, an Egyptian Arabic recipe app.

Search the web for what the user asks for. Prefer well-known recipe sites and mix sources: Arabic sites (for example cookpad.com/eg, fatafeat.com, shahiya.com, atyabtabkha.3a2ilati.com, sayidaty.net) and international ones (for example allrecipes.com, bbcgoodfood.com, seriouseats.com, food.com, simplyrecipes.com). Pick up to ${MAX_RESULTS} good recipes, each from a different page and ideally from different websites. When a search result doesn't show the ingredients and steps, open the page with web_fetch.

Then call submit_recipes once with everything you found:
- Write every title, ingredient and step in simple Egyptian Arabic, in your own words, keeping the quantities. Translate pages in other languages.
- source_url must be the exact address of a page you saw in the search results or fetched. Never guess a URL.
- source_name is the website's short name (for example "Cookpad" or "BBC Good Food").
- Leave out recipes that use pork or alcohol.
- category is "food" for dishes, "healthy-drink" for teas, herbal and healthy drinks, "juice" for juices and smoothies. meal_types (breakfast/lunch/dinner) only for food.
If the request isn't about food or drinks, call submit_recipes with an empty list.`;

const nullableInt = { anyOf: [{ type: 'integer' }, { type: 'null' }] };
const SUBMIT_TOOL = {
  name: 'submit_recipes',
  description: 'Return the recipes you found to the app. Call it exactly once, at the end.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['recipes'],
    properties: {
      recipes: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'category', 'meal_types', 'ingredients', 'steps', 'prep_minutes', 'servings', 'source_name', 'source_url'],
          properties: {
            title: { type: 'string' },
            category: { type: 'string', enum: CATEGORIES },
            meal_types: { type: 'array', items: { type: 'string', enum: MEALS } },
            ingredients: { type: 'array', items: { type: 'string' } },
            steps: { type: 'array', items: { type: 'string' } },
            prep_minutes: nullableInt,
            servings: nullableInt,
            source_name: { type: 'string' },
            source_url: { type: 'string' },
          },
        },
      },
    },
  },
};

// ---------- page photos (og:image), never from private/internal addresses ----------

function isPrivateIp(ip) {
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
export { isPrivateIp };

async function assertPublicUrl(raw) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('bad-url');
  const addrs = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('private-address');
  return url;
}

/** The page's main photo (og:image / twitter:image), or null. */
async function pagePhoto(pageUrl, { allowPrivate = false } = {}) {
  try {
    let url = new URL(pageUrl);
    for (let hop = 0; hop < 4; hop++) {
      if (!allowPrivate) url = await assertPublicUrl(url.href);
      const res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(6000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DarwishKitchen/1.0)', Accept: 'text/html' },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location'), url);
        continue;
      }
      if (!res.ok || !String(res.headers.get('content-type')).includes('html')) return null;
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
        const img = new URL(content.replace(/&amp;/g, '&'), url);
        if (img.protocol === 'https:' || img.protocol === 'http:') return img.href;
      }
      return null;
    }
  } catch {
    // No photo is fine.
  }
  return null;
}

// ---------- results ----------

const normalizeUrl = (u) => {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return '';
  }
};

/**
 * Every URL the web tools returned (search results, fetched pages, filtered output) — only tool *results*,
 * never Claude's own text or its submit_recipes call, so a guessed link can't vouch for itself.
 */
function seenUrls(contents) {
  const results = contents.flat().filter((b) => typeof b?.type === 'string' && b.type.endsWith('_tool_result'));
  const text = JSON.stringify(results);
  return new Set((text.match(/https?:\/\/[^\s"'<>\\]+/g) ?? []).map(normalizeUrl).filter(Boolean));
}

function cleanResults(raw, seen) {
  const out = [];
  const urls = new Set();
  for (const r of Array.isArray(raw) ? raw : []) {
    try {
      const source = new URL(String(r.source_url));
      if (!['http:', 'https:'].includes(source.protocol)) continue;
      const key = normalizeUrl(source.href);
      if (!seen.has(key) || urls.has(key)) continue; // only real pages the search found, once each
      const category = CATEGORIES.includes(r.category) ? r.category : 'food';
      const mealTypes = Array.isArray(r.meal_types) && r.meal_types.length ? r.meal_types : ['lunch', 'dinner'];
      const recipe = cleanRecipe({
        title: r.title,
        category,
        mealTypes,
        ingredients: r.ingredients,
        steps: r.steps,
        prepMinutes: r.prep_minutes,
        servings: r.servings,
      });
      if (recipe.ingredients.length < 2 || recipe.steps.length < 1) continue;
      if (NOT_HALAL.test(`${recipe.title} ${recipe.ingredients.join(' ')} ${recipe.steps.join(' ')}`)) continue;
      urls.add(key);
      out.push({
        ...recipe,
        sourceName: String(r.source_name ?? '').trim().slice(0, 60) || source.hostname.replace(/^www\./, ''),
        sourceUrl: source.href,
      });
    } catch {
      // Skip anything malformed.
    }
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

export function createAi({ db, apiKey, baseURL, model = 'claude-opus-5-5', dailyLimit = 20, allowPrivateFetch = false, waitMs = 25_000 }) {
  const client = apiKey ? new Anthropic({ apiKey, baseURL, timeout: 150_000, maxRetries: 1 }) : null;

  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_searches (key TEXT PRIMARY KEY, ids TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS ai_recipes (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS ai_usage (user_id TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (user_id, day));
  `);
  const q = {
    search: db.prepare('SELECT ids, created_at FROM ai_searches WHERE key = ?'),
    saveSearch: db.prepare('INSERT INTO ai_searches (key, ids, created_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET ids = excluded.ids, created_at = excluded.created_at'),
    recipe: db.prepare('SELECT data FROM ai_recipes WHERE id = ?'),
    saveRecipe: db.prepare('INSERT INTO ai_recipes (id, data, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, created_at = excluded.created_at'),
    usage: db.prepare('SELECT count FROM ai_usage WHERE user_id = ? AND day = ?'),
    use: db.prepare('INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1'),
    prune: db.prepare('DELETE FROM ai_usage WHERE day < ?'),
  };
  const inFlight = new Map(); // key → promise of recipes
  const failed = new Map(); // key → time of a failed search, reported once to the next poll
  const today = () => new Date().toISOString().slice(0, 10);

  /** Runs Claude with web search until it submits the recipes. */
  async function askClaude(query, category) {
    const ask = category
      ? `${query}\n\n(القسم المطلوب: ${{ food: 'أكل', 'healthy-drink': 'مشروبات صحية', juice: 'عصائر' }[category]})`
      : query;
    const messages = [{ role: 'user', content: ask }];
    const contents = [];
    for (let turn = 0; turn < 6; turn++) {
      const response = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low' },
        system: SYSTEM,
        tools: [
          { type: 'web_search_20260209', name: 'web_search', max_uses: 4, user_location: { type: 'approximate', country: 'EG', timezone: 'Africa/Cairo' } },
          { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 6 },
          SUBMIT_TOOL,
        ],
        messages,
      });
      contents.push(response.content);
      if (response.stop_reason === 'refusal') return [];
      const submit = response.content.find((b) => b.type === 'tool_use' && b.name === 'submit_recipes');
      if (submit) {
        if (response.stop_reason === 'max_tokens') throw new Error('ai-truncated');
        return cleanResults(submit.input?.recipes, seenUrls(contents));
      }
      // Long web-tool turns pause; send the turn back so the server continues it.
      if (response.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: response.content });
        continue;
      }
      return [];
    }
    return [];
  }

  async function search(query, category) {
    const recipes = await askClaude(query, category);
    const photos = await Promise.all(recipes.map((r) => pagePhoto(r.sourceUrl, { allowPrivate: allowPrivateFetch })));
    const now = Date.now();
    return recipes.map((r, i) => {
      const id = `ai-${createHash('sha256').update(`${r.sourceUrl}|${r.title}`).digest('hex').slice(0, 12)}`;
      const recipe = { id, ...r, image: photos[i] };
      q.saveRecipe.run(id, JSON.stringify(recipe), now);
      return recipe;
    });
  }

  return {
    enabled: !!client,

    async route(req, res, path, { requireUser, isAdmin }) {
      if (path === '/api/ai/search' && req.method === 'POST') {
        const user = requireUser(req);
        if (!client) throw new HttpError(503, 'ai-unavailable');
        const body = await readJson(req);
        const query = typeof body?.query === 'string' ? body.query.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
        if (query.length < 2) throw new HttpError(400, 'query-required');
        const category = CATEGORIES.includes(body?.category) ? body.category : '';
        const key = `${category}|${query.toLowerCase()}`;

        const fromCache = () => {
          const cached = q.search.get(key);
          if (!cached || Date.now() - cached.created_at > CACHE_DAYS * 86_400_000) return null;
          return JSON.parse(cached.ids).map((id) => q.recipe.get(id)).filter(Boolean).map((r) => JSON.parse(r.data));
        };
        const remaining = () => (isAdmin(user) ? null : Math.max(0, dailyLimit - (q.usage.get(user.userId, today())?.count ?? 0)));

        // Recent identical searches are free and instant.
        const cachedRecipes = fromCache();
        if (cachedRecipes) {
          send(res, 200, { recipes: cachedRecipes, cached: true, remaining: remaining() });
          return true;
        }
        if (failed.has(key)) {
          failed.delete(key);
          throw new HttpError(502, 'ai-failed');
        }

        let job = inFlight.get(key);
        if (!job) {
          // A new search: counts toward today's limit.
          const day = today();
          if (!isAdmin(user) && (q.usage.get(user.userId, day)?.count ?? 0) >= dailyLimit) throw new HttpError(429, 'ai-daily-limit');
          q.use.run(user.userId, day);
          if (Math.random() < 0.02) q.prune.run(day);
          job = search(query, category)
            .then((recipes) => {
              q.saveSearch.run(key, JSON.stringify(recipes.map((r) => r.id)), Date.now());
              return recipes;
            })
            .catch((e) => {
              console.error(new Date().toISOString(), 'AI search failed', e?.status ?? '', e?.message);
              failed.set(key, Date.now());
              setTimeout(() => failed.delete(key), 120_000).unref?.();
              throw e;
            })
            .finally(() => inFlight.delete(key));
          job.catch(() => {}); // reported to the next poll instead
          inFlight.set(key, job);
        }

        // Wait a little; if it's not done, tell the app to ask again.
        const timeout = new Promise((resolve) => setTimeout(resolve, waitMs, 'pending').unref?.());
        const outcome = await Promise.race([job.then((r) => ({ recipes: r }), () => ({ error: true })), timeout]);
        if (outcome === 'pending') {
          send(res, 202, { pending: true });
          return true;
        }
        if (outcome.error) {
          failed.delete(key);
          throw new HttpError(502, 'ai-failed');
        }
        send(res, 200, { recipes: outcome.recipes, cached: false, remaining: remaining() });
        return true;
      }

      const one = /^\/api\/ai\/recipes\/([^/]+)$/.exec(path);
      if (one && req.method === 'GET') {
        const row = ID.test(one[1]) ? q.recipe.get(one[1]) : undefined;
        if (!row) throw new HttpError(404, 'not-found');
        send(res, 200, JSON.parse(row.data), { 'Cache-Control': 'public, max-age=3600' });
        return true;
      }
      return false;
    },
  };
}
