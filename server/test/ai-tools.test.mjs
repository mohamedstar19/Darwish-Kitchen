import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const dataDir = mkdtempSync(join(tmpdir(), 'kitchen-ai-tools-'));
const seedFile = fileURLToPath(new URL('../../src/data/starter-recipes.json', import.meta.url));
const codes = new Map();
const calls = [];
let claude, pages, app, server, base, PAGES, token, otherToken, adminToken;

// Fake photo sources: the Wikimedia Commons and Openverse search APIs, and their JPEG images.
const sourceCalls = [];
const BIG_JPEG = Buffer.concat([JPEG, Buffer.alloc(9000, 1)]);
function pageHandler(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/w/api.php') {
    sourceCalls.push({ api: 'commons', search: url.searchParams.get('gsrsearch'), ua: req.headers['user-agent'] });
    const page = (index, n, mime, license, artist) => ({
      index,
      title: `File:${n}`,
      imageinfo: [{ thumburl: `${PAGES}/img/${n}.jpg`, descriptionurl: `${PAGES}/wiki/${n}`, mime, extmetadata: { LicenseShortName: { value: license }, Artist: { value: artist } } }],
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ query: { pages: [
      page(2, 'p2', 'image/jpeg', 'CC BY-NC 2.0', 'X'), // not free for the app → skipped
      page(1, 'p1', 'image/jpeg', 'CC BY-SA 4.0', '<a href="/wiki/User:Sara">Sara</a>'),
      page(3, 'p3', 'image/png', 'CC0', 'Y'), // not a JPEG → skipped
    ] } }));
  }
  if (url.pathname === '/v1/images/') {
    sourceCalls.push({ api: 'openverse', q: url.searchParams.get('q'), license: url.searchParams.get('license') });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ results: [
      { url: `${PAGES}/img/p1.jpg`, foreign_landing_url: `${PAGES}/wiki/p1`, license: 'by-sa', license_version: '4.0', creator: 'Sara', source: 'wikimedia', filetype: 'jpg' }, // same photo → once
      { url: `${PAGES}/img/p4.jpg`, foreign_landing_url: `${PAGES}/flickr/p4`, license: 'by', license_version: '2.0', creator: 'Ali', source: 'flickr', filetype: 'jpg' },
    ] }));
  }
  if (/^\/img\/p\d\.jpg$/.test(url.pathname)) {
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    return res.end(req.headers.accept === 'image/jpeg' ? BIG_JPEG : PNG);
  }
  const page = /^\/photo\/(\d)$/.exec(req.url);
  if (page) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    const img = page[1] === '3' ? '/img/3.png' : `/img/${page[1]}.jpg`;
    return res.end(`<html><head><meta property="og:image" content="${img}"></head></html>`);
  }
  if (req.url.endsWith('.jpg')) {
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    return res.end(Buffer.concat([JPEG, Buffer.from(req.url)]));
  }
  if (req.url.endsWith('.png')) {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    return res.end(PNG);
  }
  res.writeHead(404);
  res.end();
}

const recipe = (title, extra = {}) => ({
  title, category: 'food', meal_types: ['lunch'], ingredients: ['بيض', 'طماطم'], steps: ['اقلي البيض مع الطماطم'], prep_minutes: 10, servings: 2, ...extra,
});

// Fake Claude: answers by feature, recognised from the system prompt.
async function claudeHandler(req, res) {
  const body = JSON.parse(await readBody(req));
  calls.push(body);
  const system = String(body.system);
  const user = body.messages[0].content;
  const text = typeof user === 'string' ? user : user.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const reply = (content, stop_reason = 'end_turn') => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: body.model, content, stop_reason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
  };
  const json = (obj) => reply([{ type: 'text', text: JSON.stringify(obj) }]);
  if (text.includes('بطيء')) await wait(400);

  if (system.includes('which ingredients they have')) {
    return json({
      seen_ingredients: ['بيض', 'طماطم'],
      recipes: [
        { ...recipe('شكشوكة'), uses_ingredients: ['بيض', 'طماطم'], missing_ingredients: ['فلفل أخضر'], tip: 'كُلها مع عيش بلدي سخن.' },
        { ...recipe('بيض بالبيكون', { ingredients: ['بيض', 'bacon'] }), uses_ingredients: [], missing_ingredients: [], tip: '' },
        { ...recipe('ناقصة', { steps: [] }), uses_ingredients: [], missing_ingredients: [], tip: '' },
      ],
    });
  }
  if (system.includes('read recipes from photos')) {
    if (text.includes('اكتبلي') && JSON.stringify(user).includes('iVBOR')) return json({ found: false, recipe: { ...recipe(''), notes: null } });
    return json({ found: true, recipe: { ...recipe('كيكة ماما', { category: 'food', meal_types: [] }), notes: 'من كشكول ماما' } });
  }
  if (system.includes('choose what one person should eat')) {
    if (text.includes('"key":"local:1"')) return json({ pick: 'saved', candidate_key: 'local:1', new_recipe: null, reason: 'النهارده الجمعة وانت بتحب المحشي.' });
    if (text.includes('"key":"local:9"')) return json({ pick: 'saved', candidate_key: 'made-up', new_recipe: null, reason: 'x' });
    return json({ pick: 'new', candidate_key: null, new_recipe: recipe('عجة بالبقدونس'), reason: 'أكلة خفيفة وسريعة للعشا.' });
  }
  if (system.includes('review recipes that customers publish')) {
    if (text.includes('إعلان')) return json({ verdict: 'block', reason: 'دي إعلان مش وصفة.' });
    if (text.includes('غريبة')) return json({ verdict: 'review', reason: 'الصورة مش شبه الأكلة.' });
    return json({ verdict: 'ok', reason: '' });
  }
  if (system.includes('You check photos for recipes')) {
    return json({ photos: [{ index: 1, shows_dish: true, score: 9, problem: '' }, { index: 2, shows_dish: true, score: 4, problem: 'ضلمة' }] });
  }
  if (system.includes('image-search queries')) return json({ queries: ['koshari', 'egyptian rice lentils'] });
  json({});
}

const call = (path, { token: t, json, method } = {}) =>
  fetch(base + path, {
    method: method ?? (json ? 'POST' : 'GET'),
    headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}) },
    body: json ? JSON.stringify(json) : undefined,
  });
const login = async (phone) => {
  await call('/api/auth/otp/send', { json: { phone } });
  return (await (await call('/api/auth/otp/verify', { json: { phone, code: codes.get(`20${phone.slice(1)}`) } })).json()).token;
};
const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await wait(25);
  }
};

before(async () => {
  claude = await listen(claudeHandler);
  pages = await listen(pageHandler);
  PAGES = urlOf(pages);
  app = createApp({
    dataDir,
    seedFile,
    admins: ['01000000009'],
    otp: { devCodes: true, onDevCode: (p, c) => codes.set(p, c) },
    ai: {
      apiKey: 'test-key', baseURL: urlOf(claude), dailyLimit: 5, allowPrivateFetch: true, waitMs: 150,
      moderationDelayMs: 20, photoApis: { commons: `${PAGES}/w/api.php`, openverse: `${PAGES}/v1/images/` }, photoRunLimit: 1,
    },
  });
  server = await listen(app);
  base = urlOf(server);
  token = await login('01000000001');
  otherToken = await login('01000000002');
  adminToken = await login('01000000009');
});
after(() => {
  for (const s of [server, claude, pages]) s.close();
  app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test('fridge: suggests halal, complete dishes from typed ingredients and a photo', async () => {
  assert.equal((await call('/api/ai/fridge', { json: { ingredients: 'بيض' } })).status, 401);
  assert.equal((await call('/api/ai/fridge', { token, json: {} })).status, 400);
  assert.equal((await call('/api/ai/fridge', { token, json: { image: 'bm90IGFuIGltYWdl' } })).status, 400);

  const res = await call('/api/ai/fridge', { token, json: { ingredients: 'بيض وطماطم', image: JPEG.toString('base64') } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.seen, ['بيض', 'طماطم']);
  assert.deepEqual(body.recipes.map((r) => r.title), ['شكشوكة']);
  const [shakshuka] = body.recipes;
  assert.deepEqual(shakshuka.missing, ['فلفل أخضر']);
  assert.equal(shakshuka.notes, 'كُلها مع عيش بلدي سخن.');
  assert.equal(shakshuka.generated, true);
  assert.equal(shakshuka.sourceUrl, null);
  assert.equal(body.remaining, 4);

  // Structured output with the photo as an image block.
  const sent = calls.at(-1);
  assert.equal(sent.model, 'claude-opus-5-5');
  assert.equal(sent.fallbacks, 'default');
  assert.equal(sent.output_config.format.type, 'json_schema');
  assert.equal(sent.messages[0].content[0].type, 'image');
  assert.equal(sent.messages[0].content[0].source.media_type, 'image/jpeg');

  const again = await (await call(`/api/ai/recipes/${shakshuka.id}`)).json();
  assert.equal(again.title, 'شكشوكة');
});

test('slow answers come back as a job the owner can poll', async () => {
  const first = await call('/api/ai/fridge', { token, json: { ingredients: 'رز بطيء' } });
  assert.equal(first.status, 202);
  const { pending, job } = await first.json();
  assert.equal(pending, true);
  assert.equal((await call(`/api/ai/jobs/${job}`, { token: otherToken })).status, 404);
  const done = await until(async () => {
    const r = await call(`/api/ai/jobs/${job}`, { token });
    return r.status === 200 && r.json();
  });
  assert.equal(done.recipes.length, 1);
});

test('photo of a written recipe → the form fields', async () => {
  assert.equal((await call('/api/ai/photo-recipe', { token, json: {} })).status, 400);
  const res = await call('/api/ai/photo-recipe', { token, json: { image: `data:image/jpeg;base64,${JPEG.toString('base64')}` } });
  assert.equal(res.status, 200);
  const { recipe } = await res.json();
  assert.equal(recipe.title, 'كيكة ماما');
  assert.equal(recipe.notes, 'من كشكول ماما');
  assert.deepEqual(recipe.mealTypes, []); // the user picks the meal in the form
  const none = await call('/api/ai/photo-recipe', { token, json: { image: PNG.toString('base64') } });
  assert.equal(none.status, 422);
  assert.equal((await none.json()).error, 'no-recipe');
});

test('smart suggestion: picks a saved dish or a new one, always with a reason', async () => {
  assert.equal((await call('/api/ai/suggest', { token: adminToken, json: { meal: 'brunch' } })).status, 400);
  const saved = await (await call('/api/ai/suggest', {
    token: adminToken,
    json: { meal: 'lunch', allowNew: true, candidates: [{ key: 'local:1', title: 'محشي', liked: true, rating: 5 }, { key: 'darwish:2', title: 'كشري' }] },
  })).json();
  assert.deepEqual([saved.kind, saved.key, saved.reason], ['saved', 'local:1', 'النهارده الجمعة وانت بتحب المحشي.']);
  assert.equal(saved.remaining, null); // admins have no limit
  assert.match(calls.at(-1).messages[0].content, /Africa|Cairo|القاهرة/);

  const made = await (await call('/api/ai/suggest', { token: adminToken, json: { meal: 'dinner', candidates: [] } })).json();
  assert.equal(made.kind, 'new');
  assert.equal(made.recipe.title, 'عجة بالبقدونس');
  assert.deepEqual(made.recipe.mealTypes, ['dinner']);

  // A key Claude made up never reaches the app.
  const fixed = await (await call('/api/ai/suggest', { token: adminToken, json: { meal: 'lunch', allowNew: false, candidates: [{ key: 'local:9', title: 'فتة' }] } })).json();
  assert.deepEqual([fixed.kind, fixed.key], ['saved', 'local:9']);
});

test('the daily limit covers every AI feature', async () => {
  const t = await login('01000000003');
  for (let i = 0; i < 5; i++) assert.equal((await call('/api/ai/fridge', { token: t, json: { ingredients: `بيض ${i}` } })).status, 200);
  const limited = await call('/api/ai/suggest', { token: t, json: { meal: 'lunch', candidates: [] } });
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error, 'ai-daily-limit');
});

test('feed moderation: hides clear problems, flags doubtful posts, lets fixed posts back', async () => {
  await call('/api/me/profile', { token, method: 'PUT', json: { name: 'شيف سارة' } });
  const publish = async (clientId, title) =>
    (await call('/api/posts', { token, json: { clientId, recipe: { title, category: 'juice', ingredients: ['مانجا'], steps: ['اخلط'] } } })).json();

  const ad = await publish('r1', 'إعلان: كلمني على 0100');
  const odd = await publish('r2', 'وصفة غريبة');
  const good = await publish('r3', 'عصير مانجا');
  assert.equal(ad.hidden, false); // posts appear right away

  const flagged = await until(async () => {
    const { posts } = await (await call('/api/admin/posts?filter=ai', { token: adminToken })).json();
    return posts.length === 2 && posts;
  });
  const byId = Object.fromEntries(flagged.map((p) => [p.id, p]));
  assert.deepEqual([byId[ad.id].aiStatus, byId[ad.id].hidden, byId[ad.id].aiReason], ['block', true, 'دي إعلان مش وصفة.']);
  assert.deepEqual([byId[odd.id].aiStatus, byId[odd.id].hidden], ['review', false]);
  assert.equal(byId[good.id], undefined);
  const feed = (await (await call('/api/feed')).json()).posts.map((p) => p.id);
  assert.ok(!feed.includes(ad.id) && feed.includes(odd.id) && feed.includes(good.id));

  // The chef fixes it → the AI shows it again.
  await publish('r1', 'عصير مانجا بالحليب');
  await until(async () => !(await (await call(`/api/feed/${ad.id}`)).json()).hidden);

  // What an admin hides stays hidden, whatever the AI says later.
  await call(`/api/admin/posts/${good.id}`, { token: adminToken, method: 'PUT', json: { hidden: true } });
  await publish('r3', 'عصير مانجا فريش');
  await wait(150);
  const { posts } = await (await call('/api/admin/posts?filter=hidden', { token: adminToken })).json();
  assert.ok(posts.some((p) => p.id === good.id));
});

test('photo finder: free-license photo APIs, scored by the AI, reviewed or applied automatically', async () => {
  assert.equal((await call('/api/admin/ai/photos', { token })).status, 403);
  const start = await call('/api/admin/ai/photos/run', { token: adminToken, json: { mode: 'review' } });
  assert.equal(start.status, 202);
  assert.equal((await start.json()).run.total, 1); // runLimit
  assert.equal((await call('/api/admin/ai/photos/run', { token: adminToken, json: { mode: 'review' } })).status, 409);

  const done = await until(async () => {
    const o = await (await call('/api/admin/ai/photos', { token: adminToken })).json();
    return !o.run.running && o;
  });
  assert.equal(done.run.waiting, 1);
  assert.equal(done.items.length, 1);
  const [item] = done.items;
  assert.equal(item.candidates.length, 1); // the Flickr photo scored too low; NC and PNG files were never downloaded
  const [photo] = item.candidates;
  assert.deepEqual([photo.score, photo.author, photo.pageUrl, photo.source, photo.license], [9, 'Sara', `${PAGES}/wiki/p1`, 'Wikimedia Commons', 'CC BY-SA 4.0']);
  const file = await call(photo.image);
  assert.equal(file.headers.get('content-type'), 'image/jpeg');

  // English search words from Claude; both sources asked for free licenses only; the review saw 2 photos.
  assert.equal(sourceCalls[0].search, 'koshari filetype:bitmap');
  assert.match(sourceCalls[0].ua, /^DarwishKitchen\//);
  assert.equal(sourceCalls.find((c) => c.api === 'openverse').license, 'by,by-sa,cc0,pdm');
  const review = calls.findLast((c) => String(c.system).includes('You check photos for recipes'));
  assert.equal(review.messages[0].content.filter((b) => b.type === 'image').length, 2);

  const approved = await (await call(`/api/admin/ai/photos/${photo.id}/approve`, { token: adminToken, json: {} })).json();
  assert.match(approved.recipe.image, /^\/api\/catalog\/images\//);
  assert.deepEqual(approved.recipe.imageCredit, { source: 'Wikimedia Commons', url: `${PAGES}/wiki/p1`, author: 'Sara', license: 'CC BY-SA 4.0' });
  const catalog = (await (await call('/api/catalog')).json()).recipes;
  assert.equal(catalog.find((r) => r.id === item.recipe.id).imageCredit.author, 'Sara');
  assert.equal((await (await call('/api/admin/ai/photos', { token: adminToken })).json()).items.length, 0);
  assert.equal((await call(photo.image)).status, 404);

  // Auto mode puts a clearly good photo straight onto the recipe.
  const next = (await (await call('/api/admin/catalog', { token: adminToken })).json()).recipes.find((r) => !r.image);
  await call('/api/admin/ai/photos/run', { token: adminToken, json: { mode: 'auto', ids: [next.id] } });
  const auto = await until(async () => {
    const o = await (await call('/api/admin/ai/photos', { token: adminToken })).json();
    return !o.run.running && o;
  });
  assert.equal(auto.run.applied, 1);
  const updated = (await (await call('/api/admin/catalog', { token: adminToken })).json()).recipes.find((r) => r.id === next.id);
  assert.ok(updated.image);

  // A manual upload replaces the AI photo and its credit.
  const up = await fetch(`${base}/api/admin/catalog/${next.id}/image`, { method: 'PUT', headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'image/jpeg' }, body: JPEG });
  assert.equal((await up.json()).imageCredit, null);
});
