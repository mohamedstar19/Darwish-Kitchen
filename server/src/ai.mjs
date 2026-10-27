import { createHash, randomBytes } from 'node:crypto';
import { CATEGORIES, MEALS, RECIPE_FIELDS, createClaude, imageBlock, isHalal, isPrivateIp, normalizeUrl, nullableString, pagePhoto, seenUrls } from './ai-core.mjs';
import { createModeration } from './ai-moderation.mjs';
import { createPhotoFinder } from './ai-photos.mjs';
import { HttpError, readJson, send } from './http.mjs';
import { cleanRecipe } from './recipe.mjs';

export { isPrivateIp };

/**
 * AI features (Claude). All Claude calls stay on the server; the app never sees the API key.
 *
 * Signed in (each counts toward the user's daily AI limit; admins have none):
 *   POST /api/ai/search {query, category?}          recipes from cooking sites on the web, in Egyptian Arabic.
 *        200 {recipes} or 202 {pending}: the app repeats the same POST (Cloudflare cuts requests after 100 s).
 *   POST /api/ai/fridge {ingredients?, image?, category?}   dishes from what's in the fridge (text and/or photo)
 *   POST /api/ai/photo-recipe {image}                a photo of a written recipe → the recipe's fields
 *   POST /api/ai/suggest {meal, candidates, allowNew}  smart "what do we eat today" pick, with the reason
 *        These three answer 200 with the result, or 202 {pending, job}; then GET /api/ai/jobs/:job until 200.
 * Public:
 *   GET  /api/ai/recipes/:id                        a recipe from an earlier search or suggestion
 * Also: feed moderation (ai-moderation.mjs) and the control panel's photo finder (ai-photos.mjs).
 */

const MAX_RESULTS = 6;
const CACHE_DAYS = 7;
const ID = /^ai-[a-f0-9]{12}$/;
const JOB = /^[A-Za-z0-9_-]{16}$/;
const AI_NAME = 'مطبخ درويش الذكي';
const CATEGORY_AR = { food: 'أكل', 'healthy-drink': 'مشروبات صحية', juice: 'عصائر' };

const SEARCH_SYSTEM = `You find home-cooking recipes on the web for Darwish Kitchen, an Egyptian Arabic recipe app.

Search the web for what the user asks for. Prefer well-known recipe sites and mix sources: Arabic sites (for example cookpad.com/eg, fatafeat.com, shahiya.com, atyabtabkha.3a2ilati.com, sayidaty.net) and international ones (for example allrecipes.com, bbcgoodfood.com, seriouseats.com, food.com, simplyrecipes.com). Pick up to ${MAX_RESULTS} good recipes, each from a different page and ideally from different websites. When a search result doesn't show the ingredients and steps, open the page with web_fetch.

Then call submit_recipes once with everything you found:
- Write every title, ingredient and step in simple Egyptian Arabic, in your own words, keeping the quantities. Translate pages in other languages.
- source_url must be the exact address of a page you saw in the search results or fetched. Never guess a URL.
- source_name is the website's short name (for example "Cookpad" or "BBC Good Food").
- Leave out recipes that use pork or alcohol.
- category is "food" for dishes, "healthy-drink" for teas, herbal and healthy drinks, "juice" for juices and smoothies. meal_types (breakfast/lunch/dinner) only for food.
If the request isn't about food or drinks, call submit_recipes with an empty list.`;

const SUBMIT_TOOL = {
  name: 'submit_recipes',
  description: 'Return the recipes you found to the app. Call it exactly once, at the end.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['recipes'],
    properties: {
      recipes: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [...Object.keys(RECIPE_FIELDS), 'source_name', 'source_url'],
          properties: { ...RECIPE_FIELDS, source_name: { type: 'string' }, source_url: { type: 'string' } },
        },
      },
    },
  },
};

const CHEF = `You are the chef of Darwish Kitchen, an Egyptian Arabic home-cooking app. Write in simple, warm Egyptian Arabic. Every recipe must be halal: no pork and no alcohol. category is "food" for dishes, "healthy-drink" for teas, herbal and healthy drinks, "juice" for juices and smoothies; meal_types (breakfast/lunch/dinner) only for food.`;

const FRIDGE_SYSTEM = `${CHEF}

The user tells you (in text, a photo of their fridge or kitchen counter, or both) which ingredients they have. Suggest 3 or 4 different home dishes they can make now, mostly from those ingredients. Assume basic pantry items exist: salt, pepper, spices, oil, butter, water, sugar, flour, rice, onion and garlic. Prefer familiar Egyptian and Arab home food, plus one simple international idea when it fits.
- seen_ingredients: the ingredients you understood or could clearly see (in Arabic). Don't guess items you can't see.
- For each recipe: full ingredients with quantities and clear steps; uses_ingredients = which of their ingredients it uses; missing_ingredients = anything important it needs that they didn't mention (keep it short, ideally empty); tip = one short helpful sentence.
- If a category is requested, suggest only that kind. If there is nothing usable (no food in the photo, or a request unrelated to cooking), return empty lists.`;

const PHOTO_RECIPE_SYSTEM = `You read recipes from photos for Darwish Kitchen, an Egyptian Arabic recipe app. The photo may be a handwritten notebook page, a printed page, a recipe card or a screenshot.
Copy the recipe faithfully: keep the title, every ingredient with its quantity, and the steps in order. Keep Arabic text as written (only fix obvious misspellings); translate text in other languages into simple Egyptian Arabic. Put any extra remarks from the page in notes.
category is "food" for dishes, "healthy-drink" for teas and healthy drinks, "juice" for juices and smoothies; meal_types only for food (your best guess).
If the photo doesn't contain a recipe, return found = false with empty fields.`;

const SUGGEST_SYSTEM = `${CHEF}

You choose what one person should eat for the requested meal today. You get the current day and time in Cairo and a list of candidate dishes from their own recipes and the Darwish Kitchen, with what they liked, how they rated them, and what they saw or were suggested lately.
- Prefer dishes they liked or rated highly, but avoid what they saw or were suggested in the last few days. Fit the meal, the time of day, the day (for example a big family lunch on Friday) and the season (light and cold in summer, warm in winter).
- Pick from the candidates (pick = "saved" with its key). If none fits well and new dishes are allowed, suggest a new dish instead (pick = "new" with a full recipe in new_recipe), similar in spirit to what they like.
- reason: one or two short, friendly sentences in Egyptian Arabic telling them why this dish suits them now. Don't mention ratings as numbers.`;

const recipeSchema = (extra = {}) => ({
  type: 'object',
  additionalProperties: false,
  required: [...Object.keys(RECIPE_FIELDS), ...Object.keys(extra)],
  properties: { ...RECIPE_FIELDS, ...extra },
});

const FRIDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['seen_ingredients', 'recipes'],
  properties: {
    seen_ingredients: { type: 'array', items: { type: 'string' } },
    recipes: {
      type: 'array',
      items: recipeSchema({
        uses_ingredients: { type: 'array', items: { type: 'string' } },
        missing_ingredients: { type: 'array', items: { type: 'string' } },
        tip: { type: 'string' },
      }),
    },
  },
};

const PHOTO_RECIPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['found', 'recipe'],
  properties: { found: { type: 'boolean' }, recipe: recipeSchema({ notes: nullableString }) },
};

const SUGGEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pick', 'candidate_key', 'new_recipe', 'reason'],
  properties: {
    pick: { type: 'string', enum: ['saved', 'new'] },
    candidate_key: nullableString,
    new_recipe: { anyOf: [recipeSchema(), { type: 'null' }] },
    reason: { type: 'string' },
  },
};

/** Claude's snake_case recipe → a clean, halal recipe, or null. */
function fromClaude(r, { notes = null, requireSteps = true, halal = true } = {}) {
  try {
    const category = CATEGORIES.includes(r?.category) ? r.category : 'food';
    const mealTypes = Array.isArray(r?.meal_types) && r.meal_types.length ? r.meal_types : ['lunch', 'dinner'];
    const recipe = cleanRecipe({
      title: r?.title,
      category,
      mealTypes,
      ingredients: r?.ingredients,
      steps: r?.steps,
      prepMinutes: r?.prep_minutes,
      servings: r?.servings,
      notes: notes ?? r?.notes,
    });
    if (requireSteps && (recipe.ingredients.length < 2 || recipe.steps.length < 1)) return null;
    return !halal || isHalal(recipe) ? recipe : null;
  } catch {
    return null;
  }
}

const strings = (v, max, len = 80) => (Array.isArray(v) ? v : []).filter((x) => typeof x === 'string').map((x) => x.trim().slice(0, len)).filter(Boolean).slice(0, max);

function cleanSearchResults(raw, seen) {
  const out = [];
  const urls = new Set();
  for (const r of Array.isArray(raw) ? raw : []) {
    let source;
    try {
      source = new URL(String(r.source_url));
    } catch {
      continue;
    }
    if (!['http:', 'https:'].includes(source.protocol)) continue;
    const key = normalizeUrl(source.href);
    if (!seen.has(key) || urls.has(key)) continue; // only real pages the search found, once each
    const recipe = fromClaude({ ...r, notes: null });
    if (!recipe) continue;
    urls.add(key);
    out.push({
      ...recipe,
      sourceName: String(r.source_name ?? '').trim().slice(0, 60) || source.hostname.replace(/^www\./, ''),
      sourceUrl: source.href,
    });
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

function cairoNow() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref?.());

export function createAi({
  db, dataDir, catalog, apiKey, baseURL, model, dailyLimit = 20, allowPrivateFetch = false, waitMs = 25_000,
  moderationDelayMs, photoApis, pexelsKey, photoRunLimit,
}) {
  const claude = createClaude({ apiKey, baseURL, model });
  const client = claude.enabled;

  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_searches (key TEXT PRIMARY KEY, ids TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS ai_recipes (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS ai_usage (user_id TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (user_id, day));
  `);
  const q = {
    search: db.prepare('SELECT ids, created_at FROM ai_searches WHERE key = ?'),
    saveSearch: db.prepare('INSERT INTO ai_searches (key, ids, created_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET ids = excluded.ids, created_at = excluded.created_at'),
    recipe: db.prepare('SELECT data FROM ai_recipes WHERE id = ?'),
    saveRecipe: db.prepare('INSERT INTO ai_recipes (id, data, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, created_at = excluded.created_at'),
    usage: db.prepare('SELECT count FROM ai_usage WHERE user_id = ? AND day = ?'),
    use: db.prepare('INSERT INTO ai_usage (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1'),
    prune: db.prepare('DELETE FROM ai_usage WHERE day < ?'),
  };
  const today = () => new Date().toISOString().slice(0, 10);

  const moderation = createModeration({ db, dataDir, claude, delayMs: moderationDelayMs });
  const photos = createPhotoFinder({ db, dataDir, claude, catalog, apis: photoApis, pexelsKey, allowPrivateFetch, runLimit: photoRunLimit });

  // ---------- daily limit ----------

  let isAdminFn = () => false;
  const remaining = (user) => (isAdminFn(user) ? null : Math.max(0, dailyLimit - (q.usage.get(user.userId, today())?.count ?? 0)));
  const takeQuota = (user) => {
    if (isAdminFn(user)) return;
    const day = today();
    if ((q.usage.get(user.userId, day)?.count ?? 0) >= dailyLimit) throw new HttpError(429, 'ai-daily-limit');
    q.use.run(user.userId, day);
    if (Math.random() < 0.02) q.prune.run(day);
  };

  // ---------- background jobs (answers that take longer than one request) ----------

  const jobs = new Map();
  function startJob(userId, run) {
    const job = { id: randomBytes(12).toString('base64url'), userId, done: false, result: null, error: null };
    job.promise = run()
      .then((result) => {
        job.result = result;
      })
      .catch((e) => {
        if (!(e instanceof HttpError)) console.error(new Date().toISOString(), 'AI job failed', e?.status ?? '', e?.message);
        job.error = e instanceof HttpError ? e : new HttpError(502, 'ai-failed');
      })
      .finally(() => {
        job.done = true;
        setTimeout(() => jobs.delete(job.id), 10 * 60_000).unref?.();
      });
    jobs.set(job.id, job);
    return job;
  }
  async function answerJob(res, job) {
    if (!job.done) await Promise.race([job.promise, sleep(waitMs)]);
    if (!job.done) return send(res, 202, { pending: true, job: job.id });
    if (job.error) throw job.error;
    send(res, 200, job.result);
  }

  /** Saves a recipe Claude wrote itself (no website), so the app can open it by id like a search result. */
  function saveGenerated(recipe, extra = {}) {
    const id = `ai-${createHash('sha256').update(JSON.stringify([recipe.title, recipe.ingredients, recipe.steps])).digest('hex').slice(0, 12)}`;
    const data = { id, ...recipe, image: null, sourceName: AI_NAME, sourceUrl: null, generated: true, ...extra };
    q.saveRecipe.run(id, JSON.stringify(data), Date.now());
    return data;
  }

  // ---------- web search ----------

  const inFlight = new Map(); // key → promise of recipes
  const failed = new Map(); // key → time of a failed search, reported once to the next poll

  async function search(query, category) {
    const ask = category ? `${query}\n\n(القسم المطلوب: ${CATEGORY_AR[category]})` : query;
    const { input, contents } = await claude.withTools({
      system: SEARCH_SYSTEM,
      content: ask,
      submitName: 'submit_recipes',
      tools: [
        { type: 'web_search_20260209', name: 'web_search', max_uses: 4, user_location: { type: 'approximate', country: 'EG', timezone: 'Africa/Cairo' } },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 6 },
        SUBMIT_TOOL,
      ],
    });
    const recipes = cleanSearchResults(input?.recipes, seenUrls(contents));
    const pics = await Promise.all(recipes.map((r) => pagePhoto(r.sourceUrl, { allowPrivate: allowPrivateFetch })));
    const now = Date.now();
    return recipes.map((r, i) => {
      const id = `ai-${createHash('sha256').update(`${r.sourceUrl}|${r.title}`).digest('hex').slice(0, 12)}`;
      const recipe = { id, ...r, image: pics[i] };
      q.saveRecipe.run(id, JSON.stringify(recipe), now);
      return recipe;
    });
  }

  async function searchRoute(req, res, user) {
    const body = await readJson(req);
    const query = typeof body?.query === 'string' ? body.query.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    if (query.length < 2) throw new HttpError(400, 'query-required');
    const category = CATEGORIES.includes(body?.category) ? body.category : '';
    const key = `${category}|${query.toLowerCase()}`;

    // Recent identical searches are free and instant.
    const cached = q.search.get(key);
    if (cached && Date.now() - cached.created_at < CACHE_DAYS * 86_400_000) {
      const recipes = JSON.parse(cached.ids).map((id) => q.recipe.get(id)).filter(Boolean).map((r) => JSON.parse(r.data));
      return send(res, 200, { recipes, cached: true, remaining: remaining(user) });
    }
    if (failed.has(key)) {
      failed.delete(key);
      throw new HttpError(502, 'ai-failed');
    }

    let job = inFlight.get(key);
    if (!job) {
      takeQuota(user); // a new search counts toward today's limit
      job = search(query, category)
        .then((recipes) => {
          q.saveSearch.run(key, JSON.stringify(recipes.map((r) => r.id)), Date.now());
          return recipes;
        })
        .catch((e) => {
          console.error(new Date().toISOString(), 'AI search failed', e?.status ?? '', e?.message);
          failed.set(key, Date.now());
          setTimeout(() => failed.delete(key), 120_000).unref?.();
          throw e;
        })
        .finally(() => inFlight.delete(key));
      job.catch(() => {}); // reported to the next poll instead
      inFlight.set(key, job);
    }

    // Wait a little; if it's not done, tell the app to ask again.
    const outcome = await Promise.race([job.then((r) => ({ recipes: r }), () => ({ error: true })), sleep(waitMs).then(() => 'pending')]);
    if (outcome === 'pending') return send(res, 202, { pending: true });
    if (outcome.error) {
      failed.delete(key);
      throw new HttpError(502, 'ai-failed');
    }
    send(res, 200, { recipes: outcome.recipes, cached: false, remaining: remaining(user) });
  }

  // ---------- fridge, photo → recipe, smart suggestion ----------

  const photoFrom = (body, required) => {
    try {
      const block = imageBlock(body?.image);
      if (!block && required) throw new HttpError(400, 'image-required');
      return block;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, 'bad-image');
    }
  };

  async function fridge(body) {
    const image = photoFrom(body, false);
    const ingredients = typeof body?.ingredients === 'string' ? body.ingredients.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
    if (!image && ingredients.length < 2) throw new HttpError(400, 'ingredients-required');
    const category = CATEGORIES.includes(body?.category) ? body.category : '';
    const text = [
      ingredients ? `اللي عندي: ${ingredients}` : 'شوف الصورة واعرف عندي إيه.',
      category ? `(عايز ${CATEGORY_AR[category]} بس)` : '',
    ].filter(Boolean).join('\n');
    return async () => {
      const out = await claude.json({ system: FRIDGE_SYSTEM, content: [...(image ? [image] : []), { type: 'text', text }], schema: FRIDGE_SCHEMA });
      const recipes = [];
      for (const r of Array.isArray(out?.recipes) ? out.recipes.slice(0, 4) : []) {
        const recipe = fromClaude(r, { notes: typeof r.tip === 'string' && r.tip.trim() ? r.tip : null });
        if (!recipe || (category && recipe.category !== category)) continue;
        recipes.push(saveGenerated(recipe, { uses: strings(r.uses_ingredients, 20), missing: strings(r.missing_ingredients, 10) }));
      }
      return { seen: strings(out?.seen_ingredients, 30), recipes };
    };
  }

  async function photoRecipe(body) {
    const image = photoFrom(body, true);
    return async () => {
      const out = await claude.json({ system: PHOTO_RECIPE_SYSTEM, content: [image, { type: 'text', text: 'اكتبلي الوصفة اللي في الصورة.' }], schema: PHOTO_RECIPE_SCHEMA, effort: 'medium' });
      const recipe = out?.found ? fromClaude(out.recipe, { requireSteps: false, halal: false }) : null;
      // The user's own recipe: keep it even if it's not halal-checked here (publishing goes through moderation).
      if (!recipe || (!recipe.ingredients.length && !recipe.steps.length)) throw new HttpError(422, 'no-recipe');
      return { recipe: { ...recipe, mealTypes: out.recipe.meal_types?.length ? recipe.mealTypes : [] } };
    };
  }

  async function suggest(body) {
    const meal = MEALS.includes(body?.meal) ? body.meal : null;
    if (!meal) throw new HttpError(400, 'meal-required');
    const candidates = (Array.isArray(body?.candidates) ? body.candidates : [])
      .filter((c) => typeof c?.key === 'string' && typeof c?.title === 'string' && c.key.length <= 80)
      .slice(0, 60)
      .map((c) => ({
        key: c.key,
        title: c.title.trim().slice(0, 120),
        liked: c.liked === true,
        rating: Number.isInteger(c.rating) && c.rating >= 1 && c.rating <= 5 ? c.rating : null,
        seenDaysAgo: Number.isFinite(c.seenDaysAgo) && c.seenDaysAgo >= 0 ? Math.round(c.seenDaysAgo) : null,
        suggestedLately: c.suggestedLately === true,
        mine: c.mine === true,
      }));
    const allowNew = body?.allowNew !== false;
    if (!candidates.length && !allowNew) throw new HttpError(400, 'no-candidates');
    const keys = new Set(candidates.map((c) => c.key));
    const mealAr = { breakfast: 'الفطار', lunch: 'الغدا', dinner: 'العشا' }[meal];
    const text = [
      `الوجبة: ${mealAr} (${meal})`,
      `الوقت دلوقتي في القاهرة: ${cairoNow()}`,
      `ينفع أكلة جديدة مش في القايمة: ${allowNew ? 'أيوه' : 'لأ'}`,
      'الأكلات المتاحة (JSON):',
      JSON.stringify(candidates),
    ].join('\n');
    return async () => {
      const out = await claude.json({ system: SUGGEST_SYSTEM, content: text, schema: SUGGEST_SCHEMA });
      const reason = typeof out?.reason === 'string' ? out.reason.trim().slice(0, 400) : '';
      if (out?.pick === 'saved' && keys.has(out.candidate_key)) return { kind: 'saved', key: out.candidate_key, reason };
      const recipe = allowNew && out?.new_recipe ? fromClaude({ ...out.new_recipe, meal_types: [meal] }) : null;
      if (recipe) return { kind: 'new', recipe: saveGenerated(recipe), reason };
      if (candidates.length) {
        // Claude's answer didn't fit: fall back to a dish not suggested lately.
        const fresh = candidates.filter((c) => !c.suggestedLately);
        const pick = (fresh.length ? fresh : candidates)[Math.floor(Math.random() * (fresh.length || candidates.length))];
        return { kind: 'saved', key: pick.key, reason: '' };
      }
      throw new HttpError(502, 'ai-failed');
    };
  }

  const TASKS = { '/api/ai/fridge': fridge, '/api/ai/photo-recipe': photoRecipe, '/api/ai/suggest': suggest };

  return {
    enabled: client,
    /** Called by the feed whenever a post's text or photo changes. */
    postChanged: (postId) => client && moderation.schedule(postId),

    async route(req, res, path, { requireUser, requireAdmin, isAdmin }) {
      isAdminFn = isAdmin;

      if (path === '/api/ai/search' && req.method === 'POST') {
        const user = requireUser(req);
        if (!client) throw new HttpError(503, 'ai-unavailable');
        await searchRoute(req, res, user);
        return true;
      }

      if (TASKS[path] && req.method === 'POST') {
        const user = requireUser(req);
        if (!client) throw new HttpError(503, 'ai-unavailable');
        const body = await readJson(req, 8 * 1024 * 1024);
        const run = await TASKS[path](body); // validates the input before anything is counted
        takeQuota(user);
        const job = startJob(user.userId, async () => ({ ...(await run()), remaining: remaining(user) }));
        await answerJob(res, job);
        return true;
      }

      const job = /^\/api\/ai\/jobs\/([^/]+)$/.exec(path);
      if (job && req.method === 'GET') {
        const user = requireUser(req);
        const found = JOB.test(job[1]) ? jobs.get(job[1]) : undefined;
        if (!found || found.userId !== user.userId) throw new HttpError(404, 'not-found');
        await answerJob(res, found);
        return true;
      }

      const one = /^\/api\/ai\/recipes\/([^/]+)$/.exec(path);
      if (one && req.method === 'GET') {
        const row = ID.test(one[1]) ? q.recipe.get(one[1]) : undefined;
        if (!row) throw new HttpError(404, 'not-found');
        send(res, 200, JSON.parse(row.data), { 'Cache-Control': 'public, max-age=3600' });
        return true;
      }

      return photos.route(req, res, path, { requireAdmin, enabled: client });
    },
  };
}
