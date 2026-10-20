/**
 * Persistence of the "What's new" hint (whatsnew/model.ts): the version it was last shown for, and the launch's
 * decision. The decision is made once per app start, before onboarding can finish: a fresh install that is being set
 * up right now must not see the hint after its first setup.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { loadOnboardedFlag, hasLegacySetup } from '../onboarding/storage';
import { decideWhatsNew, type WhatsNewRelease } from './model';

export const WHATS_NEW_KEY = 'hui.whatsNew.seen.v1';

export const appVersion = (): string | undefined => Constants.expoConfig?.version;

let decision: Promise<WhatsNewRelease | null> | null = null;
/** the sheet was opened (or dismissed) in this app run: no second sheet from another chat view */
let claimed = false;

/** This launch's release to show (null: nothing). Read once per app run; a fresh install is recorded right away. */
export function whatsNewForLaunch(): Promise<WhatsNewRelease | null> {
  decision ??= (async () => {
    const current = appVersion();
    try {
      const [seen, flag, legacy] = await Promise.all([AsyncStorage.getItem(WHATS_NEW_KEY), loadOnboardedFlag(), hasLegacySetup()]);
      const d = decideWhatsNew({ current, seen, existingUser: !!flag || legacy });
      if (d.record && current) await AsyncStorage.setItem(WHATS_NEW_KEY, current).catch(() => {});
      return d.show;
    } catch {
      return null;
    }
  })();
  return decision;
}

/** Shown now: never again for this version (also when the app is closed without tapping anything). */
export function markWhatsNewShown(): void {
  claimed = true;
  const current = appVersion();
  if (current) void AsyncStorage.setItem(WHATS_NEW_KEY, current).catch(() => {});
}

export const whatsNewClaimed = (): boolean => claimed;
