# Darwish Kitchen — developer notes

## Stack

- Expo SDK 58, React Native 0.88, React 19, TypeScript, Expo Router (routes in `src/app`).
- One codebase for Android, iOS and web. Web is exported as a single-page app (`web.output: "single"`).
- All data lives on the device in AsyncStorage (`localStorage` on web). Keys are in `src/lib/kv.ts`: recipes, profile, activity (likes/ratings/views), backup meta.
- The self-hosted API in `server/` is used **only** for login + backup/restore. The app calls `https://kitchen.darwish-tech.com` (override with `EXPO_PUBLIC_API_URL`; an empty value means same origin). Everything else works offline.

## Layout

| Path | Purpose |
| --- | --- |
| `src/app/(tabs)/index.tsx` | Home: meal + source pickers and the "حناكل إيه النهارده؟" button |
| `src/app/(tabs)/recipes.tsx` | Saved recipes: search, meal/favorite filters, add button |
| `src/app/(tabs)/discover.tsx` | Search TheMealDB |
| `src/app/recipe/[id].tsx` | Saved recipe details, favorite, edit, delete |
| `src/app/recipe/edit.tsx` | Add / edit form with photo (`?id=` to edit) |
| `src/app/online/[id].tsx` | Internet recipe details + save |
| `src/lib/suggest.ts` | Suggestion logic |
| `src/lib/mealdb.ts` | TheMealDB client, category mapping, pork/alcohol filter |
| `src/lib/images.ts` | Pick, resize and store recipe photos |
| `src/lib/recipes-context.tsx` | Recipe state + persistence |
| `src/data/starter-recipes.json` | Starter recipes (food, drinks, juices): bundled in the app and seeds the server catalog |
| `src/data/samples.ts` | Turns the starters into `Recipe`s for first launch / offline |
| `src/lib/catalog.ts` | Fetch + merge the admin catalog into the device's recipes |
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
- "وصفاتي" has section tabs (الكل / أكل / مشروبات صحية / عصائر); meal filters show only in أكل. `/recipes?section=juice` opens a section (used by the home tiles).
- Starter drinks/juices live in `DRINK_SAMPLES`. `SAMPLES_VERSION` (stored under `darwish-kitchen.samples-version`) adds new starters once for existing users; a starter the user deleted later doesn't come back.
- "حناكل إيه النهارده؟" only suggests food.

## Suggestions

- The meal defaults from the clock: 04:00–10:59 breakfast, 11:00–16:59 lunch, otherwise dinner.
- **وصفاتي** picks a random saved recipe tagged with that meal, skipping the last 5 suggestions when possible.
- **من النت** picks a random TheMealDB category for the meal (`CATEGORIES_BY_MEAL`), then a random dish from it, and drops dishes containing pork or alcohol.
- **الاتنين** chooses between the two at random and falls back to whichever one works (e.g. offline → saved recipes).

## Profile and activity

- Likes, ratings (1–5, tap again to clear) and views are keyed `local:<recipe id>` or `web:<TheMealDB id>`. Web entries keep a title/image snapshot so lists work offline.
- Views are recorded when a detail screen opens; the last 60 are kept.
- "ضفتها" = saved recipes whose `source` isn't `sample` (includes internet recipes the user saved).
- Old `Recipe.favorite` flags are migrated to likes the first time the activity store loads.

## Catalog and control panel

- The server keeps a **catalog** of starter recipes everyone gets. First start seeds it from `starter-recipes.json` (once; deleting them later doesn't re-seed).
- Admins are phone numbers in `ADMIN_PHONES` (`/opt/darwish-kitchen/otp.env`, or `ADMIN_PHONES=01… bash deploy/update.sh <server>`). `GET /api/me` and login return `isAdmin`; every `/api/admin/*` route checks it server-side.
- Control panel: `/admin` in the app (web: `https://kitchen.darwish-tech.com/admin`, or "حسابي" → لوحة التحكم). Add/edit recipes, upload/replace/remove a photo, hide (unpublish), delete. Filter "من غير صورة" shows what still needs a photo.
- Photos: `DATA_DIR/catalog-images/<id>-<random>.jpg`, served publicly from `/api/catalog/images/…` with a 1-year immutable cache (a new upload gets a new name).
- App sync (`mergeCatalog`), on every app start: adds new catalog recipes; updates starters the user never edited (`customized`) when `updatedAt` changes; removes starters the admin deleted/hid unless edited; never re-adds starters the user deleted (`darwish-kitchen.catalog-dismissed`); ignores an empty response. Catalog photos are remote URLs, so they need internet the first time.

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

## Arabic / RTL

- Native builds force RTL via `expo-localization` (`forcesRTL`). In Expo Go, `_layout.tsx` calls `I18nManager.forceRTL`, which applies after one app restart.
- Web sets `dir="rtl"` on `<html>`. Use `start`/`end` and `marginStart`/`marginEnd`, and leave `textAlign` unset so text follows the layout direction.
- Internet recipes are English; their lists render left-to-right (`RecipeBody ltr`).

## Web deploy

`deploy/update.sh` builds the web app with `WEB_BASE_URL=""` (served at the domain root) and installs it to `/opt/darwish-kitchen/web` on the server. `scripts/postexport-web.mjs` prefixes the PWA links and adds `404.html`. GitHub Actions (`.github/workflows/ci.yml`) only checks: typecheck, web build, server tests.

## Checks

`npm run typecheck`, `npm run build:web`, and `npx expo export --platform android --platform ios` (bundles native JS without a device). `cd server && npm test` covers the API. For an end-to-end run, start the API locally (`PORT=3020 DATA_DIR=./data npm start`) and build/run the web app with `EXPO_PUBLIC_API_URL=http://localhost:3020`.
