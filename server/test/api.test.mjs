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
const codes = new Map(); // phone → last dev code

before(async () => {
  app = createApp({ dataDir, otp: { devCodes: true, onDevCode: (phone, code) => codes.set(phone, code) } });
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

/** Full phone login: request a code, then verify it. Returns the session token. */
const signup = async (phone) => {
  const sent = await call('/api/auth/otp/send', { json: { phone } });
  assert.equal(sent.status, 200);
  const normalized = [...codes.keys()].at(-1);
  const res = await call('/api/auth/otp/verify', { json: { phone, code: codes.get(normalized) } });
  assert.equal(res.status, 200);
  return (await res.json()).token;
};

test('phone login with a code: new user, same user again, wrong and reused codes', async () => {
  // Egyptian local format is normalized to the international one.
  assert.equal((await call('/api/auth/otp/send', { json: { phone: '0100 123 4567' } })).status, 200);
  const code = codes.get('201001234567');
  assert.match(code, /^\d{6}$/);

  assert.equal((await call('/api/auth/otp/verify', { json: { phone: '01001234567', code: '000000' === code ? '111111' : '000000' } })).status, 400);
  const ok = await call('/api/auth/otp/verify', { json: { phone: '+201001234567', code } });
  assert.equal(ok.status, 200);
  const first = await ok.json();
  assert.equal(first.user.phone, '201001234567');
  assert.ok(first.token.length > 30);

  // The code works once.
  assert.equal((await call('/api/auth/otp/verify', { json: { phone: '01001234567', code } })).status, 400);

  // Logging in again gives the same account.
  const again = await signup('01001234567');
  const me = await (await call('/api/me', { token: again })).json();
  assert.equal(me.user.id, first.user.id);
  assert.equal(me.user.phone, '201001234567');

  assert.equal((await call('/api/auth/otp/send', { json: { phone: '123' } })).status, 400);
  assert.equal((await call('/api/auth/otp/verify', { json: { phone: '01001234567', code: 'abc' } })).status, 400);
});

test('locks a code after 5 wrong tries', async () => {
  await call('/api/auth/otp/send', { json: { phone: '01112223334' } });
  const code = codes.get('201112223334');
  const wrong = code === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) assert.equal((await call('/api/auth/otp/verify', { json: { phone: '01112223334', code: wrong } })).status, 400);
  assert.equal((await call('/api/auth/otp/verify', { json: { phone: '01112223334', code } })).status, 429);
});

test('requires a valid token', async () => {
  assert.equal((await call('/api/backup')).status, 401);
  assert.equal((await call('/api/backup', { token: 'made-up' })).status, 401);
});

test('backup round trip and validation', async () => {
  const token = await signup('01200000001');
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
  const token = await signup('01200000002');
  const other = await signup('01200000003');
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
  const token = await signup('01200000004');
  await call('/api/images/p.jpg', { token, method: 'PUT', body: JPEG, type: 'image/jpeg' });
  await call('/api/backup', { token, method: 'PUT', json: { data: { version: 1, recipes: [] } } });

  const second = await signup('01200000004');
  assert.equal((await call('/api/auth/logout', { token: second, method: 'POST' })).status, 204);
  assert.equal((await call('/api/me', { token: second })).status, 401);

  assert.equal((await call('/api/account', { token, method: 'DELETE' })).status, 204);
  assert.equal((await call('/api/me', { token })).status, 401);
  // Signing in with the same number later starts a fresh, empty account.
  const fresh = await signup('01200000004');
  assert.equal((await call('/api/backup', { token: fresh })).status, 404);
});

test('limits code requests per phone number', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kitchen-limit-'));
  const limitedApp = createApp({ dataDir: dir, otp: { devCodes: true, onDevCode: () => {} } });
  const limited = createServer(limitedApp);
  await new Promise((r) => limited.listen(0, '127.0.0.1', r));
  const sendCode = (phone) =>
    fetch(`http://127.0.0.1:${limited.address().port}/api/auth/otp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    }).then((r) => r.status);
  try {
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push(await sendCode('01555555555'));
    assert.deepEqual(statuses, [200, 200, 200, 429]);
    assert.equal(await sendCode('01555555556'), 200); // another number is still fine
  } finally {
    limited.close();
    limitedApp.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses the Darwish OTP platform when configured', async () => {
  // Fake platform: same contract the Quran site uses.
  const calls = [];
  const platform = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    calls.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/send') return res.end(JSON.stringify({ request_id: 'req-1', expires_in: 300 }));
    const { code } = JSON.parse(body);
    res.end(JSON.stringify({ valid: code === '424242' }));
  });
  await new Promise((r) => platform.listen(0, '127.0.0.1', r));
  const dir = mkdtempSync(join(tmpdir(), 'kitchen-otp-'));
  const remoteApp = createApp({ dataDir: dir, otp: { url: `http://127.0.0.1:${platform.address().port}/send`, token: 'secret' } });
  const remote = createServer(remoteApp);
  await new Promise((r) => remote.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${remote.address().port}`;
  const post = (p, json) => fetch(url + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) });

  try {
    assert.equal((await post('/api/auth/otp/send', { phone: '01009998887' })).status, 200);
    assert.deepEqual(calls[0], { path: '/send', auth: 'Bearer secret', body: { phone: '201009998887' } });
    assert.equal((await post('/api/auth/otp/verify', { phone: '01009998887', code: '111111' })).status, 400);
    assert.deepEqual(calls[1].body, { request_id: 'req-1', code: '111111' });
    assert.equal(calls[1].path, '/verify');
    const ok = await post('/api/auth/otp/verify', { phone: '01009998887', code: '424242' });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).user.phone, '201009998887');
  } finally {
    remote.close();
    remoteApp.close();
    platform.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('without OTP config, login is unavailable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kitchen-nootp-'));
  const offApp = createApp({ dataDir: dir });
  const off = createServer(offApp);
  await new Promise((r) => off.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${off.address().port}/api/auth/otp/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '01001234567' }),
    });
    assert.equal(res.status, 503);
    assert.deepEqual(await (await fetch(`http://127.0.0.1:${off.address().port}/api/health`)).json(), { ok: true, otp: false, ai: false });
  } finally {
    off.close();
    offApp.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upgrades a database from the email-login version without losing data', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = mkdtempSync(join(tmpdir(), 'kitchen-v1-'));
  const old = new DatabaseSync(join(dir, 'kitchen.db'));
  old.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE backups (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
    INSERT INTO users VALUES ('u1', 'old@example.com', 'scrypt$x$y', 1);
    INSERT INTO sessions VALUES ('${'a'.repeat(64)}', 'u1', 1, 99999999999999);
    INSERT INTO backups VALUES ('u1', '{"version":1,"recipes":[]}', 5);
  `);
  old.close();

  const upgraded = createApp({ dataDir: dir, otp: { devCodes: true, onDevCode: () => {} } });
  upgraded.close();
  const db = new DatabaseSync(join(dir, 'kitchen.db'));
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 4);
    const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
    assert.ok(cols.includes('phone'));
    assert.equal(db.prepare('SELECT email FROM users WHERE id = ?').get('u1').email, 'old@example.com');
    assert.equal(db.prepare('SELECT updated_at FROM backups WHERE user_id = ?').get('u1').updated_at, 5);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
