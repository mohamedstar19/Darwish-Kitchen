import type { Profile, Recipe } from '../types';
import { api, ApiError } from './api';
import type { FeedPost } from './feed-api';
import { isLocalImage, readImageBytes } from './images';
import { KEYS, readJson, writeJson } from './kv';

/** What was last uploaded, so unchanged photos aren't sent again. */
type PublishMeta = { avatar?: string | null; images?: Record<string, string | null> };

const getMeta = async () => (await readJson<PublishMeta>(KEYS.publishMeta)) ?? {};
const setMeta = async (m: PublishMeta) => writeJson(KEYS.publishMeta, m);

/** Sends the chef's public name and photo (only when they changed). */
export async function syncChefProfile(profile: Profile) {
  if (!profile.name || profile.name.trim().length < 2) throw new ApiError(400, 'name-required');
  await api('/api/me/profile', { method: 'PUT', json: { name: profile.name } });
  const meta = await getMeta();
  const avatar = isLocalImage(profile.avatar) ? profile.avatar : null;
  if (meta.avatar !== avatar) {
    if (avatar) await api('/api/me/avatar', { method: 'PUT', body: await readImageBytes(avatar), type: 'image/jpeg' });
    else await api('/api/me/avatar', { method: 'DELETE' });
    await setMeta({ ...meta, avatar });
  }
}

/** Publishes (or updates) a recipe in the chefs feed. Returns the post id. */
export async function publishRecipe(recipe: Recipe, profile: Profile): Promise<string> {
  await syncChefProfile(profile);
  const post = await api<FeedPost>('/api/posts', {
    json: {
      clientId: recipe.id,
      recipe: {
        title: recipe.title,
        category: recipe.category ?? 'food',
        mealTypes: recipe.mealTypes,
        ingredients: recipe.ingredients,
        steps: recipe.steps,
        prepMinutes: recipe.prepMinutes,
        servings: recipe.servings,
        notes: recipe.notes,
      },
    },
  });

  // Photo: only photos taken/picked on this device can be uploaded.
  const meta = await getMeta();
  const images = { ...(meta.images ?? {}) };
  const image = isLocalImage(recipe.image) ? recipe.image : null;
  const uploaded = post.image ? images[recipe.id] ?? null : null;
  if (image !== uploaded) {
    if (image) await api(`/api/posts/${post.id}/image`, { method: 'PUT', body: await readImageBytes(image), type: 'image/jpeg' });
    else if (post.image) await api(`/api/posts/${post.id}/image`, { method: 'DELETE' });
    images[recipe.id] = image;
    await setMeta({ ...(await getMeta()), images });
  }
  return post.id;
}

/** Removes a recipe from the feed (already gone is fine). */
export async function unpublishRecipe(postId: string) {
  try {
    await api(`/api/posts/${encodeURIComponent(postId)}`, { method: 'DELETE' });
  } catch (e) {
    if ((e as ApiError).status !== 404) throw e;
  }
}
