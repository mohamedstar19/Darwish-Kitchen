import { Stack, useLocalSearchParams } from 'expo-router';
import { FlatList } from 'react-native';
import { RecipeListItem } from '../../components/RecipeListItem';
import { EmptyState } from '../../components/ui';
import { openRecipe } from '../../lib/open-recipe';
import { SECTION_TITLES, useProfileSections, type ProfileSection } from '../../lib/profile-lists';
import { space, useTheme } from '../../theme';

const EMPTY_MESSAGES: Record<ProfileSection, string> = {
  added: 'الوصفات اللي هتضيفها هتظهر هنا.',
  liked: 'دوس "أعجبني" في أي وصفة علشان تظهر هنا.',
  rated: 'قيّم أي وصفة بالنجوم علشان تظهر هنا.',
  viewed: 'الوصفات اللي هتفتحها هتظهر هنا.',
};

export default function ProfileSectionScreen() {
  const c = useTheme();
  const { section: raw } = useLocalSearchParams<{ section: string }>();
  const section: ProfileSection = raw in SECTION_TITLES ? (raw as ProfileSection) : 'viewed';
  const items = useProfileSections()[section];

  return (
    <>
      <Stack.Screen options={{ title: SECTION_TITLES[section] }} />
      <FlatList
        style={{ backgroundColor: c.background }}
        data={items}
        keyExtractor={(i) => i.key}
        contentContainerStyle={{ padding: space.lg, gap: space.md, maxWidth: 720, width: '100%', alignSelf: 'center' }}
        renderItem={({ item }) => (
          <RecipeListItem
            title={item.title}
            image={item.image}
            mealTypes={item.mealTypes}
            minutes={item.minutes}
            subtitle={[item.stars ? '★'.repeat(item.stars) : '', item.ref.kind === 'web' ? 'من النت' : ''].filter(Boolean).join('  •  ')}
            onPress={() => openRecipe(item.ref)}
          />
        )}
        ListEmptyComponent={<EmptyState icon="file-tray-outline" title="لسه مفيش حاجة" message={EMPTY_MESSAGES[section]} />}
      />
    </>
  );
}
