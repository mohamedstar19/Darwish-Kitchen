import { categoryOf, type MealType, type Recipe, type WebRecipe } from '../types';
import { suggestWebRecipe } from './mealdb';

export type SuggestSource = 'all' | 'mine' | 'web';

/** local = one of my recipes, darwish = from the Darwish kitchen, web = TheMealDB. */
export type Suggestion = { kind: 'local' | 'darwish'; recipe: Recipe } | { kind: 'web'; recipe: WebRecipe };

type Picked = { kind: 'local' | 'darwish'; recipe: Recipe };

const random = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];

function pickLocal(pool: { mine: Recipe[]; darwish: Recipe[] }, meal: MealType, recent: string[]): Picked | null {
  const fitsMeal = (r: Recipe) => categoryOf(r) === 'food' && r.mealTypes.includes(meal);
  const fits: Picked[] = [
    ...pool.mine.filter(fitsMeal).map((recipe) => ({ kind: 'local' as const, recipe })),
    ...pool.darwish.filter(fitsMeal).map((recipe) => ({ kind: 'darwish' as const, recipe })),
  ];
  if (!fits.length) return null;
  const fresh = fits.filter((p) => !recent.includes(p.recipe.id));
  return random(fresh.length ? fresh : fits);
}

/**
 * Chooses today's dish for the meal.
 * "mine" picks from my recipes and the Darwish kitchen; "all" also mixes in the internet, falling back to whichever works.
 * `recent` holds ids (local or web) suggested lately so the same dish doesn't repeat.
 */
export async function suggestMeal(
  meal: MealType,
  source: SuggestSource,
  pool: { mine: Recipe[]; darwish: Recipe[] },
  recent: string[],
): Promise<Suggestion> {
  const local = source === 'web' ? null : pickLocal(pool, meal, recent);

  if (source === 'mine') {
    if (!local) throw new Error('no-local');
    return local;
  }

  const preferLocal = source === 'all' && local !== null && Math.random() < 0.5;
  if (preferLocal) return local!;

  try {
    return { kind: 'web', recipe: await suggestWebRecipe(meal, recent) };
  } catch (error) {
    if (local) return local;
    throw error;
  }
}
