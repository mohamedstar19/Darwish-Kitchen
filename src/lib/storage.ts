import { SAMPLE_RECIPES } from '../data/samples';
import type { Recipe } from '../types';
import { KEYS, readJson, writeJson } from './kv';

export async function loadRecipes(): Promise<Recipe[]> {
  const list = await readJson<Recipe[]>(KEYS.recipes);
  return Array.isArray(list) ? list : SAMPLE_RECIPES;
}

export async function saveRecipes(recipes: Recipe[]): Promise<void> {
  await writeJson(KEYS.recipes, recipes);
}
