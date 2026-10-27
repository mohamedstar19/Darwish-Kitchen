import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { displayPhone } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { backupNow, deleteAccount, getBackupMeta, getServerBackupDate, restoreBackup, type BackupMeta } from '../lib/backup';
import { confirm, notify } from '../lib/confirm';
import { useReloadData } from '../lib/data-reload';
import { formatDateTime } from '../lib/format';
import { space, useTheme } from '../theme';
import { Button, Card, Muted } from './ui';

type Busy = null | 'backup' | 'restore' | 'delete';

/** Account + backup controls on the profile tab. */
export function BackupCard() {
  const c = useTheme();
  const { auth, phone, signOut, refresh } = useAuth();
  const reload = useReloadData();
  const [meta, setMeta] = useState<BackupMeta>({});
  const [busy, setBusy] = useState<Busy>(null);

  useFocusEffect(
    useCallback(() => {
      getBackupMeta().then(setMeta);
    }, [auth]),
  );

  if (!auth) {
    return (
      <Card>
        <Title text="الحساب والنسخ الاحتياطي" />
        <Muted>بياناتك محفوظة على الموبايل. سجّل برقم موبايلك علشان تاخد نسخة احتياطية من وصفاتك وملفك وترجّعها لو غيّرت الموبايل.</Muted>
        <Button label="سجّل برقم الموبايل" icon="phone-portrait-outline" onPress={() => router.push('/account')} />
      </Card>
    );
  }

  const fail = (title: string, e: unknown) => {
    const code = (e as { code?: string }).code;
    if (code === 'signed-out') {
      refresh();
      return notify(title, 'انتهت جلسة الدخول. سجّل دخول تاني.');
    }
    notify(
      title,
      code === 'no-backup'
        ? 'مفيش نسخة احتياطية على حسابك لسه.'
        : code === 'too-large'
          ? 'النسخة أكبر من المسموح. قلّل عدد الصور وجرب تاني.'
          : 'اتأكد من الإنترنت وجرب تاني.',
    );
  };

  const doBackup = async () => {
    try {
      // A phone that never backed up or restored could be a new phone: don't overwrite silently.
      if (!meta.lastBackupAt && !meta.lastRestoreAt) {
        const server = await getServerBackupDate();
        if (
          server &&
          !(await confirm('فيه نسخة على السيرفر', `حسابك عليه نسخة من ${formatDateTime(server)}. لو كمّلت هتتبدل ببيانات الموبايل ده. لو عايز ترجّعها دوس "إلغاء" وبعدين "استرجاع".`, 'كمّل'))
        )
          return;
      }
      setBusy('backup');
      const result = await backupNow();
      setMeta(await getBackupMeta());
      notify('تم النسخ الاحتياطي ✅', `اتحفظ ${result.recipes} وصفة مع ملفك وتقييماتك.`);
    } catch (e) {
      fail('مقدرناش ناخد نسخة احتياطية', e);
    } finally {
      setBusy(null);
    }
  };

  const doRestore = async () => {
    if (!(await confirm('استرجاع النسخة', 'البيانات اللي على الموبايل هتتبدل بالنسخة اللي على السيرفر. متأكد؟', 'استرجاع'))) return;
    setBusy('restore');
    try {
      const result = await restoreBackup();
      reload();
      setMeta(await getBackupMeta());
      notify('تم الاسترجاع ✅', `رجعنا ${result.recipes} وصفة.`);
    } catch (e) {
      fail('مقدرناش نسترجع النسخة', e);
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async () => {
    if (!(await confirm('حذف الحساب', 'هنمسح حسابك والنسخة الاحتياطية من السيرفر نهائيًا. البيانات اللي على الموبايل هتفضل زي ما هي.', 'حذف نهائي'))) return;
    setBusy('delete');
    try {
      await deleteAccount();
      await refresh();
      setMeta({});
      notify('اتمسح الحساب');
    } catch (e) {
      fail('مقدرناش نمسح الحساب', e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <Title text="الحساب والنسخ الاحتياطي" />
      <View style={{ gap: 2 }}>
        <Text style={{ color: c.text, fontWeight: '700', writingDirection: 'ltr', textAlign: 'auto' }}>{phone ? displayPhone(phone) : ''}</Text>
        <Muted>{meta.lastBackupAt ? `آخر نسخة احتياطية: ${formatDateTime(meta.lastBackupAt)}` : 'لسه مخدتش نسخة احتياطية.'}</Muted>
        <Muted style={{ fontSize: 12 }}>بعد أول نسخة، التطبيق بياخد نسخة لوحده مرة كل يوم وانت مسجّل.</Muted>
      </View>
      <View style={styles.row}>
        <Button label="نسخ احتياطي" icon="cloud-upload-outline" onPress={doBackup} loading={busy === 'backup'} disabled={!!busy} style={{ flex: 1 }} />
        <Button label="استرجاع" icon="cloud-download-outline" variant="secondary" onPress={doRestore} loading={busy === 'restore'} disabled={!!busy} style={{ flex: 1 }} />
      </View>
      <View style={styles.row}>
        <Button label="تسجيل الخروج" icon="log-out-outline" variant="ghost" onPress={signOut} disabled={!!busy} style={{ flex: 1 }} />
        <Button label="حذف الحساب" icon="trash-outline" variant="danger" onPress={doDelete} loading={busy === 'delete'} disabled={!!busy} style={{ flex: 1 }} />
      </View>
    </Card>
  );
}

function Title({ text }: { text: string }) {
  const c = useTheme();
  return <Text style={[styles.title, { color: c.text }]}>{text}</Text>;
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: '800' },
  row: { flexDirection: 'row', gap: space.sm },
});
