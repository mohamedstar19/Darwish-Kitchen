import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/ui';
import { notify } from '../../lib/confirm';
import { goBack } from '../../lib/nav';
import { pickImage, type ImageSource } from '../../lib/images';
import { useAuth } from '../../lib/auth-context';
import { useProfile } from '../../lib/profile-context';
import { syncChefProfile } from '../../lib/publish';
import { radius, space, useTheme } from '../../theme';

export default function EditProfileScreen() {
  const { ready } = useProfile();
  if (!ready) return <ActivityIndicator style={{ marginTop: 60 }} />;
  return <ProfileForm />;
}

function ProfileForm() {
  const c = useTheme();
  const { profile, updateProfile } = useProfile();
  const { auth } = useAuth();
  const [avatar, setAvatar] = useState(profile.avatar);
  const [name, setName] = useState(profile.name);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [busyImage, setBusyImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const choose = async (source: ImageSource) => {
    setBusyImage(true);
    try {
      const uri = await pickImage(source, { target: 'profile-images', square: true });
      if (uri) setAvatar(uri);
    } catch (e) {
      notify('مقدرناش نضيف الصورة', (e as Error).message.endsWith('permission') ? 'محتاجين إذن الوصول للكاميرا أو الصور من إعدادات الموبايل.' : 'جرّب صورة تانية.');
    } finally {
      setBusyImage(false);
    }
  };

  const save = async () => {
    if (!name.trim()) return setError('اكتب اسمك.');
    setSaving(true);
    try {
      const changes = { name: name.trim(), bio: bio.trim() || undefined, phone: phone.trim() || undefined, avatar };
      await updateProfile(changes);
      // Name and photo also show on the recipes I published in the feed.
      if (auth) syncChefProfile({ ...profile, ...changes, updatedAt: Date.now() }).catch(() => {});
      goBack('/profile');
    } catch {
      notify('مقدرناش نحفظ الملف', 'مساحة التخزين ممكن تكون مليانة.');
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, props: TextInputProps) => (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { color: c.text }]}>{label}</Text>
      <TextInput
        placeholderTextColor={c.muted}
        {...props}
        style={[styles.input, props.multiline && { minHeight: 90, textAlignVertical: 'top' }, { backgroundColor: c.card, borderColor: c.border, color: c.text }]}
      />
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: 'الملف الشخصي' }} />
      <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', gap: space.md }}>
          <Pressable onPress={() => choose('library')} accessibilityLabel="تغيير الصورة الشخصية" disabled={busyImage}>
            <Avatar uri={avatar} size={120} />
          </Pressable>
          <View style={styles.row}>
            {Platform.OS !== 'web' ? (
              <Button label="الكاميرا" icon="camera-outline" variant="secondary" onPress={() => choose('camera')} loading={busyImage} />
            ) : null}
            <Button label={Platform.OS === 'web' ? 'اختار صورة' : 'من الصور'} icon="images-outline" variant="secondary" onPress={() => choose('library')} loading={busyImage} />
            {avatar ? <Button label="شيل" icon="trash-outline" variant="danger" onPress={() => setAvatar(undefined)} /> : null}
          </View>
        </View>

        {field('الاسم *', { value: name, onChangeText: setName, placeholder: 'اسمك', autoComplete: 'name' })}
        {field('نبذة عنك', { value: bio, onChangeText: setBio, placeholder: 'مثلاً: بحب الأكل البيتي', multiline: true })}
        {field('رقم الموبايل', { value: phone, onChangeText: setPhone, placeholder: 'اختياري', keyboardType: 'phone-pad', autoComplete: 'tel' })}

        {error ? <Text style={{ color: c.danger, fontWeight: '600' }}>• {error}</Text> : null}
        <Text style={{ color: c.muted, fontSize: 12, lineHeight: 18 }}>بياناتك بتتحفظ على الموبايل بس، وبتتنسخ على السيرفر لو عملت نسخة احتياطية.</Text>
        <Button label="حفظ" icon="checkmark" onPress={save} loading={saving} disabled={busyImage} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.lg, gap: space.lg, paddingBottom: 48, maxWidth: 720, width: '100%', alignSelf: 'center' },
  label: { fontSize: 15, fontWeight: '700' },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12, fontSize: 16 },
  row: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap', justifyContent: 'center' },
});
