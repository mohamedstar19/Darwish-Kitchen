import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.mjs';

const dataDir = mkdtempSync(join(tmpdir(), 'kitchen-posts-'));
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 7, 7, 7, 7]);
const codes = new Map();
let app, server, base;
const t = {}; // tokens

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
  return (await (await call('/api/auth/otp/verify', { json: { phone, code: codes.get(`20${phone.slice(1)}`) } })).json()).token;
};
const juice = (title) => ({ title, category: 'juice', ingredients: ['برتقال'], steps: ['اعصر'] });

before(async () => {
  app = createApp({ dataDir, admins: ['01000000009'], otp: { devCodes: true, onDevCode: (p, c) => codes.set(p, c) } });
  server = createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  t.sara = await login('01000000001');
  t.omar = await login('01000000002');
  t.admin = await login('01000000009');
});
after(() => {
  server.close();
  app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test('publishing needs a chef name; same clientId updates the same post', async () => {
  assert.equal((await call('/api/posts', { token: t.sara, json: { clientId: 'r1', recipe: juice('عصير برتقال') } })).status, 400);
  assert.equal((await call('/api/me/profile', { token: t.sara, method: 'PUT', json: { name: ' ' } })).status, 400);
  assert.equal((await call('/api/me/profile', { token: t.sara, method: 'PUT', json: { name: '  سارة   الشيف ' } })).status, 200);

  const created = await call('/api/posts', { token: t.sara, json: { clientId: 'r1', recipe: juice('عصير برتقال') } });
  assert.equal(created.status, 201);
  const post = await created.json();
  assert.match(post.id, /^p-[a-f0-9]{12}$/);
  assert.equal(post.author.name, 'سارة الشيف');
  assert.equal(post.mine, true);

  const updated = await (await call('/api/posts', { token: t.sara, json: { clientId: 'r1', recipe: juice('عصير برتقال بالجزر') } })).json();
  assert.equal(updated.id, post.id);
  assert.equal(updated.title, 'عصير برتقال بالجزر');

  // Photo + avatar
  const withImage = await (await call(`/api/posts/${post.id}/image`, { token: t.sara, method: 'PUT', body: JPEG, type: 'image/jpeg' })).json();
  assert.match(withImage.image, /^\/api\/feed\/images\/p-[a-f0-9]{12}-[a-f0-9]{12}\.jpg$/);
  assert.equal((await call(withImage.image)).status, 200);
  const avatar = await (await call('/api/me/avatar', { token: t.sara, method: 'PUT', body: JPEG, type: 'image/jpeg' })).json();
  assert.equal((await call(avatar.avatar)).status, 200);
  const me = await (await call('/api/me', { token: t.sara })).json();
  assert.equal(me.user.name, 'سارة الشيف');
  assert.equal(me.user.avatar, avatar.avatar);

  // Others can't change it.
  assert.equal((await call(`/api/posts/${post.id}/image`, { token: t.omar, method: 'PUT', body: JPEG, type: 'image/jpeg' })).status, 403);
  assert.equal((await call(`/api/posts/${post.id}`, { token: t.omar, method: 'DELETE' })).status, 403);
});

test('feed is public, newest first, filterable and paged; likes are per user', async () => {
  await call('/api/me/profile', { token: t.omar, method: 'PUT', json: { name: 'عمر' } });
  for (let i = 0; i < 3; i++) {
    await call('/api/posts', { token: t.omar, json: { clientId: `o${i}`, recipe: { title: `كبسة ${i}`, category: 'food', mealTypes: ['lunch'] } } });
  }
  const all = await (await call('/api/feed')).json();
  assert.deepEqual(all.posts.map((p) => p.title), ['كبسة 2', 'كبسة 1', 'كبسة 0', 'عصير برتقال بالجزر']);
  assert.equal(all.posts[0].author.name, 'عمر');
  assert.equal(all.posts[0].mine, false);
  assert.equal(all.posts[0].clientId, undefined); // never leak another chef's ids

  const juices = await (await call('/api/feed?category=juice')).json();
  assert.deepEqual(juices.posts.map((p) => p.title), ['عصير برتقال بالجزر']);

  const page1 = await (await call('/api/feed?limit=2')).json();
  assert.equal(page1.posts.length, 2);
  const page2 = await (await call(`/api/feed?limit=2&before=${page1.next}`)).json();
  assert.deepEqual(page2.posts.map((p) => p.title), ['كبسة 0', 'عصير برتقال بالجزر']);

  const target = all.posts.at(-1).id;
  assert.deepEqual(await (await call(`/api/posts/${target}/like`, { token: t.omar, json: {} })).json(), { likes: 1, likedByMe: true });
  assert.deepEqual(await (await call(`/api/posts/${target}/like`, { token: t.omar, json: {} })).json(), { likes: 1, likedByMe: true });
  assert.deepEqual(await (await call(`/api/posts/${target}/like`, { token: t.admin, json: {} })).json(), { likes: 2, likedByMe: true });
  const seenByOmar = (await (await call('/api/feed?category=juice', { token: t.omar })).json()).posts[0];
  assert.equal(seenByOmar.likes, 2);
  assert.equal(seenByOmar.likedByMe, true);
  assert.equal((await (await call('/api/feed?category=juice')).json()).posts[0].likedByMe, false);
  assert.deepEqual(await (await call(`/api/posts/${target}/like`, { token: t.omar, method: 'DELETE' })).json(), { likes: 1, likedByMe: false });
  assert.equal((await call(`/api/posts/${target}/like`, { json: {} })).status, 401);
});

test('reports and admin moderation', async () => {
  const sara = (await (await call('/api/feed?category=juice')).json()).posts[0];
  assert.equal((await call(`/api/posts/${sara.id}/report`, { token: t.sara, json: {} })).status, 400); // own post
  assert.equal((await call(`/api/posts/${sara.id}/report`, { token: t.omar, json: { reason: 'مش مناسبة' } })).status, 204);

  assert.equal((await call('/api/admin/posts', { token: t.omar })).status, 403);
  const reported = (await (await call('/api/admin/posts?filter=reported', { token: t.admin })).json()).posts;
  assert.deepEqual(reported.map((p) => [p.id, p.reports]), [[sara.id, 1]]);

  // Hide → gone from the feed, still visible to its chef.
  assert.equal((await (await call(`/api/admin/posts/${sara.id}`, { token: t.admin, method: 'PUT', json: { hidden: true } })).json()).hidden, true);
  assert.ok(!(await (await call('/api/feed')).json()).posts.some((p) => p.id === sara.id));
  assert.equal((await call(`/api/feed/${sara.id}`)).status, 404);
  assert.equal((await call(`/api/feed/${sara.id}`, { token: t.sara })).status, 200);
  await call(`/api/admin/posts/${sara.id}`, { token: t.admin, method: 'PUT', json: { hidden: false } });
  assert.ok((await (await call('/api/feed')).json()).posts.some((p) => p.id === sara.id));

  // Admin can delete anyone's post.
  const kabsa = (await (await call('/api/feed?category=food')).json()).posts[0];
  assert.equal((await call(`/api/posts/${kabsa.id}`, { token: t.admin, method: 'DELETE' })).status, 204);
  assert.equal((await call(`/api/feed/${kabsa.id}`)).status, 404);
});

test('deleting an account removes the chef posts and photos', async () => {
  assert.ok(readdirSync(join(dataDir, 'post-images')).length > 0);
  assert.equal((await call('/api/account', { token: t.sara, method: 'DELETE' })).status, 204);
  assert.ok(!(await (await call('/api/feed')).json()).posts.some((p) => p.author.name === 'سارة الشيف'));
  assert.equal(readdirSync(join(dataDir, 'post-images')).length, 0);
  assert.equal(readdirSync(join(dataDir, 'avatars')).length, 0);
});

test('rejects bad input', async () => {
  assert.equal((await call('/api/posts', { token: t.omar, json: { clientId: '../x', recipe: juice('x') } })).status, 400);
  assert.equal((await call('/api/posts', { token: t.omar, json: { clientId: 'ok', recipe: { title: '' } } })).status, 400);
  assert.equal((await call('/api/feed/images/..%2F..%2Fkitchen.db')).status, 404);
  assert.equal((await call('/api/feed/nope')).status, 404);
  assert.equal((await call('/api/me/avatar', { token: t.omar, method: 'PUT', body: Buffer.from('x'), type: 'image/jpeg' })).status, 400);
});
