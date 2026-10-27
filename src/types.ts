export type MealType = 'breakfast' | 'lunch' | 'dinner';

export const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner'];

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: 'فطار',
  lunch: 'غداء',
  dinner: 'عشاء',
};

export type RecipeCategory = 'food' | 'healthy-drink' | 'juice';

export const CATEGORIES: RecipeCategory[] = ['food', 'healthy-drink', 'juice'];

export const CATEGORY_LABELS: Record<RecipeCategory, string> = {
  food: 'أكل',
  'healthy-drink': 'مشروبات صحية',
  juice: 'عصائر',
};

/** Singular labels for forms and badges. */
export const CATEGORY_LABELS_ONE: Record<RecipeCategory, string> = {
  food: 'أكلة',
  'healthy-drink': 'مشروب صحي',
  juice: 'عصير',
};

export const CATEGORY_ICONS = {
  food: 'restaurant',
  'healthy-drink': 'leaf',
  juice: 'nutrition',
} as const satisfies Record<RecipeCategory, string>;

export type Recipe = {
  id: string;
  title: string;
  /** Missing on recipes saved before sections existed: treat as 'food'. */
  category?: RecipeCategory;
  /** Used for food; drinks and juices usually leave it empty. */
  mealTypes: MealType[];
  /** Local file URI (mobile), data URI (web) or remote URL (saved internet recipes). */
  image?: string;
  ingredients: string[];
  steps: string[];
  prepMinutes?: number;
  servings?: number;
  notes?: string;
  /** @deprecated Likes now live in the activity store; kept only to migrate old data. */
  favorite?: boolean;
  /** user = written by this user; web = saved from TheMealDB; feed = saved from another chef; sample = legacy starter. */
  source: 'user' | 'web' | 'sample' | 'feed';
  sourceUrl?: string;
  /** TheMealDB id when the recipe was saved from the internet. */
  webId?: string;
  /** Post id while this recipe is published in the chefs feed. */
  postId?: string;
  /** Feed post this recipe was saved from. */
  feedId?: string;
  /** Legacy (starters used to live in the user's list): the user edited this starter. */
  customized?: boolean;
  /** Legacy: catalog version applied to a starter. */
  catalogVersion?: number;
  createdAt: number;
  updatedAt: number;
};

export type RecipeInput = Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'>;

export const categoryOf = (r: Pick<Recipe, 'category'>): RecipeCategory => r.category ?? 'food';

/** A recipe fetched from the internet (TheMealDB), not yet saved. */
export type WebRecipe = {
  /** TheMealDB id, or "ai-…" for a recipe found by the AI search. */
  webId: string;
  title: string;
  image?: string;
  /** TheMealDB category (English). */
  category?: string;
  area?: string;
  ingredients: string[];
  steps: string[];
  sourceUrl?: string;
  youtube?: string;
  /** Set for AI search results: written in Arabic from a recipe site. */
  ai?: {
    category: RecipeCategory;
    mealTypes: MealType[];
    sourceName: string;
    prepMinutes?: number | null;
    servings?: number | null;
    notes?: string | null;
  };
};

export function mealTypeForNow(date = new Date()): MealType {
  const h = date.getHours();
  if (h >= 4 && h < 11) return 'breakfast';
  if (h >= 11 && h < 17) return 'lunch';
  return 'dinner';
}

export type Profile = {
  name: string;
  bio?: string;
  phone?: string;
  /** Device file URI (mobile) or data URI (web). */
  avatar?: string;
  updatedAt: number;
};

/** Points at a saved recipe ("local") or an internet recipe ("web"). */
export type RecipeRef = {
  /** local = my recipes, darwish = Darwish catalog, feed = another chef's post, web = TheMealDB. */
  kind: 'local' | 'web' | 'darwish' | 'feed';
  id: string;
  /** Snapshot for internet recipes so lists can show them offline. */
  title?: string;
  image?: string;
};

export type Activity = {
  likes: Record<string, { ref: RecipeRef; at: number }>;
  ratings: Record<string, { ref: RecipeRef; stars: number; at: number }>;
  /** Most recent first. */
  views: { ref: RecipeRef; at: number }[];
};

export const refKey = (ref: Pick<RecipeRef, 'kind' | 'id'>) => `${ref.kind}:${ref.id}`;
