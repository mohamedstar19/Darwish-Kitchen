import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RecipeBody } from '../../components/RecipeBody';
import { StarRating } from '../../components/StarRating';
import { Badge, Button, Card, EmptyState, Meta, Muted, RecipeImage } from '../../components/ui';
import { useActivity } from '../../lib/activity-context';
import { notify } from '../../lib/confirm';
import { fetchAiRecipe, isAiId } from '../../lib/ai-search';
import { CATEGORY_AR, getWebRecipe, isAllowed } from '../../lib/mealdb';
import { useRecipes } from '../../lib/recipes-context';
import { rememberWebRecipe, webRecipeCache, webToRecipeInput } from '../../lib/web-recipes';
import { space, useTheme } from '../../theme';
import { CATEGORY_ICONS, CATEGORY_LABELS_ONE, MEAL_LABELS, MEAL_TYPES, type MealType, type WebRecipe } from '../../types';

export default function OnlineRecipeScreen() {
  const c = useTheme();
  const { id, meal } = useLocalSearchParams<{ id: string; meal?: string }>();
  const { recipes, addRecipe } = useRecipes();
  const [recipe, setRecipe] = useState<WebRecipe | null>(() => webRecipeCache.get(id) ?? null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const { isLiked, toggleLike, ratingOf, rate, recordView } = useActivity();

  useEffect(() => {
    if (recipe) recordView({ kind: 'web', id: recipe.webId, title: recipe.title, image: recipe.image });
  }, [recipe, recordView]);

  useEffect(() => {
    if (recipe) return;
    if (isAiId(id)) {
      let cancelled = false;
      fetchAiRecipe(id)
        .then((r) => {
          if (cancelled) return;
          rememberWebRecipe(r);
          setRecipe(r);
        })
        .catch(() => !cancelled && setFailed(true));
      return () => {
        cancelled = true;
      };
    }
    const ctrl = new AbortController();
    getWebRecipe(id, ctrl.signal)
      .then((r) => {
        if (r && isAllowed(r)) {
          rememberWebRecipe(r);
          setRecipe(r);
        } else setFailed(true);
      })
      .catch((e) => {
        if ((e as Error).name !== 'AbortError') setFailed(true);
      });
    return () => ctrl.abort();
  }, [id, recipe]);

  if (failed) return <EmptyState icon="cloud-offline-outline" title="مقدرناش نجيب الوصفة" message="اتأكد من الإنترنت وجرب تاني." />;
  if (!recipe) return <ActivityIndicator color={c.primary} style={{ marginTop: 60 }} />;

  const ai = recipe.ai;
  const saved = recipes.find((r) => r.webId === recipe.webId);
  const ref = { kind: 'web' as const, id: recipe.webId, title: recipe.title, image: recipe.image };
  const liked = isLiked(ref);
  const mealType = MEAL_TYPES.includes(meal as MealType) ? (meal as MealType) : undefined;

  const save = async () => {
    setSaving(true);
    try {
      const created = await addRecipe(webToRecipeInput(recipe, mealType));
      router.replace({ pathname: '/recipe/[id]', params: { id: created.id } });
    } catch {
      notify('مقدرناش نحفظ الوصفة', 'مساحة التخزين ممكن تكون مليانة.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: recipe.title }} />
      <RecipeImage uri={recipe.image} height={260} icon={ai ? CATEGORY_ICONS[ai.category] : 'restaurant'} />
      <View style={{ gap: space.sm }}>
        <Text style={[styles.title, { color: c.text }, !ai && { writingDirection: 'ltr' }]}>{recipe.title}</Text>
        <View style={styles.row}>
          {ai ? (
            <>
              {ai.category !== 'food' ? <Badge label={CATEGORY_LABELS_ONE[ai.category]} tone="accent" /> : null}
              {ai.category === 'food' ? ai.mealTypes.map((m) => <Badge key={m} label={MEAL_LABELS[m]} />) : null}
              <Badge label={ai.generated ? '✨ كتبها الذكاء الاصطناعي' : `من ${ai.sourceName}`} tone="muted" />
            </>
          ) : (
            <>
              {recipe.category ? <Badge label={CATEGORY_AR[recipe.category] ?? recipe.category} /> : null}
              {recipe.area ? <Badge label={recipe.area} tone="muted" /> : null}
              <Badge label="من النت" tone="muted" />
            </>
          )}
        </View>
        <View style={styles.row}>
          {ai?.prepMinutes ? <Meta icon="hourglass-outline" label={`${ai.prepMinutes} دقيقة`} /> : null}
          {ai?.servings ? <Meta icon="people-outline" label={`${ai.servings} ${ai.category === 'food' ? 'أفراد' : 'كوباية'}`} /> : null}
        </View>
        <Muted>
          {ai?.generated
            ? '✨ الوصفة دي فكرة من الذكاء الاصطناعي في مطبخ درويش. ذوقها وعدّل المقادير على مزاجك.'
            : ai
              ? `✨ الذكاء الاصطناعي لقى الوصفة دي على موقع ${ai.sourceName} وكتبها بالعربي. راجع المصدر الأصلي للتفاصيل.`
              : 'الوصفة من موقع TheMealDB ومكتوبة بالإنجليزي. تقدر تحفظها وتعدّلها بالعربي.'}
        </Muted>
        {ai?.missing?.length ? (
          <Card style={{ borderColor: c.primary }}>
            <Text style={{ color: c.text, fontWeight: '800' }}>هتحتاج كمان</Text>
            <Muted>{ai.missing.join('، ')}</Muted>
          </Card>
        ) : null}
      </View>

      {saved ? (
        <Button label="محفوظة في وصفاتي — افتحها" icon="checkmark-circle" variant="secondary" onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: saved.id } })} />
      ) : (
        <Button label="احفظها في وصفاتي" icon="bookmark-outline" onPress={save} loading={saving} />
      )}

      <Card style={styles.rateCard}>
        <StarRating value={ratingOf(ref)} onChange={(stars) => rate(ref, stars)} />
        <Button label={liked ? 'عجبتني' : 'أعجبني'} icon={liked ? 'heart' : 'heart-outline'} variant="ghost" onPress={() => toggleLike(ref)} />
      </Card>

      <RecipeBody ingredients={recipe.ingredients} steps={recipe.steps} notes={ai?.notes ?? undefined} ltr={!ai} />

      {recipe.youtube ? <Button label="فيديو الوصفة على يوتيوب" icon="logo-youtube" variant="ghost" onPress={() => Linking.openURL(recipe.youtube!)} /> : null}
      {recipe.sourceUrl ? (
        <Button label={ai ? `الوصفة الأصلية على ${ai.sourceName}` : 'المصدر الأصلي'} icon="open-outline" variant="ghost" onPress={() => Linking.openURL(recipe.sourceUrl!)} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.lg, gap: space.xl, paddingBottom: 48, maxWidth: 720, width: '100%', alignSelf: 'center' },
  title: { fontSize: 26, fontWeight: '900' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  rateCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space.sm },
});
