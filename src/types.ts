export type MealType = 'breakfast' | 'lunch' | 'dinner';

export const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner'];

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: 'فطار',
  lunch: 'غداء',
  dinner: 'عشاء',
};

export type Recipe = {
  id: string;
  title: string;
  mealTypes: MealType[];
  /** Local file URI (mobile), data URI (web) or remote URL (saved internet recipes). */
  image?: string;
  ingredients: string[];
  steps: string[];
  prepMinutes?: number;
  servings?: number;
  notes?: string;
  favorite?: boolean;
  source: 'user' | 'web' | 'sample';
  sourceUrl?: string;
  /** TheMealDB id when the recipe was saved from the internet. */
  webId?: string;
  createdAt: number;
  updatedAt: number;
};

export type RecipeInput = Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'>;

/** A recipe fetched from the internet (TheMealDB), not yet saved. */
export type WebRecipe = {
  webId: string;
  title: string;
  image?: string;
  category?: string;
  area?: string;
  ingredients: string[];
  steps: string[];
  sourceUrl?: string;
  youtube?: string;
};

export function mealTypeForNow(date = new Date()): MealType {
  const h = date.getHours();
  if (h >= 4 && h < 11) return 'breakfast';
  if (h >= 11 && h < 17) return 'lunch';
  return 'dinner';
}
