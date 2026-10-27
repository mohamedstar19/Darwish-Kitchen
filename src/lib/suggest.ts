import { categoryOf, type MealType, type Recipe, type WebRecipe } from '../types';
import { suggestWebRecipe } from './mealdb';

export type SuggestSource = 'all' | 'mine' | 'web';

export type Suggestion = { kind: 'local'; recipe: Recipe } | { kind: 'web'; recipe: WebRecipe };

const random = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];

function pickLocal(recipes: Recipe[], meal: MealType, recent: string[]): Recipe | null {
  const fits = recipes.filter((r) => categoryOf(r) === 'food' && r.mealTypes.includes(meal));
  if (!fits.length) return null;
  const fresh = fits.filter((r) => !recent.includes(r.id));
  return random(fresh.length ? fresh : fits);
}

/**
 * Chooses today's dish for the meal.
 * "all" mixes saved recipes and the internet, falling back to whichever works.
 * `recent` holds ids (local or web) suggested lately so the same dish doesn't repeat.
 */
export async function suggestMeal(
  meal: MealType,
  source: SuggestSource,
  recipes: Recipe[],
  recent: string[],
): Promise<Suggestion> {
  const local = source === 'web' ? null : pickLocal(recipes, meal, recent);

  if (source === 'mine') {
    if (!local) throw new Error('no-local');
    return { kind: 'local', recipe: local };
  }

  const preferLocal = source === 'all' && local !== null && Math.random() < 0.5;
  if (preferLocal) return { kind: 'local', recipe: local! };

  try {
    return { kind: 'web', recipe: await suggestWebRecipe(meal, recent) };
  } catch (error) {
    if (local) return { kind: 'local', recipe: local };
    throw error;
  }
}
