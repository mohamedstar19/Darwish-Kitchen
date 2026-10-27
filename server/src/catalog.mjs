import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError, readBody, readJson, send } from './http.mjs';

/**
 * The shared recipe catalog: starter recipes (food, healthy drinks, juices) that every app syncs,
 * managed by admins from the control panel, with photos.
 *
 * Public:  GET /api/catalog                 published recipes
 *          GET /api/catalog/images/:name    photos (cacheable forever: names change on every upload)
 * Admin:   GET /api/admin/catalog           all recipes, including hidden ones
 *          POST /api/admin/catalog          create
 *          PUT|DELETE /api/admin/catalog/:id
 *          PUT|DELETE /api/admin/catalog/:id/image   (JPEG body)
 */

const CATEGORIES = new Set(['food', 'healthy-drink', 'juice']);
const MEALS = ['breakfast', 'lunch', 'dinner'];
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const IMAGE = /^[a-z0-9-]{1,64}-[a-f0-9]{12}\.jpg$/;
const MAX_IMAGE = 5 * 1024 * 1024;

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const lines = (v, maxItems, maxLen) =>
  (Array.isArray(v) ? v : [])
    .filter((x) => typeof x === 'string')
    .map((x) => x.trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
const count = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 1000 ? n : null;
};

/** Validates and cleans a recipe sent by the control panel. */
function cleanRecipe(body) {
  const title = text(body?.title, 120);
  if (!title) throw new HttpError(400, 'title-required');
  const category = CATEGORIES.has(body?.category) ? body.category : 'food';
  const mealTypes = MEALS.filter((m) => Array.isArray(body?.mealTypes) && body.mealTypes.includes(m));
  if (category === 'food' && !mealTypes.length) throw new HttpError(400, 'meal-required');
  return {
    title,
    category,
    mealTypes: category === 'food' ? mealTypes : [],
    ingredients: lines(body?.ingredients, 60, 300),
    steps: lines(body?.steps, 60, 1000),
    prepMinutes: count(body?.prepMinutes),
    servings: count(body?.servings),
    notes: text(body?.notes, 2000) || null,
  };
}

export function createCatalog({ db, dataDir, seedFile }) {
  const imagesDir = join(dataDir, 'catalog-images');
  db.exec(`
    CREATE TABLE IF NOT EXISTS catalog (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      image TEXT,
      published INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);

  const q = {
    all: db.prepare('SELECT * FROM catalog ORDER BY created_at DESC, id'),
    published: db.prepare('SELECT * FROM catalog WHERE published = 1 ORDER BY created_at DESC, id'),
    get: db.prepare('SELECT * FROM catalog WHERE id = ?'),
    insert: db.prepare('INSERT INTO catalog (id, data, image, published, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)'),
    update: db.prepare('UPDATE catalog SET data = ?, published = ?, updated_at = ? WHERE id = ?'),
    setImage: db.prepare('UPDATE catalog SET image = ?, updated_at = ? WHERE id = ?'),
    remove: db.prepare('DELETE FROM catalog WHERE id = ?'),
    meta: db.prepare('SELECT value FROM meta WHERE key = ?'),
    setMeta: db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  };

  // First start: load the starter recipes once (so deleting them all later doesn't bring them back).
  if (!q.meta.get('catalog_seeded') && seedFile && existsSync(seedFile)) {
    const starters = JSON.parse(readFileSync(seedFile, 'utf8'));
    const base = Date.UTC(2026, 0, 1);
    starters.forEach((s, i) => {
      if (!ID.test(s.id) || q.get.get(s.id)) return;
      // Older starters get older dates so the list keeps the bundled order.
      q.insert.run(s.id, JSON.stringify(cleanRecipe(s)), 1, base - i, base - i);
    });
    q.setMeta.run('catalog_seeded', '1');
  }

  const toJson = (row, { admin = false } = {}) => ({
    id: row.id,
    ...JSON.parse(row.data),
    image: row.image ? `/api/catalog/images/${row.image}` : null,
    updatedAt: row.updated_at,
    ...(admin ? { published: row.published === 1, createdAt: row.created_at } : {}),
  });

  const find = (id) => {
    const row = ID.test(id) ? q.get.get(id) : undefined;
    if (!row) throw new HttpError(404, 'not-found');
    return row;
  };

  const deleteImageFile = (name) => (name ? rm(join(imagesDir, name), { force: true }) : Promise.resolve());

  /** Handles catalog routes; returns false for other paths. `requireAdmin(req)` throws unless the caller is an admin. */
  return async function route(req, res, path, requireAdmin) {
    const m = req.method;

    if (path === '/api/catalog' && m === 'GET') {
      const recipes = q.published.all().map((r) => toJson(r));
      // Short cache: apps check on start; Cloudflare/browsers may reuse it for a minute.
      send(res, 200, { recipes }, { 'Cache-Control': 'public, max-age=60' });
      return true;
    }

    const img = /^\/api\/catalog\/images\/([^/]+)$/.exec(path);
    if (img && m === 'GET') {
      const name = decodeURIComponent(img[1]);
      if (!IMAGE.test(name)) throw new HttpError(404, 'not-found');
      let bytes;
      try {
        bytes = await readFile(join(imagesDir, name));
      } catch {
        throw new HttpError(404, 'not-found');
      }
      send(res, 200, bytes, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' });
      return true;
    }

    if (!path.startsWith('/api/admin/catalog')) return false;
    requireAdmin(req);

    if (path === '/api/admin/catalog') {
      if (m === 'GET') {
        send(res, 200, { recipes: q.all.all().map((r) => toJson(r, { admin: true })) });
        return true;
      }
      if (m === 'POST') {
        const body = await readJson(req);
        const recipe = cleanRecipe(body);
        const id = `c-${randomBytes(6).toString('hex')}`;
        const now = Date.now();
        q.insert.run(id, JSON.stringify(recipe), body?.published === false ? 0 : 1, now, now);
        send(res, 201, toJson(q.get.get(id), { admin: true }));
        return true;
      }
    }

    const one = /^\/api\/admin\/catalog\/([^/]+)(\/image)?$/.exec(path);
    if (!one) throw new HttpError(404, 'not-found');
    const row = find(decodeURIComponent(one[1]));

    if (one[2]) {
      if (m === 'PUT') {
        if (!String(req.headers['content-type'] ?? '').startsWith('image/jpeg')) throw new HttpError(415, 'jpeg-required');
        const bytes = await readBody(req, MAX_IMAGE);
        if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new HttpError(400, 'not-jpeg');
        const name = `${row.id}-${randomBytes(6).toString('hex')}.jpg`;
        await mkdir(imagesDir, { recursive: true, mode: 0o755 });
        await writeFile(join(imagesDir, name), bytes, { mode: 0o644 });
        q.setImage.run(name, Date.now(), row.id);
        await deleteImageFile(row.image);
        send(res, 200, toJson(q.get.get(row.id), { admin: true }));
        return true;
      }
      if (m === 'DELETE') {
        q.setImage.run(null, Date.now(), row.id);
        await deleteImageFile(row.image);
        send(res, 200, toJson(q.get.get(row.id), { admin: true }));
        return true;
      }
    }

    if (!one[2] && m === 'PUT') {
      const body = await readJson(req);
      const recipe = cleanRecipe(body);
      const published = typeof body?.published === 'boolean' ? body.published : row.published === 1;
      q.update.run(JSON.stringify(recipe), published ? 1 : 0, Date.now(), row.id);
      send(res, 200, toJson(q.get.get(row.id), { admin: true }));
      return true;
    }

    if (!one[2] && m === 'DELETE') {
      q.remove.run(row.id);
      await deleteImageFile(row.image);
      send(res, 204);
      return true;
    }

    throw new HttpError(405, 'method-not-allowed');
  };
}
