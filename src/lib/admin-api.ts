import type { MealType, RecipeCategory } from '../types';
import { api } from './api';
import type { CatalogRecipe } from './catalog';
import { deleteStoredImage, readImageBytes } from './images';

/** What the control panel sends when creating or editing a catalog recipe. */
export type CatalogInput = {
  title: string;
  category: RecipeCategory;
  mealTypes: MealType[];
  ingredients: string[];
  steps: string[];
  prepMinutes?: number;
  servings?: number;
  notes?: string;
  published: boolean;
};

export const adminList = async () => (await api<{ recipes: CatalogRecipe[] }>('/api/admin/catalog')).recipes;

export const adminCreate = (input: CatalogInput) => api<CatalogRecipe>('/api/admin/catalog', { json: input });

export const adminUpdate = (id: string, input: CatalogInput) =>
  api<CatalogRecipe>(`/api/admin/catalog/${encodeURIComponent(id)}`, { method: 'PUT', json: input });

export const adminDelete = (id: string) => api(`/api/admin/catalog/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** Uploads a photo picked on this device, then removes the device copy. */
export async function adminUploadImage(id: string, localUri: string) {
  try {
    return await api<CatalogRecipe>(`/api/admin/catalog/${encodeURIComponent(id)}/image`, {
      method: 'PUT',
      body: await readImageBytes(localUri),
      type: 'image/jpeg',
    });
  } finally {
    deleteStoredImage(localUri);
  }
}

export const adminDeleteImage = (id: string) =>
  api<CatalogRecipe>(`/api/admin/catalog/${encodeURIComponent(id)}/image`, { method: 'DELETE' });

// ---------- AI photo finder ----------

export type PhotoCandidate = {
  id: string;
  /** Server path of the photo. */
  image: string;
  source: string;
  pageUrl: string;
  author: string | null;
  license: string | null;
  /** 0–10: how well the AI thinks it shows the dish. */
  score: number;
  note: string | null;
};

export type PhotoRun = {
  mode: 'review' | 'auto';
  running: boolean;
  total: number;
  done: number;
  applied: number;
  waiting: number;
  notFound: number;
  failed: number;
  current: string | null;
};

export type PhotoOverview = {
  enabled: boolean;
  run: PhotoRun | null;
  missing: number;
  items: { recipe: { id: string; title: string; category: RecipeCategory; image: string | null }; candidates: PhotoCandidate[] }[];
};

export const aiPhotos = () => api<PhotoOverview>('/api/admin/ai/photos');
export const aiPhotosRun = (mode: 'review' | 'auto') => api<{ run: PhotoRun }>('/api/admin/ai/photos/run', { json: { mode } });
export const aiPhotoApprove = (id: string) => api<{ recipe: CatalogRecipe }>(`/api/admin/ai/photos/${encodeURIComponent(id)}/approve`, { json: {} });
export const aiPhotoSkip = (recipeId: string) => api(`/api/admin/ai/photos/recipes/${encodeURIComponent(recipeId)}`, { method: 'DELETE' });
