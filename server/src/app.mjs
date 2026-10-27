import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRateLimiter, DUMMY_HASH, hashPassword, hashToken, newToken, verifyPassword } from './auth.mjs';
import { openDb } from './db.mjs';

const SESSION_DAYS = 180;
const MAX_JSON = 10 * 1024 * 1024; // backup JSON
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_IMAGES_PER_USER = 2000;
const IMAGE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}\.jpg$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function send(res, status, body, headers = {}) {
  const isJson = body !== undefined && !Buffer.isBuffer(body);
  res.writeHead(status, {
    ...(isJson ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body === undefined ? undefined : isJson ? JSON.stringify(body) : body);
}

async function readBody(req, max) {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > max) throw new HttpError(413, 'too-large');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new HttpError(413, 'too-large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req, max = 64 * 1024) {
  if (!String(req.headers['content-type'] ?? '').includes('application/json')) throw new HttpError(415, 'json-required');
  try {
    return JSON.parse((await readBody(req, max)).toString('utf8'));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'bad-json');
  }
}

function clientIp(req) {
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
  // Only trust proxy headers when the request came through the local nginx.
  if (local) return String(req.headers['cf-connecting-ip'] ?? req.headers['x-real-ip'] ?? req.socket.remoteAddress);
  return req.socket.remoteAddress ?? 'unknown';
}

function credentials(body) {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!EMAIL.test(email) || email.length > 254) throw new HttpError(400, 'invalid-email');
  if (password.length < 8 || password.length > 200) throw new HttpError(400, 'weak-password');
  return { email, password };
}

/** Builds the request handler. `dataDir` holds the SQLite file and users' photos. */
export function createApp({ dataDir }) {
  const db = openDb(dataDir);
  const imagesRoot = join(dataDir, 'images');
  const authLimit = createRateLimiter({ limit: 20, windowMs: 15 * 60 * 1000 });

  const q = {
    userByEmail: db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?'),
    insertUser: db.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    session: db.prepare(
      'SELECT s.user_id AS userId, u.email AS email, s.expires_at AS expiresAt FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
    ),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteExpired: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
    backup: db.prepare('SELECT data, updated_at AS updatedAt FROM backups WHERE user_id = ?'),
    backupDate: db.prepare('SELECT updated_at AS updatedAt FROM backups WHERE user_id = ?'),
    upsertBackup: db.prepare(
      'INSERT INTO backups (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
    ),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
  };

  const startSession = (userId, email) => {
    const token = newToken();
    const now = Date.now();
    q.insertSession.run(hashToken(token), userId, now, now + SESSION_DAYS * 86_400_000);
    if (Math.random() < 0.05) q.deleteExpired.run(now);
    return { token, user: { id: userId, email } };
  };

  const requireUser = (req) => {
    const match = /^Bearer\s+(\S+)$/.exec(String(req.headers.authorization ?? ''));
    if (!match) throw new HttpError(401, 'signed-out');
    const row = q.session.get(hashToken(match[1]));
    if (!row || row.expiresAt < Date.now()) throw new HttpError(401, 'signed-out');
    return { userId: row.userId, email: row.email, tokenHash: hashToken(match[1]) };
  };

  const userDir = (userId) => join(imagesRoot, userId);
  const imagePath = (userId, name) => {
    if (!IMAGE_NAME.test(name) || name.includes('..')) throw new HttpError(400, 'bad-name');
    return join(userDir(userId), name);
  };
  const listImages = async (userId) => {
    try {
      return (await readdir(userDir(userId))).filter((n) => IMAGE_NAME.test(n));
    } catch {
      return [];
    }
  };

  async function route(req, res, path) {
    const m = req.method;

    if (path === '/api/health' && m === 'GET') return send(res, 200, { ok: true });

    if ((path === '/api/auth/signup' || path === '/api/auth/login') && m === 'POST') {
      if (!authLimit(clientIp(req))) throw new HttpError(429, 'too-many-attempts');
      const { email, password } = credentials(await readJson(req));
      if (path === '/api/auth/signup') {
        if (q.userByEmail.get(email)) throw new HttpError(409, 'email-taken');
        const id = randomUUID();
        q.insertUser.run(id, email, await hashPassword(password), Date.now());
        return send(res, 201, startSession(id, email));
      }
      const user = q.userByEmail.get(email);
      const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
      if (!user || !ok) throw new HttpError(401, 'invalid-login');
      return send(res, 200, startSession(user.id, user.email));
    }

    if (path === '/api/auth/logout' && m === 'POST') {
      const { tokenHash } = requireUser(req);
      q.deleteSession.run(tokenHash);
      return send(res, 204);
    }

    if (path === '/api/me' && m === 'GET') {
      const { userId, email } = requireUser(req);
      return send(res, 200, { user: { id: userId, email } });
    }

    if (path === '/api/backup') {
      const { userId } = requireUser(req);
      if (m === 'GET') {
        const row = q.backup.get(userId);
        if (!row) throw new HttpError(404, 'no-backup');
        return send(res, 200, Buffer.from(`{"updatedAt":${row.updatedAt},"data":${row.data}}`), { 'Content-Type': 'application/json; charset=utf-8' });
      }
      if (m === 'PUT') {
        const body = await readJson(req, MAX_JSON);
        const data = body?.data;
        if (!data || typeof data !== 'object' || data.version !== 1 || !Array.isArray(data.recipes)) {
          throw new HttpError(400, 'bad-backup');
        }
        const updatedAt = Date.now();
        q.upsertBackup.run(userId, JSON.stringify(data), updatedAt);
        return send(res, 200, { updatedAt });
      }
    }

    if (path === '/api/backup/meta' && m === 'GET') {
      const { userId } = requireUser(req);
      return send(res, 200, { updatedAt: q.backupDate.get(userId)?.updatedAt ?? null });
    }

    if (path === '/api/images' && m === 'GET') {
      const { userId } = requireUser(req);
      return send(res, 200, { names: await listImages(userId) });
    }

    if (path === '/api/images' && m === 'DELETE') {
      const { userId } = requireUser(req);
      const body = await readJson(req, 256 * 1024);
      const names = Array.isArray(body?.names) ? body.names.filter((n) => typeof n === 'string') : [];
      for (const name of names) await rm(imagePath(userId, name), { force: true });
      return send(res, 204);
    }

    const image = /^\/api\/images\/([^/]+)$/.exec(path);
    if (image) {
      const { userId } = requireUser(req);
      const file = imagePath(userId, decodeURIComponent(image[1]));
      if (m === 'GET') {
        try {
          return send(res, 200, await readFile(file), { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' });
        } catch {
          throw new HttpError(404, 'not-found');
        }
      }
      if (m === 'PUT') {
        if (!String(req.headers['content-type'] ?? '').startsWith('image/jpeg')) throw new HttpError(415, 'jpeg-required');
        const bytes = await readBody(req, MAX_IMAGE);
        if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new HttpError(400, 'not-jpeg');
        const exists = await stat(file).then(() => true, () => false);
        if (!exists && (await listImages(userId)).length >= MAX_IMAGES_PER_USER) throw new HttpError(507, 'too-many-images');
        await mkdir(userDir(userId), { recursive: true, mode: 0o700 });
        await writeFile(file, bytes, { mode: 0o600 });
        return send(res, 204);
      }
    }

    if (path === '/api/account' && m === 'DELETE') {
      const { userId } = requireUser(req);
      await rm(userDir(userId), { recursive: true, force: true });
      q.deleteUser.run(userId); // Sessions and backup go with it (ON DELETE CASCADE).
      return send(res, 204);
    }

    throw new HttpError(404, 'not-found');
  }

  const handler = async (req, res) => {
    // The mobile app and local web dev call from other origins; auth is a bearer token, not a cookie.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return send(res, 204);
    try {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      await route(req, res, path);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.code });
      console.error(new Date().toISOString(), req.method, req.url, e);
      if (!res.headersSent) send(res, 500, { error: 'server-error' });
    }
  };
  handler.close = () => db.close();
  return handler;
}
