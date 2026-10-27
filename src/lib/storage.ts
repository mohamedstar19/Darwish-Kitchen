import AsyncStorage from '@react-native-async-storage/async-storage';
import { SAMPLE_RECIPES } from '../data/samples';
import type { Recipe } from '../types';

const KEY = 'darwish-kitchen.recipes.v1';

export async function loadRecipes(): Promise<Recipe[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (raw === null) return SAMPLE_RECIPES;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Recipe[]) : SAMPLE_RECIPES;
  } catch {
    return SAMPLE_RECIPES;
  }
}

export async function saveRecipes(recipes: Recipe[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(recipes));
}
