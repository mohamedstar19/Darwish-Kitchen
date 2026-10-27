import { Ionicons } from '@expo/vector-icons';
import { Image, View } from 'react-native';
import { useTheme } from '../theme';

export function Avatar({ uri, size = 88 }: { uri?: string; size?: number }) {
  const c = useTheme();
  const shape = { width: size, height: size, borderRadius: size / 2, backgroundColor: c.primarySoft };
  if (uri) return <Image source={{ uri }} style={shape} accessibilityIgnoresInvertColors />;
  return (
    <View style={[shape, { alignItems: 'center', justifyContent: 'center' }]}>
      <Ionicons name="person" size={size * 0.5} color={c.primary} />
    </View>
  );
}
