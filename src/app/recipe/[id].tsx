import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RecipeBody } from '../../components/RecipeBody';
import { Badge, Button, EmptyState, Meta, RecipeImage } from '../../components/ui';
import { confirm } from '../../lib/confirm';
import { useRecipes } from '../../lib/recipes-context';
import { space, useTheme } from '../../theme';
import { MEAL_LABELS } from '../../types';

export default function RecipeScreen() {
  const c = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getRecipe, deleteRecipe, toggleFavorite, ready } = useRecipes();
  const recipe = getRecipe(id);

  if (!recipe) {
    return ready ? <EmptyState icon="alert-circle-outline" title="الوصفة دي مش موجودة" /> : null;
  }

  const remove = async () => {
    if (await confirm('حذف الوصفة', `متأكد إنك عايز تحذف "${recipe.title}"؟`, 'حذف')) {
      await deleteRecipe(recipe.id);
      if (router.canGoBack()) router.back();
      else router.replace('/recipes');
    }
  };

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: recipe.title }} />
      <RecipeImage uri={recipe.image} height={260} />
      <View style={{ gap: space.sm }}>
        <Text style={[styles.title, { color: c.text }]}>{recipe.title}</Text>
        <View style={styles.row}>
          {recipe.mealTypes.map((m) => (
            <Badge key={m} label={MEAL_LABELS[m]} />
          ))}
          {recipe.source === 'web' ? <Badge label="من النت" tone="muted" /> : null}
        </View>
        <View style={styles.row}>
          {recipe.prepMinutes ? <Meta icon="hourglass-outline" label={`${recipe.prepMinutes} دقيقة`} /> : null}
          {recipe.servings ? <Meta icon="people-outline" label={`${recipe.servings} أفراد`} /> : null}
        </View>
      </View>

      <View style={styles.actions}>
        <Button
          label={recipe.favorite ? 'في المفضلة' : 'للمفضلة'}
          icon={recipe.favorite ? 'heart' : 'heart-outline'}
          variant="secondary"
          onPress={() => toggleFavorite(recipe.id)}
          style={{ flex: 1 }}
        />
        <Button
          label="تعديل"
          icon="create-outline"
          variant="secondary"
          onPress={() => router.push({ pathname: '/recipe/edit', params: { id: recipe.id } })}
          style={{ flex: 1 }}
        />
      </View>

      <RecipeBody ingredients={recipe.ingredients} steps={recipe.steps} notes={recipe.notes} />

      {recipe.sourceUrl ? (
        <Button label="المصدر الأصلي" icon="open-outline" variant="ghost" onPress={() => Linking.openURL(recipe.sourceUrl!)} />
      ) : null}
      <Button label="حذف الوصفة" icon="trash-outline" variant="danger" onPress={remove} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.lg, gap: space.xl, paddingBottom: 48, maxWidth: 720, width: '100%', alignSelf: 'center' },
  title: { fontSize: 26, fontWeight: '900' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  actions: { flexDirection: 'row', gap: space.sm },
});
