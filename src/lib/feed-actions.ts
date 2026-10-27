import { router } from 'expo-router';
import { useCallback } from 'react';
import { useActivity } from './activity-context';
import { useAuth } from './auth-context';
import { confirm, notify } from './confirm';
import { feedToRecipeInput, likePost, postImageUrl, type FeedPost } from './feed-api';
import { useRecipes } from './recipes-context';

/** Shared like/save behavior for feed cards and the post page. */
export function useFeedActions() {
  const { auth } = useAuth();
  const { recipes, addRecipe } = useRecipes();
  const { isLiked, toggleLike } = useActivity();

  const needLogin = useCallback(async (what: string) => {
    if (await confirm('سجّل الأول', `علشان ${what} لازم تسجّل برقم موبايلك.`, 'سجّل')) router.push('/account');
  }, []);

  /** Likes/unlikes on the server; returns the updated post (or null if not signed in / failed). */
  const like = useCallback(
    async (post: FeedPost): Promise<FeedPost | null> => {
      if (!auth) {
        await needLogin('تعمل إعجاب');
        return null;
      }
      try {
        const res = await likePost(post.id, !post.likedByMe);
        // Keep "عجبتني" in my profile in step with the server.
        const ref = { kind: 'feed' as const, id: post.id, title: post.title, image: postImageUrl(post) };
        if (res.likedByMe !== isLiked(ref)) toggleLike(ref);
        return { ...post, ...res };
      } catch {
        notify('مقدرناش نسجّل الإعجاب', 'اتأكد من الإنترنت وجرب تاني.');
        return null;
      }
    },
    [auth, needLogin, isLiked, toggleLike],
  );

  const isSaved = useCallback((post: FeedPost) => recipes.some((r) => r.feedId === post.id), [recipes]);

  const save = useCallback(
    async (post: FeedPost) => {
      if (isSaved(post)) return;
      try {
        await addRecipe(feedToRecipeInput(post));
        notify('اتحفظت في وصفاتك ✅');
      } catch {
        notify('مقدرناش نحفظها', 'مساحة التخزين ممكن تكون مليانة.');
      }
    },
    [addRecipe, isSaved],
  );

  return { like, save, isSaved, needLogin, signedIn: !!auth, isAdmin: !!auth?.isAdmin };
}
