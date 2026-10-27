import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { ChefsModeration } from '../../components/ChefsModeration';
import { RecipeListItem } from '../../components/RecipeListItem';
import { Button, Chip, EmptyState, Muted } from '../../components/ui';
import { adminList } from '../../lib/admin-api';
import { serverUrl } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import type { CatalogRecipe } from '../../lib/catalog';
import { radius, space, useTheme } from '../../theme';
import { CATEGORIES, CATEGORY_LABELS, type RecipeCategory } from '../../types';

type Filter = 'all' | RecipeCategory | 'no-photo' | 'hidden';

/** Control panel: the shared recipe catalog every app syncs. Admins only (checked by the server too). */
export default function AdminScreen() {
  const c = useTheme();
  const { auth, ready } = useAuth();
  const [recipes, setRecipes] = useState<CatalogRecipe[] | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'darwish' | 'chefs'>('darwish');

  useFocusEffect(
    useCallback(() => {
      if (!auth?.isAdmin) return;
      setError(false);
      adminList()
        .then(setRecipes)
        .catch(() => setError(true));
    }, [auth?.isAdmin]),
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (recipes ?? []).filter((r) => {
      if (filter === 'no-photo' && r.image) return false;
      if (filter === 'hidden' && r.published) return false;
      if (CATEGORIES.includes(filter as RecipeCategory) && r.category !== filter) return false;
      return !q || r.title.toLowerCase().includes(q);
    });
  }, [recipes, filter, query]);

  if (!ready) return <ActivityIndicator style={{ marginTop: 60 }} />;
  if (!auth?.isAdmin) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <Stack.Screen options={{ title: 'لوحة التحكم' }} />
        <EmptyState
          icon="lock-closed-outline"
          title="الصفحة دي للأدمن بس"
          message={auth ? 'رقمك مش متسجّل كأدمن.' : 'سجّل دخول برقم الموبايل بتاع الأدمن.'}
          action={!auth ? <Button label="تسجيل الدخول" icon="log-in-outline" onPress={() => router.push('/account')} /> : undefined}
        />
      </View>
    );
  }

  const switcher = (
    <View style={styles.chips}>
      <Chip label="وصفات درويش" icon="restaurant-outline" selected={mode === 'darwish'} onPress={() => setMode('darwish')} />
      <Chip label="وصفات الشيفات" icon="people-outline" selected={mode === 'chefs'} onPress={() => setMode('chefs')} />
    </View>
  );

  if (mode === 'chefs') {
    return (
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <Stack.Screen options={{ title: 'لوحة التحكم' }} />
        <ChefsModeration header={switcher} />
      </View>
    );
  }

  const noPhoto = (recipes ?? []).filter((r) => !r.image).length;
  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: `الكل (${recipes?.length ?? 0})` },
    ...CATEGORIES.map((k) => ({ key: k as Filter, label: CATEGORY_LABELS[k] })),
    { key: 'no-photo', label: `من غير صورة (${noPhoto})` },
    { key: 'hidden', label: 'مخفية' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <Stack.Screen options={{ title: 'لوحة التحكم' }} />
      <FlatList
        data={visible}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={{ gap: space.md }}>
            {switcher}
            <Muted>الوصفات دي بتظهر عند كل اللي عندهم التطبيق. بتظهر في "وصفات درويش" وفي السلايدر في الرئيسية.</Muted>
            <View style={[styles.search, { backgroundColor: c.card, borderColor: c.border }]}>
              <Ionicons name="search" size={18} color={c.muted} />
              <TextInput value={query} onChangeText={setQuery} placeholder="دوّر بالاسم…" placeholderTextColor={c.muted} style={[styles.input, { color: c.text }]} />
            </View>
            <View style={styles.chips}>
              {filters.map((f) => (
                <Chip key={f.key} label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} />
              ))}
            </View>
            {noPhoto ? (
              <Button label={`✨ هات صور بالذكاء الاصطناعي (${noPhoto})`} icon="images-outline" variant="secondary" onPress={() => router.push('/admin/photos')} />
            ) : (
              <Button label="✨ صور بالذكاء الاصطناعي" icon="images-outline" variant="ghost" onPress={() => router.push('/admin/photos')} />
            )}
            {error ? <Text style={{ color: c.danger, fontWeight: '600' }}>مقدرناش نجيب الوصفات. اتأكد من الإنترنت.</Text> : null}
            {!recipes && !error ? <ActivityIndicator color={c.primary} /> : null}
          </View>
        }
        renderItem={({ item }) => (
          <RecipeListItem
            title={item.title}
            image={item.image ? serverUrl(item.image) : undefined}
            mealTypes={item.mealTypes}
            category={item.category}
            minutes={item.prepMinutes ?? undefined}
            subtitle={[!item.published ? '🙈 مخفية' : '', !item.image ? '📷 من غير صورة' : ''].filter(Boolean).join('  •  ') || undefined}
            onPress={() => router.push({ pathname: '/admin/edit', params: { id: item.id } })}
          />
        )}
        ListEmptyComponent={recipes ? <EmptyState icon="file-tray-outline" title="مفيش وصفات هنا" /> : undefined}
      />
      <View style={styles.fabWrap} pointerEvents="box-none">
        <Button label="إضافة وصفة للكل" icon="add" onPress={() => router.push('/admin/edit')} style={styles.fab} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg, gap: space.md, paddingBottom: 110, maxWidth: 720, width: '100%', alignSelf: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.lg, minHeight: 46 },
  input: { flex: 1, fontSize: 16, paddingVertical: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  fabWrap: { position: 'absolute', bottom: space.lg, start: 0, end: 0, alignItems: 'center' },
  fab: { shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
});
