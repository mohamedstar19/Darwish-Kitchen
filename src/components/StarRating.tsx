import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';

/** 1–5 stars. Tapping the current rating again clears it. Read-only when `onChange` is missing. */
export function StarRating({ value, onChange, size = 28 }: { value: number; onChange?: (stars: number) => void; size?: number }) {
  const c = useTheme();
  return (
    <View style={styles.row} accessibilityRole={onChange ? 'adjustable' : undefined} accessibilityLabel={`التقييم ${value} من 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          disabled={!onChange}
          onPress={() => onChange?.(n === value ? 0 : n)}
          accessibilityLabel={`${n} نجوم`}
          hitSlop={4}>
          <Ionicons name={n <= value ? 'star' : 'star-outline'} size={size} color={n <= value ? '#F59E0B' : c.muted} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', gap: 4 } });
