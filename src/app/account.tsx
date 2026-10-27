import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Card, Chip, Muted } from '../components/ui';
import { useAuth } from '../lib/auth-context';
import { getBackupMeta, getServerBackupDate, restoreBackup } from '../lib/backup';
import { confirm, notify } from '../lib/confirm';
import { useReloadData } from '../lib/data-reload';
import { formatDateTime } from '../lib/format';
import { radius, space, useTheme } from '../theme';

type Mode = 'signin' | 'signup';

const ERRORS: Record<string, string> = {
  'invalid-login': 'الإيميل أو كلمة السر غلط.',
  'email-taken': 'الإيميل ده عليه حساب بالفعل. سجّل دخول.',
  'weak-password': 'كلمة السر لازم تكون 8 حروف أو أكتر.',
  'invalid-email': 'اكتب إيميل صحيح.',
  'too-many-attempts': 'محاولات كتير. استنى ربع ساعة وجرب تاني.',
};

function errorMessage(e: unknown): string {
  return ERRORS[(e as { code?: string }).code ?? ''] ?? 'حصلت مشكلة. اتأكد من الإنترنت وجرب تاني.';
}

export default function AccountScreen() {
  const c = useTheme();
  const { signIn, signUp } = useAuth();
  const reload = useReloadData();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /** On a phone that never synced, offer the account's backup right after login. */
  const offerRestore = async () => {
    const meta = await getBackupMeta();
    if (meta.lastBackupAt || meta.lastRestoreAt) return;
    const server = await getServerBackupDate().catch(() => null);
    if (!server) return;
    if (await confirm('لقينا نسخة احتياطية', `حسابك عليه نسخة من ${formatDateTime(server)}. تحب ترجّعها على الموبايل ده؟ (البيانات الحالية هتتبدل)`, 'استرجاع')) {
      try {
        const result = await restoreBackup();
        reload();
        notify('تم الاسترجاع ✅', `رجعنا ${result.recipes} وصفة.`);
      } catch {
        notify('مقدرناش نسترجع النسخة', 'تقدر تجرب تاني من صفحة حسابي.');
      }
    }
  };

  const submit = async () => {
    setError('');
    if (!email.trim() || password.length < 8) {
      setError('اكتب الإيميل وكلمة سر 8 حروف أو أكتر.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signup') await signUp(email, password);
      else await signIn(email, password);
      await offerRestore();
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = [styles.input, { backgroundColor: c.card, borderColor: c.border, color: c.text }];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: 'الحساب' }} />
      <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Card>
          <View style={styles.row}>
            <Chip label="تسجيل الدخول" selected={mode === 'signin'} onPress={() => setMode('signin')} />
            <Chip label="حساب جديد" selected={mode === 'signup'} onPress={() => setMode('signup')} />
          </View>
          <Muted>الحساب بيستخدم بس للنسخ الاحتياطي واسترجاع وصفاتك وملفك. كل حاجة بتفضل محفوظة على موبايلك.</Muted>
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: c.text }]}>الإيميل</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="name@example.com"
              placeholderTextColor={c.muted}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              style={[inputStyle, { writingDirection: 'ltr' }]}
            />
          </View>
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: c.text }]}>كلمة السر</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="8 حروف أو أكتر"
              placeholderTextColor={c.muted}
              secureTextEntry
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              onSubmitEditing={submit}
              style={[inputStyle, { writingDirection: 'ltr' }]}
            />
          </View>
          {error ? <Text style={{ color: c.danger, fontWeight: '600' }}>{error}</Text> : null}
          <Button label={mode === 'signup' ? 'اعمل الحساب' : 'دخول'} icon={mode === 'signup' ? 'person-add-outline' : 'log-in-outline'} onPress={submit} loading={busy} />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.lg, gap: space.lg, maxWidth: 560, width: '100%', alignSelf: 'center' },
  row: { flexDirection: 'row', gap: space.sm },
  label: { fontSize: 15, fontWeight: '700' },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12, fontSize: 16 },
});
