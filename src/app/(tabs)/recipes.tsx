import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { RecipeListItem } from '../../components/RecipeListItem';
import { Button, Chip, EmptyState } from '../../components/ui';
import { useActivity } from '../../lib/activity-context';
import { useRecipes } from '../../lib/recipes-context';
import { radius, space, useTheme } from '../../theme';
import { CATEGORIES, CATEGORY_ICONS, CATEGORY_LABELS, categoryOf, MEAL_LABELS, MEAL_TYPES, type MealType, type RecipeCategory } from '../../types';

type Filter = 'all' | 'favorite' | MealType;
type Section = 'all' | RecipeCategory;

const isSection = (v: unknown): v is Section => v === 'all' || CATEGORIES.includes(v as RecipeCategory);

export default function RecipesScreen() {
  const c = useTheme();
  const { recipes, ready } = useRecipes();
  const { activity } = useActivity();
  const liked = (id: string) => !!activity.likes[`local:${id}`];
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const params = useLocalSearchParams<{ section?: string }>();
  const [section, setSection] = useState<Section>(isSection(params.section) ? params.section : 'all');

  // Shortcuts from the home screen open a specific section.
  useEffect(() => {
    if (isSection(params.section)) {
      setSection(params.section);
      setFilter('all');
    }
  }, [params.section]);

  const chooseSection = (next: Section) => {
    setSection(next);
    // Meal filters only make sense for food.
    if (next !== 'food' && filter !== 'favorite') setFilter('all');
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes.filter((r) => {
      if (section !== 'all' && categoryOf(r) !== section) return false;
      if (filter === 'favorite' && !liked(r.id)) return false;
      if (filter !== 'all' && filter !== 'favorite' && !r.mealTypes.includes(filter)) return false;
      if (!q) return true;
      return r.title.toLowerCase().includes(q) || r.ingredients.some((i) => i.toLowerCase().includes(q));
    });
  }, [recipes, query, filter, section, activity.likes]);

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'الكل' },
    ...(section === 'food' ? MEAL_TYPES.map((m) => ({ key: m as Filter, label: MEAL_LABELS[m] })) : []),
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
            <View style={[styles.sections, { backgroundColor: c.cardAlt }]}>
              {(['all', ...CATEGORIES] as Section[]).map((key) => {
                const selected = section === key;
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    onPress={() => chooseSection(key)}
                    style={[styles.section, selected && { backgroundColor: c.card }]}>
                    {key !== 'all' ? <Ionicons name={CATEGORY_ICONS[key]} size={16} color={selected ? c.primary : c.muted} /> : null}
                    <Text style={[styles.sectionText, { color: selected ? c.primary : c.muted }]}>
                      {key === 'all' ? 'الكل' : CATEGORY_LABELS[key]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={[styles.search, { backgroundColor: c.card, borderColor: c.border }]}>
              <Ionicons name="search" size={18} color={c.muted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="دوّر بالاسم أو بمكوّن…"
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
            category={categoryOf(item)}
            minutes={item.prepMinutes}
            favorite={liked(item.id)}
            onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: item.id } })}
          />
        )}
        ListEmptyComponent={
          ready ? (
            recipes.length ? (
              <EmptyState icon="search-outline" title="مفيش نتايج" message="جرّب كلمة تانية أو فلتر تاني." />
            ) : (
              <EmptyState
                icon="book-outline"
                title="دي مساحتك يا شيف 👨‍🍳"
                message="هنا هتلاقي الوصفات اللي بتضيفها بصورها، واللي بتحفظها من الشيفات ومن النت."
                action={
                  <View style={{ gap: space.sm, alignSelf: 'stretch' }}>
                    <Button label="ضيف أول وصفة" icon="add" onPress={() => router.push('/recipe/edit')} />
                    <Button label="شوف وصفات درويش" icon="restaurant-outline" variant="secondary" onPress={() => router.push('/darwish')} />
                  </View>
                }
              />
            )
          ) : undefined
        }
      />
      <View style={styles.fabWrap} pointerEvents="box-none">
        <Button
          label={section === 'healthy-drink' ? 'إضافة مشروب' : section === 'juice' ? 'إضافة عصير' : 'إضافة وصفة'}
          icon="add"
          onPress={() => router.push({ pathname: '/recipe/edit', params: section === 'all' ? {} : { category: section } })}
          style={styles.fab}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg, gap: space.md, paddingBottom: 110, maxWidth: 720, width: '100%', alignSelf: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.lg, minHeight: 46 },
  input: { flex: 1, fontSize: 16, paddingVertical: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  sections: { flexDirection: 'row', borderRadius: radius.md, padding: 4, gap: 4 },
  section: { flexGrow: 1, flexShrink: 0, flexBasis: 'auto', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 40, borderRadius: radius.sm, paddingHorizontal: 8 },
  sectionText: { fontSize: 13, fontWeight: '800' },
  fabWrap: { position: 'absolute', bottom: space.lg, start: 0, end: 0, alignItems: 'center' },
  fab: { shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
});
