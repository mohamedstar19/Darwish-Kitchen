import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Recipe, RecipeInput } from '../types';
import { dismissStarter, fetchCatalog, getDismissed, mergeCatalog } from './catalog';
import { useDataGeneration } from './data-reload';
import { newId } from './id';
import { deleteStoredImage } from './images';
import { loadRecipes, saveRecipes } from './storage';

type RecipesContextValue = {
  recipes: Recipe[];
  ready: boolean;
  getRecipe: (id: string) => Recipe | undefined;
  addRecipe: (input: RecipeInput) => Promise<Recipe>;
  updateRecipe: (id: string, input: Partial<RecipeInput>) => Promise<void>;
  deleteRecipe: (id: string) => Promise<void>;
};

const RecipesContext = createContext<RecipesContextValue | null>(null);

export function RecipesProvider({ children }: { children: ReactNode }) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [ready, setReady] = useState(false);
  const latest = useRef<Recipe[]>([]);
  const generation = useDataGeneration();

  useEffect(() => {
    let cancelled = false;
    loadRecipes()
      .then(async (list) => {
        latest.current = list;
        setRecipes(list);
        setReady(true);
        // Then pull the admin's catalog (new recipes, photos). Offline is fine: keep what we have.
        const [catalog, dismissed] = await Promise.all([fetchCatalog(), getDismissed()]);
        const merged = !cancelled && mergeCatalog(latest.current, catalog, dismissed);
        if (merged) await commit(merged);
      })
      .catch(() => {})
      .finally(() => setReady(true));
    return () => {
      cancelled = true;
    };
  }, [generation]);

  // Saves first so a storage error (e.g. full browser storage) reaches the caller.
  const commit = useCallback(async (next: Recipe[]) => {
    await saveRecipes(next);
    latest.current = next;
    setRecipes(next);
  }, []);

  const value = useMemo<RecipesContextValue>(
    () => ({
      recipes,
      ready,
      getRecipe: (id) => recipes.find((r) => r.id === id),
      addRecipe: async (input) => {
        const now = Date.now();
        const recipe: Recipe = { ...input, id: newId(), createdAt: now, updatedAt: now };
        await commit([recipe, ...latest.current]);
        return recipe;
      },
      updateRecipe: async (id, input) => {
        const old = latest.current.find((r) => r.id === id);
        // Editing a starter makes it the user's own: catalog updates won't overwrite it.
        await commit(
          latest.current.map((r) =>
            r.id === id ? { ...r, ...input, ...(r.source === 'sample' ? { customized: true } : {}), updatedAt: Date.now() } : r,
          ),
        );
        if (old?.image && 'image' in input && input.image !== old.image) deleteStoredImage(old.image);
      },
      deleteRecipe: async (id) => {
        const old = latest.current.find((r) => r.id === id);
        await commit(latest.current.filter((r) => r.id !== id));
        if (old?.source === 'sample') await dismissStarter(id);
        deleteStoredImage(old?.image);
      },
    }),
    [recipes, ready, commit],
  );

  return <RecipesContext.Provider value={value}>{children}</RecipesContext.Provider>;
}

export function useRecipes() {
  const ctx = useContext(RecipesContext);
  if (!ctx) throw new Error('useRecipes must be used inside RecipesProvider');
  return ctx;
}
