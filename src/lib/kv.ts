import AsyncStorage from '@react-native-async-storage/async-storage';

/** Storage keys for everything kept on the device. */
export const KEYS = {
  recipes: 'darwish-kitchen.recipes.v1',
  profile: 'darwish-kitchen.profile.v1',
  activity: 'darwish-kitchen.activity.v1',
  backupMeta: 'darwish-kitchen.backup-meta.v1',
} as const;

export async function readJson<T>(key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}
