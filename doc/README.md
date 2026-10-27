# Darwish Kitchen — developer notes

## Stack

- Expo SDK 58, React Native 0.88, React 19, TypeScript, Expo Router (routes in `src/app`).
- One codebase for Android, iOS and web. Web is exported as a single-page app (`web.output: "single"`).
- All data lives on the device in AsyncStorage (`localStorage` on web). Keys are in `src/lib/kv.ts`: recipes, profile, activity (likes/ratings/views), backup meta.
- Optional Supabase project is used **only** for login + backup/restore (`src/lib/supabase.ts`, `src/lib/backup.ts`). Without `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` the app runs fully offline.

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
| `src/data/samples.ts` | Starter recipes shown on first launch |
| `src/app/(tabs)/profile.tsx` | Profile: info, stats, recently viewed, account/backup card |
| `src/app/profile/edit.tsx` | Edit name, bio, phone, avatar |
| `src/app/profile/[section].tsx` | Lists: `added`, `liked`, `rated`, `viewed` |
| `src/app/account.tsx` | Sign in / sign up; offers restore on a phone that never synced |
| `src/lib/profile-context.tsx`, `src/lib/activity-context.tsx` | Profile and likes/ratings/views state |
| `src/lib/backup.ts` | Backup, restore, delete account |
| `supabase/schema.sql` | Server table, private photo bucket, row-level security, `delete_my_account()` |

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

## Backup and restore

- Server data: table `backups` (one JSON row per user) and private bucket `backups` with photos at `<user id>/images/<file>.jpg`. RLS limits both to the owner.
- Backup reads device storage, uploads photos not already on the server (file name = device file name, or a hash for web data URIs), writes the JSON with images as `backup:<file>`, then deletes server photos no longer used.
- Restore downloads photos via signed URLs, saves them like freshly picked photos, replaces the device data, deletes the replaced photos, and bumps `DataGenerationContext` so providers re-read storage.
- Safety: after sign-in on a phone that never backed up/restored, the app offers to restore; a first backup from such a phone asks before overwriting a server backup. Sign-out clears the backup meta so a different account never auto-backs up over its data.
- Auto backup: once a day on app start while signed in, after the first manual backup.
- Delete account removes photos and the backup row, then calls `delete_my_account()` (required by the App Store). Device data stays.
- Not built yet: password reset (needs a deep-link redirect).

## Photos

- Mobile: the picked photo is resized to max 1400px, saved as JPEG in `Paths.document/recipe-images/`, and deleted when its recipe is deleted or its photo replaced.
- Web: resized to 900px and stored as a JPEG data URI inside the recipe (~20–150 KB each). Browser storage is about 5 MB, so a save error is shown if it fills up.

## Arabic / RTL

- Native builds force RTL via `expo-localization` (`forcesRTL`). In Expo Go, `_layout.tsx` calls `I18nManager.forceRTL`, which applies after one app restart.
- Web sets `dir="rtl"` on `<html>`. Use `start`/`end` and `marginStart`/`marginEnd`, and leave `textAlign` unset so text follows the layout direction.
- Internet recipes are English; their lists render left-to-right (`RecipeBody ltr`).

## Web deploy

`.github/workflows/deploy-web.yml` runs `npm run build:web` with `WEB_BASE_URL=/<repo>` and publishes `dist/` to GitHub Pages. `scripts/postexport-web.mjs` prefixes the PWA links, adds `404.html` for deep links, and `.nojekyll`. Turn on Pages → Source: GitHub Actions once in repo settings.

## Checks

`npm run typecheck`, `npm run build:web`, and `npx expo export --platform android --platform ios` (bundles native JS without a device). To test backup in a browser without a real project, build with fake `EXPO_PUBLIC_SUPABASE_*` values and stub the Supabase REST/auth/storage calls (e.g. Playwright `page.route`).
