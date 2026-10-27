import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Image, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { RecipeListItem } from '../../components/RecipeListItem';
import { Button, Card, Chip, Muted } from '../../components/ui';
import { aiErrorMessage, aiFridge, pickPhotoForAi, type FridgeResult } from '../../lib/ai-tools';
import { useAuth } from '../../lib/auth-context';
import { notify } from '../../lib/confirm';
import type { ImageSource } from '../../lib/images';
import { rememberWebRecipe } from '../../lib/web-recipes';
import { radius, space, useTheme } from '../../theme';
import { CATEGORIES, CATEGORY_ICONS, CATEGORY_LABELS, type RecipeCategory } from '../../types';

const QUICK = ['بيض', 'طماطم', 'بطاطس', 'فراخ', 'لحمة مفرومة', 'رز', 'مكرونة', 'جبنة', 'لبن', 'فول', 'عدس', 'كوسة', 'باذنجان', 'موز', 'برتقال', 'فراولة'];

/** "عندي في التلاجة…": the user types or photographs what they have; the AI suggests dishes. */
export default function FridgeScreen() {
  const c = useTheme();
  const { auth } = useAuth();
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<{ uri: string; base64: string } | null>(null);
  const [category, setCategory] = useState<RecipeCategory | undefined>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FridgeResult | null>(null);
  const [error, setError] = useState('');
  const request = useRef(0);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const resultsY = useRef(0);

  // Bring the answer into view when it arrives (it's below the form on a phone).
  useEffect(() => {
    if (result || busy) setTimeout(() => scroll.current?.scrollTo({ y: Math.max(0, resultsY.current - space.lg), animated: true }), 50);
  }, [result, busy]);

  const addQuick = (item: string) => setText((t) => (t.trim() ? `${t.trim().replace(/[،,]$/, '')}، ${item}` : item));

  const takePhoto = async (source: ImageSource) => {
    try {
      const p = await pickPhotoForAi(source);
      if (p) setPhoto(p);
    } catch (e) {
      notify('مقدرناش نضيف الصورة', (e as Error).message.endsWith('permission') ? 'محتاجين إذن الوصول للكاميرا أو الصور من إعدادات الموبايل.' : 'جرّب صورة تانية.');
    }
  };

  const ask = async () => {
    if (!text.trim() && !photo) return setError('اكتب المكونات اللي عندك أو صوّرها.');
    const id = ++request.current;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const res = await aiFridge({ ingredients: text.trim(), image: photo?.base64, category }, () => id === request.current);
      if (id !== request.current) return;
      res.recipes.forEach(rememberWebRecipe);
      setResult(res);
    } catch (e) {
      if (id === request.current) setError(aiErrorMessage(e));
    } finally {
      if (id === request.current) setBusy(false);
    }
  };

  if (!auth) {
    return (
      <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.container}>
        <Text style={styles.hero}>🧊</Text>
        <Card>
          <Text style={[styles.title, { color: c.text }]}>عندي في التلاجة…</Text>
          <Muted>اكتب أو صوّر الحاجات اللي عندك في المطبخ، والذكاء الاصطناعي يقترح عليك أكلات تعملها بيها دلوقتي. محتاج تسجّل برقم موبايلك الأول.</Muted>
          <Button label="سجّل برقم الموبايل" icon="phone-portrait-outline" onPress={() => router.push('/account')} />
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView ref={scroll} style={{ backgroundColor: c.background }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Muted>اكتب الحاجات اللي عندك أو صوّر التلاجة، وإحنا نقولك تعمل إيه ✨</Muted>

      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        placeholder="مثلاً: بيض، طماطم، فلفل، جبنة رومي"
        placeholderTextColor={c.muted}
        style={[styles.input, { backgroundColor: c.card, borderColor: c.border, color: c.text }]}
      />
      <View style={styles.chips}>
        {QUICK.map((item) => (
          <Chip key={item} label={`+ ${item}`} onPress={() => addQuick(item)} />
        ))}
      </View>

      {photo ? (
        <View style={{ gap: space.sm }}>
          <Image source={{ uri: photo.uri }} style={[styles.photo, { borderColor: c.border }]} resizeMode="cover" accessibilityLabel="صورة المكونات" />
          <Button label="شيل الصورة" icon="trash-outline" variant="ghost" onPress={() => setPhoto(null)} />
        </View>
      ) : (
        <View style={styles.row}>
          {Platform.OS !== 'web' ? <Button label="صوّر التلاجة" icon="camera-outline" variant="secondary" onPress={() => takePhoto('camera')} style={{ flex: 1 }} /> : null}
          <Button
            label={Platform.OS === 'web' ? 'صوّر أو اختار صورة' : 'من الصور'}
            icon="images-outline"
            variant="secondary"
            onPress={() => takePhoto('library')}
            style={{ flex: 1 }}
          />
        </View>
      )}

      <View style={styles.chips}>
        <Chip label="أي حاجة" selected={!category} onPress={() => setCategory(undefined)} />
        {CATEGORIES.map((k) => (
          <Chip key={k} label={CATEGORY_LABELS[k]} icon={CATEGORY_ICONS[k]} selected={category === k} onPress={() => setCategory(k)} />
        ))}
      </View>

      <Button big icon="sparkles" label="اقترح عليا أعمل إيه" onPress={ask} loading={busy} />
      <View onLayout={(e) => (resultsY.current = e.nativeEvent.layout.y)} />

      {error ? (
        <Card style={{ borderColor: c.danger }}>
          <Text style={{ color: c.danger, fontWeight: '600' }}>{error}</Text>
        </Card>
      ) : null}

      {busy ? (
        <Card style={{ alignItems: 'center' }}>
          <ActivityIndicator color={c.primary} />
          <Muted style={{ textAlign: 'center' }}>بنفكّر في أكلات تنفع باللي عندك… ممكن ياخد نص دقيقة.</Muted>
        </Card>
      ) : null}

      {result ? (
        <View style={{ gap: space.md }}>
          {result.seen.length ? (
            <View style={{ gap: space.sm }}>
              <Text style={[styles.section, { color: c.text }]}>اللي فهمناه إن عندك</Text>
              <View style={styles.chips}>
                {result.seen.map((s) => (
                  <View key={s} style={[styles.tag, { backgroundColor: c.accentSoft }]}>
                    <Text style={{ color: c.text, fontSize: 13 }}>{s}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
          <Text style={[styles.section, { color: c.text }]}>تقدر تعمل</Text>
          {result.recipes.length ? (
            result.recipes.map((r) => (
              <RecipeListItem
                key={r.webId}
                title={r.title}
                category={r.ai?.category}
                mealTypes={r.ai?.category === 'food' ? r.ai.mealTypes : undefined}
                minutes={r.ai?.prepMinutes ?? undefined}
                subtitle={r.ai?.missing?.length ? `ناقصك: ${r.ai.missing.join('، ')}` : 'عندك كل حاجة ✅'}
                onPress={() => router.push({ pathname: '/online/[id]', params: { id: r.webId } })}
              />
            ))
          ) : (
            <Muted>ملقيناش أكلات مناسبة. جرّب تكتب المكونات بالتفصيل أو صورة أوضح.</Muted>
          )}
          {result.remaining !== null ? <Muted style={{ fontSize: 12 }}>{`فاضلك ${result.remaining} مرة بالذكاء الاصطناعي النهارده.`}</Muted> : null}
          <View style={[styles.note, { borderColor: c.border }]}>
            <Ionicons name="information-circle-outline" size={18} color={c.muted} />
            <Muted style={{ flex: 1, fontSize: 12 }}>الوصفات دي كتبها الذكاء الاصطناعي. ذوقها وعدّل المقادير على مزاجك.</Muted>
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.lg, gap: space.lg, paddingBottom: 48, maxWidth: 720, width: '100%', alignSelf: 'center' },
  hero: { fontSize: 64, textAlign: 'center' },
  title: { fontSize: 20, fontWeight: '900' },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12, fontSize: 16, minHeight: 90, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  row: { flexDirection: 'row', gap: space.sm },
  photo: { width: '100%', height: 220, borderRadius: radius.lg, borderWidth: 1 },
  section: { fontSize: 18, fontWeight: '800' },
  tag: { borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6 },
  note: { flexDirection: 'row', gap: space.sm, alignItems: 'center', borderWidth: 1, borderStyle: 'dashed', borderRadius: radius.md, padding: space.md },
});
