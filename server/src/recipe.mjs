import { HttpError } from './http.mjs';

const CATEGORIES = new Set(['food', 'healthy-drink', 'juice']);
const MEALS = ['breakfast', 'lunch', 'dinner'];

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const lines = (v, maxItems, maxLen) =>
  (Array.isArray(v) ? v : [])
    .filter((x) => typeof x === 'string')
    .map((x) => x.trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
const count = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= 1000 ? n : null;
};

/** Validates and cleans a recipe sent by the control panel or a chef. */
export function cleanRecipe(body) {
  const title = text(body?.title, 120);
  if (!title) throw new HttpError(400, 'title-required');
  const category = CATEGORIES.has(body?.category) ? body.category : 'food';
  const mealTypes = MEALS.filter((m) => Array.isArray(body?.mealTypes) && body.mealTypes.includes(m));
  if (category === 'food' && !mealTypes.length) throw new HttpError(400, 'meal-required');
  return {
    title,
    category,
    mealTypes: category === 'food' ? mealTypes : [],
    ingredients: lines(body?.ingredients, 60, 300),
    steps: lines(body?.steps, 60, 1000),
    prepMinutes: count(body?.prepMinutes),
    servings: count(body?.servings),
    notes: text(body?.notes, 2000) || null,
  };
}
