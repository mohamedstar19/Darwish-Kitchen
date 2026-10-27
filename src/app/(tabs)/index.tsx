import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge, Button, Card, Chip, Meta, Muted, RecipeImage } from '../../components/ui';
import { CATEGORY_AR } from '../../lib/mealdb';
import { DarwishSlider } from '../../components/DarwishSlider';
import { useActivity } from '../../lib/activity-context';
import { aiErrorMessage } from '../../lib/ai-tools';
import { useAuth } from '../../lib/auth-context';
import { useDarwish } from '../../lib/darwish-context';
import { useRecipes } from '../../lib/recipes-context';
import { smartSuggest, suggestMeal, type SuggestSource, type Suggestion } from '../../lib/suggest';
import { rememberWebRecipe, webToRecipeInput } from '../../lib/web-recipes';
import { notify } from '../../lib/confirm';
import { radius, space, useTheme } from '../../theme';
import { CATEGORY_ICONS, CATEGORY_LABELS, categoryOf, MEAL_LABELS, MEAL_TYPES, mealTypeForNow, type MealType, type RecipeCategory } from '../../types';

const MEAL_ICONS = { breakfast: 'cafe', lunch: 'restaurant', dinner: 'moon' } as const;

const DRINK_SECTIONS: { key: RecipeCategory; hint: string }[] = [
  { key: 'healthy-drink', hint: 'ينسون، كركديه، جنزبيل…' },
  { key: 'juice', hint: 'برتقال، مانجو، ليمون بالنعناع…' },
];

const SOURCES: { key: SuggestSource; label: string }[] = [
  { key: 'smart', label: '✨ ذكي' },
  { key: 'all', label: 'الاتنين' },
  { key: 'mine', label: 'من التطبيق' },
  { key: 'web', label: 'من النت' },
];

function greeting() {
  const h = new Date().getHours();
  return h >= 4 && h < 12 ? 'صباح الخير' : 'مساء الخير';
}

export default function HomeScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { recipes, addRecipe } = useRecipes();
  const darwish = useDarwish();
  const { auth } = useAuth();
  const { activity } = useActivity();
  const [meal, setMeal] = useState<MealType>(mealTypeForNow());
  const [source, setSource] = useState<SuggestSource>(() => (auth ? 'smart' : 'all'));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recent = useRef<string[]>([]);
  const pickedSource = useRef(false);

  // The login loads after the first render: default to the smart suggestion once we know the user is signed in.
  useEffect(() => {
    if (auth && !pickedSource.current) setSource('smart');
  }, [auth]);

  const ask = async () => {
    setError(null);
    if (source === 'smart' && !auth) {
      setSuggestion(null);
      setError('login');
      return;
    }
    setLoading(true);
    try {
      const pool = { mine: recipes, darwish: darwish.recipes };
      const result =
        source === 'smart' ? await smartSuggest(meal, pool, activity, recent.current) : await suggestMeal(meal, source, pool, recent.current);
      const id = result.kind === 'web' ? result.recipe.webId : result.recipe.id;
      recent.current = [id, ...recent.current].slice(0, 5);
      if (result.kind === 'web') rememberWebRecipe(result.recipe);
      setSuggestion(result);
    } catch (e) {
      setSuggestion(null);
      const msg = e instanceof Error ? e.message : '';
      setError(
        msg === 'no-local'
          ? `مفيش وصفات ${MEAL_LABELS[meal]} في وصفاتك لسه. ضيف وصفة أو اختار "من النت".`
          : source === 'smart'
            ? aiErrorMessage(e)
            : 'مقدرناش نجيب اقتراح من النت. اتأكد من الإنترنت وجرب تاني.',
      );
    } finally {
      setLoading(false);
    }
  };

  const savedWeb =
    suggestion?.kind === 'web' ? recipes.find((r) => r.webId === suggestion.recipe.webId) : undefined;

  const saveWeb = async () => {
    if (suggestion?.kind !== 'web') return;
    setSaving(true);
    try {
      await addRecipe(webToRecipeInput(suggestion.recipe, meal));
    } catch {
      notify('مقدرناش نحفظ الوصفة', 'مساحة التخزين ممكن تكون مليانة.');
    } finally {
      setSaving(false);
    }
  };

  const open = () => {
    if (!suggestion) return;
    if (suggestion.kind === 'local') router.push({ pathname: '/recipe/[id]', params: { id: suggestion.recipe.id } });
    else if (suggestion.kind === 'darwish') router.push({ pathname: '/darwish/[id]', params: { id: suggestion.recipe.id } });
    else router.push({ pathname: '/online/[id]', params: { id: suggestion.recipe.webId, meal } });
  };

  return (
    <ScrollView
      style={{ backgroundColor: c.background }}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + space.lg }]}>
      <View style={styles.header}>
        <Image source={require('../../../assets/logo.png')} style={styles.logo} accessibilityLabel="Darwish Kitchen" />
        <View style={{ flex: 1 }}>
          <Text style={[styles.appName, { color: c.text }]}>Darwish Kitchen</Text>
          <Muted>{greeting()} 👋 يلا نختار أكلة النهارده</Muted>
        </View>
      </View>

      <DarwishSlider />

      <Card>
        <Text style={[styles.label, { color: c.text }]}>الوجبة</Text>
        <View style={styles.chips}>
          {MEAL_TYPES.map((m) => (
            <Chip key={m} label={MEAL_LABELS[m]} icon={MEAL_ICONS[m]} selected={meal === m} onPress={() => setMeal(m)} />
          ))}
        </View>
        <Text style={[styles.label, { color: c.text }]}>نقترح منين؟</Text>
        <View style={styles.chips}>
          {SOURCES.map((s) => (
            <Chip
              key={s.key}
              label={s.label}
              selected={source === s.key}
              onPress={() => {
                pickedSource.current = true;
                setSource(s.key);
              }}
            />
          ))}
        </View>
      </Card>

      <Button big icon={source === 'smart' ? 'sparkles' : 'dice'} label="حناكل إيه النهارده؟" onPress={ask} loading={loading} />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="عندي في التلاجة"
        onPress={() => router.push('/ai/fridge')}
        style={({ pressed }) => [styles.fridge, { backgroundColor: c.accentSoft, borderColor: c.border, opacity: pressed ? 0.85 : 1 }]}>
        <Text style={styles.fridgeEmoji}>🧊</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.tileTitle, { color: c.text }]}>عندي في التلاجة…</Text>
          <Muted style={{ fontSize: 13 }}>اكتب أو صوّر اللي عندك، والذكاء الاصطناعي يقولك تعمل إيه</Muted>
        </View>
        <Ionicons name="chevron-back" size={20} color={c.muted} />
      </Pressable>

      {error === 'login' ? (
        <Card>
          <Muted>الاقتراح الذكي بيختارلك على ذوقك (اللي عجبك وقيّمته واللي شفته قريب) وعلى حسب الوقت واليوم. محتاج تسجّل برقم موبايلك الأول.</Muted>
          <Button label="سجّل برقم الموبايل" icon="phone-portrait-outline" variant="secondary" onPress={() => router.push('/account')} />
        </Card>
      ) : error ? (
        <Card style={{ borderColor: c.danger }}>
          <Text style={{ color: c.danger, fontSize: 15, lineHeight: 23 }}>{error}</Text>
        </Card>
      ) : null}

      {suggestion ? (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <RecipeImage uri={suggestion.recipe.image} height={220} rounded={false} />
          <View style={styles.resultBody}>
            <View style={styles.chips}>
              <Badge label={`${MEAL_LABELS[meal]} النهارده`} />
              <Badge
                label={
                  suggestion.kind === 'local'
                    ? 'من وصفاتي'
                    : suggestion.kind === 'darwish'
                      ? 'من مطبخ درويش'
                      : suggestion.kind === 'web' && suggestion.recipe.ai?.generated
                        ? '✨ فكرة جديدة'
                        : 'من النت'
                }
                tone={suggestion.kind === 'web' ? 'muted' : 'accent'}
              />
            </View>
            <Text style={[styles.resultTitle, { color: c.text }]}>{suggestion.recipe.title}</Text>
            {suggestion.reason ? (
              <View style={[styles.reason, { backgroundColor: c.primarySoft }]}>
                <Ionicons name="sparkles" size={16} color={c.primary} />
                <Text style={[styles.reasonText, { color: c.text }]}>{suggestion.reason}</Text>
              </View>
            ) : null}
            <View style={styles.chips}>
              {suggestion.kind !== 'web' && suggestion.recipe.prepMinutes ? (
                <Meta icon="hourglass-outline" label={`${suggestion.recipe.prepMinutes} دقيقة`} />
              ) : null}
              {suggestion.kind === 'web' && !suggestion.recipe.ai && suggestion.recipe.category ? (
                <Meta icon="pricetag-outline" label={CATEGORY_AR[suggestion.recipe.category] ?? suggestion.recipe.category} />
              ) : null}
              <Meta icon="list-outline" label={`${suggestion.recipe.ingredients.length} مكون`} />
            </View>
            {suggestion.kind === 'web' && !suggestion.recipe.ai ? <Muted>الوصفة دي من موقع TheMealDB ومكتوبة بالإنجليزي.</Muted> : null}
            <View style={styles.actions}>
              <Button label="شوف الوصفة" icon="book-outline" onPress={open} style={{ flex: 1 }} />
              <Button label="غيرها" icon="refresh" variant="secondary" onPress={ask} loading={loading} style={{ flex: 1 }} />
            </View>
            {suggestion.kind === 'web' ? (
              savedWeb ? (
                <Button label="محفوظة في وصفاتي" icon="checkmark-circle" variant="ghost" onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: savedWeb.id } })} />
              ) : (
                <Button label="احفظها في وصفاتي" icon="bookmark-outline" variant="ghost" onPress={saveWeb} loading={saving} />
              )
            ) : null}
          </View>
        </Card>
      ) : !error && !loading ? (
        <View style={[styles.hint, { borderColor: c.border }]}>
          <Ionicons name="sparkles-outline" size={28} color={c.primary} />
          <Muted style={{ textAlign: 'center' }}>
            {source === 'smart'
              ? 'اختار الوجبة ودوس على الزرار، والذكاء الاصطناعي يختارلك أكلة على ذوقك وعلى حسب الوقت، ويقولك ليه.'
              : 'اختار الوجبة ودوس على الزرار، وإحنا نقترح عليك أكلة من وصفاتك ومطبخ درويش أو من النت.'}
          </Muted>
        </View>
      ) : null}

      <View style={{ gap: space.sm }}>
        <Text style={[styles.label, { color: c.text, fontSize: 18 }]}>عايز تشرب حاجة؟</Text>
        <View style={styles.actions}>
          {DRINK_SECTIONS.map(({ key, hint }) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={CATEGORY_LABELS[key]}
              onPress={() => router.push({ pathname: '/darwish', params: { section: key } })}
              style={({ pressed }) => [styles.tile, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.85 : 1 }]}>
              <View style={[styles.tileIcon, { backgroundColor: key === 'juice' ? c.primarySoft : c.accentSoft }]}>
                <Ionicons name={CATEGORY_ICONS[key]} size={24} color={key === 'juice' ? c.primary : c.accent} />
              </View>
              <Text style={[styles.tileTitle, { color: c.text }]}>{CATEGORY_LABELS[key]}</Text>
              <Muted style={{ fontSize: 12 }}>{`${darwish.recipes.filter((r) => categoryOf(r) === key).length} وصفة • ${hint}`}</Muted>
            </Pressable>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.lg, gap: space.lg, paddingBottom: 40, maxWidth: 720, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  logo: { width: 56, height: 56, borderRadius: radius.md },
  appName: { fontSize: 26, fontWeight: '900' },
  label: { fontSize: 15, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  resultBody: { padding: space.lg, gap: space.md },
  resultTitle: { fontSize: 22, fontWeight: '900' },
  actions: { flexDirection: 'row', gap: space.sm },
  tile: { flex: 1, borderWidth: 1, borderRadius: radius.lg, padding: space.md, gap: 6 },
  tileIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  tileTitle: { fontSize: 16, fontWeight: '800' },
  reason: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', borderRadius: radius.md, padding: space.md },
  reasonText: { flex: 1, fontSize: 15, lineHeight: 23 },
  fridge: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderWidth: 1, borderRadius: radius.lg, padding: space.md },
  fridgeEmoji: { fontSize: 30 },
  hint: { borderWidth: 1, borderStyle: 'dashed', borderRadius: radius.lg, padding: space.xl, alignItems: 'center', gap: space.sm },
});
