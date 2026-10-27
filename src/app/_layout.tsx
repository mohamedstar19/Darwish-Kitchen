import { DarkTheme, DefaultTheme, LocaleProvider, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { I18nManager, Platform, useColorScheme } from 'react-native';
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
        <RecipesProvider>
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
          </Stack>
        </RecipesProvider>
      </ThemeProvider>
    </LocaleProvider>
  );
}
