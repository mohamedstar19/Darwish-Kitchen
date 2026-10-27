import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radius, space, useTheme } from '../theme';
import { MEAL_LABELS, type MealType } from '../types';
import { Meta, RecipeImage } from './ui';

type Props = {
  title: string;
  image?: string;
  mealTypes?: MealType[];
  subtitle?: string;
  minutes?: number;
  favorite?: boolean;
  onPress: () => void;
};

export function RecipeListItem({ title, image, mealTypes, subtitle, minutes, favorite, onPress }: Props) {
  const c = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.item, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.85 : 1 }]}>
      <View style={styles.thumb}>
        <RecipeImage uri={image} height={84} iconSize={28} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? <Text style={{ color: c.muted, fontSize: 13 }} numberOfLines={1}>{subtitle}</Text> : null}
        <View style={styles.metaRow}>
          {mealTypes?.length ? <Meta icon="time-outline" label={mealTypes.map((m) => MEAL_LABELS[m]).join(' • ')} /> : null}
          {minutes ? <Meta icon="hourglass-outline" label={`${minutes} دقيقة`} /> : null}
        </View>
      </View>
      {favorite ? <Ionicons name="heart" size={18} color={c.primary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: radius.md, borderWidth: 1 },
  thumb: { width: 96 },
  body: { flex: 1, gap: 4 },
  title: { fontSize: 16, fontWeight: '700' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
});
