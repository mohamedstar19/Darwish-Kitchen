import { DRINK_SAMPLES, SAMPLE_RECIPES, SAMPLES_VERSION } from '../data/samples';
import type { Recipe } from '../types';
import { KEYS, readJson, writeJson } from './kv';

export async function loadRecipes(): Promise<Recipe[]> {
  const list = await readJson<Recipe[]>(KEYS.recipes);
  if (!Array.isArray(list)) return SAMPLE_RECIPES;

  // Users from before drinks existed get the new starter drinks and juices once.
  const version = (await readJson<number>(KEYS.samplesVersion)) ?? 1;
  if (version < 2) {
    const have = new Set(list.map((r) => r.id));
    const added = [...list, ...DRINK_SAMPLES.filter((r) => !have.has(r.id))];
    await saveRecipes(added);
    return added;
  }
  return list;
}

export async function saveRecipes(recipes: Recipe[]): Promise<void> {
  await writeJson(KEYS.recipes, recipes);
  await writeJson(KEYS.samplesVersion, SAMPLES_VERSION);
}
