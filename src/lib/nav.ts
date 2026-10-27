import { router, type Href } from 'expo-router';

/** Goes back, or to `fallback` when the screen was opened directly (e.g. a web link or reload). */
export function goBack(fallback: Href) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
