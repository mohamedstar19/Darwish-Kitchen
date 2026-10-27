import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRateLimiter } from './auth.mjs';
import { HttpError, readBody, readJson, send } from './http.mjs';
import { cleanRecipe } from './recipe.mjs';

/**
 * Chefs feed: recipes customers publish for everyone, plus each chef's public name and photo.
 *
 * Public (login optional, adds likedByMe/mine):
 *   GET  /api/feed?category=&before=<createdAt>&limit=    newest first
 *   GET  /api/feed/:id
 *   GET  /api/feed/images/:name   GET /api/avatars/:name
 * Signed in:
 *   PUT  /api/me/profile {name}       PUT|DELETE /api/me/avatar (JPEG)
 *   POST /api/posts {clientId, recipe}  (same clientId updates the same post)
 *   PUT|DELETE /api/posts/:id/image   DELETE /api/posts/:id   (owner; admin may delete)
 *   POST|DELETE /api/posts/:id/like   POST /api/posts/:id/report {reason}
 * Admin:
 *   GET  /api/admin/posts?filter=reported|hidden|all   PUT /api/admin/posts/:id {hidden}
 */

const POST_ID = /^p-[a-f0-9]{12}$/;
const CLIENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const IMAGE = /^[a-z0-9-]{1,40}-[a-f0-9]{12}\.jpg$/;
const MAX_IMAGE = 5 * 1024 * 1024;
const CATEGORIES = new Set(['food', 'healthy-drink', 'juice']);

const isJpeg = (b) => b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

export function createPosts({ db, dataDir }) {
  const postImages = join(dataDir, 'post-images');
  const avatars = join(dataDir, 'avatars');
  const publishLimit = createRateLimiter({ limit: 30, windowMs: 24 * 60 * 60 * 1000 });
  const reportLimit = createRateLimiter({ limit: 50, windowMs: 24 * 60 * 60 * 1000 });

  const SELECT = `
    SELECT p.*, u.name AS author_name, u.avatar AS author_avatar,
      (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id) AS likes,
      (SELECT COUNT(*) FROM post_reports r WHERE r.post_id = p.id) AS reports,
      EXISTS (SELECT 1 FROM post_likes l WHERE l.post_id = p.id AND l.user_id = :me) AS liked
    FROM posts p JOIN users u ON u.id = p.user_id`;

  const q = {
    feed: db.prepare(`${SELECT} WHERE p.hidden = 0 AND p.created_at < :before AND (:category = '' OR json_extract(p.data, '$.category') = :category) ORDER BY p.created_at DESC LIMIT :limit`),
    one: db.prepare(`${SELECT} WHERE p.id = :id`),
    admin: db.prepare(`${SELECT} WHERE (:filter = 'all') OR (:filter = 'hidden' AND p.hidden = 1) OR (:filter = 'reported' AND EXISTS (SELECT 1 FROM post_reports r WHERE r.post_id = p.id)) ORDER BY reports DESC, p.created_at DESC LIMIT 200`),
    byClient: db.prepare('SELECT * FROM posts WHERE user_id = ? AND client_id = ?'),
    insert: db.prepare('INSERT INTO posts (id, user_id, client_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'),
    update: db.prepare('UPDATE posts SET data = ?, updated_at = ? WHERE id = ?'),
    setImage: db.prepare('UPDATE posts SET image = ?, updated_at = ? WHERE id = ?'),
    setHidden: db.prepare('UPDATE posts SET hidden = ?, updated_at = ? WHERE id = ?'),
    remove: db.prepare('DELETE FROM posts WHERE id = ?'),
    like: db.prepare('INSERT OR IGNORE INTO post_likes (post_id, user_id, created_at) VALUES (?, ?, ?)'),
    unlike: db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?'),
    report: db.prepare('INSERT OR IGNORE INTO post_reports (post_id, user_id, reason, created_at) VALUES (?, ?, ?, ?)'),
    user: db.prepare('SELECT name, avatar FROM users WHERE id = ?'),
    setName: db.prepare('UPDATE users SET name = ? WHERE id = ?'),
    setAvatar: db.prepare('UPDATE users SET avatar = ? WHERE id = ?'),
    imagesOf: db.prepare('SELECT image FROM posts WHERE user_id = ? AND image IS NOT NULL'),
  };

  const toJson = (row, me, { admin = false } = {}) => ({
    id: row.id,
    ...JSON.parse(row.data),
    image: row.image ? `/api/feed/images/${row.image}` : null,
    author: { name: row.author_name || 'شيف', avatar: row.author_avatar ? `/api/avatars/${row.author_avatar}` : null },
    likes: row.likes,
    likedByMe: !!row.liked,
    mine: !!me && row.user_id === me.userId,
    clientId: me && row.user_id === me.userId ? row.client_id : undefined,
    hidden: row.hidden === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(admin ? { reports: row.reports } : {}),
  });

  const getPost = (id, me) => {
    const row = POST_ID.test(id) ? q.one.get({ id, me: me?.userId ?? '' }) : undefined;
    if (!row) throw new HttpError(404, 'not-found');
    return row;
  };

  const saveJpeg = async (dir, prefix, req) => {
    if (!String(req.headers['content-type'] ?? '').startsWith('image/jpeg')) throw new HttpError(415, 'jpeg-required');
    const bytes = await readBody(req, MAX_IMAGE);
    if (!isJpeg(bytes)) throw new HttpError(400, 'not-jpeg');
    const name = `${prefix}-${randomBytes(6).toString('hex')}.jpg`;
    await mkdir(dir, { recursive: true, mode: 0o755 });
    await writeFile(join(dir, name), bytes, { mode: 0o644 });
    return name;
  };
  const removeFile = (dir, name) => (name && IMAGE.test(name) ? rm(join(dir, name), { force: true }) : Promise.resolve());

  const servePublicImage = async (res, dir, name) => {
    if (!IMAGE.test(name)) throw new HttpError(404, 'not-found');
    let bytes;
    try {
      bytes = await readFile(join(dir, name));
    } catch {
      throw new HttpError(404, 'not-found');
    }
    send(res, 200, bytes, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' });
  };

  /** Removes a user's feed photos and avatar (the rows go with the user, ON DELETE CASCADE). */
  async function deleteUserFiles(userId) {
    for (const { image } of q.imagesOf.all(userId)) await removeFile(postImages, image);
    await removeFile(avatars, q.user.get(userId)?.avatar);
  }

  /** Handles feed routes; returns false for other paths. */
  async function route(req, res, path, { requireUser, optionalUser, isAdmin }) {
    const m = req.method;

    const pubImage = /^\/api\/(feed\/images|avatars)\/([^/]+)$/.exec(path);
    if (pubImage && m === 'GET') {
      await servePublicImage(res, pubImage[1] === 'avatars' ? avatars : postImages, decodeURIComponent(pubImage[2]));
      return true;
    }

    if (path === '/api/feed' && m === 'GET') {
      const me = optionalUser(req);
      const url = new URL(req.url ?? '/', 'http://x');
      const category = CATEGORIES.has(url.searchParams.get('category')) ? url.searchParams.get('category') : '';
      const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 50);
      const rows = q.feed.all({ me: me?.userId ?? '', category, before, limit });
      const posts = rows.map((r) => toJson(r, me));
      send(res, 200, { posts, next: rows.length === limit ? rows.at(-1).created_at : null });
      return true;
    }

    const feedOne = /^\/api\/feed\/([^/]+)$/.exec(path);
    if (feedOne && m === 'GET') {
      const me = optionalUser(req);
      const row = getPost(feedOne[1], me);
      if (row.hidden && !(me && (row.user_id === me.userId || isAdmin(me)))) throw new HttpError(404, 'not-found');
      send(res, 200, toJson(row, me));
      return true;
    }

    if (path === '/api/me/profile' && m === 'PUT') {
      const me = requireUser(req);
      const body = await readJson(req);
      const name = typeof body?.name === 'string' ? body.name.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
      if (name.length < 2) throw new HttpError(400, 'name-required');
      q.setName.run(name, me.userId);
      send(res, 200, { name });
      return true;
    }

    if (path === '/api/me/avatar' && (m === 'PUT' || m === 'DELETE')) {
      const me = requireUser(req);
      const old = q.user.get(me.userId)?.avatar;
      const name = m === 'PUT' ? await saveJpeg(avatars, 'a', req) : null;
      q.setAvatar.run(name, me.userId);
      await removeFile(avatars, old);
      send(res, 200, { avatar: name ? `/api/avatars/${name}` : null });
      return true;
    }

    if (path === '/api/posts' && m === 'POST') {
      const me = requireUser(req);
      const body = await readJson(req, 256 * 1024);
      const clientId = typeof body?.clientId === 'string' && CLIENT_ID.test(body.clientId) ? body.clientId : null;
      if (!clientId) throw new HttpError(400, 'bad-client-id');
      if (!q.user.get(me.userId)?.name) throw new HttpError(400, 'name-required');
      const recipe = JSON.stringify(cleanRecipe(body?.recipe));
      const now = Date.now();
      const existing = q.byClient.get(me.userId, clientId);
      if (existing) {
        q.update.run(recipe, now, existing.id);
        send(res, 200, toJson(getPost(existing.id, me), me));
        return true;
      }
      if (!publishLimit(me.userId)) throw new HttpError(429, 'too-many-posts');
      const id = `p-${randomBytes(6).toString('hex')}`;
      q.insert.run(id, me.userId, clientId, recipe, now, now);
      send(res, 201, toJson(getPost(id, me), me));
      return true;
    }

    const post = /^\/api\/posts\/([^/]+)(\/image|\/like|\/report)?$/.exec(path);
    if (post) {
      const me = requireUser(req);
      const row = getPost(post[1], me);
      const owner = row.user_id === me.userId;
      const action = post[2];

      if (action === '/image' && (m === 'PUT' || m === 'DELETE')) {
        if (!owner) throw new HttpError(403, 'not-owner');
        const name = m === 'PUT' ? await saveJpeg(postImages, row.id, req) : null;
        q.setImage.run(name, Date.now(), row.id);
        await removeFile(postImages, row.image);
        send(res, 200, toJson(getPost(row.id, me), me));
        return true;
      }
      if (action === '/like' && (m === 'POST' || m === 'DELETE')) {
        if (row.hidden && !owner) throw new HttpError(404, 'not-found');
        if (m === 'POST') q.like.run(row.id, me.userId, Date.now());
        else q.unlike.run(row.id, me.userId);
        const fresh = getPost(row.id, me);
        send(res, 200, { likes: fresh.likes, likedByMe: !!fresh.liked });
        return true;
      }
      if (action === '/report' && m === 'POST') {
        if (owner) throw new HttpError(400, 'own-post');
        if (!reportLimit(me.userId)) throw new HttpError(429, 'too-many-reports');
        const body = await readJson(req).catch(() => ({}));
        const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 300) : null;
        q.report.run(row.id, me.userId, reason, Date.now());
        send(res, 204);
        return true;
      }
      if (!action && m === 'DELETE') {
        if (!owner && !isAdmin(me)) throw new HttpError(403, 'not-owner');
        q.remove.run(row.id);
        await removeFile(postImages, row.image);
        send(res, 204);
        return true;
      }
      throw new HttpError(405, 'method-not-allowed');
    }

    if (path === '/api/admin/posts' && m === 'GET') {
      const me = requireUser(req);
      if (!isAdmin(me)) throw new HttpError(403, 'not-admin');
      const filter = new URL(req.url ?? '/', 'http://x').searchParams.get('filter');
      const rows = q.admin.all({ me: me.userId, filter: ['reported', 'hidden'].includes(filter) ? filter : 'all' });
      send(res, 200, { posts: rows.map((r) => toJson(r, me, { admin: true })) });
      return true;
    }

    const adminOne = /^\/api\/admin\/posts\/([^/]+)$/.exec(path);
    if (adminOne && m === 'PUT') {
      const me = requireUser(req);
      if (!isAdmin(me)) throw new HttpError(403, 'not-admin');
      const row = getPost(adminOne[1], me);
      const body = await readJson(req);
      if (typeof body?.hidden !== 'boolean') throw new HttpError(400, 'hidden-required');
      q.setHidden.run(body.hidden ? 1 : 0, Date.now(), row.id);
      send(res, 200, toJson(getPost(row.id, me), me, { admin: true }));
      return true;
    }

    return false;
  }

  return { route, deleteUserFiles, userProfile: (userId) => q.user.get(userId) };
}
