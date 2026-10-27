import { useColorScheme } from 'react-native';

const light = {
  background: '#FFF8F1',
  card: '#FFFFFF',
  cardAlt: '#FCEFE3',
  text: '#2B1D14',
  muted: '#7C6A5C',
  border: '#F0E2D3',
  primary: '#C2410C',
  primaryText: '#FFFFFF',
  primarySoft: '#FDE7D7',
  accent: '#15803D',
  accentSoft: '#DCFCE7',
  danger: '#B91C1C',
  overlay: 'rgba(0,0,0,0.35)',
};

export type Theme = typeof light;

const dark: Theme = {
  background: '#17120E',
  card: '#231B15',
  cardAlt: '#2E231B',
  text: '#F7EDE4',
  muted: '#B9A797',
  border: '#3A2D23',
  primary: '#F97316',
  primaryText: '#1B0F06',
  primarySoft: '#3D2414',
  accent: '#4ADE80',
  accentSoft: '#163020',
  danger: '#F87171',
  overlay: 'rgba(0,0,0,0.55)',
};

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export const radius = { sm: 10, md: 16, lg: 24, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
