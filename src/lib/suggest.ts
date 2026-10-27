import { categoryOf, refKey, type Activity, type MealType, type Recipe, type WebRecipe } from '../types';
import { aiSuggest, type SuggestCandidate } from './ai-tools';
import { suggestWebRecipe } from './mealdb';

/** smart = the AI picks (signed in), all = mix, mine = my recipes + Darwish, web = TheMealDB. */
export type SuggestSource = 'smart' | 'all' | 'mine' | 'web';

/**
 * local = one of my recipes, darwish = from the Darwish kitchen, web = TheMealDB or a dish the AI wrote.
 * `reason`: why the AI picked it (smart suggestions only).
 */
export type Suggestion = { kind: 'local' | 'darwish'; recipe: Recipe; reason?: string } | { kind: 'web'; recipe: WebRecipe; reason?: string };

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

const DAY = 86_400_000;

/**
 * The smart suggestion: the AI looks at the dishes that fit the meal, what the user liked, rated and saw
 * lately, the time and the day in Cairo, and picks one (or writes a new dish), with the reason.
 */
export async function smartSuggest(
  meal: MealType,
  pool: { mine: Recipe[]; darwish: Recipe[] },
  activity: Activity,
  recent: string[],
): Promise<Suggestion & { remaining: number | null }> {
  const now = Date.now();
  const byKey = new Map<string, Picked>();
  const candidates: SuggestCandidate[] = [];
  const add = (kind: 'local' | 'darwish', recipe: Recipe) => {
    if (categoryOf(recipe) !== 'food' || !recipe.mealTypes.includes(meal)) return;
    const key = refKey({ kind, id: recipe.id });
    if (byKey.has(key)) return;
    byKey.set(key, { kind, recipe });
    const view = activity.views.find((v) => refKey(v.ref) === key);
    candidates.push({
      key,
      title: recipe.title,
      mine: kind === 'local',
      liked: !!activity.likes[key],
      rating: activity.ratings[key]?.stars ?? null,
      seenDaysAgo: view ? Math.floor((now - view.at) / DAY) : null,
      suggestedLately: recent.includes(recipe.id),
    });
  };
  pool.mine.forEach((r) => add('local', r));
  pool.darwish.forEach((r) => add('darwish', r));

  const pick = await aiSuggest(meal, candidates.slice(0, 60), true);
  if (pick.kind === 'new') return { kind: 'web', recipe: pick.recipe, reason: pick.reason, remaining: pick.remaining };
  const found = byKey.get(pick.key);
  if (!found) throw new Error('ai-failed');
  return { kind: found.kind, recipe: found.recipe, reason: pick.reason, remaining: pick.remaining };
}
