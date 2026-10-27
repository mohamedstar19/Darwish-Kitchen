import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../../components/Avatar';
import { BackupCard } from '../../components/BackupCard';
import { Button, Card, Muted, RecipeImage, type IconName } from '../../components/ui';
import { openRecipe } from '../../lib/open-recipe';
import { useAuth } from '../../lib/auth-context';
import { useProfile } from '../../lib/profile-context';
import { SECTION_TITLES, useProfileSections, type ProfileSection } from '../../lib/profile-lists';
import { radius, space, useTheme } from '../../theme';

const STATS: { key: ProfileSection; label: string; icon: IconName }[] = [
  { key: 'added', label: 'ضفتها', icon: 'add-circle-outline' },
  { key: 'liked', label: 'عجبتني', icon: 'heart-outline' },
  { key: 'rated', label: 'قيّمتها', icon: 'star-outline' },
  { key: 'viewed', label: 'شفتها', icon: 'eye-outline' },
];

export default function ProfileScreen() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const { profile } = useProfile();
  const { auth } = useAuth();
  const sections = useProfileSections();
  const recent = sections.viewed.slice(0, 10);

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={[styles.container, { paddingTop: insets.top + space.lg }]}>
      <Card style={styles.header}>
        <Avatar uri={profile.avatar} size={96} />
        <Text style={[styles.name, { color: c.text }]}>{profile.name || 'أهلاً بيك 👋'}</Text>
        {profile.bio ? <Muted style={{ textAlign: 'center' }}>{profile.bio}</Muted> : null}
        {profile.phone ? <Muted style={{ writingDirection: 'ltr' }}>{profile.phone}</Muted> : null}
        <Button
          label={profile.name ? 'تعديل الملف الشخصي' : 'اعمل ملفك الشخصي'}
          icon="create-outline"
          variant="secondary"
          onPress={() => router.push('/profile/edit')}
        />
      </Card>

      <View style={styles.stats}>
        {STATS.map((s) => (
          <Pressable
            key={s.key}
            accessibilityRole="button"
            accessibilityLabel={SECTION_TITLES[s.key]}
            onPress={() => router.push({ pathname: '/profile/[section]', params: { section: s.key } })}
            style={({ pressed }) => [styles.stat, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.8 : 1 }]}>
            <Ionicons name={s.icon} size={22} color={c.primary} />
            <Text style={[styles.statNum, { color: c.text }]}>{sections[s.key].length}</Text>
            <Text style={{ color: c.muted, fontSize: 13 }}>{s.label}</Text>
          </Pressable>
        ))}
      </View>

      {recent.length ? (
        <View style={{ gap: space.sm }}>
          <View style={styles.sectionHead}>
            <Text style={[styles.sectionTitle, { color: c.text }]}>آخر وصفات شفتها</Text>
            <Button label="الكل" variant="ghost" onPress={() => router.push({ pathname: '/profile/[section]', params: { section: 'viewed' } })} />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.md }}>
            {recent.map((item) => (
              <Pressable key={item.key} onPress={() => openRecipe(item.ref)} style={styles.recentItem} accessibilityRole="button">
                <RecipeImage uri={item.image} height={100} iconSize={30} />
                <Text numberOfLines={2} style={{ color: c.text, fontWeight: '700', fontSize: 13 }}>
                  {item.title}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {auth?.isAdmin ? (
        <Button label="لوحة التحكم (صور ووصفات للكل)" icon="construct-outline" onPress={() => router.push('/admin')} />
      ) : null}

      <BackupCard />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.lg, gap: space.lg, paddingBottom: 40, maxWidth: 720, width: '100%', alignSelf: 'center' },
  header: { alignItems: 'center' },
  name: { fontSize: 22, fontWeight: '900', textAlign: 'center' },
  stats: { flexDirection: 'row', gap: space.sm },
  stat: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: space.md, borderRadius: radius.md, borderWidth: 1 },
  statNum: { fontSize: 20, fontWeight: '900' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 18, fontWeight: '800' },
  recentItem: { width: 130, gap: 6 },
});
