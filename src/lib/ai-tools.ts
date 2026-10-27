import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import type { MealType, RecipeCategory, RecipeInput, WebRecipe } from '../types';
import { api } from './api';
import { toWebRecipe, type AiRecipe } from './ai-search';
import type { ImageSource } from './images';

/**
 * The AI helpers (all run on the server; signed in only, counted in the daily AI limit):
 * fridge ideas, a recipe from a photo of a written recipe, and the smart "what do we eat today".
 */

type Pending = { pending: true; job: string };

const POLL_MS = 2500;
const GIVE_UP_MS = 5 * 60 * 1000;

/** Sends the request; while the server is still thinking it answers with a job, which we check until it's done. */
async function runTask<T>(path: string, body: object, isCurrent: () => boolean): Promise<T> {
  const started = Date.now();
  let res = await api<T | Pending>(path, { json: body });
  while ((res as Pending).pending) {
    if (!isCurrent()) throw Object.assign(new Error('superseded'), { code: 'superseded' });
    if (Date.now() - started > GIVE_UP_MS) throw Object.assign(new Error('timeout'), { code: 'ai-failed' });
    await new Promise((r) => setTimeout(r, POLL_MS));
    res = await api<T | Pending>(`/api/ai/jobs/${(res as Pending).job}`);
  }
  return res as T;
}

/** Common error codes → Egyptian Arabic messages. */
export const AI_ERRORS: Record<string, string> = {
  'ai-daily-limit': 'خلّصت عدد مرات الذكاء الاصطناعي النهارده. جرّب بكرة 🙏',
  'ai-unavailable': 'الذكاء الاصطناعي مش متاح دلوقتي.',
  'no-recipe': 'مقدرناش نلاقي وصفة في الصورة. صوّرها أوضح ومن قريب وجرب تاني.',
  'bad-image': 'الصورة دي مش مدعومة. جرب صورة تانية.',
  network: 'مفيش إنترنت. اتأكد من الاتصال وجرب تاني.',
  'signed-out': 'لازم تسجّل الدخول برقم موبايلك الأول.',
};
export const aiErrorMessage = (e: unknown) => AI_ERRORS[(e as { code?: string }).code ?? ''] ?? 'حصلت مشكلة. جرب تاني بعد شوية.';

/**
 * Takes or chooses a photo and returns it as base64 JPEG (not saved anywhere), sized for the AI to read.
 * Null if the user cancelled.
 */
export async function pickPhotoForAi(source: ImageSource): Promise<{ uri: string; base64: string } | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('camera-permission');
  } else if (Platform.OS !== 'web') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) throw new Error('library-permission');
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.9 };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  const context = ImageManipulator.manipulate(asset.uri);
  // Long side ~1500px keeps handwriting readable and the upload small.
  if (!asset.width || !asset.height || Math.max(asset.width, asset.height) > 1500) {
    context.resize((asset.width ?? 0) >= (asset.height ?? 0) ? { width: 1500 } : { height: 1500 });
  }
  const saved = await (await context.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
  if (!saved.base64) throw new Error('no-image');
  return { uri: `data:image/jpeg;base64,${saved.base64}`, base64: saved.base64 };
}

// ---------- fridge ----------

export type FridgeResult = { seen: string[]; recipes: WebRecipe[]; remaining: number | null };

export async function aiFridge(
  input: { ingredients: string; image?: string; category?: RecipeCategory },
  isCurrent: () => boolean = () => true,
): Promise<FridgeResult> {
  const res = await runTask<{ seen: string[]; recipes: AiRecipe[]; remaining: number | null }>('/api/ai/fridge', input, isCurrent);
  return { seen: res.seen, recipes: res.recipes.map(toWebRecipe), remaining: res.remaining };
}

// ---------- photo → recipe ----------

type ScannedRecipe = {
  title: string;
  category: RecipeCategory;
  mealTypes: MealType[];
  ingredients: string[];
  steps: string[];
  prepMinutes: number | null;
  servings: number | null;
  notes: string | null;
};

export async function aiPhotoRecipe(base64: string): Promise<Omit<RecipeInput, 'source'>> {
  const { recipe } = await runTask<{ recipe: ScannedRecipe }>('/api/ai/photo-recipe', { image: base64 }, () => true);
  return {
    title: recipe.title,
    category: recipe.category,
    mealTypes: recipe.mealTypes,
    ingredients: recipe.ingredients,
    steps: recipe.steps,
    prepMinutes: recipe.prepMinutes ?? undefined,
    servings: recipe.servings ?? undefined,
    notes: recipe.notes ?? undefined,
  };
}

// ---------- smart suggestion ----------

export type SuggestCandidate = {
  /** "local:<id>" or "darwish:<id>" */
  key: string;
  title: string;
  mine: boolean;
  liked: boolean;
  rating: number | null;
  seenDaysAgo: number | null;
  suggestedLately: boolean;
};

export type SmartPick = ({ kind: 'saved'; key: string } | { kind: 'new'; recipe: WebRecipe }) & { reason: string; remaining: number | null };

export async function aiSuggest(meal: MealType, candidates: SuggestCandidate[], allowNew: boolean): Promise<SmartPick> {
  type Res = ({ kind: 'saved'; key: string } | { kind: 'new'; recipe: AiRecipe }) & { reason: string; remaining: number | null };
  const res = await runTask<Res>('/api/ai/suggest', { meal, candidates, allowNew }, () => true);
  return res.kind === 'new' ? { ...res, recipe: toWebRecipe(res.recipe) } : res;
}
