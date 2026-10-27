import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { Button, Chip, EmptyState, Muted, RecipeImage } from '../../components/ui';
import { adminCreate, adminDelete, adminDeleteImage, adminList, adminUpdate, adminUploadImage, type CatalogInput } from '../../lib/admin-api';
import { serverUrl } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import type { CatalogRecipe } from '../../lib/catalog';
import { confirm, notify } from '../../lib/confirm';
import { goBack } from '../../lib/nav';
import { deleteStoredImage, pickImage, type ImageSource } from '../../lib/images';
import { radius, space, useTheme } from '../../theme';
import { CATEGORIES, CATEGORY_ICONS, CATEGORY_LABELS_ONE, MEAL_LABELS, MEAL_TYPES, type MealType, type RecipeCategory } from '../../types';

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

const toNumber = (text: string) => {
  const n = parseInt(text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

const ERRORS: Record<string, string> = {
  'title-required': 'اكتب اسم الوصفة.',
  'meal-required': 'اختار الوجبة للأكل (فطار، غداء أو عشاء).',
  'not-admin': 'رقمك مش متسجّل كأدمن.',
  'too-large': 'الصورة كبيرة. جرّب صورة تانية.',
};
const message = (e: unknown) => ERRORS[(e as { code?: string }).code ?? ''] ?? 'حصلت مشكلة. اتأكد من الإنترنت وجرب تاني.';

export default function AdminEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { auth } = useAuth();
  const [existing, setExisting] = useState<CatalogRecipe | null | undefined>(id ? undefined : null);

  useEffect(() => {
    if (!id || !auth?.isAdmin) return;
    adminList()
      .then((list) => setExisting(list.find((r) => r.id === id) ?? null))
      .catch(() => setExisting(null));
  }, [id, auth?.isAdmin]);

  if (!auth?.isAdmin) return <EmptyState icon="lock-closed-outline" title="الصفحة دي للأدمن بس" />;
  if (existing === undefined) return <ActivityIndicator style={{ marginTop: 60 }} />;
  if (id && !existing) return <EmptyState icon="alert-circle-outline" title="الوصفة دي مش موجودة" />;
  return <AdminForm key={id ?? 'new'} existing={existing} />;
}

function AdminForm({ existing }: { existing: CatalogRecipe | null }) {
  const c = useTheme();
  const [recipe, setRecipe] = useState(existing);
  const [category, setCategory] = useState<RecipeCategory>(existing?.category ?? 'food');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [mealTypes, setMealTypes] = useState<MealType[]>(existing?.mealTypes ?? []);
  const [minutes, setMinutes] = useState(existing?.prepMinutes ? String(existing.prepMinutes) : '');
  const [servings, setServings] = useState(existing?.servings ? String(existing.servings) : '');
  const [ingredients, setIngredients] = useState(existing?.ingredients.join('\n') ?? '');
  const [steps, setSteps] = useState(existing?.steps.join('\n') ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [published, setPublished] = useState(existing?.published ?? true);
  /** New recipe: photo waits on the device until the recipe is created. */
  const [pendingImage, setPendingImage] = useState<string | undefined>();
  const [busy, setBusy] = useState<null | 'save' | 'image' | 'delete'>(null);
  const [error, setError] = useState('');
  const isFood = category === 'food';

  const shownImage = pendingImage ?? (recipe?.image ? serverUrl(recipe.image) : undefined);

  const choose = async (source: ImageSource) => {
    setBusy('image');
    try {
      const uri = await pickImage(source);
      if (!uri) return;
      if (recipe) {
        setRecipe(await adminUploadImage(recipe.id, uri));
      } else {
        deleteStoredImage(pendingImage);
        setPendingImage(uri);
      }
    } catch (e) {
      notify('مقدرناش نضيف الصورة', (e as Error).message?.endsWith('permission') ? 'محتاجين إذن الوصول للكاميرا أو الصور.' : message(e));
    } finally {
      setBusy(null);
    }
  };

  const removeImage = async () => {
    if (pendingImage) {
      deleteStoredImage(pendingImage);
      return setPendingImage(undefined);
    }
    if (!recipe?.image) return;
    setBusy('image');
    try {
      setRecipe(await adminDeleteImage(recipe.id));
    } catch (e) {
      notify('مقدرناش نشيل الصورة', message(e));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setError('');
    if (!title.trim()) return setError(ERRORS['title-required']);
    if (isFood && !mealTypes.length) return setError(ERRORS['meal-required']);
    const input: CatalogInput = {
      title: title.trim(),
      category,
      mealTypes: isFood ? MEAL_TYPES.filter((m) => mealTypes.includes(m)) : [],
      ingredients: lines(ingredients),
      steps: lines(steps),
      prepMinutes: toNumber(minutes),
      servings: toNumber(servings),
      notes: notes.trim() || undefined,
      published,
    };
    setBusy('save');
    try {
      if (recipe) {
        await adminUpdate(recipe.id, input);
      } else {
        const created = await adminCreate(input);
        if (pendingImage) await adminUploadImage(created.id, pendingImage);
      }
      goBack('/admin');
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!recipe) return;
    if (!(await confirm('حذف من الكتالوج', `"${recipe.title}" هتختفي عند كل الناس (إلا اللي عدّلها عنده). متأكد؟`, 'حذف'))) return;
    setBusy('delete');
    try {
      await adminDelete(recipe.id);
      goBack('/admin');
    } catch (e) {
      notify('مقدرناش نحذف', message(e));
    } finally {
      setBusy(null);
    }
  };

  const field = (label: string, props: TextInputProps) => (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { color: c.text }]}>{label}</Text>
      <TextInput
        placeholderTextColor={c.muted}
        {...props}
        style={[styles.input, props.multiline && styles.multiline, { backgroundColor: c.card, borderColor: c.border, color: c.text }]}
      />
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: recipe ? 'تعديل وصفة الكتالوج' : 'وصفة جديدة للكل' }} />
      <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={{ gap: space.sm }}>
          <Text style={[styles.label, { color: c.text }]}>الصورة</Text>
          <Pressable onPress={() => choose('library')} disabled={!!busy} accessibilityLabel="اختار صورة">
            <RecipeImage uri={shownImage} height={220} icon={CATEGORY_ICONS[category]} />
            {busy === 'image' ? <ActivityIndicator style={StyleSheet.absoluteFill} color={c.primary} /> : null}
            {!shownImage && busy !== 'image' ? (
              <View style={styles.imageHint} pointerEvents="none">
                <Ionicons name="camera" size={22} color={c.primary} />
                <Text style={{ color: c.primary, fontWeight: '700' }}>دوس لإضافة صورة</Text>
              </View>
            ) : null}
          </Pressable>
          <View style={styles.row}>
            {Platform.OS !== 'web' ? (
              <Button label="الكاميرا" icon="camera-outline" variant="secondary" onPress={() => choose('camera')} disabled={!!busy} style={{ flex: 1 }} />
            ) : null}
            <Button label={shownImage ? 'غيّر الصورة' : 'اختار صورة'} icon="images-outline" variant="secondary" onPress={() => choose('library')} disabled={!!busy} style={{ flex: 1 }} />
            {shownImage ? <Button label="شيل" icon="trash-outline" variant="danger" onPress={removeImage} disabled={!!busy} /> : null}
          </View>
          {recipe ? <Muted style={{ fontSize: 12 }}>الصورة بتتحفظ على طول وبتوصل لكل الناس.</Muted> : null}
        </View>

        <View style={{ gap: 6 }}>
          <Text style={[styles.label, { color: c.text }]}>القسم *</Text>
          <View style={styles.chips}>
            {CATEGORIES.map((cat) => (
              <Chip key={cat} label={CATEGORY_LABELS_ONE[cat]} icon={CATEGORY_ICONS[cat]} selected={category === cat} onPress={() => setCategory(cat)} />
            ))}
          </View>
        </View>

        {field('الاسم *', { value: title, onChangeText: setTitle, placeholder: 'اسم الوصفة' })}

        {isFood ? (
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: c.text }]}>تنفع لـ *</Text>
            <View style={styles.chips}>
              {MEAL_TYPES.map((m) => (
                <Chip
                  key={m}
                  label={MEAL_LABELS[m]}
                  selected={mealTypes.includes(m)}
                  onPress={() => setMealTypes((l) => (l.includes(m) ? l.filter((x) => x !== m) : [...l, m]))}
                />
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.row}>
          <View style={{ flex: 1 }}>{field('الوقت (دقيقة)', { value: minutes, onChangeText: setMinutes, keyboardType: 'number-pad', placeholder: '30' })}</View>
          <View style={{ flex: 1 }}>
            {field(isFood ? 'عدد الأفراد' : 'عدد الكوبايات', { value: servings, onChangeText: setServings, keyboardType: 'number-pad', placeholder: '4' })}
          </View>
        </View>

        {field('المكونات (كل مكوّن في سطر)', { value: ingredients, onChangeText: setIngredients, multiline: true })}
        {field('طريقة التحضير (كل خطوة في سطر)', { value: steps, onChangeText: setSteps, multiline: true })}
        {field('ملاحظات', { value: notes, onChangeText: setNotes, multiline: true, placeholder: 'اختياري' })}

        <View style={{ gap: 6 }}>
          <Text style={[styles.label, { color: c.text }]}>الظهور</Text>
          <View style={styles.chips}>
            <Chip label="ظاهرة للناس" icon="eye-outline" selected={published} onPress={() => setPublished(true)} />
            <Chip label="مخفية" icon="eye-off-outline" selected={!published} onPress={() => setPublished(false)} />
          </View>
        </View>

        {error ? <Text style={{ color: c.danger, fontWeight: '600' }}>• {error}</Text> : null}
        <Button label={recipe ? 'حفظ التعديلات' : 'نشر الوصفة'} icon="checkmark" onPress={save} loading={busy === 'save'} disabled={!!busy && busy !== 'save'} />
        {recipe ? <Button label="حذف من الكتالوج" icon="trash-outline" variant="danger" onPress={remove} loading={busy === 'delete'} disabled={!!busy && busy !== 'delete'} /> : null}
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
