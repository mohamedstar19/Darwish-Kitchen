import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FeedCard } from '../../components/FeedCard';
import { Button, Chip, EmptyState, Muted } from '../../components/ui';
import { fetchFeed, type FeedPost } from '../../lib/feed-api';
import { useFeedActions } from '../../lib/feed-actions';
import { space, useTheme } from '../../theme';
import { CATEGORIES, CATEGORY_ICONS, CATEGORY_LABELS, type RecipeCategory } from '../../types';

/** "الشيفات": recipes customers publish, newest first. */
export default function FeedScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { like, save, isSaved } = useFeedActions();
  const [category, setCategory] = useState<RecipeCategory | undefined>();
  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const request = useRef(0);

  const load = useCallback(async (cat: RecipeCategory | undefined) => {
    const id = ++request.current;
    setError(false);
    try {
      const page = await fetchFeed({ category: cat });
      if (id !== request.current) return;
      setPosts(page.posts);
      setNext(page.next);
    } catch {
      if (id === request.current) setError(true);
    }
  }, []);

  // Fresh posts every time the tab opens.
  useFocusEffect(
    useCallback(() => {
      load(category);
    }, [load, category]),
  );

  const choose = (cat: RecipeCategory | undefined) => {
    setCategory(cat);
    setPosts(null);
  };

  const more = async () => {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchFeed({ category, before: next });
      setPosts((p) => [...(p ?? []), ...page.posts.filter((x) => !(p ?? []).some((y) => y.id === x.id))]);
      setNext(page.next);
    } catch {
      // Try again on the next scroll.
    } finally {
      setLoadingMore(false);
    }
  };

  const onLike = async (post: FeedPost) => {
    const updated = await like(post);
    if (updated) setPosts((list) => list?.map((p) => (p.id === post.id ? updated : p)) ?? null);
  };

  return (
    <FlatList
      style={{ backgroundColor: c.background }}
      data={posts ?? []}
      keyExtractor={(p) => p.id}
      contentContainerStyle={[styles.list, { paddingTop: insets.top + space.lg }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load(category);
            setRefreshing(false);
          }}
        />
      }
      onEndReached={more}
      onEndReachedThreshold={0.5}
      ListHeaderComponent={
        <View style={{ gap: space.md }}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: c.text }]}>وصفات الشيفات</Text>
              <Muted>وصفات بيشاركها مستخدمين التطبيق</Muted>
            </View>
            <Button label="انشر وصفة" icon="add" onPress={() => router.push('/recipe/edit')} />
          </View>
          <View style={styles.chips}>
            <Chip label="الكل" selected={!category} onPress={() => choose(undefined)} />
            {CATEGORIES.map((k) => (
              <Chip key={k} label={CATEGORY_LABELS[k]} icon={CATEGORY_ICONS[k]} selected={category === k} onPress={() => choose(k)} />
            ))}
          </View>
          {!posts && !error ? <ActivityIndicator color={c.primary} style={{ marginTop: space.xl }} /> : null}
        </View>
      }
      renderItem={({ item }) => (
        <FeedCard
          post={item}
          saved={isSaved(item)}
          onOpen={() => router.push({ pathname: '/feed/[id]', params: { id: item.id } })}
          onLike={() => onLike(item)}
          onSave={() => save(item)}
        />
      )}
      ListEmptyComponent={
        error ? (
          <EmptyState icon="cloud-offline-outline" title="مقدرناش نجيب الوصفات" message="اتأكد من الإنترنت واسحب الصفحة لتحت." />
        ) : posts ? (
          <EmptyState
            icon="people-outline"
            title="لسه مفيش وصفات هنا"
            message="كن أول شيف ينشر وصفة!"
            action={<Button label="انشر وصفة" icon="add" onPress={() => router.push('/recipe/edit')} />}
          />
        ) : undefined
      }
      ListFooterComponent={loadingMore ? <ActivityIndicator color={c.primary} /> : undefined}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg, gap: space.lg, paddingBottom: 40, maxWidth: 720, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  title: { fontSize: 24, fontWeight: '900' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
