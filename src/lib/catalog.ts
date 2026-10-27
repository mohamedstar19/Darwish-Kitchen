import type { MealType, Recipe, RecipeCategory } from '../types';
import { api, serverUrl } from './api';
import { KEYS, readJson, writeJson } from './kv';

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
    ingredients: c.ingredients,
    steps: c.steps,
    prepMinutes: c.prepMinutes ?? undefined,
    servings: c.servings ?? undefined,
    notes: c.notes ?? undefined,
    source: 'sample',
    catalogVersion: c.updatedAt,
    createdAt: existing?.createdAt ?? now,
    updatedAt: existing?.updatedAt ?? now,
  };
}

const isUntouchedStarter = (r: Recipe) => r.source === 'sample' && !r.customized;

/**
 * Applies the catalog to the device's recipes. Returns the new list, or null when nothing changed.
 * - new catalog recipes are added (unless the user deleted them before)
 * - starters the user never edited get the admin's updates (text, photo)
 * - starters the admin removed or hid disappear, unless the user edited them
 */
export function mergeCatalog(local: Recipe[], catalog: CatalogRecipe[], dismissed: Set<string>): Recipe[] | null {
  if (!catalog.length) return null; // never wipe starters because of an empty/failed response
  const catalogById = new Map(catalog.map((c) => [c.id, c]));
  const localIds = new Set(local.map((r) => r.id));
  let changed = false;

  const kept = local.flatMap((r) => {
    const c = catalogById.get(r.id);
    if (isUntouchedStarter(r) && !c) {
      changed = true;
      return [];
    }
    if (c && isUntouchedStarter(r) && r.catalogVersion !== c.updatedAt) {
      changed = true;
      return [catalogToRecipe(c, r)];
    }
    return [r];
  });

  const added = catalog.filter((c) => !localIds.has(c.id) && !dismissed.has(c.id)).map((c) => catalogToRecipe(c));
  if (added.length) changed = true;

  return changed ? [...added, ...kept] : null;
}

export async function getDismissed(): Promise<Set<string>> {
  return new Set((await readJson<string[]>(KEYS.catalogDismissed)) ?? []);
}

/** Remembers a starter the user deleted so syncing doesn't bring it back. */
export async function dismissStarter(id: string) {
  const set = await getDismissed();
  set.add(id);
  await writeJson(KEYS.catalogDismissed, [...set]);
}
