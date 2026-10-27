import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { confirm, notify } from '../lib/confirm';
import { adminHidePost, adminPosts, deletePost, postImageUrl, timeAgo, type FeedPost } from '../lib/feed-api';
import { space, useTheme } from '../theme';
import { RecipeListItem } from './RecipeListItem';
import { Button, Chip, EmptyState, Muted } from './ui';

type Filter = 'reported' | 'hidden' | 'all';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'reported', label: '🚩 مبلّغ عنها' },
  { key: 'hidden', label: '🙈 مخفية' },
  { key: 'all', label: 'الكل' },
];

/** Control panel: chefs' posts, reported first; hide/show or delete. */
export function ChefsModeration({ header }: { header: React.ReactNode }) {
  const c = useTheme();
  const [filter, setFilter] = useState<Filter>('reported');
  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback((f: Filter) => {
    setError(false);
    adminPosts(f)
      .then(setPosts)
      .catch(() => setError(true));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(filter);
    }, [load, filter]),
  );

  const toggleHidden = async (p: FeedPost) => {
    setBusy(p.id);
    try {
      const updated = await adminHidePost(p.id, !p.hidden);
      setPosts((list) => list?.map((x) => (x.id === p.id ? { ...x, ...updated } : x)) ?? null);
    } catch {
      notify('مقدرناش نعدّلها', 'اتأكد من الإنترنت.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (p: FeedPost) => {
    if (!(await confirm('حذف الوصفة', `"${p.title}" بتاعة ${p.author.name} هتتمسح من الفيد نهائيًا.`, 'حذف'))) return;
    setBusy(p.id);
    try {
      await deletePost(p.id);
      setPosts((list) => list?.filter((x) => x.id !== p.id) ?? null);
    } catch {
      notify('مقدرناش نحذفها', 'اتأكد من الإنترنت.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <FlatList
      style={{ backgroundColor: c.background }}
      data={posts ?? []}
      keyExtractor={(p) => p.id}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={{ gap: space.md }}>
          {header}
          <Muted>وصفات المستخدمين بتظهر للكل على طول. راجع اللي اتبلّغ عنها، وخفّي أو احذف أي حاجة مش مناسبة.</Muted>
          <View style={styles.chips}>
            {FILTERS.map((f) => (
              <Chip
                key={f.key}
                label={f.label}
                selected={filter === f.key}
                onPress={() => {
                  setFilter(f.key);
                  setPosts(null);
                }}
              />
            ))}
          </View>
          {error ? <Text style={{ color: c.danger, fontWeight: '600' }}>مقدرناش نجيب الوصفات. اتأكد من الإنترنت.</Text> : null}
          {!posts && !error ? <ActivityIndicator color={c.primary} /> : null}
        </View>
      }
      renderItem={({ item }) => (
        <View style={{ gap: space.sm }}>
          <RecipeListItem
            title={item.title}
            image={postImageUrl(item)}
            category={item.category}
            mealTypes={item.mealTypes}
            subtitle={[`👤 ${item.author.name}`, timeAgo(item.createdAt), item.reports ? `🚩 ${item.reports}` : '', item.hidden ? '🙈 مخفية' : '']
              .filter(Boolean)
              .join('  •  ')}
            onPress={() => router.push({ pathname: '/feed/[id]', params: { id: item.id } })}
          />
          <View style={styles.row}>
            <Button
              label={item.hidden ? 'إظهار' : 'إخفاء'}
              icon={item.hidden ? 'eye-outline' : 'eye-off-outline'}
              variant="secondary"
              onPress={() => toggleHidden(item)}
              loading={busy === item.id}
              style={{ flex: 1 }}
            />
            <Button label="حذف" icon="trash-outline" variant="danger" onPress={() => remove(item)} disabled={busy === item.id} style={{ flex: 1 }} />
          </View>
        </View>
      )}
      ListEmptyComponent={posts ? <EmptyState icon="checkmark-done-outline" title="مفيش حاجة هنا" /> : undefined}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg, gap: space.lg, paddingBottom: 40, maxWidth: 720, width: '100%', alignSelf: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  row: { flexDirection: 'row', gap: space.sm },
});
