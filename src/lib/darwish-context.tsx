import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { SAMPLE_RECIPES } from '../data/samples';
import type { Recipe } from '../types';
import { catalogToRecipe, fetchCatalog } from './catalog';
import { KEYS, readJson, writeJson } from './kv';

/**
 * "وصفات درويش": the admin's catalog (food, healthy drinks, juices, with photos).
 * Shown from the last saved copy (or the bundled starters offline), then refreshed from the server.
 */
type DarwishContextValue = {
  recipes: Recipe[];
  ready: boolean;
  getRecipe: (id: string) => Recipe | undefined;
  refresh: () => Promise<void>;
};

const DarwishContext = createContext<DarwishContextValue | null>(null);

export function DarwishProvider({ children }: { children: ReactNode }) {
  const [recipes, setRecipes] = useState<Recipe[]>(SAMPLE_RECIPES);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = (await fetchCatalog()).map((c) => catalogToRecipe(c));
      setRecipes(list);
      await writeJson(KEYS.darwishCache, list);
    } catch {
      // Offline: keep showing the saved copy.
    }
  }, []);

  useEffect(() => {
    readJson<Recipe[]>(KEYS.darwishCache)
      .then((cached) => {
        if (Array.isArray(cached)) setRecipes(cached);
      })
      .finally(() => {
        setReady(true);
        refresh();
      });
  }, [refresh]);

  const value = useMemo(
    () => ({ recipes, ready, getRecipe: (id: string) => recipes.find((r) => r.id === id), refresh }),
    [recipes, ready, refresh],
  );
  return <DarwishContext.Provider value={value}>{children}</DarwishContext.Provider>;
}

export function useDarwish() {
  const ctx = useContext(DarwishContext);
  if (!ctx) throw new Error('useDarwish must be used inside DarwishProvider');
  return ctx;
}
