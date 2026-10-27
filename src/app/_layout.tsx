import { DarkTheme, DefaultTheme, LocaleProvider, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { I18nManager, Platform, useColorScheme } from 'react-native';
import { ActivityProvider } from '../lib/activity-context';
import { AuthProvider } from '../lib/auth-context';
import { DarwishProvider } from '../lib/darwish-context';
import { DataGenerationContext } from '../lib/data-reload';
import { ProfileProvider } from '../lib/profile-context';
import { RecipesProvider } from '../lib/recipes-context';
import { useTheme } from '../theme';

// The app is Arabic-first. Native builds force RTL through app.json; this also covers Expo Go
// (it takes effect after the app is reopened once).
if (Platform.OS !== 'web' && !I18nManager.isRTL) {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
}

export default function RootLayout() {
  const scheme = useColorScheme();
  const c = useTheme();

  useEffect(() => {
    if (Platform.OS === 'web') {
      document.documentElement.dir = 'rtl';
      document.documentElement.lang = 'ar';
    }
  }, []);

  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: { ...base.colors, primary: c.primary, background: c.background, card: c.card, text: c.text, border: c.border },
  };

  return (
    <LocaleProvider direction="rtl">
      <ThemeProvider value={navTheme}>
        <AuthProvider>
          <DarwishProvider>
          <DataProviders>
            <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
            <Stack
              screenOptions={{
                headerTitleStyle: { fontWeight: '800' },
                headerBackButtonDisplayMode: 'minimal',
                contentStyle: { backgroundColor: c.background },
              }}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'الرئيسية' }} />
              <Stack.Screen name="recipe/[id]" options={{ title: 'الوصفة' }} />
              <Stack.Screen name="recipe/edit" options={{ title: 'وصفة جديدة', presentation: 'modal' }} />
              <Stack.Screen name="online/[id]" options={{ title: 'وصفة من النت' }} />
              <Stack.Screen name="profile/edit" options={{ title: 'الملف الشخصي', presentation: 'modal' }} />
              <Stack.Screen name="profile/[section]" options={{ title: 'وصفاتي' }} />
              <Stack.Screen name="account" options={{ title: 'الحساب', presentation: 'modal' }} />
              <Stack.Screen name="darwish/index" options={{ title: 'وصفات درويش' }} />
              <Stack.Screen name="darwish/[id]" options={{ title: 'من مطبخ درويش' }} />
              <Stack.Screen name="feed/[id]" options={{ title: 'وصفة شيف' }} />
              <Stack.Screen name="admin/index" options={{ title: 'لوحة التحكم' }} />
              <Stack.Screen name="admin/edit" options={{ title: 'وصفة الكتالوج' }} />
              <Stack.Screen name="admin/photos" options={{ title: 'صور بالذكاء الاصطناعي' }} />
              <Stack.Screen name="ai/fridge" options={{ title: 'عندي في التلاجة' }} />
            </Stack>
          </DataProviders>
          </DarwishProvider>
        </AuthProvider>
      </ThemeProvider>
    </LocaleProvider>
  );
}

/** On-device data providers. `reload` makes them re-read storage (used after a restore). */
function DataProviders({ children }: { children: ReactNode }) {
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration((g) => g + 1), []);
  const value = useMemo(() => ({ generation, reload }), [generation, reload]);
  return (
    <DataGenerationContext.Provider value={value}>
      <RecipesProvider>
        <ProfileProvider>
          <ActivityProvider>{children}</ActivityProvider>
        </ProfileProvider>
      </RecipesProvider>
    </DataGenerationContext.Provider>
  );
}
