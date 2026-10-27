import type { MealType, RecipeInput, WebRecipe } from '../types';

/** In-memory cache so opening a suggested internet recipe doesn't refetch it. */
export const webRecipeCache = new Map<string, WebRecipe>();

export function rememberWebRecipe(recipe: WebRecipe) {
  webRecipeCache.set(recipe.webId, recipe);
}

export function webToRecipeInput(web: WebRecipe, meal?: MealType): RecipeInput {
  if (web.ai) {
    return {
      title: web.title,
      category: web.ai.category,
      mealTypes: web.ai.category === 'food' ? web.ai.mealTypes : [],
      image: web.image,
      ingredients: web.ingredients,
      steps: web.steps,
      prepMinutes: web.ai.prepMinutes ?? undefined,
      servings: web.ai.servings ?? undefined,
      notes: web.ai.notes ?? undefined,
      source: 'web',
      sourceUrl: web.sourceUrl,
      webId: web.webId,
    };
  }
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
