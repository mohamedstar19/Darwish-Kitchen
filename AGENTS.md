# Darwish Kitchen — agent guide

Arabic-first recipe app (Expo + React Native + Expo Router) for Android, iOS and web. Read `doc/README.md` first for the layout and how suggestions, photos, RTL and the web deploy work.

## Rules

- UI text is Egyptian Arabic and the layout is RTL. Use `start`/`end` styles and don't hard-code `textAlign: 'left' | 'right'`.
- Support light and dark mode through `useTheme()` in `src/theme.ts`; never hard-code screen colors.
- Keep non-route code out of `src/app/` (every file there is a screen).
- `server/` is the API (plain Node ESM). Its only dependency is `@anthropic-ai/sdk` for AI search; don't add others. Keep Claude calls on the server (never ship an API key in the app), validate every input, scope every query to the signed-in user, and run `cd server && npm test`.
- Don't commit `dist/`, `node_modules/`, `ios/`, `android/`, `server/data/`, or secrets.
- Update `doc/README.md` when behavior, storage or deploy changes.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. Before using an Expo or React Native API, check the installed package's types in `node_modules` or the versioned docs at `https://docs.expo.dev/versions/v58.0.0/`.

```bash
npx expo install <package>  # ALWAYS use instead of npm add — picks SDK-compatible versions
npx expo start              # dev server
npm run typecheck           # TypeScript
npm run build:web           # web export to dist/
npx expo export --platform android --platform ios   # check native bundles compile
```

Expo Go only includes bundled native modules; a library with custom native code needs a development build (`npx eas-cli@latest build --profile development`). `ios/` and `android/` are generated — configure them through `app.json` and config plugins.
