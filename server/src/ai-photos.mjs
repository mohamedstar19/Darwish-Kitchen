import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { downloadJpeg, normalizeUrl } from './ai-core.mjs';
import { HttpError, readJson, send } from './http.mjs';

/**
 * Control panel: the AI finds photos for Darwish recipes that have none.
 *
 * Photos come only from free-license sources, through their official search APIs (no page scraping,
 * which photo sites block): Wikimedia Commons, Openverse (Creative Commons photos from Flickr and others)
 * and Pexels when PEXELS_API_KEY is set. Never from cooking sites, whose photos are copyrighted.
 * For each recipe: Claude turns the Arabic name into English search words, the server searches the
 * sources and downloads up to 6 JPEGs, then Claude looks at the photos and scores how well each one
 * shows the dish. Every photo keeps its credit (site, page, photographer, license), shown under the photo.
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

const APIS = {
  commons: 'https://commons.wikimedia.org/w/api.php',
  openverse: 'https://api.openverse.org/v1/images/',
  pexels: 'https://api.pexels.com/v1/search',
};
// Wikimedia asks API clients to identify themselves.
const USER_AGENT = 'DarwishKitchen/1.0 (https://kitchen.darwish-tech.com/about/)';
const CANDIDATE_ID = /^ph-[a-f0-9]{16}$/;
const MAX_DOWNLOADS = 6;
const MIN_SCORE = 6;
const AUTO_SCORE = 8;

const QUERY_SYSTEM = `You help find photos of dishes and drinks for Darwish Kitchen, an Egyptian Arabic recipe app. Given a recipe, write up to 3 short English image-search queries for a photo of the finished dish: first its usual English or transliterated name (for example "koshari", "molokhia soup", "hibiscus tea"), then broader descriptions that would still show a similar-looking dish. Two to four words each, no quotes.`;

const QUERY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['queries'],
  properties: { queries: { type: 'array', items: { type: 'string' } } },
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

const plain = (html, max = 120) =>
  typeof html === 'string'
    ? html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) || null
    : null;

/** Licenses that allow use in the app with credit: public domain, CC0, CC BY, CC BY-SA (no NC/ND). */
const freeLicense = (name) => !!name && /^(cc0|public domain|pdm|pd\b|cc[ -]by(-sa)?\b)/i.test(name) && !/\b(nc|nd)\b/i.test(name);

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
  return res.json();
}

// ---------- photo sources: each returns [{page, image, source, author, license}] ----------

async function searchCommons(base, query) {
  const url = new URL(base);
  for (const [k, v] of Object.entries({
    action: 'query', format: 'json', formatversion: '2', generator: 'search', gsrnamespace: '6', gsrlimit: '10',
    gsrsearch: `${query} filetype:bitmap`, prop: 'imageinfo', iiprop: 'url|mime|extmetadata', iiurlwidth: '1200',
  })) url.searchParams.set(k, v);
  const data = await getJson(url);
  return (data?.query?.pages ?? [])
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((p) => {
      const info = p.imageinfo?.[0];
      const meta = info?.extmetadata ?? {};
      const license = plain(meta.LicenseShortName?.value, 60);
      if (!info?.thumburl || info.mime !== 'image/jpeg' || !freeLicense(license)) return null;
      return { page: info.descriptionurl, image: info.thumburl, source: 'Wikimedia Commons', author: plain(meta.Artist?.value), license };
    })
    .filter(Boolean);
}

const OPENVERSE_LICENSE = { by: 'CC BY', 'by-sa': 'CC BY-SA', cc0: 'CC0', pdm: 'Public domain' };
const SOURCE_NAMES = { flickr: 'Flickr', wikimedia: 'Wikimedia Commons', stocksnap: 'StockSnap', rawpixel: 'rawpixel' };

async function searchOpenverse(base, query) {
  const url = new URL(base);
  for (const [k, v] of Object.entries({ q: query, license: 'by,by-sa,cc0,pdm', page_size: '10', mature: 'false' })) url.searchParams.set(k, v);
  const data = await getJson(url);
  return (data?.results ?? [])
    .filter((r) => r.url && r.foreign_landing_url && OPENVERSE_LICENSE[r.license] && (!r.filetype || /^jpe?g$/i.test(r.filetype)))
    .map((r) => ({
      page: r.foreign_landing_url,
      image: r.url,
      source: SOURCE_NAMES[r.source] ?? String(r.source ?? 'Openverse'),
      author: plain(r.creator),
      license: [OPENVERSE_LICENSE[r.license], ['by', 'by-sa'].includes(r.license) ? r.license_version : ''].filter(Boolean).join(' '),
    }));
}

async function searchPexels(base, key, query) {
  const url = new URL(base);
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', '8');
  const data = await getJson(url, { Authorization: key });
  return (data?.photos ?? [])
    .filter((p) => p.url && p.src?.large)
    .map((p) => ({ page: p.url, image: p.src.large, source: 'Pexels', author: plain(p.photographer), license: 'Pexels License' }));
}

export function createPhotoFinder({ db, dataDir, claude, catalog, apis = {}, pexelsKey, allowPrivateFetch = false, runLimit = 25 }) {
  const api = { ...APIS, ...apis };
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

  let run = null; // progress of the current (or last) run

  /** Searches, downloads and scores photos for one recipe; saves the good ones as candidates. */
  async function findFor(recipe) {
    const kind = CATEGORY_EN[recipe.category] ?? 'a dish';
    const words = await claude.json({
      system: QUERY_SYSTEM,
      content: `Recipe name (Arabic): ${recipe.title}\nKind: ${kind}\nMain ingredients: ${recipe.ingredients.slice(0, 8).join('، ')}`,
      schema: QUERY_SCHEMA,
    });
    const queries = (Array.isArray(words?.queries) ? words.queries : []).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 60)).slice(0, 3);
    const used = new Set(q.usedPages.all(recipe.id).map((r) => normalizeUrl(r.page_url)));
    const stats = { found: 0, downloaded: 0, errors: [] };

    // Search the free sources and download JPEGs until there are enough to compare.
    const photos = [];
    const sources = [
      (query) => searchCommons(api.commons, query),
      (query) => searchOpenverse(api.openverse, query),
      ...(pexelsKey ? [(query) => searchPexels(api.pexels, pexelsKey, query)] : []),
    ];
    for (const query of queries) {
      for (const search of sources) {
        if (photos.length >= MAX_DOWNLOADS) break;
        let found = [];
        try {
          found = await search(query);
        } catch (e) {
          console.error(new Date().toISOString(), 'AI photos: search failed', query, e?.message);
          stats.errors.push(e?.message ?? 'search failed');
          continue;
        }
        stats.found += found.length;
        for (const f of found) {
          if (photos.length >= MAX_DOWNLOADS) break;
          const key = normalizeUrl(f.page);
          if (!key || used.has(key) || used.has(normalizeUrl(f.image))) continue;
          used.add(key);
          used.add(normalizeUrl(f.image));
          const bytes = await downloadJpeg(f.image, { allowPrivate: allowPrivateFetch, userAgent: USER_AGENT });
          if (!bytes || bytes.length < 8000) continue; // tiny files are icons or broken images
          stats.downloaded++;
          photos.push({ ...f, bytes });
        }
      }
    }
    console.log(new Date().toISOString(), `AI photos: "${recipe.title}" — queries ${queries.join(' | ') || '-'}; found ${stats.found}, downloaded ${stats.downloaded}`);
    if (!photos.length && !stats.found && stats.errors.length) throw new Error(`photo search failed: ${stats.errors[0]}`);
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
      q.insert.run(id, recipe.id, p.page, p.image, p.source, p.author, p.license, score, String(r.problem ?? '').slice(0, 200) || null, Date.now());
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
    run = { mode, running: true, total: targets.length, done: 0, applied: 0, waiting: 0, notFound: 0, failed: 0, lastError: null, current: null, startedAt: Date.now(), finishedAt: null };
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
          current.lastError = String(e?.message ?? 'error').slice(0, 200);
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
