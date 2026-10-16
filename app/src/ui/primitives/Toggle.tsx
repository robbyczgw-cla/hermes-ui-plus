import { Platform, Switch, type SwitchProps } from 'react-native';
import { useTheme } from '../theme';

/**
 * The one on/off switch: brand track (accent on, borderStrong off) and a light thumb on every platform. Plain RN
 * `Switch` falls back to platform defaults – on web that is a teal thumb (#009688) on the accent track.
 * iOS keeps its native white thumb; Android/web get `surface` (light) or `text` (dark), both near-white.
 */
export function Toggle(props: SwitchProps) {
  const t = useTheme();
  const thumb = Platform.OS === 'ios' ? undefined : t.dark ? t.colors.text : t.colors.surface;
  // react-native-web reads the on-state thumb from `activeThumbColor` (not in the RN types)
  const web = Platform.OS === 'web' ? ({ activeThumbColor: thumb } as object) : null;
  return <Switch trackColor={{ true: t.colors.accent, false: t.colors.borderControl }} ios_backgroundColor={t.colors.borderControl} thumbColor={thumb} {...web} {...props} />;
}
