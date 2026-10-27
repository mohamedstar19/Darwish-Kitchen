import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.mjs';

let base;
let server;
let app;
const dataDir = mkdtempSync(join(tmpdir(), 'kitchen-test-'));
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

before(async () => {
  app = createApp({ dataDir });
  server = createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const call = (path, { token, json, body, method = json ? 'POST' : 'GET', type } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(json ? { 'Content-Type': 'application/json' } : type ? { 'Content-Type': type } : {}),
    },
    body: json ? JSON.stringify(json) : body,
  });

const signup = async (email) => (await (await call('/api/auth/signup', { json: { email, password: 'secret-pass' } })).json()).token;

test('signup, login, wrong password, duplicate email', async () => {
  const res = await call('/api/auth/signup', { json: { email: 'A@Example.com', password: 'secret-pass' } });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.user.email, 'a@example.com');
  assert.ok(body.token.length > 30);

  assert.equal((await call('/api/auth/signup', { json: { email: 'a@example.com', password: 'secret-pass' } })).status, 409);
  assert.equal((await call('/api/auth/login', { json: { email: 'a@example.com', password: 'nope-nope' } })).status, 401);
  assert.equal((await call('/api/auth/login', { json: { email: 'nobody@example.com', password: 'nope-nope' } })).status, 401);
  assert.equal((await call('/api/auth/signup', { json: { email: 'bad', password: 'secret-pass' } })).status, 400);
  assert.equal((await call('/api/auth/signup', { json: { email: 'b@example.com', password: 'short' } })).status, 400);

  const login = await call('/api/auth/login', { json: { email: 'a@example.com', password: 'secret-pass' } });
  assert.equal(login.status, 200);
  const me = await call('/api/me', { token: (await login.json()).token });
  assert.equal((await me.json()).user.email, 'a@example.com');
});

test('requires a valid token', async () => {
  assert.equal((await call('/api/backup')).status, 401);
  assert.equal((await call('/api/backup', { token: 'made-up' })).status, 401);
});

test('backup round trip and validation', async () => {
  const token = await signup('c@example.com');
  assert.equal((await call('/api/backup', { token })).status, 404);
  assert.deepEqual(await (await call('/api/backup/meta', { token })).json(), { updatedAt: null });

  const data = { version: 1, createdAt: 1, recipes: [{ id: 'x', title: 'كشري' }], profile: { name: 'محمد' }, activity: null };
  const put = await call('/api/backup', { token, method: 'PUT', json: { data } });
  assert.equal(put.status, 200);
  const got = await (await call('/api/backup', { token })).json();
  assert.deepEqual(got.data, data);
  assert.ok(got.updatedAt > 0);

  assert.equal((await call('/api/backup', { token, method: 'PUT', json: { data: { version: 2 } } })).status, 400);
});

test('images: upload, list, download, isolation, delete, bad input', async () => {
  const token = await signup('d@example.com');
  const other = await signup('e@example.com');
  assert.equal((await call('/api/images/a1.jpg', { token, method: 'PUT', body: JPEG, type: 'image/jpeg' })).status, 204);
  assert.deepEqual((await (await call('/api/images', { token })).json()).names, ['a1.jpg']);
  const img = await call('/api/images/a1.jpg', { token });
  assert.equal(img.status, 200);
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), JPEG);

  // Another user can't see it.
  assert.equal((await call('/api/images/a1.jpg', { token: other })).status, 404);
  assert.deepEqual((await (await call('/api/images', { token: other })).json()).names, []);

  assert.equal((await call('/api/images/..%2Fkitchen.db', { token })).status, 400);
  assert.equal((await call('/api/images/x.jpg', { token, method: 'PUT', body: Buffer.from('hello'), type: 'image/jpeg' })).status, 400);
  assert.equal((await call('/api/images/x.jpg', { token, method: 'PUT', body: JPEG, type: 'image/png' })).status, 415);

  assert.equal((await call('/api/images', { token, method: 'DELETE', json: { names: ['a1.jpg'] } })).status, 204);
  assert.deepEqual((await (await call('/api/images', { token })).json()).names, []);
});

test('logout revokes the token; delete account removes everything', async () => {
  const token = await signup('f@example.com');
  await call('/api/images/p.jpg', { token, method: 'PUT', body: JPEG, type: 'image/jpeg' });
  await call('/api/backup', { token, method: 'PUT', json: { data: { version: 1, recipes: [] } } });

  const second = (await (await call('/api/auth/login', { json: { email: 'f@example.com', password: 'secret-pass' } })).json()).token;
  assert.equal((await call('/api/auth/logout', { token: second, method: 'POST' })).status, 204);
  assert.equal((await call('/api/me', { token: second })).status, 401);

  assert.equal((await call('/api/account', { token, method: 'DELETE' })).status, 204);
  assert.equal((await call('/api/me', { token })).status, 401);
  assert.equal((await call('/api/auth/login', { json: { email: 'f@example.com', password: 'secret-pass' } })).status, 401);
  // Email is free again.
  assert.equal((await call('/api/auth/signup', { json: { email: 'f@example.com', password: 'secret-pass' } })).status, 201);
});

test('rate limits repeated login attempts', async () => {
  let last;
  for (let i = 0; i < 25; i++) last = await call('/api/auth/login', { json: { email: 'g@example.com', password: 'wrong-pass' } });
  assert.equal(last.status, 429);
});
