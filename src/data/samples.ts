import type { MealType, Recipe, RecipeCategory } from '../types';
import starters from './starter-recipes.json';

const t = Date.UTC(2026, 0, 1);

/**
 * Darwish recipes bundled with the app (food, healthy drinks, juices): shown in "وصفات درويش" until the
 * server catalog loads (e.g. first launch offline). The same file seeds the server catalog.
 */
export const SAMPLE_RECIPES: Recipe[] = starters.map((s) => ({
  ...s,
  category: s.category as RecipeCategory,
  mealTypes: s.mealTypes as MealType[],
  source: 'sample',
  createdAt: t,
  updatedAt: t,
}));
