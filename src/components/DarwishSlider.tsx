import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useDarwish } from '../lib/darwish-context';
import { radius, space, useTheme } from '../theme';
import { CATEGORY_ICONS, CATEGORY_LABELS_ONE, categoryOf, MEAL_LABELS, type Recipe } from '../types';
import { RecipeImage } from './ui';

const AUTO_MS = 4500;
const MAX_SLIDES = 8;

/** Slideshow of Darwish recipes (ones with photos first) that advances on its own. */
export function DarwishSlider() {
  const c = useTheme();
  const { recipes } = useDarwish();
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const list = useRef<FlatList<Recipe>>(null);
  const touching = useRef(false);

  const slides = useMemo(() => [...recipes].sort((a, b) => Number(!!b.image) - Number(!!a.image)).slice(0, MAX_SLIDES), [recipes]);

  useEffect(() => {
    if (slides.length < 2 || !width) return;
    const t = setInterval(() => {
      if (touching.current) return;
      setIndex((i) => {
        const next = (i + 1) % slides.length;
        list.current?.scrollToOffset({ offset: next * width, animated: true });
        return next;
      });
    }, AUTO_MS);
    return () => clearInterval(t);
  }, [slides.length, width]);

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width) setIndex(Math.round(Math.abs(e.nativeEvent.contentOffset.x) / width) % Math.max(slides.length, 1));
    touching.current = false;
  };

  if (!slides.length) return null;

  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.head}>
        <Text style={[styles.heading, { color: c.text }]}>من مطبخ درويش</Text>
        <Pressable onPress={() => router.push('/darwish')} accessibilityRole="link" hitSlop={8}>
          <Text style={{ color: c.primary, fontWeight: '800' }}>كل وصفات درويش</Text>
        </Pressable>
      </View>
      <View style={[styles.frame, { borderColor: c.border }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width ? (
          <FlatList
            ref={list}
            data={slides}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(r) => r.id}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            onScrollBeginDrag={() => (touching.current = true)}
            onMomentumScrollEnd={onScrollEnd}
            onScrollEndDrag={onScrollEnd}
            renderItem={({ item }) => {
              const cat = categoryOf(item);
              const sub = cat === 'food' ? item.mealTypes.map((m) => MEAL_LABELS[m]).join(' • ') : CATEGORY_LABELS_ONE[cat];
              return (
                <Pressable
                  style={{ width }}
                  onPress={() => router.push({ pathname: '/darwish/[id]', params: { id: item.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={item.title}>
                  <RecipeImage uri={item.image} height={200} rounded={false} icon={CATEGORY_ICONS[cat]} iconSize={64} />
                  <View style={[styles.caption, { backgroundColor: c.overlay }]}>
                    <Text style={styles.captionTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    {sub ? <Text style={styles.captionSub}>{sub}</Text> : null}
                  </View>
                </Pressable>
              );
            }}
          />
        ) : (
          <View style={{ height: 200 }} />
        )}
      </View>
      {slides.length > 1 ? (
        <View style={styles.dots}>
          {slides.map((s, i) => (
            <View key={s.id} style={[styles.dot, { backgroundColor: i === index ? c.primary : c.border, width: i === index ? 18 : 7 }]} />
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
