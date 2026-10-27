import { router, Stack } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Card, Muted } from '../components/ui';
import { displayPhone } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { getBackupMeta, getServerBackupDate, restoreBackup } from '../lib/backup';
import { confirm, notify } from '../lib/confirm';
import { useReloadData } from '../lib/data-reload';
import { formatDateTime } from '../lib/format';
import { goBack } from '../lib/nav';
import { useProfile } from '../lib/profile-context';
import { radius, space, useTheme } from '../theme';

const RESEND_SECONDS = 60;

const ERRORS: Record<string, string> = {
  'invalid-phone': 'اكتب رقم موبايل صحيح، مثلاً 01001234567.',
  'wrong-code': 'الكود غلط. اتأكد منه وجرب تاني.',
  'code-expired': 'الكود انتهى. اطلب كود جديد.',
  'too-many-attempts': 'محاولات كتير. استنى شوية وجرب تاني.',
  'otp-unavailable': 'إرسال الأكواد مش متاح دلوقتي. جرب بعد شوية.',
  'otp-send-failed': 'مقدرناش نبعت الكود. جرب تاني بعد شوية.',
};

function errorMessage(e: unknown): string {
  return ERRORS[(e as { code?: string }).code ?? ''] ?? 'حصلت مشكلة. اتأكد من الإنترنت وجرب تاني.';
}

export default function AccountScreen() {
  const c = useTheme();
  const { sendCode, verifyCode } = useAuth();
  const { profile, updateProfile } = useProfile();
  const reload = useReloadData();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [wait, setWait] = useState(0);
  const codeInput = useRef<ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  /** On a phone that never synced, offer the account's backup right after login. */
  const offerRestore = async () => {
    const meta = await getBackupMeta();
    if (meta.lastBackupAt || meta.lastRestoreAt) return false;
    const server = await getServerBackupDate().catch(() => null);
    if (!server) return false;
    if (!(await confirm('لقينا نسخة احتياطية', `حسابك عليه نسخة من ${formatDateTime(server)}. تحب ترجّعها على الموبايل ده؟ (البيانات الحالية هتتبدل)`, 'استرجاع'))) return false;
    try {
      const result = await restoreBackup();
      reload();
      notify('تم الاسترجاع ✅', `رجعنا ${result.recipes} وصفة.`);
      return true;
    } catch {
      notify('مقدرناش نسترجع النسخة', 'تقدر تجرب تاني من صفحة حسابي.');
      return false;
    }
  };

  const requestCode = async () => {
    setError('');
    if (phone.replace(/\D/g, '').length < 8) return setError(ERRORS['invalid-phone']);
    setBusy(true);
    try {
      await sendCode(phone);
      setStep('code');
      setCode('');
      setWait(RESEND_SECONDS);
      setTimeout(() => codeInput.current?.focus(), 100);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    setError('');
    if (!/^\d{4,8}$/.test(code.trim())) return setError('اكتب الكود اللي وصلك.');
    setBusy(true);
    try {
      const auth = await verifyCode(phone, code.trim());
      const restored = await offerRestore();
      // Fill the profile's phone the first time, unless a restore just brought one.
      if (!restored && !profile.phone) await updateProfile({ phone: displayPhone(auth.phone) }).catch(() => {});
      goBack('/profile');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = [styles.input, { backgroundColor: c.card, borderColor: c.border, color: c.text }];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: 'تسجيل الدخول' }} />
      <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Card>
          {step === 'phone' ? (
            <>
              <Text style={[styles.title, { color: c.text }]}>رقم الموبايل</Text>
              <Muted>هنبعتلك كود على واتساب. الحساب بيستخدم بس للنسخ الاحتياطي واسترجاع وصفاتك وملفك، وكل حاجة بتفضل محفوظة على موبايلك.</Muted>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="01001234567"
                placeholderTextColor={c.muted}
                keyboardType="phone-pad"
                autoComplete="tel"
                textContentType="telephoneNumber"
                onSubmitEditing={requestCode}
                style={[inputStyle, styles.ltr]}
              />
              <Muted style={{ fontSize: 12 }}>لو رقمك من برّه مصر اكتبه بكود الدولة، مثلاً ‎+9665xxxxxxxx</Muted>
              {error ? <Text style={{ color: c.danger, fontWeight: '600' }}>{error}</Text> : null}
              <Button label="ابعتلي الكود" icon="logo-whatsapp" onPress={requestCode} loading={busy} />
            </>
          ) : (
            <>
              <Text style={[styles.title, { color: c.text }]}>اكتب الكود</Text>
              <Muted>{`بعتنا كود على واتساب للرقم ${phone}.`}</Muted>
              <TextInput
                ref={codeInput}
                value={code}
                onChangeText={(t) => setCode(t.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/\D/g, '').slice(0, 8))}
                placeholder="••••••"
                placeholderTextColor={c.muted}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={8}
                onSubmitEditing={submitCode}
                style={[inputStyle, styles.ltr, styles.code]}
              />
              {error ? <Text style={{ color: c.danger, fontWeight: '600' }}>{error}</Text> : null}
              <Button label="دخول" icon="log-in-outline" onPress={submitCode} loading={busy} />
              <View style={styles.row}>
                <Button
                  label={wait > 0 ? `ابعت تاني (${wait})` : 'ابعت الكود تاني'}
                  variant="ghost"
                  onPress={requestCode}
                  disabled={wait > 0 || busy}
                  style={{ flex: 1 }}
                />
                <Button
                  label="غيّر الرقم"
                  variant="ghost"
                  onPress={() => {
                    setStep('phone');
                    setError('');
                  }}
                  disabled={busy}
                  style={{ flex: 1 }}
                />
              </View>
            </>
          )}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.lg, gap: space.lg, maxWidth: 560, width: '100%', alignSelf: 'center' },
  title: { fontSize: 18, fontWeight: '800' },
  row: { flexDirection: 'row', gap: space.sm },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12, fontSize: 18 },
  ltr: { writingDirection: 'ltr', textAlign: 'center' },
  code: { fontSize: 26, letterSpacing: 8, fontWeight: '800' },
});
