import type { Activity, Profile, Recipe } from '../types';
import { api, API_URL, authHeader, setAuth } from './api';
import { deleteStoredImage, isLocalImage, readImageBytes, storeDownloadedImage, type ImageFolder } from './images';
import { KEYS, readJson, writeJson } from './kv';
import { loadRecipes } from './storage';

/**
 * The server (see `server/`) only keeps a copy of the device data:
 * one JSON backup per user (recipes, profile, likes/ratings/views) plus the user's photos.
 * Images inside the JSON are written as `backup:<file name>`.
 */
type BackupData = {
  version: 1;
  createdAt: number;
  recipes: Recipe[];
  profile: Profile | null;
  activity: Activity | null;
};

export type BackupMeta = { lastBackupAt?: number; lastRestoreAt?: number };

const REF = 'backup:';

/** Stable file name for a stored image so unchanged photos aren't uploaded twice. */
function imageName(uri: string): string {
  if (!uri.startsWith('data:')) {
    const base = uri.split('/').pop()!.replace(/[^\w.-]/g, '').replace(/^\.+/, '');
    return base.endsWith('.jpg') ? base : `${base}.jpg`;
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < uri.length; i++) {
    h ^= uri.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `w-${(h >>> 0).toString(16)}-${uri.length.toString(16)}.jpg`;
}

const listImages = async () => (await api<{ names: string[] }>('/api/images')).names;

export async function getBackupMeta(): Promise<BackupMeta> {
  return (await readJson<BackupMeta>(KEYS.backupMeta)) ?? {};
}

export async function clearBackupMeta() {
  await writeJson(KEYS.backupMeta, {});
}

async function setBackupMeta(changes: BackupMeta) {
  await writeJson(KEYS.backupMeta, { ...(await getBackupMeta()), ...changes });
}

/** Uploads the device data and photos. Returns how many recipes were backed up. */
export async function backupNow(): Promise<{ recipes: number; at: number }> {
  const recipes = await loadRecipes(); // Includes the starter recipes if they were never edited.
  const profile = await readJson<Profile>(KEYS.profile);
  const activity = await readJson<Activity>(KEYS.activity);

  const localUris = [...recipes.map((r) => r.image), profile?.avatar].filter(isLocalImage);
  const existing = new Set(await listImages());
  const names = new Map<string, string>();
  for (const uri of new Set(localUris)) {
    const name = imageName(uri);
    names.set(uri, name);
    if (existing.has(name)) continue;
    try {
      await api(`/api/images/${encodeURIComponent(name)}`, { method: 'PUT', body: await readImageBytes(uri), type: 'image/jpeg' });
    } catch (e) {
      if ((e as { code?: string }).code === 'network') throw e;
      names.delete(uri); // Missing/unreadable photo: back up the recipe without it.
    }
  }

  const toRef = (uri?: string) => (uri && names.has(uri) ? REF + names.get(uri) : isLocalImage(uri) ? undefined : uri);
  const data: BackupData = {
    version: 1,
    createdAt: Date.now(),
    recipes: recipes.map((r) => ({ ...r, image: toRef(r.image) })),
    profile: profile ? { ...profile, avatar: toRef(profile.avatar) } : null,
    activity,
  };
  const { updatedAt } = await api<{ updatedAt: number }>('/api/backup', { method: 'PUT', json: { data } });

  // Remove photos the backup no longer uses.
  const used = new Set(names.values());
  const stale = [...existing].filter((n) => !used.has(n));
  if (stale.length) await api('/api/images', { method: 'DELETE', json: { names: stale } });

  await setBackupMeta({ lastBackupAt: updatedAt });
  return { recipes: recipes.length, at: updatedAt };
}

/** Date of the backup stored on the server, or null if there is none. */
export async function getServerBackupDate(): Promise<number | null> {
  return (await api<{ updatedAt: number | null }>('/api/backup/meta')).updatedAt;
}

/** Replaces the device data with the server backup. Call the data reload afterwards. */
export async function restoreBackup(): Promise<{ recipes: number }> {
  const { data: backup } = await api<{ data: BackupData }>('/api/backup'); // 404 → 'no-backup'
  const headers = await authHeader();

  const download = async (uri: string | undefined, folder: ImageFolder) => {
    if (!uri?.startsWith(REF)) return uri;
    try {
      return await storeDownloadedImage(`${API_URL}/api/images/${encodeURIComponent(uri.slice(REF.length))}`, folder, headers);
    } catch {
      return undefined;
    }
  };

  const recipes: Recipe[] = [];
  for (const r of backup.recipes) recipes.push({ ...r, image: await download(r.image, 'recipe-images') });
  const profile = backup.profile ? { ...backup.profile, avatar: await download(backup.profile.avatar, 'profile-images') } : null;

  // Swap in the restored data, then delete the photos of the replaced data.
  const oldRecipes = (await readJson<Recipe[]>(KEYS.recipes)) ?? [];
  const oldProfile = await readJson<Profile>(KEYS.profile);
  await writeJson(KEYS.recipes, recipes);
  if (profile) await writeJson(KEYS.profile, profile);
  if (backup.activity) await writeJson(KEYS.activity, backup.activity);
  const kept = new Set([...recipes.map((r) => r.image), profile?.avatar]);
  for (const uri of [...oldRecipes.map((r) => r.image), profile ? oldProfile?.avatar : undefined]) {
    if (uri && !kept.has(uri)) deleteStoredImage(uri);
  }

  await setBackupMeta({ lastRestoreAt: Date.now() });
  return { recipes: recipes.length };
}

/** Deletes the account, its backup and photos from the server. Device data stays. */
export async function deleteAccount(): Promise<void> {
  await api('/api/account', { method: 'DELETE' });
  await setAuth(null);
  await clearBackupMeta();
}
