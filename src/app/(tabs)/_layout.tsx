import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme';

export default function TabsLayout() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.muted,
        // Arabic labels need more room than the default bar height.
        tabBarStyle: {
          backgroundColor: c.card,
          borderTopColor: c.border,
          height: 62 + insets.bottom,
          paddingTop: 6,
          paddingBottom: insets.bottom + 6,
        },
        tabBarItemStyle: { height: 56, paddingVertical: 2 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '700' },
        headerStyle: { backgroundColor: c.background },
        headerTitleStyle: { fontWeight: '800', color: c.text },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: c.background },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'اقتراح اليوم',
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Ionicons name="sparkles" color={String(color)} size={size} />,
        }}
      />
      <Tabs.Screen
        name="recipes"
        options={{
          title: 'وصفاتي',
          tabBarIcon: ({ color, size }) => <Ionicons name="book" color={String(color)} size={size} />,
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: 'من النت',
          tabBarIcon: ({ color, size }) => <Ionicons name="globe-outline" color={String(color)} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'حسابي',
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" color={String(color)} size={size} />,
        }}
      />
    </Tabs>
  );
}
