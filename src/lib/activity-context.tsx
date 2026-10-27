import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { refKey, type Activity, type Recipe, type RecipeRef } from '../types';
import { useDataGeneration } from './data-reload';
import { KEYS, readJson, writeJson } from './kv';
import { migrated } from './storage';

const MAX_VIEWS = 60;
const EMPTY: Activity = { likes: {}, ratings: {}, views: [] };

/** First run with the activity store: carry over old "favorite" flags as likes. */
async function loadActivity(): Promise<Activity> {
  await migrated();
  const stored = await readJson<Activity>(KEYS.activity);
  if (stored) return { ...EMPTY, ...stored };
  const recipes = (await readJson<Recipe[]>(KEYS.recipes)) ?? [];
  const likes: Activity['likes'] = {};
  for (const r of recipes) {
    if (r.favorite) likes[refKey({ kind: 'local', id: r.id })] = { ref: { kind: 'local', id: r.id }, at: r.updatedAt };
  }
  return { ...EMPTY, likes };
}

type ActivityContextValue = {
  activity: Activity;
  isLiked: (ref: Pick<RecipeRef, 'kind' | 'id'>) => boolean;
  toggleLike: (ref: RecipeRef) => void;
  ratingOf: (ref: Pick<RecipeRef, 'kind' | 'id'>) => number;
  rate: (ref: RecipeRef, stars: number) => void;
  recordView: (ref: RecipeRef) => void;
};

const ActivityContext = createContext<ActivityContextValue | null>(null);

export function ActivityProvider({ children }: { children: ReactNode }) {
  const [activity, setActivity] = useState<Activity>(EMPTY);
  const loaded = useRef(false);
  const generation = useDataGeneration();

  useEffect(() => {
    loadActivity().then((a) => {
      if (loaded.current) {
        setActivity(a); // Reload after a restore: take the stored data as is.
        return;
      }
      loaded.current = true;
      setActivity((current) => ({
        // First load: keep anything recorded while loading (e.g. a view on the first screen).
        likes: { ...a.likes, ...current.likes },
        ratings: { ...a.ratings, ...current.ratings },
        views: [...current.views, ...a.views].slice(0, MAX_VIEWS),
      }));
    });
  }, [generation]);

  useEffect(() => {
    if (loaded.current) writeJson(KEYS.activity, activity).catch(() => {});
  }, [activity]);

  const toggleLike = useCallback((ref: RecipeRef) => {
    setActivity((a) => {
      const key = refKey(ref);
      const likes = { ...a.likes };
      if (likes[key]) delete likes[key];
      else likes[key] = { ref, at: Date.now() };
      return { ...a, likes };
    });
  }, []);

  const rate = useCallback((ref: RecipeRef, stars: number) => {
    setActivity((a) => {
      const key = refKey(ref);
      const ratings = { ...a.ratings };
      if (stars <= 0) delete ratings[key];
      else ratings[key] = { ref, stars: Math.min(5, Math.round(stars)), at: Date.now() };
      return { ...a, ratings };
    });
  }, []);

  const recordView = useCallback((ref: RecipeRef) => {
    setActivity((a) => {
      const key = refKey(ref);
      const views = [{ ref, at: Date.now() }, ...a.views.filter((v) => refKey(v.ref) !== key)].slice(0, MAX_VIEWS);
      return { ...a, views };
    });
  }, []);

  const value = useMemo<ActivityContextValue>(
    () => ({
      activity,
      isLiked: (ref) => !!activity.likes[refKey(ref)],
      toggleLike,
      ratingOf: (ref) => activity.ratings[refKey(ref)]?.stars ?? 0,
      rate,
      recordView,
    }),
    [activity, toggleLike, rate, recordView],
  );

  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

export function useActivity() {
  const ctx = useContext(ActivityContext);
  if (!ctx) throw new Error('useActivity must be used inside ActivityProvider');
  return ctx;
}
