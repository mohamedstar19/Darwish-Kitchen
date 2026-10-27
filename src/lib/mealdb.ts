import type { MealType, WebRecipe } from '../types';

// TheMealDB free public API (test key "1"): https://www.themealdb.com/api.php
const API = 'https://www.themealdb.com/api/json/v1/1';

const CATEGORIES_BY_MEAL: Record<MealType, string[]> = {
  breakfast: ['Breakfast'],
  lunch: ['Chicken', 'Beef', 'Lamb', 'Seafood', 'Pasta', 'Goat'],
  dinner: ['Chicken', 'Pasta', 'Vegetarian', 'Seafood', 'Side', 'Starter'],
};

export const CATEGORY_AR: Record<string, string> = {
  Breakfast: 'فطار',
  Beef: 'لحم بقري',
  Chicken: 'فراخ',
  Lamb: 'لحم ضاني',
  Seafood: 'مأكولات بحرية',
  Pasta: 'مكرونة',
  Goat: 'لحم ماعز',
  Vegetarian: 'نباتي',
  Vegan: 'نباتي صرف',
  Side: 'أطباق جانبية',
  Starter: 'مقبلات',
  Dessert: 'حلويات',
  Miscellaneous: 'متنوع',
};

// Hide recipes that use pork or alcohol.
const EXCLUDED = [
  'pork', 'bacon', 'ham', 'lard', 'prosciutto', 'pancetta', 'chorizo', 'salami', 'pepperoni',
  'gammon', 'sausage', 'wine', 'beer', 'ale', 'rum', 'brandy', 'sherry', 'vodka', 'whisky',
  'whiskey', 'bourbon', 'cognac', 'liqueur', 'marsala', 'sake', 'mirin', 'gin', 'cider', 'stout',
  'kirsch', 'port', 'tequila', 'champagne', 'vermouth', 'calvados', 'grand marnier',
];
const EXCLUDED_RE = new RegExp(`\\b(${EXCLUDED.join('|')})\\b`, 'i');

type RawMeal = Record<string, string | null>;

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API}/${path}`, { signal });
  if (!res.ok) throw new Error(`mealdb-${res.status}`);
  return (await res.json()) as T;
}

function clean(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function toWebRecipe(raw: RawMeal): WebRecipe {
  const ingredients: string[] = [];
  for (let i = 1; i <= 20; i++) {
    const name = clean(raw[`strIngredient${i}`]);
    if (!name) continue;
    const measure = clean(raw[`strMeasure${i}`]);
    ingredients.push(measure ? `${measure} ${name}` : name);
  }
  const steps = clean(raw.strInstructions)
    .split(/\r?\n+/)
    .map((s) => s.replace(/^(step\s*\d+[:.)]?|\d+[.)])\s*/i, '').trim())
    .filter((s) => s.length > 2);
  return {
    webId: clean(raw.idMeal),
    title: clean(raw.strMeal),
    image: clean(raw.strMealThumb) || undefined,
    category: clean(raw.strCategory) || undefined,
    area: clean(raw.strArea) || undefined,
    ingredients,
    steps,
    sourceUrl: clean(raw.strSource) || undefined,
    youtube: clean(raw.strYoutube) || undefined,
  };
}

export function isAllowed(recipe: WebRecipe): boolean {
  return !EXCLUDED_RE.test(recipe.ingredients.join(' ')) && !EXCLUDED_RE.test(recipe.title);
}

export async function getWebRecipe(webId: string, signal?: AbortSignal): Promise<WebRecipe | null> {
  const data = await getJson<{ meals: RawMeal[] | null }>(`lookup.php?i=${encodeURIComponent(webId)}`, signal);
  const raw = data.meals?.[0];
  return raw ? toWebRecipe(raw) : null;
}

export async function searchWebRecipes(query: string, signal?: AbortSignal): Promise<WebRecipe[]> {
  const data = await getJson<{ meals: RawMeal[] | null }>(`search.php?s=${encodeURIComponent(query)}`, signal);
  return (data.meals ?? []).map(toWebRecipe).filter(isAllowed);
}

const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];

/** Picks a random internet recipe that fits the meal, skipping ids in `avoid`. */
export async function suggestWebRecipe(meal: MealType, avoid: string[] = []): Promise<WebRecipe> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const category = pick(CATEGORIES_BY_MEAL[meal]);
    const list = await getJson<{ meals: RawMeal[] | null }>(`filter.php?c=${encodeURIComponent(category)}`);
    const candidates = (list.meals ?? []).filter((m) => !avoid.includes(clean(m.idMeal)));
    if (!candidates.length) continue;
    const full = await getWebRecipe(clean(pick(candidates).idMeal));
    if (full && isAllowed(full)) return full;
  }
  throw new Error('no-web-recipe');
}
