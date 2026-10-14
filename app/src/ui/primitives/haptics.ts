import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

export type HapticKind = 'selection' | 'light' | 'medium' | 'success' | 'warning';

let enabled = true;

/** App-wide haptics switch (Settings → Bedienung → Haptik). Set by the preferences provider. */
export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

export function hapticsEnabled(): boolean {
  return enabled && Platform.OS !== 'web';
}

/** Fire-and-forget haptic feedback. No-op on web or when disabled in settings. Never throws. */
export function haptic(kind: HapticKind = 'light'): void {
  if (!hapticsEnabled()) return;
  let p: Promise<void>;
  switch (kind) {
    case 'selection':
      p = Haptics.selectionAsync();
      break;
    case 'medium':
      p = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      break;
    case 'success':
      p = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      break;
    case 'warning':
      p = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      break;
    default:
      p = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
  p.catch(() => {});
}
