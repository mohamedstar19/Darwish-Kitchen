import type { MealType, RecipeCategory, RecipeInput } from '../types';
import { api, serverUrl } from './api';

/** A recipe another chef (customer) published in the feed. */
export type FeedPost = {
  id: string;
  title: string;
  category: RecipeCategory;
  mealTypes: MealType[];
  ingredients: string[];
  steps: string[];
  prepMinutes: number | null;
  servings: number | null;
  notes: string | null;
  /** Server path. */
  image: string | null;
  author: { name: string; avatar: string | null };
  likes: number;
  likedByMe: boolean;
  mine: boolean;
  /** Only on my own posts: the local recipe id it was published from. */
  clientId?: string;
  hidden: boolean;
  createdAt: number;
  updatedAt: number;
  /** Control panel only. */
  reports?: number;
};

export async function fetchFeed({ category, before }: { category?: RecipeCategory; before?: number } = {}) {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (before) params.set('before', String(before));
  const qs = params.toString();
  return api<{ posts: FeedPost[]; next: number | null }>(`/api/feed${qs ? `?${qs}` : ''}`, { auth: 'optional' });
}

export const fetchPost = (id: string) => api<FeedPost>(`/api/feed/${encodeURIComponent(id)}`, { auth: 'optional' });

export const likePost = (id: string, like: boolean) =>
  api<{ likes: number; likedByMe: boolean }>(`/api/posts/${encodeURIComponent(id)}/like`, like ? { json: {} } : { method: 'DELETE' });

export const reportPost = (id: string, reason?: string) => api(`/api/posts/${encodeURIComponent(id)}/report`, { json: { reason } });

export const deletePost = (id: string) => api(`/api/posts/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const adminPosts = async (filter: 'all' | 'reported' | 'hidden') =>
  (await api<{ posts: FeedPost[] }>(`/api/admin/posts?filter=${filter}`)).posts;

export const adminHidePost = (id: string, hidden: boolean) =>
  api<FeedPost>(`/api/admin/posts/${encodeURIComponent(id)}`, { method: 'PUT', json: { hidden } });

export const postImageUrl = (p: Pick<FeedPost, 'image'>) => (p.image ? serverUrl(p.image) : undefined);
export const avatarUrl = (p: Pick<FeedPost, 'author'>) => (p.author.avatar ? serverUrl(p.author.avatar) : undefined);

/** Copy of a feed post for "وصفاتي". */
export function feedToRecipeInput(p: FeedPost): RecipeInput {
  return {
    title: p.title,
    category: p.category,
    mealTypes: p.mealTypes,
    image: postImageUrl(p),
    ingredients: p.ingredients,
    steps: p.steps,
    prepMinutes: p.prepMinutes ?? undefined,
    servings: p.servings ?? undefined,
    notes: p.notes ?? undefined,
    source: 'feed',
    feedId: p.id,
  };
}

/** "منذ ٥ دقايق" style time. */
export function timeAgo(at: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - at) / 60_000));
  if (min < 1) return 'دلوقتي';
  if (min < 60) return `من ${min} دقيقة`;
  const h = Math.round(min / 60);
  if (h < 24) return `من ${h} ساعة`;
  const d = Math.round(h / 24);
  if (d < 30) return `من ${d} يوم`;
  return new Date(at).toLocaleDateString('ar-EG');
}
