import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRateLimiter, hashToken, newToken } from './auth.mjs';
import { createAi } from './ai.mjs';
import { createCatalog } from './catalog.mjs';
import { openDb } from './db.mjs';
import { clientIp, HttpError, readBody, readJson, send } from './http.mjs';
import { createOtp, normalizePhone } from './otp.mjs';
import { createPosts } from './posts.mjs';

const SESSION_DAYS = 180;
const MAX_JSON = 10 * 1024 * 1024; // backup JSON
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_IMAGES_PER_USER = 2000;
const IMAGE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}\.jpg$/;
const MAX_CODE_ATTEMPTS = 5;

function phoneFrom(body) {
  const phone = normalizePhone(body?.phone);
  if (!phone) throw new HttpError(400, 'invalid-phone');
  return phone;
}

/**
 * Builds the request handler. `dataDir` holds the SQLite file and users' photos.
 * `otp` configures login codes (see otp.mjs): { url, token } for Darwish OTP, or { devCodes, onDevCode } for tests.
 * `admins`: phone numbers allowed into the control panel. `seedFile`: starter recipes for a new catalog.
 * `ai`: AI features (see ai.mjs) — { apiKey, model, dailyLimit, … }; all off without an API key.
 */
export function createApp({ dataDir, otp: otpConfig = {}, admins = [], seedFile, ai: aiConfig = {} }) {
  const db = openDb(dataDir);
  const adminPhones = new Set(admins.map((p) => normalizePhone(p)).filter(Boolean));
  const catalog = createCatalog({ db, dataDir, seedFile });
  const posts = createPosts({ db, dataDir, onChange: (id) => ai.postChanged(id) });
  const ai = createAi({ db, dataDir, catalog, ...aiConfig });
  const imagesRoot = join(dataDir, 'images');
  const otp = createOtp(otpConfig);
  const sendPerIp = createRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000 });
  const sendPerPhone = createRateLimiter({ limit: 3, windowMs: 10 * 60 * 1000 });
  const verifyPerIp = createRateLimiter({ limit: 30, windowMs: 15 * 60 * 1000 });

  const q = {
    userByPhone: db.prepare('SELECT id, phone FROM users WHERE phone = ?'),
    insertUser: db.prepare('INSERT INTO users (id, phone, created_at) VALUES (?, ?, ?)'),
    otpRequest: db.prepare('SELECT request_id, code_hash, attempts, expires_at FROM otp_requests WHERE phone = ?'),
    saveOtpRequest: db.prepare(
      'INSERT INTO otp_requests (phone, request_id, code_hash, attempts, expires_at, created_at) VALUES (?, ?, ?, 0, ?, ?) ON CONFLICT(phone) DO UPDATE SET request_id = excluded.request_id, code_hash = excluded.code_hash, attempts = 0, expires_at = excluded.expires_at, created_at = excluded.created_at',
    ),
    otpFailed: db.prepare('UPDATE otp_requests SET attempts = attempts + 1 WHERE phone = ?'),
    deleteOtpRequest: db.prepare('DELETE FROM otp_requests WHERE phone = ?'),
    deleteExpiredOtp: db.prepare('DELETE FROM otp_requests WHERE expires_at < ?'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    session: db.prepare(
      'SELECT s.user_id AS userId, u.phone AS phone, s.expires_at AS expiresAt FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
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

  const startSession = (userId, phone) => {
    const token = newToken();
    const now = Date.now();
    q.insertSession.run(hashToken(token), userId, now, now + SESSION_DAYS * 86_400_000);
    if (Math.random() < 0.05) {
      q.deleteExpired.run(now);
      q.deleteExpiredOtp.run(now);
    }
    return { token, user: { id: userId, phone, isAdmin: adminPhones.has(phone) } };
  };

  const requireUser = (req) => {
    const match = /^Bearer\s+(\S+)$/.exec(String(req.headers.authorization ?? ''));
    if (!match) throw new HttpError(401, 'signed-out');
    const row = q.session.get(hashToken(match[1]));
    // Old email-only accounts (no phone) must sign in again with a phone number.
    if (!row || row.expiresAt < Date.now() || !row.phone) throw new HttpError(401, 'signed-out');
    return { userId: row.userId, phone: row.phone, tokenHash: hashToken(match[1]) };
  };

  const requireAdmin = (req) => {
    const user = requireUser(req);
    if (!adminPhones.has(user.phone)) throw new HttpError(403, 'not-admin');
    return user;
  };

  /** The signed-in user, or null for visitors (and for expired logins) on public pages. */
  const optionalUser = (req) => {
    if (!req.headers.authorization) return null;
    try {
      return requireUser(req);
    } catch {
      return null;
    }
  };
  const isAdmin = (user) => adminPhones.has(user.phone);

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

    if (path === '/api/health' && m === 'GET') return send(res, 200, { ok: true, otp: otp.enabled, ai: ai.enabled });

    if (path === '/api/auth/otp/send' && m === 'POST') {
      const phone = phoneFrom(await readJson(req));
      if (!otp.enabled) throw new HttpError(503, 'otp-unavailable');
      if (!sendPerIp(clientIp(req)) || !sendPerPhone(phone)) throw new HttpError(429, 'too-many-attempts');
      let sent;
      try {
        sent = await otp.send(phone);
      } catch (e) {
        console.error(new Date().toISOString(), 'OTP send failed', e.message);
        throw new HttpError(502, 'otp-send-failed');
      }
      const now = Date.now();
      q.saveOtpRequest.run(phone, sent.requestId ?? null, sent.codeHash ?? null, now + sent.expiresIn * 1000, now);
      return send(res, 200, { expiresIn: sent.expiresIn });
    }

    if (path === '/api/auth/otp/verify' && m === 'POST') {
      if (!verifyPerIp(clientIp(req))) throw new HttpError(429, 'too-many-attempts');
      const body = await readJson(req);
      const phone = phoneFrom(body);
      const code = typeof body?.code === 'string' ? body.code.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))) : '';
      if (!/^\d{4,8}$/.test(code)) throw new HttpError(400, 'wrong-code');
      const record = q.otpRequest.get(phone);
      if (!record || record.expires_at < Date.now()) throw new HttpError(400, 'code-expired');
      if (record.attempts >= MAX_CODE_ATTEMPTS) {
        q.deleteOtpRequest.run(phone);
        throw new HttpError(429, 'too-many-attempts');
      }
      let valid;
      try {
        valid = await otp.check(phone, record, code);
      } catch (e) {
        console.error(new Date().toISOString(), 'OTP verify failed', e.message);
        throw new HttpError(502, 'otp-send-failed');
      }
      if (!valid) {
        q.otpFailed.run(phone);
        throw new HttpError(400, 'wrong-code');
      }
      q.deleteOtpRequest.run(phone);
      let user = q.userByPhone.get(phone);
      if (!user) {
        user = { id: randomUUID(), phone };
        q.insertUser.run(user.id, phone, Date.now());
      }
      return send(res, 200, startSession(user.id, phone));
    }

    if (path === '/api/auth/logout' && m === 'POST') {
      const { tokenHash } = requireUser(req);
      q.deleteSession.run(tokenHash);
      return send(res, 204);
    }

    if (path === '/api/me' && m === 'GET') {
      const { userId, phone } = requireUser(req);
      const pub = posts.userProfile(userId) ?? {};
      return send(res, 200, {
        user: { id: userId, phone, isAdmin: adminPhones.has(phone), name: pub.name ?? null, avatar: pub.avatar ? `/api/avatars/${pub.avatar}` : null },
      });
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
      await posts.deleteUserFiles(userId);
      q.deleteUser.run(userId); // Sessions and backup go with it (ON DELETE CASCADE).
      return send(res, 204);
    }

    if (await posts.route(req, res, path, { requireUser, optionalUser, isAdmin })) return;
    if (await ai.route(req, res, path, { requireUser, requireAdmin, isAdmin })) return;
    if (await catalog.route(req, res, path, requireAdmin)) return;

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
