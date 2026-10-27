import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { Button, Chip, Muted, RecipeImage } from '../../components/ui';
import { aiErrorMessage, aiPhotoRecipe, pickPhotoForAi } from '../../lib/ai-tools';
import { confirm, notify } from '../../lib/confirm';
import { goBack } from '../../lib/nav';
import { pickRecipeImage, type ImageSource } from '../../lib/images';
import { useAuth } from '../../lib/auth-context';
import { useProfile } from '../../lib/profile-context';
import { publishRecipe, unpublishRecipe } from '../../lib/publish';
import { useRecipes } from '../../lib/recipes-context';
import { radius, space, useTheme } from '../../theme';
import { CATEGORIES, CATEGORY_ICONS, CATEGORY_LABELS_ONE, categoryOf, MEAL_LABELS, MEAL_TYPES, type MealType, type RecipeCategory } from '../../types';

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
  const { id, category } = useLocalSearchParams<{ id?: string; category?: string }>();
  const { ready } = useRecipes();
  // Wait for saved recipes to load so an edit form never starts empty.
  if (!ready) return <ActivityIndicator style={{ marginTop: 60 }} />;
  const initial = CATEGORIES.includes(category as RecipeCategory) ? (category as RecipeCategory) : 'food';
  return <RecipeForm key={id ?? `new-${initial}`} id={id} initialCategory={initial} />;
}

function RecipeForm({ id, initialCategory }: { id?: string; initialCategory: RecipeCategory }) {
  const c = useTheme();
  const { getRecipe, addRecipe, updateRecipe } = useRecipes();
  const { auth } = useAuth();
  const { profile, updateProfile } = useProfile();
  const existing = id ? getRecipe(id) : undefined;
  // Only the user's own recipes can go to the feed (not ones saved from other chefs or the internet).
  const canPublish = !existing || existing.source === 'user';
  const [publish, setPublish] = useState(existing ? !!existing.postId : true);
  const [chefName, setChefName] = useState('');

  const [image, setImage] = useState<string | undefined>(existing?.image);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [category, setCategory] = useState<RecipeCategory>(existing ? categoryOf(existing) : initialCategory);
  const [mealTypes, setMealTypes] = useState<MealType[]>(existing?.mealTypes ?? []);
  const isFood = category === 'food';
  const [minutes, setMinutes] = useState(existing?.prepMinutes ? String(existing.prepMinutes) : '');
  const [servings, setServings] = useState(existing?.servings ? String(existing.servings) : '');
  const [ingredients, setIngredients] = useState(existing?.ingredients.join('\n') ?? '');
  const [steps, setSteps] = useState(existing?.steps.join('\n') ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [busyImage, setBusyImage] = useState(false);
  const [scanning, setScanning] = useState(false);
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

  /** Photo of a written recipe (notebook, card, screenshot) → the AI fills the form. */
  const scan = async (source: ImageSource) => {
    if (!auth) {
      router.push('/account');
      return;
    }
    if ((title.trim() || ingredients.trim() || steps.trim()) && !(await confirm('نكتب فوق اللي كتبته؟', 'الوصفة اللي في الصورة هتتكتب مكان الكلام اللي في الخانات.', 'أيوه، اكتبها'))) {
      return;
    }
    setScanning(true);
    try {
      const photo = await pickPhotoForAi(source);
      if (!photo) return;
      const r = await aiPhotoRecipe(photo.base64);
      setTitle(r.title);
      setCategory(r.category ?? 'food');
      setMealTypes(r.mealTypes);
      setIngredients(r.ingredients.join('\n'));
      setSteps(r.steps.join('\n'));
      setMinutes(r.prepMinutes ? String(r.prepMinutes) : '');
      setServings(r.servings ? String(r.servings) : '');
      setNotes(r.notes ?? '');
      setErrors([]);
      notify('✨ الوصفة اتكتبت', r.mealTypes.length || r.category !== 'food' ? 'راجعها وعدّل اللي محتاج قبل ما تحفظ.' : 'راجعها، واختار الوجبة المناسبة قبل ما تحفظ.');
    } catch (e) {
      const msg = (e as Error).message;
      notify('مقدرناش نقرا الوصفة', msg.endsWith('permission') ? 'محتاجين إذن الوصول للكاميرا أو الصور من إعدادات الموبايل.' : aiErrorMessage(e));
    } finally {
      setScanning(false);
    }
  };

  const save = async () => {
    const problems: string[] = [];
    if (!title.trim()) problems.push('اكتب اسم الوصفة.');
    if (isFood && !mealTypes.length) problems.push('اختار الوجبة (فطار، غداء أو عشاء).');
    const sharing = canPublish && publish && !!auth;
    if (sharing && !profile.name && chefName.trim().length < 2) problems.push('اكتب اسمك اللي هيظهر على الوصفة في الفيد.');
    setErrors(problems);
    if (problems.length) return;

    const input = {
      title: title.trim(),
      category,
      mealTypes: isFood ? MEAL_TYPES.filter((m) => mealTypes.includes(m)) : [],
      image,
      ingredients: lines(ingredients),
      steps: lines(steps),
      prepMinutes: toNumber(minutes),
      servings: toNumber(servings),
      notes: notes.trim() || undefined,
    };

    setSaving(true);
    let saved;
    try {
      if (existing) {
        await updateRecipe(existing.id, input);
        saved = { ...existing, ...input };
      } else {
        saved = await addRecipe({ ...input, source: 'user' });
      }
    } catch {
      setSaving(false);
      notify('مقدرناش نحفظ الوصفة', 'مساحة التخزين ممكن تكون مليانة. جرّب صورة أصغر.');
      return;
    }

    // The recipe is safe on the phone; now share it (or take it down) in the chefs feed.
    try {
      if (sharing) {
        const chef = profile.name ? profile : { ...profile, name: chefName.trim() };
        if (!profile.name) await updateProfile({ name: chef.name });
        const postId = await publishRecipe(saved, chef);
        if (postId !== saved.postId) await updateRecipe(saved.id, { postId });
      } else if (canPublish && !publish && saved.postId) {
        await unpublishRecipe(saved.postId);
        await updateRecipe(saved.id, { postId: undefined });
      }
    } catch {
      notify('اتحفظت عندك ✅', 'بس مقدرناش نحدّثها في الفيد دلوقتي. اتأكد من الإنترنت واحفظها تاني.');
    }
    setSaving(false);
    if (existing) goBack({ pathname: '/recipe/[id]', params: { id: existing.id } });
    else router.replace({ pathname: '/recipe/[id]', params: { id: saved.id } });
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
      <Stack.Screen options={{ title: existing ? 'تعديل الوصفة' : isFood ? 'وصفة جديدة' : `${CATEGORY_LABELS_ONE[category]} جديد` }} />
      <ScrollView
        style={{ backgroundColor: c.background }}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled">
        <View style={[styles.scanBox, { backgroundColor: c.primarySoft }]}>
          <View style={styles.publishRow}>
            <Ionicons name="sparkles" size={22} color={c.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: c.text }]}>عندك الوصفة مكتوبة؟</Text>
              <Muted style={{ fontSize: 12 }}>صوّر صفحة الكشكول أو الكارت أو سكرين شوت، والذكاء الاصطناعي يكتبهالك هنا.</Muted>
            </View>
          </View>
          {scanning ? (
            <View style={styles.publishRow}>
              <ActivityIndicator color={c.primary} />
              <Muted>بنقرا الوصفة… ممكن ياخد نص دقيقة.</Muted>
            </View>
          ) : (
            <View style={styles.row}>
              {Platform.OS !== 'web' ? (
                <Button label="صوّر الوصفة" icon="camera-outline" variant="secondary" onPress={() => scan('camera')} style={{ flex: 1 }} />
              ) : null}
              <Button
                label={Platform.OS === 'web' ? 'صوّر أو اختار صورة الوصفة' : 'من الصور'}
                icon="document-text-outline"
                variant="secondary"
                onPress={() => scan('library')}
                style={{ flex: 1 }}
              />
            </View>
          )}
          {!auth ? <Muted style={{ fontSize: 12 }}>محتاج تسجّل برقم موبايلك الأول.</Muted> : null}
        </View>

        <View style={{ gap: space.sm }}>
          <Text style={[styles.label, { color: c.text }]}>الصورة</Text>
          <Pressable onPress={() => choose('library')} disabled={busyImage} accessibilityLabel="اختار صورة">
            <RecipeImage uri={image} height={210} icon={CATEGORY_ICONS[category]} />
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

        <View style={{ gap: 6 }}>
          <Text style={[styles.label, { color: c.text }]}>القسم *</Text>
          <View style={styles.chips}>
            {CATEGORIES.map((cat) => (
              <Chip key={cat} label={CATEGORY_LABELS_ONE[cat]} icon={CATEGORY_ICONS[cat]} selected={category === cat} onPress={() => setCategory(cat)} />
            ))}
          </View>
        </View>

        {field('الاسم *', {
          value: title,
          onChangeText: setTitle,
          placeholder: category === 'juice' ? 'مثلاً: عصير جوافة' : category === 'healthy-drink' ? 'مثلاً: ينسون بالعسل' : 'مثلاً: محشي كرنب',
        })}

        {isFood ? (
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: c.text }]}>تنفع لـ *</Text>
            <View style={styles.chips}>
              {MEAL_TYPES.map((m) => (
                <Chip key={m} label={MEAL_LABELS[m]} selected={mealTypes.includes(m)} onPress={() => toggleMeal(m)} />
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            {field('الوقت (دقيقة)', { value: minutes, onChangeText: setMinutes, keyboardType: 'number-pad', placeholder: '30' })}
          </View>
          <View style={{ flex: 1 }}>
            {field(isFood ? 'عدد الأفراد' : 'عدد الكوبايات', { value: servings, onChangeText: setServings, keyboardType: 'number-pad', placeholder: '4' })}
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

        {canPublish ? (
          <View style={[styles.publishBox, { backgroundColor: c.cardAlt }]}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: publish }}
              onPress={() => setPublish((p) => !p)}
              style={styles.publishRow}>
              <Ionicons name={publish ? 'checkbox' : 'square-outline'} size={24} color={c.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: c.text }]}>انشرها في الفيد</Text>
                <Muted style={{ fontSize: 12 }}>الشيفات التانيين هيشوفوها باسمك وصورتك.</Muted>
              </View>
            </Pressable>
            {publish && !auth ? (
              <View style={{ gap: space.sm }}>
                <Muted>سجّل برقم موبايلك علشان تنشر. الوصفة هتتحفظ عندك في الحالتين.</Muted>
                <Button label="سجّل برقم الموبايل" icon="phone-portrait-outline" variant="secondary" onPress={() => router.push('/account')} />
              </View>
            ) : null}
            {publish && auth && !profile.name
              ? field('اسمك كشيف *', { value: chefName, onChangeText: setChefName, placeholder: 'مثلاً: الشيف سارة' }, 'هيتحفظ في ملفك الشخصي.')
              : null}
          </View>
        ) : null}

        <Button label="حفظ الوصفة" icon="checkmark" onPress={save} loading={saving} disabled={busyImage || scanning} />
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
  scanBox: { borderRadius: radius.md, padding: space.md, gap: space.md },
  publishBox: { borderRadius: radius.md, padding: space.md, gap: space.md },
  publishRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  imageHint: { position: 'absolute', bottom: 14, start: 0, end: 0, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
});
