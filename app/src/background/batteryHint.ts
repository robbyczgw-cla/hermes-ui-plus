/**
 * One-time Android hint after a cut answer: set the app's battery usage to "Uneingeschränkt". Opens the app's
 * system settings page (App info → Akku) – no REQUEST_IGNORE_BATTERY_OPTIMIZATIONS permission: Google Play only
 * allows the direct exemption request for apps whose core function breaks under Doze (chat apps: not acceptable).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';
import { createStore } from './noticeState';

const STORAGE_ID = 'hermes.batteryHint.v1';

/** null = not loaded yet */
export const batteryHintDone = createStore<boolean | null>(null);

let loading = false;
export function loadBatteryHint(): void {
  if (loading || batteryHintDone.get() !== null) return;
  loading = true;
  if (Platform.OS !== 'android') {
    batteryHintDone.set(true);
    return;
  }
  void AsyncStorage.getItem(STORAGE_ID)
    .then((v) => batteryHintDone.set(v === '1'))
    .catch(() => batteryHintDone.set(false));
}

export function dismissBatteryHint(): void {
  batteryHintDone.set(true);
  void AsyncStorage.setItem(STORAGE_ID, '1').catch(() => {});
}

/** App info screen of this app (Akku → "Uneingeschränkt"; OEMs like vivo: "Hintergrundaktivität erlauben") */
export async function openBatterySettings(): Promise<void> {
  dismissBatteryHint();
  try {
    await Linking.openSettings();
  } catch {
    try {
      await Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
    } catch {
      /* nothing to open */
    }
  }
}
