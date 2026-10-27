import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useDarwish } from '../lib/darwish-context';
import { radius, space, useTheme } from '../theme';
import { CATEGORY_ICONS, CATEGORY_LABELS_ONE, categoryOf, MEAL_LABELS } from '../types';
import { RecipeImage } from './ui';

const AUTO_MS = 4500;
const PAUSE_AFTER_SWIPE_MS = 9000;
const MAX_SLIDES = 8;

/**
 * Slideshow of Darwish recipes (ones with photos first) that advances on its own.
 * It shows one slide at a time and fades between them (no horizontal scrolling, which misbehaves
 * in right-to-left layouts on the web). Swipe to move; in RTL, swiping toward the right goes forward.
 */
export function DarwishSlider() {
  const c = useTheme();
  const { recipes } = useDarwish();
  const [index, setIndex] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;
  const pausedUntil = useRef(0);
  const lastSwipe = useRef(0);

  const slides = useMemo(() => [...recipes].sort((a, b) => Number(!!b.image) - Number(!!a.image)).slice(0, MAX_SLIDES), [recipes]);
  const count = slides.length;
  const current = slides[index % Math.max(count, 1)];

  const go = (step: number) => {
    if (count < 2) return;
    Animated.timing(fade, { toValue: 0, duration: 160, useNativeDriver: false }).start(() => {
      setIndex((i) => (i + step + count) % count);
      Animated.timing(fade, { toValue: 1, duration: 260, useNativeDriver: false }).start();
    });
  };
  const goRef = useRef(go);
  goRef.current = go;

  useEffect(() => {
    if (count < 2) return;
    const t = setInterval(() => {
      if (Date.now() >= pausedUntil.current) goRef.current(1);
    }, AUTO_MS);
    return () => clearInterval(t);
  }, [count]);

  useEffect(() => {
    if (index >= count && count) setIndex(0);
  }, [index, count]);

  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_, g) => {
          lastSwipe.current = Date.now(); // the press that ends a swipe must not open the recipe
          if (Math.abs(g.dx) < 40) return;
          pausedUntil.current = Date.now() + PAUSE_AFTER_SWIPE_MS;
          goRef.current(g.dx > 0 ? 1 : -1);
        },
      }),
    [],
  );

  if (!current) return null;
  const cat = categoryOf(current);
  const sub = cat === 'food' ? current.mealTypes.map((m) => MEAL_LABELS[m]).join(' • ') : CATEGORY_LABELS_ONE[cat];

  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.head}>
        <Text style={[styles.heading, { color: c.text }]}>من مطبخ درويش</Text>
        <Pressable onPress={() => router.push('/darwish')} accessibilityRole="link" hitSlop={8}>
          <Text style={{ color: c.primary, fontWeight: '800' }}>كل وصفات درويش</Text>
        </Pressable>
      </View>
      <View style={[styles.frame, { borderColor: c.border }]} {...swipe.panHandlers}>
        <Animated.View style={{ opacity: fade }}>
          <Pressable
            onPress={() => {
              if (Date.now() - lastSwipe.current > 400) router.push({ pathname: '/darwish/[id]', params: { id: current.id } });
            }}
            accessibilityRole="button"
            accessibilityLabel={current.title}>
            <RecipeImage uri={current.image} height={200} rounded={false} icon={CATEGORY_ICONS[cat]} iconSize={64} />
            <View style={[styles.caption, { backgroundColor: c.overlay }]}>
              <Text style={styles.captionTitle} numberOfLines={1}>
                {current.title}
              </Text>
              {sub ? <Text style={styles.captionSub}>{sub}</Text> : null}
            </View>
          </Pressable>
        </Animated.View>
      </View>
      {count > 1 ? (
        <View style={styles.dots}>
          {slides.map((s, i) => (
            <Pressable
              key={s.id}
              accessibilityRole="button"
              accessibilityLabel={`الوصفة ${i + 1}: ${s.title}`}
              hitSlop={6}
              onPress={() => {
                pausedUntil.current = Date.now() + PAUSE_AFTER_SWIPE_MS;
                if (i !== index) go(i - index);
              }}>
              <View style={[styles.dot, { backgroundColor: i === index ? c.primary : c.border, width: i === index ? 18 : 7 }]} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontSize: 18, fontWeight: '800' },
  frame: { borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1 },
  caption: { position: 'absolute', start: 0, end: 0, bottom: 0, paddingHorizontal: space.lg, paddingVertical: space.md, gap: 2 },
  captionTitle: { color: '#fff', fontSize: 20, fontWeight: '900' },
  captionSub: { color: '#f5f5f5', fontSize: 13, fontWeight: '600' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { height: 7, borderRadius: 4 },
});
