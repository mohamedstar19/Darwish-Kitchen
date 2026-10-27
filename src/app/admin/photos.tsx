import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, EmptyState, Muted } from '../../components/ui';
import { aiPhotoApprove, aiPhotos, aiPhotoSkip, aiPhotosRun, type PhotoCandidate, type PhotoOverview } from '../../lib/admin-api';
import { serverUrl } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { confirm, notify } from '../../lib/confirm';
import { useDarwish } from '../../lib/darwish-context';
import { radius, space, useTheme } from '../../theme';
import { CATEGORY_LABELS_ONE } from '../../types';

/**
 * Control panel: the AI finds photos for Darwish recipes without one, from free photo sites only
 * (Wikimedia Commons, Openverse, Pexels), and the admin reviews them — or lets the clearly good ones go up by themselves.
 */
export default function AiPhotosScreen() {
  const c = useTheme();
  const { auth } = useAuth();
  const { refresh: reloadDarwish } = useDarwish();
  const [data, setData] = useState<PhotoOverview | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    aiPhotos()
      .then((d) => {
        setData(d);
        setError(false);
      })
      .catch(() => setError(true));
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (auth?.isAdmin) load();
    }, [auth?.isAdmin, load]),
  );

  // Follow a running search.
  const running = !!data?.run?.running;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [running, load]);
  // When a run that put photos on recipes finishes, refresh this phone's copy of the Darwish recipes.
  const finishedWithPhotos = !!data?.run && !data.run.running && data.run.applied > 0;
  useEffect(() => {
    if (finishedWithPhotos) reloadDarwish();
  }, [finishedWithPhotos, reloadDarwish]);

  if (!auth?.isAdmin) return <EmptyState icon="lock-closed-outline" title="الصفحة دي للأدمن بس" />;

  const start = async (mode: 'review' | 'auto') => {
    if (
      mode === 'auto' &&
      !(await confirm('ترفع على طول؟', 'الصور اللي الذكاء الاصطناعي متأكد منها (8 من 10 أو أكتر) هتتحط على الوصفات على طول، والباقي يستناك تراجعه.', 'يلا'))
    ) {
      return;
    }
    setBusy(mode);
    try {
      await aiPhotosRun(mode);
      load();
    } catch (e) {
      const code = (e as { code?: string }).code;
      notify('مقدرناش نبدأ', code === 'already-running' ? 'فيه بحث شغال دلوقتي، استنى لما يخلص.' : code === 'ai-unavailable' ? 'الذكاء الاصطناعي مش متاح على السيرفر.' : 'اتأكد من الإنترنت وجرب تاني.');
    } finally {
      setBusy(null);
    }
  };

  const approve = async (photo: PhotoCandidate) => {
    setBusy(photo.id);
    try {
      await aiPhotoApprove(photo.id);
      reloadDarwish();
      load();
    } catch {
      notify('مقدرناش نحط الصورة', 'جرب تاني.');
    } finally {
      setBusy(null);
    }
  };

  const skip = async (recipeId: string) => {
    setBusy(recipeId);
    try {
      await aiPhotoSkip(recipeId);
      load();
    } catch {
      notify('حصلت مشكلة', 'جرب تاني.');
    } finally {
      setBusy(null);
    }
  };

  const run = data?.run;

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'صور بالذكاء الاصطناعي' }} />
      <Muted>
        الذكاء الاصطناعي بيدوّر على صور للوصفات اللي من غير صورة في مكتبات الصور المجانية بس (Wikimedia Commons و Openverse، و Pexels لو ضفت مفتاحه)، وبيبص على كل صورة ويقيّمها. اسم المصوّر والموقع بيظهروا تحت الصورة في التطبيق.
      </Muted>

      {error ? <Text style={{ color: c.danger, fontWeight: '600' }}>مقدرناش نجيب البيانات. اتأكد من الإنترنت.</Text> : null}
      {!data && !error ? <ActivityIndicator color={c.primary} /> : null}

      {data ? (
        <Card>
          <Text style={[styles.title, { color: c.text }]}>{`📷 ${data.missing} وصفة من غير صورة`}</Text>
          {!data.enabled ? (
            <Muted>الذكاء الاصطناعي مش متشغّل على السيرفر (محتاج ANTHROPIC_API_KEY).</Muted>
          ) : running && run ? (
            <View style={{ gap: space.sm }}>
              <View style={styles.row}>
                <ActivityIndicator color={c.primary} />
                <Text style={{ color: c.text, fontWeight: '700' }}>{`بندوّر… ${run.done} من ${run.total}`}</Text>
              </View>
              {run.current ? <Muted>{`دلوقتي: ${run.current}`}</Muted> : null}
              <View style={[styles.bar, { backgroundColor: c.border }]}>
                <View style={[styles.barFill, { backgroundColor: c.primary, width: `${run.total ? Math.round((run.done / run.total) * 100) : 0}%` }]} />
              </View>
            </View>
          ) : (
            <View style={{ gap: space.sm }}>
              <Button label="دوّر وأنا أراجع" icon="eye-outline" onPress={() => start('review')} loading={busy === 'review'} disabled={!data.missing || !!busy} />
              <Button label="دوّر وارفع على طول" icon="sparkles" variant="secondary" onPress={() => start('auto')} loading={busy === 'auto'} disabled={!data.missing || !!busy} />
              <Muted style={{ fontSize: 12 }}>كل مرة بتدوّر على 25 وصفة بالكتير. "ارفع على طول" بيحط الصور اللي متأكد منها بس، والباقي يستناك هنا.</Muted>
            </View>
          )}
          {run && !run.running ? (
            <Muted style={{ fontSize: 13 }}>
              {`آخر مرة: ${run.applied} صورة اتحطت على طول • ${run.waiting} مستنية مراجعتك • ${run.notFound} ملقيناش ليها${run.failed ? ` • ${run.failed} حصل فيها مشكلة` : ''}`}
            </Muted>
          ) : null}
          {run && !run.running && run.lastError ? (
            <Muted style={{ fontSize: 12 }}>
              {`سبب المشكلة: ${run.lastError}`}
            </Muted>
          ) : null}
        </Card>
      ) : null}

      {data?.items.length ? <Text style={[styles.section, { color: c.text }]}>{`مستنية مراجعتك (${data.items.length})`}</Text> : null}
      {data?.items.map(({ recipe, candidates }) => (
        <Card key={recipe.id}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: c.text }]}>{recipe.title}</Text>
              <Muted style={{ fontSize: 12 }}>{`${CATEGORY_LABELS_ONE[recipe.category]}${recipe.image ? ' • عندها صورة دلوقتي (هتتبدل)' : ''}`}</Muted>
            </View>
            <Button label="ولا واحدة" icon="close" variant="ghost" onPress={() => skip(recipe.id)} loading={busy === recipe.id} />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.md }}>
            {candidates.map((p) => (
              <View key={p.id} style={[styles.candidate, { borderColor: c.border }]}>
                <Image source={{ uri: serverUrl(p.image) }} style={styles.photo} resizeMode="cover" accessibilityLabel={`صورة مقترحة لـ ${recipe.title}`} />
                <View style={styles.candidateBody}>
                  <View style={styles.row}>
                    <Ionicons name="star" size={14} color={c.primary} />
                    <Text style={{ color: c.text, fontWeight: '800' }}>{`${p.score}/10`}</Text>
                  </View>
                  <Text accessibilityRole="link" onPress={() => Linking.openURL(p.pageUrl)} style={[styles.credit, { color: c.muted }]} numberOfLines={2}>
                    {`📷 ${[p.author, p.source].filter(Boolean).join(' / ')}`}
                  </Text>
                  {p.note ? <Muted style={{ fontSize: 11 }}>{p.note}</Muted> : null}
                  <Button label="استخدم دي" icon="checkmark" onPress={() => approve(p)} loading={busy === p.id} disabled={!!busy && busy !== p.id} />
                </View>
              </View>
            ))}
          </ScrollView>
        </Card>
      ))}

      {data && !data.items.length && !running ? (
        <EmptyState icon="images-outline" title="مفيش صور مستنية مراجعة" message="دوس على دوّر علشان الذكاء الاصطناعي يجيب صور للوصفات اللي من غير صورة." />
      ) : null}

      <Button label="رجوع للوحة التحكم" icon="arrow-forward" variant="ghost" onPress={() => router.back()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.lg, gap: space.lg, paddingBottom: 48, maxWidth: 720, width: '100%', alignSelf: 'center' },
  title: { fontSize: 17, fontWeight: '800' },
  section: { fontSize: 18, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  bar: { height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8 },
  candidate: { width: 210, borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  photo: { width: 210, height: 150 },
  candidateBody: { padding: space.sm, gap: 6 },
  credit: { fontSize: 11, textDecorationLine: 'underline' },
});
