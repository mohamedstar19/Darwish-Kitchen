import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { RecipeListItem } from '../../components/RecipeListItem';
import { Button, Chip, EmptyState } from '../../components/ui';
import { useActivity } from '../../lib/activity-context';
import { useRecipes } from '../../lib/recipes-context';
import { radius, space, useTheme } from '../../theme';
import { MEAL_LABELS, MEAL_TYPES, type MealType } from '../../types';

type Filter = 'all' | 'favorite' | MealType;

export default function RecipesScreen() {
  const c = useTheme();
  const { recipes, ready } = useRecipes();
  const { activity } = useActivity();
  const liked = (id: string) => !!activity.likes[`local:${id}`];
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes.filter((r) => {
      if (filter === 'favorite' && !liked(r.id)) return false;
      if (filter !== 'all' && filter !== 'favorite' && !r.mealTypes.includes(filter)) return false;
      if (!q) return true;
      return r.title.toLowerCase().includes(q) || r.ingredients.some((i) => i.toLowerCase().includes(q));
    });
  }, [recipes, query, filter, activity.likes]);

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'الكل' },
    ...MEAL_TYPES.map((m) => ({ key: m as Filter, label: MEAL_LABELS[m] })),
    { key: 'favorite', label: 'عجبتني' },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <FlatList
        data={visible}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={{ gap: space.md }}>
            <View style={[styles.search, { backgroundColor: c.card, borderColor: c.border }]}>
              <Ionicons name="search" size={18} color={c.muted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="دوّر باسم الأكلة أو مكوّن…"
                placeholderTextColor={c.muted}
                style={[styles.input, { color: c.text }]}
                returnKeyType="search"
              />
              {query ? (
                <Pressable onPress={() => setQuery('')} accessibilityLabel="مسح">
                  <Ionicons name="close-circle" size={18} color={c.muted} />
                </Pressable>
              ) : null}
            </View>
            <View style={styles.chips}>
              {filters.map((f) => (
                <Chip key={f.key} label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} />
              ))}
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <RecipeListItem
            title={item.title}
            image={item.image}
            mealTypes={item.mealTypes}
            minutes={item.prepMinutes}
            favorite={liked(item.id)}
            onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: item.id } })}
          />
        )}
        ListEmptyComponent={
          ready ? (
            <EmptyState
              icon="book-outline"
              title={recipes.length ? 'مفيش نتايج' : 'لسه مفيش وصفات'}
              message={recipes.length ? 'جرّب كلمة تانية أو فلتر تاني.' : 'ضيف أول وصفة ليك بصورتها.'}
            />
          ) : undefined
        }
      />
      <View style={styles.fabWrap} pointerEvents="box-none">
        <Button label="إضافة وصفة" icon="add" onPress={() => router.push('/recipe/edit')} style={styles.fab} />
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
