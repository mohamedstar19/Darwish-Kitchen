import type { Activity, Recipe } from '../types';
import { KEYS, readJson, writeJson } from './kv';

/**
 * Data layout version on this device.
 * 3: Darwish starters no longer live in "وصفاتي" (they're their own section, synced from the server).
 */
const DATA_VERSION = 3;

/** Starter ids: bundled ("sample-…") or added by the admin ("c-…"). */
const isStarterId = (id: string) => id.startsWith('sample-') || /^c-[a-f0-9]{12}$/.test(id);

async function migrate() {
  const version = (await readJson<number>(KEYS.samplesVersion)) ?? 1;
  if (version >= DATA_VERSION) return;

  // Untouched starters leave "وصفاتي"; ones the user edited become their own recipes.
  const list = await readJson<Recipe[]>(KEYS.recipes);
  const kept = Array.isArray(list)
    ? list
        .filter((r) => !(r.source === 'sample' && !r.customized))
        .map((r) => (r.source === 'sample' ? { ...r, source: 'user' as const, customized: undefined, catalogVersion: undefined } : r))
    : null;
  if (kept) await writeJson(KEYS.recipes, kept);

  // Likes, ratings and views on starters now point at the Darwish section.
  const keptIds = new Set((kept ?? []).map((r) => r.id));
  const activity = await readJson<Activity>(KEYS.activity);
  if (activity) {
    const fix = <T extends { ref: Activity['views'][number]['ref'] }>(e: T): T =>
      e.ref.kind === 'local' && isStarterId(e.ref.id) && !keptIds.has(e.ref.id) ? { ...e, ref: { ...e.ref, kind: 'darwish' } } : e;
    const rekey = <T extends { ref: Activity['views'][number]['ref'] }>(m: Record<string, T>) =>
      Object.fromEntries(Object.values(m).map((e) => fix(e)).map((e) => [`${e.ref.kind}:${e.ref.id}`, e]));
    await writeJson(KEYS.activity, {
      likes: rekey(activity.likes ?? {}),
      ratings: rekey(activity.ratings ?? {}),
      views: (activity.views ?? []).map(fix),
    });
  }
  await writeJson(KEYS.samplesVersion, DATA_VERSION);
}

let migration: Promise<void> | null = null;
/** Runs the one-time data migration (shared by every loader so they never race). */
export const migrated = () => (migration ??= migrate().catch(() => {}));

export async function loadRecipes(): Promise<Recipe[]> {
  await migrated();
  const list = await readJson<Recipe[]>(KEYS.recipes);
  return Array.isArray(list) ? list : [];
}

export async function saveRecipes(recipes: Recipe[]): Promise<void> {
  await writeJson(KEYS.recipes, recipes);
  await writeJson(KEYS.samplesVersion, DATA_VERSION);
}
