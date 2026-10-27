import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { RecipeListItem } from '../../components/RecipeListItem';
import { Button, Card, Chip, EmptyState, Muted } from '../../components/ui';
import { aiSearch } from '../../lib/ai-search';
import { useAuth } from '../../lib/auth-context';
import { CATEGORY_AR, searchWebRecipes } from '../../lib/mealdb';
import { rememberWebRecipe } from '../../lib/web-recipes';
import { radius, space, useTheme } from '../../theme';
import { CATEGORIES, CATEGORY_ICONS, CATEGORY_LABELS, type RecipeCategory, type WebRecipe } from '../../types';

const IDEAS = ['ملوخية', 'محشي ورق عنب', 'كبسة فراخ', 'بسبوسة', 'عصير مانجو', 'سموزي فراولة', 'شوربة عدس', 'chicken curry'];

type AiState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; recipes: WebRecipe[]; remaining: number | null }
  | { status: 'error'; code: string };

const AI_ERRORS: Record<string, string> = {
  'ai-daily-limit': 'خلّصت عدد البحث بالذكاء الاصطناعي النهارده. جرّب بكرة 🙏',
  'ai-unavailable': 'البحث بالذكاء الاصطناعي مش متاح دلوقتي.',
  network: 'مفيش إنترنت. اتأكد من الاتصال وجرب تاني.',
};

/** "من النت": AI search across many recipe sites (Arabic), plus TheMealDB. */
export default function DiscoverScreen() {
  const c = useTheme();
  const { auth } = useAuth();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<RecipeCategory | undefined>();
  const [ai, setAi] = useState<AiState>({ status: 'idle' });
  const [mealdb, setMealdb] = useState<WebRecipe[] | null>(null);
  const [mealdbLoading, setMealdbLoading] = useState(false);
  const [searched, setSearched] = useState('');
  const request = useRef(0);

  const search = async (q = query) => {
    const term = q.trim();
    if (term.length < 2) return;
    const id = ++request.current;
    setSearched(term);
    setMealdb(null);

    // Free source: TheMealDB (English names work best).
    setMealdbLoading(true);
    searchWebRecipes(term)
      .then((list) => {
        if (id !== request.current) return;
        list.forEach(rememberWebRecipe);
        setMealdb(list);
      })
      .catch(() => id === request.current && setMealdb([]))
      .finally(() => id === request.current && setMealdbLoading(false));

    // AI: many recipe sites, written in Arabic. Needs a login.
    if (!auth) {
      setAi({ status: 'idle' });
      return;
    }
    setAi({ status: 'loading' });
    try {
      const res = await aiSearch(term, category, () => id === request.current);
      if (id !== request.current) return;
      res.recipes.forEach(rememberWebRecipe);
      setAi({ status: 'done', recipes: res.recipes, remaining: res.remaining });
    } catch (e) {
      if (id === request.current) setAi({ status: 'error', code: (e as { code?: string }).code ?? '' });
    }
  };

  const open = (r: WebRecipe) => router.push({ pathname: '/online/[id]', params: { id: r.webId } });

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Muted>اكتب اسم أي أكلة أو مشروب بالعربي أو بالإنجليزي، والذكاء الاصطناعي هيدوّر في مواقع طبخ كتير ويجيبلك الوصفات بالعربي ✨</Muted>
      <View style={[styles.search, { backgroundColor: c.card, borderColor: c.border }]}>
        <Ionicons name="sparkles" size={18} color={c.primary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => search()}
          placeholder="مثلاً: ملوخية، كيكة شوكولاتة، عصير جوافة"
          placeholderTextColor={c.muted}
          returnKeyType="search"
          style={[styles.input, { color: c.text }]}
        />
      </View>
      <View style={styles.chips}>
        <Chip label="الكل" selected={!category} onPress={() => setCategory(undefined)} />
        {CATEGORIES.map((k) => (
          <Chip key={k} label={CATEGORY_LABELS[k]} icon={CATEGORY_ICONS[k]} selected={category === k} onPress={() => setCategory(k)} />
        ))}
      </View>
      <Button label="دوّر" icon="search" onPress={() => search()} loading={ai.status === 'loading'} disabled={query.trim().length < 2} />
      {!searched ? (
        <View style={styles.chips}>
          {IDEAS.map((idea) => (
            <Chip
              key={idea}
              label={idea}
              onPress={() => {
                setQuery(idea);
                search(idea);
              }}
            />
          ))}
        </View>
      ) : null}

      {searched ? (
        <>
          {/* AI results from many sites */}
          <View style={{ gap: space.md }}>
            <Text style={[styles.section, { color: c.text }]}>✨ من مواقع طبخ كتير</Text>
            {!auth ? (
              <Card>
                <Muted>سجّل برقم موبايلك علشان الذكاء الاصطناعي يدوّرلك في مواقع الطبخ العربي والأجنبي ويكتبلك الوصفات بالعربي.</Muted>
                <Button label="سجّل برقم الموبايل" icon="phone-portrait-outline" variant="secondary" onPress={() => router.push('/account')} />
              </Card>
            ) : ai.status === 'loading' ? (
              <Card style={{ alignItems: 'center' }}>
                <ActivityIndicator color={c.primary} />
                <Muted style={{ textAlign: 'center' }}>بندوّر في مواقع الطبخ ونكتبلك الوصفات بالعربي… ممكن ياخد دقيقة.</Muted>
              </Card>
            ) : ai.status === 'error' ? (
              <Card style={{ borderColor: c.danger }}>
                <Text style={{ color: c.danger, fontWeight: '600' }}>{AI_ERRORS[ai.code] ?? 'حصلت مشكلة في البحث. جرب تاني بعد شوية.'}</Text>
              </Card>
            ) : ai.status === 'done' ? (
              ai.recipes.length ? (
                <>
                  {ai.recipes.map((r) => (
                    <RecipeListItem
                      key={r.webId}
                      title={r.title}
                      image={r.image}
                      category={r.ai?.category}
                      mealTypes={r.ai?.category === 'food' ? r.ai.mealTypes : undefined}
                      minutes={r.ai?.prepMinutes ?? undefined}
                      subtitle={`🌐 ${r.ai?.sourceName ?? ''}`}
                      onPress={() => open(r)}
                    />
                  ))}
                  {ai.remaining !== null ? <Muted style={{ fontSize: 12 }}>{`فاضلك ${ai.remaining} بحث بالذكاء الاصطناعي النهارده.`}</Muted> : null}
                </>
              ) : (
                <Muted>ملقيناش وصفات مناسبة. جرّب اسم تاني.</Muted>
              )
            ) : null}
          </View>

          {/* TheMealDB (free, English) */}
          <View style={{ gap: space.md }}>
            <Text style={[styles.section, { color: c.text }]}>من TheMealDB (بالإنجليزي)</Text>
            {mealdbLoading ? (
              <ActivityIndicator color={c.primary} />
            ) : mealdb?.length ? (
              mealdb.map((r) => (
                <RecipeListItem
                  key={r.webId}
                  title={r.title}
                  image={r.image}
                  subtitle={[r.category && (CATEGORY_AR[r.category] ?? r.category), r.area].filter(Boolean).join(' • ')}
                  onPress={() => open(r)}
                />
              ))
            ) : (
              <Muted>مفيش نتايج هنا. الموقع ده بيفهم الأسماء الإنجليزي بس (مثلاً chicken).</Muted>
            )}
          </View>
        </>
      ) : (
        <EmptyState icon="globe-outline" title="دوّر على أي أكلة" message="هنجيبلك وصفات من مصادر كتير على النت." />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.lg, gap: space.lg, paddingBottom: 40, maxWidth: 720, width: '100%', alignSelf: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.lg, minHeight: 50 },
  input: { flex: 1, fontSize: 16, paddingVertical: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  section: { fontSize: 18, fontWeight: '800' },
});
