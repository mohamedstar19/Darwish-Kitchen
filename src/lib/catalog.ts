import type { ImageCredit, MealType, Recipe, RecipeCategory } from '../types';
import { api, serverUrl } from './api';

/** A recipe from the shared catalog the admin manages (`GET /api/catalog`). */
export type CatalogRecipe = {
  id: string;
  title: string;
  category: RecipeCategory;
  mealTypes: MealType[];
  ingredients: string[];
  steps: string[];
  prepMinutes: number | null;
  servings: number | null;
  notes: string | null;
  /** Server path of the photo, or null. */
  image: string | null;
  /** Set when the AI found the photo on a free photo site. */
  imageCredit?: ImageCredit | null;
  updatedAt: number;
  /** Control panel only. */
  published?: boolean;
};

export async function fetchCatalog(): Promise<CatalogRecipe[]> {
  return (await api<{ recipes: CatalogRecipe[] }>('/api/catalog', { auth: false })).recipes;
}

export function catalogToRecipe(c: CatalogRecipe, existing?: Recipe): Recipe {
  const now = Date.now();
  return {
    id: c.id,
    title: c.title,
    category: c.category,
    mealTypes: c.mealTypes,
    image: c.image ? serverUrl(c.image) : undefined,
    imageCredit: c.image && c.imageCredit ? c.imageCredit : undefined,
    ingredients: c.ingredients,
    steps: c.steps,
    prepMinutes: c.prepMinutes ?? undefined,
    servings: c.servings ?? undefined,
    notes: c.notes ?? undefined,
    source: 'sample',
    createdAt: existing?.createdAt ?? now,
    updatedAt: existing?.updatedAt ?? now,
  };
}
