import type { MealType, Recipe, RecipeCategory } from '../types';
import starters from './starter-recipes.json';

const t = Date.UTC(2026, 0, 1);

/**
 * Starter recipes bundled with the app (food, healthy drinks, juices) so it works offline on first launch.
 * The same file seeds the server catalog, where the admin can edit them and add photos; the app then syncs them.
 */
export const SAMPLE_RECIPES: Recipe[] = starters.map((s) => ({
  ...s,
  category: s.category as RecipeCategory,
  mealTypes: s.mealTypes as MealType[],
  source: 'sample',
  createdAt: t,
  updatedAt: t,
}));

/** Starter healthy drinks and juices (added in samples version 2). */
export const DRINK_SAMPLES: Recipe[] = SAMPLE_RECIPES.filter((r) => r.category !== 'food');

/** Bump when new starter recipes are added, so existing users get them once. */
export const SAMPLES_VERSION = 2;
