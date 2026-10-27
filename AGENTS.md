# Darwish Kitchen — agent guide

Arabic-first recipe app (Expo + React Native + Expo Router) for Android, iOS and web. Read `doc/README.md` first for the layout and how suggestions, photos, RTL and the web deploy work.

## Rules

- UI text is Egyptian Arabic and the layout is RTL. Use `start`/`end` styles and don't hard-code `textAlign: 'left' | 'right'`.
- Support light and dark mode through `useTheme()` in `src/theme.ts`; never hard-code screen colors.
- Keep non-route code out of `src/app/` (every file there is a screen).
- Don't commit `dist/`, `node_modules/`, `ios/`, `android/`, or secrets.
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
