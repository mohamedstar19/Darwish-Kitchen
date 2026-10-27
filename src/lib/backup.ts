import type { Activity, Profile, Recipe } from '../types';
import { deleteStoredImage, isLocalImage, readImageBytes, storeDownloadedImage, type ImageFolder } from './images';
import { KEYS, readJson, writeJson } from './kv';
import { loadRecipes } from './storage';
import { BACKUP_BUCKET, supabase } from './supabase';

/**
 * The server only keeps a copy of the device data:
 * - table `backups`: one JSON row per user (recipes, profile, likes/ratings/views)
 * - storage bucket `backups`: the user's photos under `<user id>/images/`
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

function client() {
  if (!supabase) throw new Error('backup-disabled');
  return supabase;
}

async function userId(): Promise<string> {
  const { data } = await client().auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('signed-out');
  return id;
}

/** Stable file name for a stored image so unchanged photos aren't uploaded twice. */
function imageName(uri: string): string {
  if (!uri.startsWith('data:')) return uri.split('/').pop()!.replace(/[^\w.-]/g, '');
  let h = 0x811c9dc5;
  for (let i = 0; i < uri.length; i++) {
    h ^= uri.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `w-${(h >>> 0).toString(16)}-${uri.length.toString(16)}.jpg`;
}

async function listImages(uid: string): Promise<string[]> {
  const { data, error } = await client().storage.from(BACKUP_BUCKET).list(`${uid}/images`, { limit: 1000 });
  if (error) throw error;
  return (data ?? []).map((f) => f.name);
}

export async function getBackupMeta(): Promise<BackupMeta> {
  return (await readJson<BackupMeta>(KEYS.backupMeta)) ?? {};
}

async function setBackupMeta(changes: BackupMeta) {
  await writeJson(KEYS.backupMeta, { ...(await getBackupMeta()), ...changes });
}

/** Uploads the device data and photos. Returns how many recipes were backed up. */
export async function backupNow(): Promise<{ recipes: number; at: number }> {
  const sb = client();
  const uid = await userId();
  const recipes = await loadRecipes(); // Includes the starter recipes if they were never edited.
  const profile = await readJson<Profile>(KEYS.profile);
  const activity = await readJson<Activity>(KEYS.activity);

  const localUris = [...recipes.map((r) => r.image), profile?.avatar].filter(isLocalImage);
  const existing = new Set(await listImages(uid));
  const names = new Map<string, string>();
  for (const uri of new Set(localUris)) {
    const name = imageName(uri);
    names.set(uri, name);
    if (existing.has(name)) continue;
    try {
      const body = await readImageBytes(uri);
      const { error } = await sb.storage
        .from(BACKUP_BUCKET)
        .upload(`${uid}/images/${name}`, body, { contentType: 'image/jpeg', upsert: true });
      if (error) throw error;
    } catch {
      names.delete(uri); // Missing/unreadable photo: back up the recipe without it.
    }
  }

  const toRef = (uri?: string) => (uri && names.has(uri) ? REF + names.get(uri) : isLocalImage(uri) ? undefined : uri);
  const at = Date.now();
  const data: BackupData = {
    version: 1,
    createdAt: at,
    recipes: recipes.map((r) => ({ ...r, image: toRef(r.image) })),
    profile: profile ? { ...profile, avatar: toRef(profile.avatar) } : null,
    activity,
  };

  const { error } = await sb.from('backups').upsert({ user_id: uid, data, updated_at: new Date(at).toISOString() });
  if (error) throw error;

  // Remove photos the backup no longer uses.
  const used = new Set(names.values());
  const stale = [...existing].filter((n) => !used.has(n)).map((n) => `${uid}/images/${n}`);
  if (stale.length) await sb.storage.from(BACKUP_BUCKET).remove(stale);

  await setBackupMeta({ lastBackupAt: at });
  return { recipes: recipes.length, at };
}

/** Date of the backup stored on the server, or null if there is none. */
export async function getServerBackupDate(): Promise<number | null> {
  const uid = await userId();
  const { data, error } = await client().from('backups').select('updated_at').eq('user_id', uid).maybeSingle();
  if (error) throw error;
  return data ? Date.parse(data.updated_at as string) : null;
}

/** Replaces the device data with the server backup. Call the data reload afterwards. */
export async function restoreBackup(): Promise<{ recipes: number }> {
  const sb = client();
  const uid = await userId();
  const { data: row, error } = await sb.from('backups').select('data').eq('user_id', uid).maybeSingle();
  if (error) throw error;
  if (!row) throw new Error('no-backup');
  const backup = row.data as BackupData;

  const refs = [...backup.recipes.map((r) => r.image), backup.profile?.avatar].filter(
    (u): u is string => !!u && u.startsWith(REF),
  );
  const urls = new Map<string, string>();
  if (refs.length) {
    const paths = [...new Set(refs)].map((r) => `${uid}/images/${r.slice(REF.length)}`);
    const { data: signed, error: signError } = await sb.storage.from(BACKUP_BUCKET).createSignedUrls(paths, 600);
    if (signError) throw signError;
    for (const s of signed ?? []) if (s.signedUrl && s.path) urls.set(REF + s.path.split('/').pop(), s.signedUrl);
  }

  const download = async (uri: string | undefined, folder: ImageFolder) => {
    if (!uri?.startsWith(REF)) return uri;
    const url = urls.get(uri);
    if (!url) return undefined;
    try {
      return await storeDownloadedImage(url, folder);
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

/** Deletes the server backup, photos and login. Device data stays. */
export async function deleteAccount(): Promise<void> {
  const sb = client();
  const uid = await userId();
  const names = await listImages(uid);
  if (names.length) await sb.storage.from(BACKUP_BUCKET).remove(names.map((n) => `${uid}/images/${n}`));
  await sb.from('backups').delete().eq('user_id', uid);
  const { error } = await sb.rpc('delete_my_account');
  if (error) throw error;
  await sb.auth.signOut();
  await writeJson(KEYS.backupMeta, {});
}
