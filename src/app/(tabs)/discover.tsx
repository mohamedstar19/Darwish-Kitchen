import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, TextInput, View } from 'react-native';
import { RecipeListItem } from '../../components/RecipeListItem';
import { Button, Chip, EmptyState, Muted } from '../../components/ui';
import { CATEGORY_AR, searchWebRecipes } from '../../lib/mealdb';
import { rememberWebRecipe } from '../../lib/web-recipes';
import { radius, space, useTheme } from '../../theme';
import type { WebRecipe } from '../../types';

const IDEAS = ['chicken', 'rice', 'pasta', 'soup', 'fish', 'egg', 'beef', 'cake'];
const IDEA_AR: Record<string, string> = {
  chicken: 'فراخ', rice: 'رز', pasta: 'مكرونة', soup: 'شوربة', fish: 'سمك', egg: 'بيض', beef: 'لحمة', cake: 'كيك',
};

export default function DiscoverScreen() {
  const c = useTheme();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WebRecipe[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const search = async (q = query) => {
    const term = q.trim();
    if (!term) return;
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    setLoading(true);
    setError(false);
    try {
      const list = await searchWebRecipes(term, ctrl.signal);
      list.forEach(rememberWebRecipe);
      setResults(list);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(true);
    } finally {
      if (controller.current === ctrl) setLoading(false);
    }
  };

  return (
    <FlatList
      style={{ backgroundColor: c.background }}
      data={results ?? []}
      keyExtractor={(r) => r.webId}
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ gap: space.md }}>
          <Muted>دوّر على وصفات من موقع TheMealDB (الوصفات بالإنجليزي). اكتب اسم الأكلة بالإنجليزي.</Muted>
          <View style={[styles.search, { backgroundColor: c.card, borderColor: c.border }]}>
            <Ionicons name="globe-outline" size={18} color={c.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={() => search()}
              placeholder="مثلاً: chicken, pasta, soup"
              placeholderTextColor={c.muted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              style={[styles.input, { color: c.text, writingDirection: 'ltr' }]}
            />
          </View>
          <Button label="دوّر" icon="search" onPress={() => search()} loading={loading} disabled={!query.trim()} />
          <View style={styles.chips}>
            {IDEAS.map((idea) => (
              <Chip
                key={idea}
                label={IDEA_AR[idea]}
                onPress={() => {
                  setQuery(idea);
                  search(idea);
                }}
              />
            ))}
          </View>
          {loading ? <ActivityIndicator color={c.primary} style={{ marginTop: space.lg }} /> : null}
        </View>
      }
      renderItem={({ item }) => (
        <RecipeListItem
          title={item.title}
          image={item.image}
          subtitle={[item.category && (CATEGORY_AR[item.category] ?? item.category), item.area].filter(Boolean).join(' • ')}
          onPress={() => router.push({ pathname: '/online/[id]', params: { id: item.webId } })}
        />
      )}
      ListEmptyComponent={
        loading ? undefined : error ? (
          <EmptyState icon="cloud-offline-outline" title="مقدرناش نوصل للنت" message="اتأكد من الاتصال وجرب تاني." />
        ) : results ? (
          <EmptyState icon="search-outline" title="مفيش نتايج" message="جرّب اسم تاني بالإنجليزي." />
        ) : undefined
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg, gap: space.md, paddingBottom: 40, maxWidth: 720, width: '100%', alignSelf: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.lg, minHeight: 46 },
  input: { flex: 1, fontSize: 16, paddingVertical: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
