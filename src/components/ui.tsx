import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { radius, space, useTheme } from '../theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

type ButtonProps = {
  label: string;
  onPress?: () => void;
  icon?: IconName;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  big?: boolean;
};

export function Button({ label, onPress, icon, variant = 'primary', loading, disabled, style, big }: ButtonProps) {
  const c = useTheme();
  const bg = { primary: c.primary, secondary: c.primarySoft, ghost: 'transparent', danger: 'transparent' }[variant];
  const fg = { primary: c.primaryText, secondary: c.primary, ghost: c.primary, danger: c.danger }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        big && styles.buttonBig,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'danger' && { borderWidth: 1, borderColor: c.danger },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={big ? 26 : 18} color={fg} /> : null}
          <Text style={[styles.buttonText, big && styles.buttonTextBig, { color: fg }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName }) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.chip,
        { backgroundColor: selected ? c.primary : c.card, borderColor: selected ? c.primary : c.border },
      ]}>
      {icon ? <Ionicons name={icon} size={15} color={selected ? c.primaryText : c.muted} /> : null}
      <Text style={[styles.chipText, { color: selected ? c.primaryText : c.text }]}>{label}</Text>
    </Pressable>
  );
}

export function Badge({ label, tone = 'primary' }: { label: string; tone?: 'primary' | 'accent' | 'muted' }) {
  const c = useTheme();
  const colors = {
    primary: [c.primarySoft, c.primary],
    accent: [c.accentSoft, c.accent],
    muted: [c.cardAlt, c.muted],
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: colors[0] }]}>
      <Text style={[styles.badgeText, { color: colors[1] }]}>{label}</Text>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useTheme();
  return <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }, style]}>{children}</View>;
}

export function RecipeImage({
  uri,
  height = 200,
  rounded = true,
  iconSize = 48,
  icon = 'restaurant',
}: {
  uri?: string;
  height?: number;
  rounded?: boolean;
  iconSize?: number;
  icon?: IconName;
}) {
  const c = useTheme();
  const shape = { height, borderRadius: rounded ? radius.md : 0 };
  if (uri) {
    return <Image source={{ uri }} style={[styles.image, shape, { backgroundColor: c.cardAlt }]} resizeMode="cover" accessibilityIgnoresInvertColors />;
  }
  return (
    <View style={[styles.image, styles.placeholder, shape, { backgroundColor: c.cardAlt }]}>
      <Ionicons name={icon} size={iconSize} color={c.primary} style={{ opacity: 0.6 }} />
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const c = useTheme();
  return <Text style={[styles.sectionTitle, { color: c.text }]}>{children}</Text>;
}

export function Muted({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const c = useTheme();
  return <Text style={[styles.muted, { color: c.muted }, style]}>{children}</Text>;
}

export function EmptyState({ icon, title, message, action }: { icon: IconName; title: string; message?: string; action?: ReactNode }) {
  const c = useTheme();
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={52} color={c.primary} style={{ opacity: 0.7 }} />
      <Text style={[styles.emptyTitle, { color: c.text }]}>{title}</Text>
      {message ? <Text style={[styles.muted, { color: c.muted, textAlign: 'center' }]}>{message}</Text> : null}
      {action}
    </View>
  );
}

export function Meta({ icon, label }: { icon: IconName; label: string }) {
  const c = useTheme();
  return (
    <View style={styles.meta}>
      <Ionicons name={icon} size={15} color={c.muted} />
      <Text style={[styles.metaText, { color: c.muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    minHeight: 46,
    borderRadius: radius.pill,
  },
  buttonBig: { minHeight: 64, paddingHorizontal: space.xl },
  buttonText: { fontSize: 16, fontWeight: '700' },
  buttonTextBig: { fontSize: 20, fontWeight: '800' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    minHeight: 38,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipText: { fontSize: 15, fontWeight: '600' },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '700' },
  card: { borderRadius: radius.lg, borderWidth: 1, padding: space.lg, gap: space.md },
  image: { width: '100%' },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 18, fontWeight: '800' },
  muted: { fontSize: 14, lineHeight: 21 },
  empty: { alignItems: 'center', gap: space.md, padding: space.xl, paddingTop: 60 },
  emptyTitle: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13 },
});
