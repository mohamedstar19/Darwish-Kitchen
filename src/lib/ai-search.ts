import type { MealType, RecipeCategory, WebRecipe } from '../types';
import { api } from './api';

/** A recipe the AI found on a cooking site (written in Arabic, with its source), or wrote itself (`generated`). */
export type AiRecipe = {
  id: string;
  title: string;
  category: RecipeCategory;
  mealTypes: MealType[];
  ingredients: string[];
  steps: string[];
  prepMinutes: number | null;
  servings: number | null;
  notes: string | null;
  image: string | null;
  sourceName: string;
  sourceUrl: string | null;
  generated?: boolean;
  missing?: string[];
};

export const isAiId = (id: string) => id.startsWith('ai-');

export function toWebRecipe(r: AiRecipe): WebRecipe {
  return {
    webId: r.id,
    title: r.title,
    image: r.image ?? undefined,
    ingredients: r.ingredients,
    steps: r.steps,
    sourceUrl: r.sourceUrl ?? undefined,
    ai: {
      category: r.category,
      mealTypes: r.mealTypes,
      sourceName: r.sourceName,
      prepMinutes: r.prepMinutes,
      servings: r.servings,
      notes: r.notes,
      generated: r.generated,
      missing: r.missing,
    },
  };
}

type SearchResponse = { pending?: true; recipes?: AiRecipe[]; cached?: boolean; remaining?: number | null };

const POLL_MS = 2500;
const GIVE_UP_MS = 5 * 60 * 1000;

/**
 * Searches recipe sites with AI (signed in only). The server answers "pending" while it's still searching;
 * we ask again until the results are ready. `isCurrent` lets a newer search stop this one.
 * `remaining` = AI searches left today (null for admins).
 */
export async function aiSearch(query: string, category: RecipeCategory | undefined, isCurrent: () => boolean = () => true) {
  const started = Date.now();
  for (;;) {
    const res = await api<SearchResponse>('/api/ai/search', { json: { query, category } });
    if (!res.pending) return { recipes: (res.recipes ?? []).map(toWebRecipe), remaining: res.remaining ?? null };
    if (!isCurrent()) throw new Error('superseded');
    if (Date.now() - started > GIVE_UP_MS) throw Object.assign(new Error('timeout'), { code: 'ai-failed' });
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

export async function fetchAiRecipe(id: string): Promise<WebRecipe> {
  return toWebRecipe(await api<AiRecipe>(`/api/ai/recipes/${encodeURIComponent(id)}`, { auth: false }));
}
