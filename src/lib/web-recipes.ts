import type { MealType, RecipeInput, WebRecipe } from '../types';

/** In-memory cache so opening a suggested internet recipe doesn't refetch it. */
export const webRecipeCache = new Map<string, WebRecipe>();

export function rememberWebRecipe(recipe: WebRecipe) {
  webRecipeCache.set(recipe.webId, recipe);
}

export function webToRecipeInput(web: WebRecipe, meal?: MealType): RecipeInput {
  const mealTypes: MealType[] = web.category === 'Breakfast' ? ['breakfast'] : meal ? [meal] : ['lunch', 'dinner'];
  return {
    title: web.title,
    category: 'food',
    mealTypes,
    image: web.image,
    ingredients: web.ingredients,
    steps: web.steps,
    source: 'web',
    sourceUrl: web.sourceUrl ?? `https://www.themealdb.com/meal/${web.webId}`,
    webId: web.webId,
  };
}
