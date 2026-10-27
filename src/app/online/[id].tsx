import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RecipeBody } from '../../components/RecipeBody';
import { Badge, Button, EmptyState, Muted, RecipeImage } from '../../components/ui';
import { notify } from '../../lib/confirm';
import { CATEGORY_AR, getWebRecipe, isAllowed } from '../../lib/mealdb';
import { useRecipes } from '../../lib/recipes-context';
import { rememberWebRecipe, webRecipeCache, webToRecipeInput } from '../../lib/web-recipes';
import { space, useTheme } from '../../theme';
import { MEAL_TYPES, type MealType, type WebRecipe } from '../../types';

export default function OnlineRecipeScreen() {
  const c = useTheme();
  const { id, meal } = useLocalSearchParams<{ id: string; meal?: string }>();
  const { recipes, addRecipe } = useRecipes();
  const [recipe, setRecipe] = useState<WebRecipe | null>(() => webRecipeCache.get(id) ?? null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (recipe) return;
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

  const saved = recipes.find((r) => r.webId === recipe.webId);
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
      <RecipeImage uri={recipe.image} height={260} />
      <View style={{ gap: space.sm }}>
        <Text style={[styles.title, { color: c.text, writingDirection: 'ltr' }]}>{recipe.title}</Text>
        <View style={styles.row}>
          {recipe.category ? <Badge label={CATEGORY_AR[recipe.category] ?? recipe.category} /> : null}
          {recipe.area ? <Badge label={recipe.area} tone="muted" /> : null}
          <Badge label="من النت" tone="muted" />
        </View>
        <Muted>الوصفة من موقع TheMealDB ومكتوبة بالإنجليزي. تقدر تحفظها وتعدّلها بالعربي.</Muted>
      </View>

      {saved ? (
        <Button label="محفوظة في وصفاتي — افتحها" icon="checkmark-circle" variant="secondary" onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: saved.id } })} />
      ) : (
        <Button label="احفظها في وصفاتي" icon="bookmark-outline" onPress={save} loading={saving} />
      )}

      <RecipeBody ingredients={recipe.ingredients} steps={recipe.steps} ltr />

      {recipe.youtube ? <Button label="فيديو الوصفة على يوتيوب" icon="logo-youtube" variant="ghost" onPress={() => Linking.openURL(recipe.youtube!)} /> : null}
      {recipe.sourceUrl ? <Button label="المصدر الأصلي" icon="open-outline" variant="ghost" onPress={() => Linking.openURL(recipe.sourceUrl!)} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.lg, gap: space.xl, paddingBottom: 48, maxWidth: 720, width: '100%', alignSelf: 'center' },
  title: { fontSize: 26, fontWeight: '900' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
