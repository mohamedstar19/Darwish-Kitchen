import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { Button, Chip, Muted, RecipeImage } from '../../components/ui';
import { notify } from '../../lib/confirm';
import { pickRecipeImage, type ImageSource } from '../../lib/images';
import { useRecipes } from '../../lib/recipes-context';
import { radius, space, useTheme } from '../../theme';
import { MEAL_LABELS, MEAL_TYPES, type MealType } from '../../types';

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

const toNumber = (text: string) => {
  const n = parseInt(text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export default function EditRecipeScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { ready } = useRecipes();
  // Wait for saved recipes to load so an edit form never starts empty.
  if (!ready) return <ActivityIndicator style={{ marginTop: 60 }} />;
  return <RecipeForm key={id ?? 'new'} id={id} />;
}

function RecipeForm({ id }: { id?: string }) {
  const c = useTheme();
  const { getRecipe, addRecipe, updateRecipe } = useRecipes();
  const existing = id ? getRecipe(id) : undefined;

  const [image, setImage] = useState<string | undefined>(existing?.image);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [mealTypes, setMealTypes] = useState<MealType[]>(existing?.mealTypes ?? []);
  const [minutes, setMinutes] = useState(existing?.prepMinutes ? String(existing.prepMinutes) : '');
  const [servings, setServings] = useState(existing?.servings ? String(existing.servings) : '');
  const [ingredients, setIngredients] = useState(existing?.ingredients.join('\n') ?? '');
  const [steps, setSteps] = useState(existing?.steps.join('\n') ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [busyImage, setBusyImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const toggleMeal = (m: MealType) =>
    setMealTypes((list) => (list.includes(m) ? list.filter((x) => x !== m) : [...list, m]));

  const choose = async (source: ImageSource) => {
    setBusyImage(true);
    try {
      const uri = await pickRecipeImage(source);
      if (uri) setImage(uri);
    } catch (e) {
      const msg = (e as Error).message;
      notify(
        'مقدرناش نضيف الصورة',
        msg.endsWith('permission') ? 'محتاجين إذن الوصول للكاميرا أو الصور من إعدادات الموبايل.' : 'جرّب صورة تانية.',
      );
    } finally {
      setBusyImage(false);
    }
  };

  const save = async () => {
    const problems: string[] = [];
    if (!title.trim()) problems.push('اكتب اسم الوصفة.');
    if (!mealTypes.length) problems.push('اختار الوجبة (فطار، غداء أو عشاء).');
    setErrors(problems);
    if (problems.length) return;

    const input = {
      title: title.trim(),
      mealTypes: MEAL_TYPES.filter((m) => mealTypes.includes(m)),
      image,
      ingredients: lines(ingredients),
      steps: lines(steps),
      prepMinutes: toNumber(minutes),
      servings: toNumber(servings),
      notes: notes.trim() || undefined,
    };

    setSaving(true);
    try {
      if (existing) {
        await updateRecipe(existing.id, input);
        router.back();
      } else {
        const created = await addRecipe({ ...input, source: 'user' });
        router.replace({ pathname: '/recipe/[id]', params: { id: created.id } });
      }
    } catch {
      notify('مقدرناش نحفظ الوصفة', 'مساحة التخزين ممكن تكون مليانة. جرّب صورة أصغر.');
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, props: TextInputProps, hint?: string) => (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { color: c.text }]}>{label}</Text>
      <TextInput
        placeholderTextColor={c.muted}
        {...props}
        style={[
          styles.input,
          props.multiline && styles.multiline,
          { backgroundColor: c.card, borderColor: c.border, color: c.text },
        ]}
      />
      {hint ? <Muted style={{ fontSize: 12 }}>{hint}</Muted> : null}
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: existing ? 'تعديل الوصفة' : 'وصفة جديدة' }} />
      <ScrollView
        style={{ backgroundColor: c.background }}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled">
        <View style={{ gap: space.sm }}>
          <Text style={[styles.label, { color: c.text }]}>صورة الوصفة</Text>
          <Pressable onPress={() => choose('library')} disabled={busyImage} accessibilityLabel="اختار صورة">
            <RecipeImage uri={image} height={210} />
            {!image ? (
              <View style={styles.imageHint} pointerEvents="none">
                <Ionicons name="camera" size={22} color={c.primary} />
                <Text style={{ color: c.primary, fontWeight: '700' }}>دوس لإضافة صورة</Text>
              </View>
            ) : null}
          </Pressable>
          <View style={styles.row}>
            {Platform.OS !== 'web' ? (
              <Button label="الكاميرا" icon="camera-outline" variant="secondary" onPress={() => choose('camera')} loading={busyImage} style={{ flex: 1 }} />
            ) : null}
            <Button
              label={Platform.OS === 'web' ? 'اختار أو صوّر صورة' : 'من الصور'}
              icon="images-outline"
              variant="secondary"
              onPress={() => choose('library')}
              loading={busyImage}
              style={{ flex: 1 }}
            />
            {image ? (
              <Button label="شيل" icon="trash-outline" variant="danger" onPress={() => setImage(undefined)} />
            ) : null}
          </View>
        </View>

        {field('اسم الوصفة *', { value: title, onChangeText: setTitle, placeholder: 'مثلاً: محشي كرنب' })}

        <View style={{ gap: 6 }}>
          <Text style={[styles.label, { color: c.text }]}>تنفع لـ *</Text>
          <View style={styles.chips}>
            {MEAL_TYPES.map((m) => (
              <Chip key={m} label={MEAL_LABELS[m]} selected={mealTypes.includes(m)} onPress={() => toggleMeal(m)} />
            ))}
          </View>
        </View>

        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            {field('الوقت (دقيقة)', { value: minutes, onChangeText: setMinutes, keyboardType: 'number-pad', placeholder: '30' })}
          </View>
          <View style={{ flex: 1 }}>
            {field('عدد الأفراد', { value: servings, onChangeText: setServings, keyboardType: 'number-pad', placeholder: '4' })}
          </View>
        </View>

        {field('المكونات', { value: ingredients, onChangeText: setIngredients, multiline: true, placeholder: 'كل مكوّن في سطر' }, 'اكتب كل مكوّن في سطر لوحده.')}
        {field('طريقة التحضير', { value: steps, onChangeText: setSteps, multiline: true, placeholder: 'كل خطوة في سطر' }, 'كل خطوة في سطر، وهنرقّمها لوحدنا.')}
        {field('ملاحظات', { value: notes, onChangeText: setNotes, multiline: true, placeholder: 'اختياري' })}

        {errors.length ? (
          <View style={{ gap: 4 }}>
            {errors.map((e) => (
              <Text key={e} style={{ color: c.danger, fontWeight: '600' }}>
                • {e}
              </Text>
            ))}
          </View>
        ) : null}

        <Button label="حفظ الوصفة" icon="checkmark" onPress={save} loading={saving} disabled={busyImage} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.lg, gap: space.lg, paddingBottom: 48, maxWidth: 720, width: '100%', alignSelf: 'center' },
  label: { fontSize: 15, fontWeight: '700' },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12, fontSize: 16 },
  multiline: { minHeight: 120, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  imageHint: { position: 'absolute', bottom: 14, start: 0, end: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
});
