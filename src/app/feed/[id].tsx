import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '../../components/Avatar';
import { RecipeView } from '../../components/RecipeView';
import { Badge, Button, EmptyState } from '../../components/ui';
import { useActivity } from '../../lib/activity-context';
import { confirm, notify } from '../../lib/confirm';
import { avatarUrl, deletePost, fetchPost, postImageUrl, reportPost, timeAgo, type FeedPost } from '../../lib/feed-api';
import { useFeedActions } from '../../lib/feed-actions';
import { goBack } from '../../lib/nav';
import { useRecipes } from '../../lib/recipes-context';
import { space, useTheme } from '../../theme';

export default function FeedPostScreen() {
  const c = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { like, save, isSaved, needLogin, signedIn, isAdmin } = useFeedActions();
  const { recordView } = useActivity();
  const { recipes, updateRecipe } = useRecipes();
  const [post, setPost] = useState<FeedPost | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchPost(id)
      .then((p) => {
        setPost(p);
        recordView({ kind: 'feed', id: p.id, title: p.title, image: postImageUrl(p) });
      })
      .catch(() => setPost(null));
  }, [id, recordView]);

  if (post === undefined) return <ActivityIndicator style={{ marginTop: 60 }} />;
  if (!post) return <EmptyState icon="alert-circle-outline" title="الوصفة دي مش موجودة" message="ممكن صاحبها شالها." />;

  const mine = recipes.find((r) => r.postId === post.id);

  const report = async () => {
    if (!signedIn) return needLogin('تبلّغ عن وصفة');
    if (!(await confirm('بلاغ عن الوصفة', 'هنبعتها للأدمن يراجعها. الوصفة دي مش مناسبة؟', 'بلّغ'))) return;
    try {
      await reportPost(post.id);
      notify('وصل البلاغ', 'شكرًا، الأدمن هيراجعها.');
    } catch {
      notify('مقدرناش نبعت البلاغ', 'جرب تاني بعد شوية.');
    }
  };

  const remove = async () => {
    const msg = post.mine ? 'هتختفي من الفيد، بس هتفضل عندك في وصفاتي.' : 'هتتمسح من الفيد عند كل الناس.';
    if (!(await confirm('حذف من الفيد', msg, 'حذف'))) return;
    setBusy(true);
    try {
      await deletePost(post.id);
      if (mine) await updateRecipe(mine.id, { postId: undefined });
      goBack('/feed');
    } catch {
      notify('مقدرناش نحذفها', 'اتأكد من الإنترنت وجرب تاني.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: post.title }} />
      <RecipeView
        {...post}
        image={postImageUrl(post)}
        top={
          <View style={styles.chef}>
            <Avatar uri={avatarUrl(post)} size={44} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.chefName, { color: c.text }]}>{post.author.name}</Text>
              <Text style={{ color: c.muted, fontSize: 12 }}>{timeAgo(post.createdAt)}</Text>
            </View>
          </View>
        }
        badges={
          <>
            <Badge label="من الشيفات" tone="muted" />
            {post.hidden ? <Badge label="مخفية من الأدمن" tone="muted" /> : null}
          </>
        }
        actions={
          <View style={styles.row}>
            <Button
              label={`${post.likes || ''} ${post.likedByMe ? 'عجبتني' : 'أعجبني'}`.trim()}
              icon={post.likedByMe ? 'heart' : 'heart-outline'}
              variant="secondary"
              onPress={async () => {
                const updated = await like(post);
                if (updated) setPost(updated);
              }}
              style={{ flex: 1 }}
            />
            {post.mine ? (
              mine ? (
                <Button label="عدّلها" icon="create-outline" variant="secondary" onPress={() => router.push({ pathname: '/recipe/edit', params: { id: mine.id } })} style={{ flex: 1 }} />
              ) : null
            ) : (
              <Button
                label={isSaved(post) ? 'في وصفاتك' : 'احفظها'}
                icon={isSaved(post) ? 'bookmark' : 'bookmark-outline'}
                variant="secondary"
                onPress={() => save(post)}
                disabled={isSaved(post)}
                style={{ flex: 1 }}
              />
            )}
          </View>
        }
        footer={
          <View style={{ gap: space.sm }}>
            {!post.mine ? <Button label="بلّغ عن الوصفة" icon="flag-outline" variant="ghost" onPress={report} /> : null}
            {post.mine || isAdmin ? (
              <Button label={post.mine ? 'شيلها من الفيد' : 'حذف (أدمن)'} icon="trash-outline" variant="danger" onPress={remove} loading={busy} />
            ) : null}
          </View>
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  chef: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  chefName: { fontSize: 17, fontWeight: '800' },
  row: { flexDirection: 'row', gap: space.sm },
});
