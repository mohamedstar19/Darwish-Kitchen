import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { space, useTheme } from '../theme';
import { CATEGORY_ICONS, CATEGORY_LABELS_ONE, MEAL_LABELS, type MealType, type RecipeCategory } from '../types';
import { RecipeBody } from './RecipeBody';
import { Badge, Meta, RecipeImage } from './ui';

type Props = {
  title: string;
  image?: string;
  category: RecipeCategory;
  mealTypes: MealType[];
  prepMinutes?: number | null;
  servings?: number | null;
  ingredients: string[];
  steps: string[];
  notes?: string | null;
  /** Extra badges after the category/meal badges. */
  badges?: ReactNode;
  /** Shown above the photo (e.g. the chef). */
  top?: ReactNode;
  /** Shown under the title (like/save buttons, rating). */
  actions?: ReactNode;
  /** Shown at the end (report/delete). */
  footer?: ReactNode;
};

/** Read-only recipe page used for Darwish recipes and chefs' posts. */
export function RecipeView(p: Props) {
  const c = useTheme();
  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.container}>
      {p.top}
      <RecipeImage uri={p.image} height={260} icon={CATEGORY_ICONS[p.category]} />
      <View style={{ gap: space.sm }}>
        <Text style={[styles.title, { color: c.text }]}>{p.title}</Text>
        <View style={styles.row}>
          {p.category !== 'food' ? <Badge label={CATEGORY_LABELS_ONE[p.category]} tone="accent" /> : null}
          {p.mealTypes.map((m) => (
            <Badge key={m} label={MEAL_LABELS[m]} />
          ))}
          {p.badges}
        </View>
        <View style={styles.row}>
          {p.prepMinutes ? <Meta icon="hourglass-outline" label={`${p.prepMinutes} دقيقة`} /> : null}
          {p.servings ? <Meta icon="people-outline" label={`${p.servings} ${p.category === 'food' ? 'أفراد' : 'كوباية'}`} /> : null}
        </View>
      </View>
      {p.actions}
      <RecipeBody ingredients={p.ingredients} steps={p.steps} notes={p.notes ?? undefined} />
      {p.footer}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.lg, gap: space.xl, paddingBottom: 48, maxWidth: 720, width: '100%', alignSelf: 'center' },
  title: { fontSize: 26, fontWeight: '900' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
});
