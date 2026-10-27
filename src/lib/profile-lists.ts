import { useMemo } from 'react';
import { categoryOf, refKey, type MealType, type RecipeCategory, type RecipeRef } from '../types';
import { useActivity } from './activity-context';
import { useDarwish } from './darwish-context';
import { useRecipes } from './recipes-context';

export type ProfileSection = 'added' | 'liked' | 'rated' | 'viewed';

export const SECTION_TITLES: Record<ProfileSection, string> = {
  added: 'وصفات ضفتها',
  liked: 'وصفات عجبتني',
  rated: 'وصفات قيّمتها',
  viewed: 'وصفات شفتها',
};

export type ProfileItem = {
  key: string;
  ref: RecipeRef;
  title: string;
  image?: string;
  mealTypes?: MealType[];
  category?: RecipeCategory;
  minutes?: number;
  stars?: number;
};

/** Recipes for each profile section. Deleted saved recipes are skipped. */
export function useProfileSections(): Record<ProfileSection, ProfileItem[]> {
  const { recipes } = useRecipes();
  const darwish = useDarwish();
  const { activity } = useActivity();

  return useMemo(() => {
    const byId = new Map(recipes.map((r) => [r.id, r]));
    const darwishById = new Map(darwish.recipes.map((r) => [r.id, r]));
    const resolve = (ref: RecipeRef): ProfileItem | null => {
      if (ref.kind === 'local' || ref.kind === 'darwish') {
        const r = (ref.kind === 'local' ? byId : darwishById).get(ref.id);
        if (!r) return null;
        return { key: refKey(ref), ref, title: r.title, image: r.image, mealTypes: r.mealTypes, category: categoryOf(r), minutes: r.prepMinutes };
      }
      return { key: refKey(ref), ref, title: ref.title ?? (ref.kind === 'feed' ? 'وصفة شيف' : 'وصفة من النت'), image: ref.image };
    };
    const newestFirst = <T extends { at: number }>(list: T[]) => [...list].sort((a, b) => b.at - a.at);
    const keep = (x: ProfileItem | null): x is ProfileItem => x !== null;

    return {
      added: recipes
        .filter((r) => r.source === 'user')
        .map((r) => resolve({ kind: 'local', id: r.id }))
        .filter(keep),
      liked: newestFirst(Object.values(activity.likes)).map((l) => resolve(l.ref)).filter(keep),
      rated: newestFirst(Object.values(activity.ratings))
        .map((r): ProfileItem | null => {
          const item = resolve(r.ref);
          return item ? { ...item, stars: r.stars } : null;
        })
        .filter(keep),
      viewed: activity.views.map((v) => resolve(v.ref)).filter(keep),
    };
  }, [recipes, darwish.recipes, activity]);
}
