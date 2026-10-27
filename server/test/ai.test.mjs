import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { isPrivateIp } from '../src/ai.mjs';
import { createApp } from '../src/app.mjs';

const listen = (handler) =>
  new Promise((resolve) => {
    const s = createServer(handler);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
const urlOf = (s) => `http://127.0.0.1:${s.address().port}`;
const readBody = async (req) => {
  let b = '';
  for await (const c of req) b += c;
  return b;
};

const dataDir = mkdtempSync(join(tmpdir(), 'kitchen-ai-'));
const codes = new Map();
const claudeCalls = [];
let claude, pages, app, server, base, token, adminToken, PAGES;

// A fake recipe site: one page with an og:image, one redirect, one without a photo.
async function pageHandler(req, res) {
  if (req.url === '/molokhia') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<html><head><meta property="og:image" content="/img/molokhia.jpg"><title>x</title></head><body>...</body></html>`);
  }
  if (req.url === '/old-juice') {
    res.writeHead(301, { Location: '/juice' });
    return res.end();
  }
  if (req.url === '/juice') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(`<head><meta content="https://cdn.example.com/juice.jpg" name="twitter:image"></head>`);
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<head></head>');
}

// A fake Claude API: first turn searches and pauses, second turn submits the recipes.
async function claudeHandler(req, res) {
  const body = JSON.parse(await readBody(req));
  claudeCalls.push({ url: req.url, beta: req.headers['anthropic-beta'], body });
  const msg = (content, stop_reason) =>
    res.end(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: body.model, content, stop_reason, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }));
  res.setHeader('Content-Type', 'application/json');
  if (String(body.messages[0].content).includes('بطيء')) await new Promise((r) => setTimeout(r, 400));
  const lastAssistant = body.messages.at(-1).role === 'assistant';
  if (!lastAssistant) {
    return msg(
      [
        { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'ملوخية' } },
        {
          type: 'web_search_tool_result',
          tool_use_id: 'srvtoolu_1',
          content: [
            { type: 'web_search_result', url: `${PAGES}/molokhia`, title: 'Molokhia', encrypted_content: 'x', page_age: null },
            { type: 'web_search_result', url: `${PAGES}/old-juice/`, title: 'Juice', encrypted_content: 'x', page_age: null },
            { type: 'web_search_result', url: `${PAGES}/pork`, title: 'Pork', encrypted_content: 'x', page_age: null },
          ],
        },
      ],
      'pause_turn',
    );
  }
  const r = (title, url, extra = {}) => ({
    title, category: 'food', meal_types: ['lunch'], ingredients: ['ملوخية', 'شوربة فراخ'], steps: ['اغلي الشوربة', 'ضيف الملوخية'],
    prep_minutes: 30, servings: 4, source_name: 'Cookpad', source_url: url, ...extra,
  });
  return msg(
    [
      { type: 'text', text: 'Here they are.' },
      {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'submit_recipes',
        input: {
          recipes: [
            r('ملوخية بالفراخ', `${PAGES}/molokhia`),
            r('عصير برتقال بالجزر', `${PAGES}/old-juice`, { category: 'juice', meal_types: [], source_name: '' }),
            r('ملوخية بالبيكون', `${PAGES}/pork`, { ingredients: ['ملوخية', '100 جم bacon'] }),
            r('ملوخية من موقع وهمي', 'https://made-up.example.com/recipe'), // never searched → dropped
            r('ملوخية مكررة', `${PAGES}/molokhia/`), // same page twice → dropped
            r('ناقصة', `${PAGES}/other`, { ingredients: ['حاجة واحدة'] }), // too short → dropped
          ],
        },
      },
    ],
    'tool_use',
  );
}

const call = (path, { token: t, json } = {}) =>
  fetch(base + path, {
    method: json ? 'POST' : 'GET',
    headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}) },
    body: json ? JSON.stringify(json) : undefined,
  });
const login = async (phone) => {
  await call('/api/auth/otp/send', { json: { phone } });
  return (await (await call('/api/auth/otp/verify', { json: { phone, code: codes.get(`20${phone.slice(1)}`) } })).json()).token;
};

before(async () => {
  claude = await listen(claudeHandler);
  pages = await listen(pageHandler);
  PAGES = urlOf(pages);
  app = createApp({
    dataDir,
    admins: ['01000000009'],
    otp: { devCodes: true, onDevCode: (p, c) => codes.set(p, c) },
    ai: { apiKey: 'test-key', baseURL: urlOf(claude), dailyLimit: 2, allowPrivateFetch: true, waitMs: 150 },
  });
  server = await listen(app);
  base = urlOf(server);
  token = await login('01000000001');
  adminToken = await login('01000000009');
});
after(() => {
  for (const s of [server, claude, pages]) s.close();
  app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test('AI search: continues paused turns, keeps only real, halal, complete recipes, adds page photos', async () => {
  assert.equal((await call('/api/ai/search', { json: { query: 'ملوخية' } })).status, 401);
  const res = await call('/api/ai/search', { token, json: { query: '  ملوخية   ', category: 'food' } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.cached, false);
  assert.equal(body.remaining, 1);
  assert.deepEqual(body.recipes.map((r) => r.title), ['ملوخية بالفراخ', 'عصير برتقال بالجزر']);

  const [molokhia, juice] = body.recipes;
  assert.match(molokhia.id, /^ai-[a-f0-9]{12}$/);
  assert.equal(molokhia.image, `${PAGES}/img/molokhia.jpg`);
  assert.equal(molokhia.sourceName, 'Cookpad');
  assert.deepEqual(molokhia.mealTypes, ['lunch']);
  assert.equal(juice.category, 'juice');
  assert.deepEqual(juice.mealTypes, []);
  assert.equal(juice.image, 'https://cdn.example.com/juice.jpg'); // followed the redirect
  assert.equal(juice.sourceName, '127.0.0.1'); // falls back to the host

  // The request to Claude: default model, fallbacks, web tools, strict submit tool; pause_turn sent back.
  assert.equal(claudeCalls.length, 2);
  const first = claudeCalls[0];
  assert.equal(first.body.model, 'claude-opus-5-5');
  assert.equal(first.body.fallbacks, 'default');
  assert.match(first.beta, /server-side-fallback-2026-07-01/);
  assert.deepEqual(first.body.tools.map((t) => t.type ?? t.name), ['web_search_20260209', 'web_fetch_20260209', 'submit_recipes']);
  assert.equal(first.body.tools[2].strict, true);
  assert.match(first.body.messages[0].content, /ملوخية\n\n\(القسم المطلوب: أكل\)/);
  assert.equal(claudeCalls[1].body.messages.at(-1).role, 'assistant');

  // A saved recipe can be opened later by id.
  const again = await (await call(`/api/ai/recipes/${molokhia.id}`)).json();
  assert.equal(again.title, 'ملوخية بالفراخ');
  assert.equal((await call('/api/ai/recipes/ai-000000000000')).status, 404);
});

test('repeated searches come from the cache (free), then the daily limit applies (not to admins)', async () => {
  const cached = await (await call('/api/ai/search', { token, json: { query: 'ملوخية', category: 'food' } })).json();
  assert.equal(cached.cached, true);
  assert.equal(cached.recipes.length, 2);
  assert.equal(claudeCalls.length, 2);

  assert.equal((await call('/api/ai/search', { token, json: { query: 'كشري' } })).status, 200);
  const limited = await call('/api/ai/search', { token, json: { query: 'محشي' } });
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error, 'ai-daily-limit');
  assert.equal((await call('/api/ai/search', { token: adminToken, json: { query: 'محشي' } })).status, 200);
  assert.equal((await call('/api/ai/search', { token, json: { query: 'x' } })).status, 400);
});

test('a slow search answers 202 and the same request later returns the results (counted once)', async () => {
  const first = await call('/api/ai/search', { token: adminToken, json: { query: 'كشري بطيء' } });
  assert.equal(first.status, 202);
  assert.deepEqual(await first.json(), { pending: true });
  let res;
  for (let i = 0; i < 20; i++) {
    res = await call('/api/ai/search', { token: adminToken, json: { query: 'كشري بطيء' } });
    if (res.status === 200) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(res.status, 200);
  assert.equal((await res.json()).recipes.length, 2);
});

test('never fetches page photos from private addresses', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.116', '172.20.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:127.0.0.1', '0.0.0.0']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '104.16.1.1', '2606:4700::1']) assert.equal(isPrivateIp(ip), false, ip);
});

test('without an API key, AI search is off', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kitchen-noai-'));
  const off = createApp({ dataDir: dir, otp: { devCodes: true, onDevCode: (p, c) => codes.set(p, c) } });
  const s = await listen(off);
  try {
    const health = await (await fetch(`${urlOf(s)}/api/health`)).json();
    assert.equal(health.ai, false);
  } finally {
    s.close();
    off.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
