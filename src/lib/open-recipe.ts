import { router } from 'expo-router';
import type { RecipeRef } from '../types';

export function openRecipe(ref: Pick<RecipeRef, 'kind' | 'id'>) {
  if (ref.kind === 'local') router.push({ pathname: '/recipe/[id]', params: { id: ref.id } });
  else if (ref.kind === 'darwish') router.push({ pathname: '/darwish/[id]', params: { id: ref.id } });
  else if (ref.kind === 'feed') router.push({ pathname: '/feed/[id]', params: { id: ref.id } });
  else router.push({ pathname: '/online/[id]', params: { id: ref.id } });
}
