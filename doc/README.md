# Darwish Kitchen — developer notes

## Stack

- Expo SDK 58, React Native 0.88, React 19, TypeScript, Expo Router (routes in `src/app`).
- One codebase for Android, iOS and web. Web is exported as a single-page app (`web.output: "single"`).
- All data lives on the device in AsyncStorage (`localStorage` on web). Keys are in `src/lib/kv.ts`: recipes, profile, activity (likes/ratings/views), backup meta.
- The self-hosted API in `server/` is used **only** for login + backup/restore. The app calls `https://kitchen.darwish-tech.com` (override with `EXPO_PUBLIC_API_URL`; an empty value means same origin). Everything else works offline.

## Layout

| Path | Purpose |
| --- | --- |
| `src/app/(tabs)/index.tsx` | Home: Darwish slider, meal + source pickers, "حناكل إيه النهارده؟", drinks tiles |
| `src/app/(tabs)/feed.tsx` | "الشيفات": chefs feed (customers' published recipes), filters, like/save |
| `src/app/feed/[id].tsx` | A chef's recipe: like, save, report, delete (own/admin) |
| `src/app/darwish/` | "وصفات درويش" list (sections) and detail (like, rate, copy to my recipes) |
| `src/app/(tabs)/recipes.tsx` | "وصفاتي": only the user's own + saved recipes; search, sections, filters |
| `src/app/(tabs)/discover.tsx` | "من النت": AI search across many recipe sites (Arabic) + TheMealDB |
| `src/lib/ai-search.ts`, `server/src/ai.mjs` | AI recipe search client / server (Claude + web search) |
| `src/lib/ai-tools.ts` | AI helpers client: fridge ideas, photo → recipe, smart suggestion (job polling) |
| `src/app/ai/fridge.tsx` | "عندي في التلاجة…": ingredients typed and/or photographed → dishes |
| `src/app/admin/photos.tsx` | Control panel: photos found by the AI for Darwish recipes (review / auto) |
| `server/src/ai-core.mjs` | Shared AI pieces: Claude client (JSON / web tools), safe fetch, halal filter, image input |
| `server/src/ai-moderation.mjs`, `server/src/ai-photos.mjs` | AI feed moderation; AI photo finder for the catalog |
| `src/app/recipe/[id].tsx` | Saved recipe details, favorite, edit, delete |
| `src/app/recipe/edit.tsx` | Add / edit form with photo (`?id=` to edit) |
| `src/app/online/[id].tsx` | Internet recipe details + save |
| `src/lib/suggest.ts` | Suggestion logic |
| `src/lib/mealdb.ts` | TheMealDB client, category mapping, pork/alcohol filter |
| `src/lib/images.ts` | Pick, resize and store recipe photos |
| `src/lib/recipes-context.tsx` | Recipe state + persistence |
| `src/data/starter-recipes.json` | Starter recipes (food, drinks, juices): bundled in the app and seeds the server catalog |
| `src/data/samples.ts` | Turns the starters into `Recipe`s for first launch / offline |
| `src/lib/catalog.ts` | Darwish catalog types + fetch |
| `src/lib/darwish-context.tsx` | Darwish recipes: cached copy, bundled fallback, refresh from server |
| `src/lib/feed-api.ts`, `src/lib/feed-actions.ts`, `src/lib/publish.ts` | Feed client, like/save helpers, publishing (chef name/photo, recipe, photo) |
| `server/src/posts.mjs` | Feed API: posts, likes, reports, chef profile, moderation |
| `src/app/admin/` | Control panel (admins only): catalog list, add/edit with photos, hide, delete |
| `server/src/catalog.mjs` | Catalog API + photos |
| `src/app/(tabs)/profile.tsx` | Profile: info, stats, recently viewed, account/backup card |
| `src/app/profile/edit.tsx` | Edit name, bio, phone, avatar |
| `src/app/profile/[section].tsx` | Lists: `added`, `liked`, `rated`, `viewed` |
| `src/app/account.tsx` | Sign in / sign up; offers restore on a phone that never synced |
| `src/lib/profile-context.tsx`, `src/lib/activity-context.tsx` | Profile and likes/ratings/views state |
| `src/lib/api.ts` | API client, saved login token |
| `src/lib/backup.ts` | Backup, restore, delete account |
| `server/` | Backup API (Node 22, no dependencies, SQLite) + tests |
| `deploy/` | One-command deploy to the darwish-tech server, nginx site |

## Sections (أكل / مشروبات صحية / عصائر)

- `Recipe.category` is `food` | `healthy-drink` | `juice`; missing means `food` (older data). Use `categoryOf()`.
- Drinks and juices don't need meal types; the add/edit form hides the meal picker for them.
- "وصفاتي" and "وصفات درويش" have section tabs (الكل / أكل / مشروبات صحية / عصائر); meal filters show only in أكل. `/darwish?section=juice` opens a section (used by the home tiles).
- Drinks and juices for everyone are in the Darwish catalog (home tiles open its sections); users add their own in وصفاتي.
- "حناكل إيه النهارده؟" only suggests food.

## Suggestions

- The meal defaults from the clock: 04:00–10:59 breakfast, 11:00–16:59 lunch, otherwise dinner.
- **وصفاتي** picks a random saved recipe tagged with that meal, skipping the last 5 suggestions when possible.
- **من النت** picks a random TheMealDB category for the meal (`CATEGORIES_BY_MEAL`), then a random dish from it, and drops dishes containing pork or alcohol.
- **الاتنين** chooses between the two at random and falls back to whichever one works (e.g. offline → saved recipes).
- **✨ ذكي** (default once signed in): see "AI helpers" below. The answer shows the AI's reason under the title.

## Profile and activity

- Likes, ratings (1–5, tap again to clear) and views are keyed `local:<recipe id>` or `web:<TheMealDB id>`. Web entries keep a title/image snapshot so lists work offline.
- Views are recorded when a detail screen opens; the last 60 are kept.
- "ضفتها" = saved recipes whose `source` isn't `sample` (includes internet recipes the user saved).
- Old `Recipe.favorite` flags are migrated to likes the first time the activity store loads.

## App structure

- Tabs: **الرئيسية** (slider + suggestions) · **الشيفات** (feed) · **وصفاتي** · **من النت** · **حسابي**.
- **وصفاتي** holds only the user's recipes: ones they wrote (`source: user`), saved from the feed (`feed`, `feedId`) or the internet (`web`). New users start empty.
- **وصفات درويش** is the admin catalog, kept separately (`DarwishProvider`, cached in `darwish-kitchen.darwish-cache.v1`, bundled `starter-recipes.json` as offline fallback). Likes/ratings/views use ref kind `darwish`. "خد نسخة وعدّلها" copies one into وصفاتي.
- Suggestions ("من التطبيق") pick from my food recipes + Darwish food; "الاتنين" also mixes in TheMealDB.
- Data version 3 (`storage.ts`, `migrated()`): untouched starters leave وصفاتي, edited ones become `user` recipes, and activity refs on removed starters become `darwish`. Every loader awaits the same migration.

## AI recipe search ("من النت")

- `POST /api/ai/search {query, category?}` (signed in): Claude (`claude-opus-5-5`, effort `low`, server-side `fallbacks: "default"`) uses `web_search_20260209` (max 4) and `web_fetch_20260209` (max 6) to find up to 6 recipes on different sites (Arabic and international), then returns them through a strict `submit_recipes` tool, written in Egyptian Arabic with `source_name`/`source_url`. `pause_turn` responses are sent back to continue.
- Server checks: each `source_url` must have appeared in the web tools' **results** (not Claude's own text), one recipe per page, title + ≥2 ingredients + ≥1 step, no pork/alcohol (English and Arabic words). Photos come from the page's `og:image`/`twitter:image`; the fetch refuses private/internal addresses (checked on every redirect) and reads only the page head.
- Cost control: login required; `AI_DAILY_LIMIT` new searches per user per day (default 20, admins unlimited); identical searches (query + section) are cached 7 days and free; concurrent identical searches share one job.
- Cloudflare cuts requests at 100 s, so the endpoint waits ~25 s then answers `202 {pending}`; the app repeats the same POST every 2.5 s (up to 5 min) until it gets `200 {recipes}`.
- Results are stored (`ai_recipes`) so `GET /api/ai/recipes/:id` can reopen them; in the app they are `WebRecipe`s with `webId: "ai-…"` and an `ai` block (category, meal types, source), shown right-to-left, saved as `source: web`.
- Settings in `/opt/darwish-kitchen/otp.env`: `ANTHROPIC_API_KEY` (required to turn it on), optional `AI_MODEL`, `AI_DAILY_LIMIT`. `/api/health` reports `ai`.
- The server's only npm dependency is `@anthropic-ai/sdk` (installed by `install.sh` with `npm ci`).

## AI helpers (fridge, photo → recipe, smart suggestion)

All Claude calls are on the server (`claude-opus-5-5`, effort `low`, `fallbacks: "default"`, structured JSON output). Each call counts toward the user's `AI_DAILY_LIMIT` (shared with the search; admins unlimited); input is validated before anything is counted. They answer `200` with the result, or `202 {pending, job}` after ~25 s; the app then polls `GET /api/ai/jobs/:job` (owner only, kept 10 min).

- `POST /api/ai/fridge {ingredients?, image?, category?}`: what the user has (text and/or a base64 photo, JPEG/PNG/WebP up to ~5 MB) → up to 4 halal dishes with `missing` ingredients and a tip (in `notes`). Results are stored like search results (`ai-…` ids, `generated: true`, no source) and open in `online/[id]`.
- `POST /api/ai/photo-recipe {image}`: a photo of a handwritten/printed recipe or screenshot → the form fields (`recipe/edit.tsx` "عندك الوصفة مكتوبة؟"). `422 no-recipe` when the photo has none. The app sends the photo resized to ~1500 px (`pickPhotoForAi`), never stores it.
- `POST /api/ai/suggest {meal, candidates, allowNew}`: the app sends the dishes that fit the meal (my food + Darwish food, max 60) with liked / rating / days since seen / suggested lately; the server adds Cairo day and time. Claude picks a candidate key (checked against the list) or writes a new dish, plus a short reason.

## AI feed moderation

- Every new or edited post (text, chef name, photo) is checked ~4 s after it changes (`posts.onChange` → `ai-moderation.mjs`, one at a time). Verdicts: `ok`; `review` (stays visible, flagged); `block` (hidden and flagged). Stored in `posts.ai_status / ai_reason / ai_hidden` (DB v5).
- `ai_hidden` marks posts the AI hid: if the chef fixes the post and it passes, it comes back. Posts an admin hid stay hidden. The result is saved only if the post didn't change meanwhile.
- Control panel → وصفات الشيفات → "✨ الذكاء الاصطناعي علّم عليها" (`GET /api/admin/posts?filter=ai`) shows the reason.

## AI photos for Darwish recipes

- Control panel → وصفات درويش → "✨ هات صور بالذكاء الاصطناعي" (`admin/photos.tsx`). A run takes up to 25 catalog recipes without a photo.
- Only free-license photos, through official search APIs (photo sites block page scraping from servers): Claude turns the Arabic name into up to 3 English queries; the server searches Wikimedia Commons (`api.php`, JPEG, CC0/PD/CC BY/CC BY-SA only), Openverse (`license=by,by-sa,cc0,pdm`) and Pexels when `PEXELS_API_KEY` is set, downloads up to 6 JPEGs (asks for `image/jpeg`, ≤5 MB, private addresses refused, identifies itself with a `DarwishKitchen/1.0` User-Agent as Wikimedia asks), then Claude scores each photo 0–10 for the dish. The log shows the queries and counts per recipe; the run keeps the last error for the control panel. Photos scoring ≥6 are kept as candidates (`ai_photo_candidates`, files in `DATA_DIR/ai-photos`).
- Modes: **review** (admin picks one or skips the recipe) and **auto** (a photo scoring ≥8 is applied at once; the rest wait). Applying copies it into `catalog-images` and stores `catalog.image_credit` `{source, url, author, license}`, returned as `imageCredit` and shown under the photo ("📷 author / site"). A manual upload clears the credit.
- Admin API: `GET /api/admin/ai/photos`, `POST /api/admin/ai/photos/run {mode, ids?}`, `POST /api/admin/ai/photos/:id/approve`, `DELETE /api/admin/ai/photos/recipes/:recipeId`; candidate images at `GET /api/ai/photo-candidates/:id.jpg`.

## Chefs feed

- Add/edit form has "انشرها في الفيد" (on by default) for the user's own recipes. Publishing needs a login and a chef name (asked inline the first time, saved in the profile). It sends the chef name/photo, then `POST /api/posts {clientId: recipe.id, recipe}` (same clientId updates the same post), then the photo if it changed. The post id is kept in `recipe.postId`. Turning it off, or deleting the recipe, removes the post. If the network fails, the recipe is still saved locally and the user is told to save again.
- Posts are public right away. Anyone signed in can like (count + likedByMe), save a copy, and report (not their own). Admins see reported/hidden/all in the control panel ("وصفات الشيفات"), and can hide/show or delete.
- Server: `posts`, `post_likes`, `post_reports` tables (DB v4) plus `users.name/avatar`. Photos in `DATA_DIR/post-images` and `DATA_DIR/avatars`, served publicly with immutable caching. Limits: 30 new posts/day, 50 reports/day per user. Deleting an account deletes the chef's posts, likes, reports and photos.

## Catalog and control panel

- The server keeps the **Darwish catalog**. First start seeds it from `starter-recipes.json` (once; deleting them later doesn't re-seed).
- Admins are phone numbers in `ADMIN_PHONES` (`/opt/darwish-kitchen/otp.env`, or `ADMIN_PHONES=01… bash deploy/update.sh <server>`). `GET /api/me` and login return `isAdmin`; every admin route checks it server-side.
- Control panel `/admin` ("حسابي" → لوحة التحكم): **وصفات درويش** (add/edit, photo upload/replace/remove, hide, delete, "من غير صورة" filter) and **وصفات الشيفات** (moderation).
- Catalog photos: `DATA_DIR/catalog-images/<id>-<random>.jpg`, public, immutable cache (a new upload gets a new name).

## Backup server (`server/`)

- Node 22.13+ with built-in `node:sqlite`; no npm dependencies. Data in `DATA_DIR` (`kitchen.db` + `images/<user id>/<file>.jpg`).
- Endpoints: `POST /api/auth/otp/send` `{phone}`, `POST /api/auth/otp/verify` `{phone, code}` (creates the account on first login), `POST /api/auth/logout`, `GET /api/me`, `GET|PUT /api/backup`, `GET /api/backup/meta`, `GET|DELETE /api/images`, `GET|PUT /api/images/:name`, `DELETE /api/account`, `GET /api/health`.
- Auth: phone number + WhatsApp code through the **Darwish OTP** platform (same as the Quran site): `POST OTP_URL {phone}` → `{request_id}`, then `POST …/verify {request_id, code}` → `{valid}`. Settings `OTP_URL` / `OTP_TOKEN` live in `/opt/darwish-kitchen/otp.env` (600, read at startup; `install.sh` copies them from the Quran `.env` on first install). Without them, `/api/health` reports `otp:false` and login returns 503. `OTP_DEV_CODES=1` prints codes to the log for local testing only.
- Phones are stored as international digits (Egyptian `01…` → `201…`). Limits: 3 codes per number per 10 min, 10 per IP per 15 min, 5 wrong tries per code. A successful login returns a random bearer token stored hashed, valid 180 days.
- Schema versions via `PRAGMA user_version` (`db.mjs`); v1 (email login) upgrades in place, old email-only accounts can't sign in but their rows stay. Migrations run with foreign keys off.
- Every backup/image route is scoped to the token's user. Image names are validated, uploads must be JPEG (≤ 5 MB, ≤ 2000 per user); backup JSON ≤ 10 MB.
- Deleting the account removes the user row (sessions and backup cascade) and the photo folder.
- Production: PM2 process `kitchen` (ecosystem file written by `install.sh`) on 127.0.0.1:3020, or the next free port if another program uses it (saved in `/opt/darwish-kitchen/port` and written into the nginx site), behind nginx (`deploy/kitchen-nginx.conf`), nightly tarball of the data folder kept 14 days. See `deploy/README.md`.

## Backup and restore (app)

- Backup reads device storage, uploads photos not already on the server (file name = device file name, or a hash for web data URIs), writes the JSON with images as `backup:<file>`, then deletes server photos no longer used.
- Restore downloads photos with the login token, saves them like freshly picked photos, replaces the device data, deletes the replaced photos, and bumps `DataGenerationContext` so providers re-read storage.
- Safety: after sign-in on a phone that never backed up/restored, the app offers to restore; a first backup from such a phone asks before overwriting a server backup. Signing out or switching accounts clears the backup meta so one account never auto-backs up over another's data.
- Auto backup: once a day on app start while signed in, after the first manual backup.
- A 401 from the server clears the saved login so the app shows the sign-in button.
- Not built yet: password reset (needs email sending on the server).

## Photos

- Mobile: the picked photo is resized to max 1400px, saved as JPEG in `Paths.document/recipe-images/`, and deleted when its recipe is deleted or its photo replaced.
- Web: resized to 900px and stored as a JPEG data URI inside the recipe (~20–150 KB each). Browser storage is about 5 MB, so a save error is shown if it fills up.

## Pull to refresh

`src/components/PullToRefresh.tsx` wraps a list or scroll view (render prop). Phones use `RefreshControl`; on the web (browser and the home-screen app) the page scrolls inside the app, so the browser's own pull-to-refresh never fires: the component follows the finger while the list is at the top, shows a spinner and calls `onRefresh` after a long enough pull (`overscroll-behavior-y: contain` stops the browser from reloading the page). Used on home (Darwish catalog), chefs feed, وصفاتي, حسابي and the Darwish list.

## Arabic / RTL

- Native builds force RTL via `expo-localization` (`forcesRTL`). In Expo Go, `_layout.tsx` calls `I18nManager.forceRTL`, which applies after one app restart.
- Web sets `dir="rtl"` on `<html>`. Use `start`/`end` and `marginStart`/`marginEnd`, and leave `textAlign` unset so text follows the layout direction.
- Internet recipes are English; their lists render left-to-right (`RecipeBody ltr`).

## Product page (`/about`)

- `site/page.html` + `site/img/` is the Arabic product page at `https://kitchen.darwish-tech.com/about/` (served by nginx from `web/about/`).
- `page.html` keeps head content (title, fonts, styles) before `<!-- /head -->` and the page after it; `scripts/postexport-web.mjs` wraps it into `dist/about/index.html` with `lang="ar" dir="rtl"`, Open Graph tags and the icons. The same file can be published as a standalone preview.
- Screenshots are 780×1328 WebP taken from the web build (iPhone 13 size); `img/og.jpg` (1200×630) is the link preview for WhatsApp/Facebook. Retake them when the screens change.

## Web deploy

`deploy/update.sh` builds the web app with `WEB_BASE_URL=""` (served at the domain root) and installs it to `/opt/darwish-kitchen/web` on the server. `scripts/postexport-web.mjs` prefixes the PWA links, adds `?v=<content hash>` to the icon/manifest/favicon links and to the icons inside `manifest.json` (so icon changes bypass browser and Cloudflare caches), and adds `404.html`. The manifest has a fixed `"id": "/"` so installed apps keep their identity when the manifest URL changes. GitHub Actions (`.github/workflows/ci.yml`) only checks: typecheck, web build, server tests.

## Icons

The brand icon is `assets/brand/icon-source.png`. `python3 scripts/make-icons.py` (needs Pillow) regenerates everything from it: `assets/icon.png` (iOS/web), Android adaptive foreground/background/monochrome (cream panel inside the safe zone on the orange `#F0802B`, set in `app.json`), splash, favicon, PWA icons incl. maskable, and `assets/logo.png` (home header).

## Checks

`npm run typecheck`, `npm run build:web`, and `npx expo export --platform android --platform ios` (bundles native JS without a device). `cd server && npm test` covers the API. For an end-to-end run, start the API locally (`PORT=3020 DATA_DIR=./data npm start`) and build/run the web app with `EXPO_PUBLIC_API_URL=http://localhost:3020`.
