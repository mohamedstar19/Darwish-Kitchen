import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { RecipeListItem } from '../../components/RecipeListItem';
import { EmptyState, Muted } from '../../components/ui';
import { useDarwish } from '../../lib/darwish-context';
import { radius, space, useTheme } from '../../theme';
import { CATEGORIES, CATEGORY_ICONS, CATEGORY_LABELS, categoryOf, type RecipeCategory } from '../../types';

type Section = 'all' | RecipeCategory;
const isSection = (v: unknown): v is Section => v === 'all' || CATEGORIES.includes(v as RecipeCategory);

/** "وصفات درويش": everything from the Darwish kitchen, by section. */
export default function DarwishScreen() {
  const c = useTheme();
  const { recipes, refresh } = useDarwish();
  const params = useLocalSearchParams<{ section?: string }>();
  const [section, setSection] = useState<Section>(isSection(params.section) ? params.section : 'all');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (isSection(params.section)) setSection(params.section);
  }, [params.section]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes.filter(
      (r) =>
        (section === 'all' || categoryOf(r) === section) &&
        (!q || r.title.toLowerCase().includes(q) || r.ingredients.some((i) => i.toLowerCase().includes(q))),
    );
  }, [recipes, section, query]);

  return (
    <>
      <Stack.Screen options={{ title: 'وصفات درويش' }} />
      <FlatList
        style={{ backgroundColor: c.background }}
        data={visible}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await refresh();
              setRefreshing(false);
            }}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: space.md }}>
            <Muted>وصفات وأكلات ومشروبات من مطبخ درويش، بتتحدّث باستمرار.</Muted>
            <View style={[styles.sections, { backgroundColor: c.cardAlt }]}>
              {(['all', ...CATEGORIES] as Section[]).map((key) => {
                const selected = section === key;
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    onPress={() => setSection(key)}
                    style={[styles.section, selected && { backgroundColor: c.card }]}>
                    {key !== 'all' ? <Ionicons name={CATEGORY_ICONS[key]} size={16} color={selected ? c.primary : c.muted} /> : null}
                    <Text style={[styles.sectionText, { color: selected ? c.primary : c.muted }]}>{key === 'all' ? 'الكل' : CATEGORY_LABELS[key]}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={[styles.search, { backgroundColor: c.card, borderColor: c.border }]}>
              <Ionicons name="search" size={18} color={c.muted} />
              <TextInput value={query} onChangeText={setQuery} placeholder="دوّر بالاسم أو بمكوّن…" placeholderTextColor={c.muted} style={[styles.input, { color: c.text }]} />
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
            onPress={() => router.push({ pathname: '/darwish/[id]', params: { id: item.id } })}
          />
        )}
        ListEmptyComponent={<EmptyState icon="search-outline" title="مفيش نتايج" />}
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: { padding: space.lg, gap: space.md, paddingBottom: 40, maxWidth: 720, width: '100%', alignSelf: 'center' },
  sections: { flexDirection: 'row', borderRadius: radius.md, padding: 4, gap: 4 },
  section: { flexGrow: 1, flexShrink: 0, flexBasis: 'auto', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 40, borderRadius: radius.sm, paddingHorizontal: 8 },
  sectionText: { fontSize: 13, fontWeight: '800' },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.lg, minHeight: 46 },
  input: { flex: 1, fontSize: 16, paddingVertical: 10 },
});
