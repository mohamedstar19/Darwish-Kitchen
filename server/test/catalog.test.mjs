import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.mjs';

const seedFile = fileURLToPath(new URL('../../src/data/starter-recipes.json', import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), 'kitchen-catalog-'));
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 9]);
const codes = new Map();
let app, server, base, admin, user;

const call = (path, { token, json, body, method = json ? 'POST' : 'GET', type } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(json ? { 'Content-Type': 'application/json' } : type ? { 'Content-Type': type } : {}),
    },
    body: json ? JSON.stringify(json) : body,
  });

const login = async (phone) => {
  await call('/api/auth/otp/send', { json: { phone } });
  const res = await call('/api/auth/otp/verify', { json: { phone, code: codes.get(`20${phone.slice(1)}`) } });
  return res.json();
};

before(async () => {
  app = createApp({ dataDir, seedFile, admins: ['01000000001'], otp: { devCodes: true, onDevCode: (p, c) => codes.set(p, c) } });
  server = createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const a = await login('01000000001');
  const u = await login('01000000002');
  assert.equal(a.user.isAdmin, true);
  assert.equal(u.user.isAdmin, false);
  admin = a.token;
  user = u.token;
});
after(() => {
  server.close();
  app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test('a new catalog starts with the starter recipes', async () => {
  const { recipes } = await (await call('/api/catalog')).json();
  assert.equal(recipes.length, 16);
  const molokhia = recipes.find((r) => r.id === 'sample-molokhia');
  assert.equal(molokhia.title, 'ملوخية بالفراخ');
  assert.equal(molokhia.category, 'food');
  assert.deepEqual(molokhia.mealTypes, ['lunch']);
  assert.equal(molokhia.image, null);
  assert.equal(recipes.filter((r) => r.category === 'juice').length, 5);
});

test('only admins can use the control panel', async () => {
  assert.equal((await call('/api/admin/catalog')).status, 401);
  assert.equal((await call('/api/admin/catalog', { token: user })).status, 403);
  assert.equal((await call('/api/admin/catalog', { token: user, json: { title: 'x', category: 'juice' } })).status, 403);
  assert.equal((await call('/api/admin/catalog', { token: admin })).status, 200);
  assert.equal((await (await call('/api/me', { token: admin })).json()).user.isAdmin, true);
});

test('admin adds a juice with a photo, edits, hides and deletes it', async () => {
  const created = await call('/api/admin/catalog', {
    token: admin,
    json: { title: '  عصير قصب ', category: 'juice', mealTypes: ['lunch'], ingredients: ['قصب', '', 'تلج'], steps: ['اعصر'], prepMinutes: '10', servings: 'x' },
  });
  assert.equal(created.status, 201);
  const juice = await created.json();
  assert.match(juice.id, /^c-[a-f0-9]{12}$/);
  assert.equal(juice.title, 'عصير قصب');
  assert.deepEqual(juice.mealTypes, []); // drinks don't keep meal types
  assert.deepEqual(juice.ingredients, ['قصب', 'تلج']);
  assert.equal(juice.prepMinutes, 10);
  assert.equal(juice.servings, null);
  assert.equal(juice.published, true);

  // Photo upload → public URL.
  const withPhoto = await (await call(`/api/admin/catalog/${juice.id}/image`, { token: admin, method: 'PUT', body: JPEG, type: 'image/jpeg' })).json();
  assert.match(withPhoto.image, /^\/api\/catalog\/images\/c-[a-f0-9]{12}-[a-f0-9]{12}\.jpg$/);
  const photo = await call(withPhoto.image);
  assert.equal(photo.status, 200);
  assert.match(photo.headers.get('cache-control'), /immutable/);
  assert.deepEqual(Buffer.from(await photo.arrayBuffer()), JPEG);

  // Replacing the photo removes the old file.
  const replaced = await (await call(`/api/admin/catalog/${juice.id}/image`, { token: admin, method: 'PUT', body: JPEG, type: 'image/jpeg' })).json();
  assert.notEqual(replaced.image, withPhoto.image);
  assert.equal((await call(withPhoto.image)).status, 404);
  assert.equal(readdirSync(join(dataDir, 'catalog-images')).length, 1);

  // Hidden recipes disappear from the public list but stay in the admin list.
  const hidden = await call(`/api/admin/catalog/${juice.id}`, { token: admin, method: 'PUT', json: { ...juice, title: 'عصير قصب ساقع', published: false } });
  assert.equal((await hidden.json()).title, 'عصير قصب ساقع');
  assert.ok(!(await (await call('/api/catalog')).json()).recipes.some((r) => r.id === juice.id));
  assert.ok((await (await call('/api/admin/catalog', { token: admin })).json()).recipes.some((r) => r.id === juice.id && !r.published));

  assert.equal((await call(`/api/admin/catalog/${juice.id}`, { token: admin, method: 'DELETE' })).status, 204);
  assert.equal((await call(`/api/admin/catalog/${juice.id}`, { token: admin, method: 'DELETE' })).status, 404);
  assert.equal(readdirSync(join(dataDir, 'catalog-images')).length, 0);
});

test('admin can add a photo to a starter recipe', async () => {
  const res = await call('/api/admin/catalog/sample-koshari/image', { token: admin, method: 'PUT', body: JPEG, type: 'image/jpeg' });
  assert.equal(res.status, 200);
  const koshari = (await (await call('/api/catalog')).json()).recipes.find((r) => r.id === 'sample-koshari');
  assert.ok(koshari.image.startsWith('/api/catalog/images/sample-koshari-'));
});

test('validates input', async () => {
  assert.equal((await call('/api/admin/catalog', { token: admin, json: { title: '' } })).status, 400);
  assert.equal((await call('/api/admin/catalog', { token: admin, json: { title: 'كبسة', category: 'food' } })).status, 400); // food needs a meal
  assert.equal((await call('/api/admin/catalog/sample-foul/image', { token: admin, method: 'PUT', body: Buffer.from('nope'), type: 'image/jpeg' })).status, 400);
  assert.equal((await call('/api/admin/catalog/..%2F..%2Fkitchen.db', { token: admin, method: 'DELETE' })).status, 404);
  assert.equal((await call('/api/catalog/images/..%2Fkitchen.db')).status, 404);
});

test('deleting starters is permanent (no re-seed on restart)', async () => {
  for (const r of (await (await call('/api/admin/catalog', { token: admin })).json()).recipes) {
    await call(`/api/admin/catalog/${r.id}`, { token: admin, method: 'DELETE' });
  }
  const again = createApp({ dataDir, seedFile });
  again.close();
  assert.equal((await (await call('/api/catalog')).json()).recipes.length, 0);
  assert.ok(existsSync(join(dataDir, 'kitchen.db')));
});
