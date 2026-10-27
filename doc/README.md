# Darwish Kitchen — developer notes

## Stack

- Expo SDK 58, React Native 0.88, React 19, TypeScript, Expo Router (routes in `src/app`).
- One codebase for Android, iOS and web. Web is exported as a single-page app (`web.output: "single"`).
- No backend. Recipes live in AsyncStorage (`localStorage` on web) under `darwish-kitchen.recipes.v1`.

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

## Suggestions

- The meal defaults from the clock: 04:00–10:59 breakfast, 11:00–16:59 lunch, otherwise dinner.
- **وصفاتي** picks a random saved recipe tagged with that meal, skipping the last 5 suggestions when possible.
- **من النت** picks a random TheMealDB category for the meal (`CATEGORIES_BY_MEAL`), then a random dish from it, and drops dishes containing pork or alcohol.
- **الاتنين** chooses between the two at random and falls back to whichever one works (e.g. offline → saved recipes).

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

`npm run typecheck`, `npm run build:web`, and `npx expo export --platform android --platform ios` (bundles native JS without a device).
