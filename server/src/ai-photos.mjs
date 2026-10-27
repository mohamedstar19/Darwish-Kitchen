import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { downloadJpeg, hostIn, normalizeUrl, nullableString, pagePhoto, seenUrls } from './ai-core.mjs';
import { HttpError, readJson, send } from './http.mjs';

/**
 * Control panel: the AI finds photos for Darwish recipes that have none.
 *
 * Photos come only from free-to-use photo sites (Unsplash, Pexels, Wikimedia Commons) — never from cooking
 * sites, whose photos are copyrighted. Claude searches those sites, the server downloads each photo page's
 * main image, then Claude looks at the photos and scores how well each one shows the dish. Every photo keeps
 * its credit (site, page, photographer, license), shown in the app under the photo.
 *
 * Two modes per run:
 *   review → the best photos wait in the control panel; the admin picks one (or skips the recipe)
 *   auto   → a clearly good photo (score ≥ 8/10) goes straight onto the recipe; the rest wait for review
 *
 * Admin:
 *   GET    /api/admin/ai/photos                     run progress + recipes with photos waiting for review
 *   POST   /api/admin/ai/photos/run {mode, ids?}     start a run (recipes without a photo, up to `runLimit`)
 *   POST   /api/admin/ai/photos/:id/approve          use this photo for its recipe
 *   DELETE /api/admin/ai/photos/recipes/:recipeId    skip: reject the recipe's waiting photos
 * Public:
 *   GET    /api/ai/photo-candidates/:file            the waiting photos themselves (random names)
 */

const SITES = {
  pages: ['unsplash.com', 'pexels.com', 'commons.wikimedia.org'],
  images: ['images.unsplash.com', 'images.pexels.com', 'upload.wikimedia.org'],
};
const SOURCE = { 'unsplash.com': 'Unsplash', 'pexels.com': 'Pexels', 'commons.wikimedia.org': 'Wikimedia Commons' };
const LICENSE = { Unsplash: 'Unsplash License', Pexels: 'Pexels License' };
const CANDIDATE_ID = /^ph-[a-f0-9]{16}$/;
const MAX_CANDIDATES = 4;
const MIN_SCORE = 6;
const AUTO_SCORE = 8;

const SEARCH_SYSTEM = `You find free-to-use photos of dishes and drinks for Darwish Kitchen, an Egyptian Arabic recipe app.

Search only these free photo sites: Unsplash (unsplash.com/photos/... pages; skip "Unsplash+" premium photos), Pexels (pexels.com/photo/... pages) and Wikimedia Commons (commons.wikimedia.org/wiki/File:... pages). Search with the dish's English name and its Arabic name, and try a more general name if nothing fits (for example "lentil soup" for an Egyptian lentil soup).

Pick up to 6 photo pages that most likely show the finished dish or drink itself, appetizing, without text or watermarks. Then call submit_photos once:
- page_url: the exact address of a photo page you saw in the results. Never guess a URL.
- image_url: the direct image address if you saw it, otherwise null.
- author and license: the photographer and the license if the page shows them (on Wikimedia Commons, fetch the page with web_fetch to read them), otherwise null.
If you find nothing suitable, call submit_photos with an empty list.`;

const SUBMIT_TOOL = {
  name: 'submit_photos',
  description: 'Return the photo pages you found. Call it exactly once, at the end.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['photos'],
    properties: {
      photos: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['page_url', 'image_url', 'author', 'license'],
          properties: { page_url: { type: 'string' }, image_url: nullableString, author: nullableString, license: nullableString },
        },
      },
    },
  },
};

const REVIEW_SYSTEM = `You check photos for recipes in Darwish Kitchen, an Egyptian Arabic recipe app. For each numbered photo, decide whether it clearly shows the named dish or drink, ready to eat, and rate it from 0 to 10 as the recipe's main photo: 10 = this exact dish, appetizing, well lit, no text, logos or watermarks. Give 0 to photos that show pork, alcohol, people as the main subject, raw ingredients only, or a different dish. problem: a few words in Egyptian Arabic about what's wrong (empty if nothing).`;

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['photos'],
  properties: {
    photos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'shows_dish', 'score', 'problem'],
        properties: { index: { type: 'integer' }, shows_dish: { type: 'boolean' }, score: { type: 'integer' }, problem: { type: 'string' } },
      },
    },
  },
};

const CATEGORY_EN = { food: 'a dish', 'healthy-drink': 'a healthy drink or herbal tea', juice: 'a juice or smoothie' };

/** Asks the photo sites for a good size, as JPEG. */
function sized(raw) {
  const url = new URL(raw);
  if (url.hostname === 'images.unsplash.com') {
    for (const k of ['w', 'h', 'crop', 'fit', 'fm', 'q', 'auto', 'dpr']) url.searchParams.delete(k);
    url.searchParams.set('w', '1200');
    url.searchParams.set('q', '80');
    url.searchParams.set('fm', 'jpg');
  } else if (url.hostname === 'images.pexels.com') {
    for (const k of ['w', 'h', 'dpr', 'fit']) url.searchParams.delete(k);
    url.searchParams.set('auto', 'compress');
    url.searchParams.set('cs', 'tinysrgb');
    url.searchParams.set('w', '1200');
  }
  return url.href;
}

export function createPhotoFinder({ db, dataDir, claude, catalog, sites = SITES, allowPrivateFetch = false, runLimit = 25 }) {
  const dir = join(dataDir, 'ai-photos');
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_photo_candidates (
      id TEXT PRIMARY KEY,
      recipe_id TEXT NOT NULL,
      page_url TEXT NOT NULL,
      image_url TEXT NOT NULL,
      source TEXT NOT NULL,
      author TEXT,
      license TEXT,
      score INTEGER NOT NULL,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ai_photo_recipe ON ai_photo_candidates(recipe_id, status);
  `);
  const q = {
    pending: db.prepare("SELECT * FROM ai_photo_candidates WHERE status = 'pending' ORDER BY recipe_id, score DESC"),
    pendingOf: db.prepare("SELECT * FROM ai_photo_candidates WHERE recipe_id = ? AND status = 'pending'"),
    one: db.prepare('SELECT * FROM ai_photo_candidates WHERE id = ?'),
    usedPages: db.prepare('SELECT page_url FROM ai_photo_candidates WHERE recipe_id = ?'),
    insert: db.prepare(
      "INSERT INTO ai_photo_candidates (id, recipe_id, page_url, image_url, source, author, license, score, note, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
    ),
    setStatus: db.prepare('UPDATE ai_photo_candidates SET status = ? WHERE id = ?'),
  };
  const fileOf = (id) => join(dir, `${id}.jpg`);
  const fetchOpts = (domains) => ({ allowPrivate: allowPrivateFetch, allowHost: (h) => hostIn(h, domains) });
  const sourceOf = (host) => SOURCE[Object.keys(SOURCE).find((d) => hostIn(host, [d]))] ?? host.replace(/^www\./, '');

  let run = null; // progress of the current (or last) run

  /** Searches, downloads and scores photos for one recipe; saves the good ones as candidates. */
  async function findFor(recipe) {
    const { input, contents } = await claude.withTools({
      system: SEARCH_SYSTEM,
      content: `Dish name (Arabic): ${recipe.title}\nKind: ${CATEGORY_EN[recipe.category] ?? 'a dish'}\nMain ingredients: ${recipe.ingredients.slice(0, 8).join('، ')}`,
      submitName: 'submit_photos',
      tools: [
        { type: 'web_search_20260209', name: 'web_search', max_uses: 4, allowed_domains: sites.pages },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 6, allowed_domains: [...sites.pages, ...sites.images] },
        SUBMIT_TOOL,
      ],
    });
    const seen = seenUrls(contents);
    const used = new Set(q.usedPages.all(recipe.id).map((r) => normalizeUrl(r.page_url)));

    // Download the photos (only from the free photo sites, only pages the search really returned).
    const photos = [];
    for (const p of Array.isArray(input?.photos) ? input.photos : []) {
      if (photos.length >= MAX_CANDIDATES) break;
      let page;
      try {
        page = new URL(String(p.page_url));
      } catch {
        continue;
      }
      const key = normalizeUrl(page.href);
      if (!hostIn(page.hostname, sites.pages) || !seen.has(key) || used.has(key)) continue;
      used.add(key);
      let imageUrl = await pagePhoto(page.href, fetchOpts(sites.pages));
      if (!imageUrl && typeof p.image_url === 'string') imageUrl = p.image_url;
      try {
        if (!imageUrl || !hostIn(new URL(imageUrl).hostname, sites.images)) continue;
        imageUrl = sized(imageUrl);
      } catch {
        continue;
      }
      const bytes = await downloadJpeg(imageUrl, fetchOpts(sites.images));
      if (!bytes) continue;
      const source = sourceOf(page.hostname);
      const text = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
      photos.push({ page: page.href, imageUrl, bytes, source, author: text(p.author, 120), license: text(p.license, 80) ?? LICENSE[source] ?? null });
    }
    if (!photos.length) return [];

    // Claude looks at the photos and scores them.
    const content = [];
    photos.forEach((p, i) => {
      content.push({ type: 'text', text: `Photo ${i + 1}:` });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: p.bytes.toString('base64') } });
    });
    content.push({ type: 'text', text: `The recipe: ${recipe.title} (${CATEGORY_EN[recipe.category] ?? 'a dish'}).` });
    const review = await claude.json({ system: REVIEW_SYSTEM, content, schema: REVIEW_SCHEMA });

    await mkdir(dir, { recursive: true, mode: 0o755 });
    const saved = [];
    for (const r of Array.isArray(review?.photos) ? review.photos : []) {
      const p = photos[r.index - 1];
      const score = Math.max(0, Math.min(10, Number(r.score) || 0));
      if (!p || p.saved || !r.shows_dish || score < MIN_SCORE) continue;
      p.saved = true;
      const id = `ph-${randomBytes(8).toString('hex')}`;
      await writeFile(fileOf(id), p.bytes, { mode: 0o644 });
      q.insert.run(id, recipe.id, p.page, p.imageUrl, p.source, p.author, p.license, score, String(r.problem ?? '').slice(0, 200) || null, Date.now());
      saved.push({ id, score });
    }
    return saved.sort((a, b) => b.score - a.score);
  }

  /** Puts a waiting photo on its recipe and clears the recipe's other waiting photos. */
  async function approve(candidate) {
    const bytes = await readFile(fileOf(candidate.id));
    const recipe = await catalog.applyImage(candidate.recipe_id, bytes, {
      source: candidate.source,
      url: candidate.page_url,
      author: candidate.author,
      license: candidate.license,
    });
    q.setStatus.run('approved', candidate.id);
    await rm(fileOf(candidate.id), { force: true });
    await reject(candidate.recipe_id);
    return recipe;
  }

  async function reject(recipeId) {
    for (const c of q.pendingOf.all(recipeId)) {
      q.setStatus.run('rejected', c.id);
      await rm(fileOf(c.id), { force: true });
    }
  }

  async function start(mode, ids) {
    const waiting = new Set(q.pending.all().map((c) => c.recipe_id));
    const targets = catalog
      .missingImages()
      .filter((r) => (ids ? ids.includes(r.id) : !waiting.has(r.id)))
      .slice(0, runLimit);
    run = { mode, running: true, total: targets.length, done: 0, applied: 0, waiting: 0, notFound: 0, failed: 0, current: null, startedAt: Date.now(), finishedAt: null };
    const current = run;
    (async () => {
      for (const recipe of targets) {
        current.current = recipe.title;
        try {
          const found = await findFor(recipe);
          if (!found.length) current.notFound++;
          else if (mode === 'auto' && found[0].score >= AUTO_SCORE) {
            await approve(q.one.get(found[0].id));
            current.applied++;
          } else current.waiting++;
        } catch (e) {
          current.failed++;
          console.error(new Date().toISOString(), 'AI photo search failed', recipe.id, e?.status ?? '', e?.message);
        }
        current.done++;
      }
      current.running = false;
      current.current = null;
      current.finishedAt = Date.now();
    })();
    return run;
  }

  function overview() {
    const groups = new Map();
    for (const c of q.pending.all()) {
      if (!groups.has(c.recipe_id)) groups.set(c.recipe_id, []);
      groups.get(c.recipe_id).push({
        id: c.id,
        image: `/api/ai/photo-candidates/${c.id}.jpg`,
        source: c.source,
        pageUrl: c.page_url,
        author: c.author,
        license: c.license,
        score: c.score,
        note: c.note,
      });
    }
    const items = [];
    for (const [recipeId, candidates] of groups) {
      try {
        const r = catalog.find(recipeId);
        items.push({ recipe: { id: r.id, title: r.title, category: r.category, image: r.image }, candidates });
      } catch {
        // The recipe was deleted.
      }
    }
    return { run, items, missing: catalog.missingImages().length };
  }

  /** Handles photo-finder routes; returns false for other paths. */
  async function route(req, res, path, { requireAdmin, enabled }) {
    const m = req.method;
    const file = /^\/api\/ai\/photo-candidates\/(ph-[a-f0-9]{16})\.jpg$/.exec(path);
    if (file && m === 'GET') {
      let bytes;
      try {
        bytes = await readFile(fileOf(file[1]));
      } catch {
        throw new HttpError(404, 'not-found');
      }
      send(res, 200, bytes, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
      return true;
    }

    if (!path.startsWith('/api/admin/ai/photos')) return false;
    requireAdmin(req);

    if (path === '/api/admin/ai/photos' && m === 'GET') {
      send(res, 200, { enabled, ...overview() });
      return true;
    }
    if (path === '/api/admin/ai/photos/run' && m === 'POST') {
      if (!enabled) throw new HttpError(503, 'ai-unavailable');
      if (run?.running) throw new HttpError(409, 'already-running');
      const body = await readJson(req);
      const mode = body?.mode === 'auto' ? 'auto' : 'review';
      const ids = Array.isArray(body?.ids) ? body.ids.filter((x) => typeof x === 'string').slice(0, 100) : null;
      send(res, 202, { run: await start(mode, ids) });
      return true;
    }
    const approveMatch = /^\/api\/admin\/ai\/photos\/([^/]+)\/approve$/.exec(path);
    if (approveMatch && m === 'POST') {
      const c = CANDIDATE_ID.test(approveMatch[1]) ? q.one.get(approveMatch[1]) : undefined;
      if (!c || c.status !== 'pending') throw new HttpError(404, 'not-found');
      send(res, 200, { recipe: await approve(c) });
      return true;
    }
    const skip = /^\/api\/admin\/ai\/photos\/recipes\/([^/]+)$/.exec(path);
    if (skip && m === 'DELETE') {
      await reject(decodeURIComponent(skip[1]));
      send(res, 204);
      return true;
    }
    throw new HttpError(404, 'not-found');
  }

  return { route };
}
