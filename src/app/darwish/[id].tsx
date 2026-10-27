import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RecipeView } from '../../components/RecipeView';
import { StarRating } from '../../components/StarRating';
import { Badge, Button, Card, EmptyState } from '../../components/ui';
import { useActivity } from '../../lib/activity-context';
import { notify } from '../../lib/confirm';
import { useDarwish } from '../../lib/darwish-context';
import { useRecipes } from '../../lib/recipes-context';
import { space, useTheme } from '../../theme';
import { categoryOf } from '../../types';

export default function DarwishRecipeScreen() {
  const c = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getRecipe, ready } = useDarwish();
  const { addRecipe } = useRecipes();
  const { isLiked, toggleLike, ratingOf, rate, recordView } = useActivity();
  const recipe = getRecipe(id);
  const ref = { kind: 'darwish' as const, id, title: recipe?.title, image: recipe?.image };

  useEffect(() => {
    if (recipe) recordView({ kind: 'darwish', id: recipe.id, title: recipe.title, image: recipe.image });
  }, [recipe, recordView]);

  if (!recipe) return ready ? <EmptyState icon="alert-circle-outline" title="الوصفة دي مش موجودة" /> : null;
  const liked = isLiked(ref);

  const saveCopy = async () => {
    try {
      const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = recipe;
      const created = await addRecipe({ ...rest, source: 'user', postId: undefined });
      router.push({ pathname: '/recipe/edit', params: { id: created.id } });
    } catch {
      notify('مقدرناش نحفظها', 'مساحة التخزين ممكن تكون مليانة.');
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: recipe.title }} />
      <RecipeView
        {...recipe}
        category={categoryOf(recipe)}
        badges={<Badge label="من مطبخ درويش" tone="muted" />}
        actions={
          <View style={{ gap: space.md }}>
            <View style={styles.row}>
              <Button label={liked ? 'عجبتني' : 'أعجبني'} icon={liked ? 'heart' : 'heart-outline'} variant="secondary" onPress={() => toggleLike(ref)} style={{ flex: 1 }} />
              <Button label="خد نسخة وعدّلها" icon="copy-outline" variant="secondary" onPress={saveCopy} style={{ flex: 1 }} />
            </View>
            <Card style={styles.rateCard}>
              <Text style={[styles.rateLabel, { color: c.text }]}>تقييمك</Text>
              <StarRating value={ratingOf(ref)} onChange={(stars) => rate(ref, stars)} />
            </Card>
          </View>
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  rateCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: space.md },
  rateLabel: { fontSize: 16, fontWeight: '800' },
});
