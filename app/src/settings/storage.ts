// Persistence: profile metadata in AsyncStorage, API keys and custom request headers in expo-secure-store
// (Keychain / Android Keystore).
//
// WEB (incl. the installed PWA): expo-secure-store has no web implementation (its web module is empty), so keys
// are stored with AsyncStorage, which on web is `window.localStorage` of the app's origin – plain text, readable
// by any script running on that origin and by anyone with access to the unlocked browser profile. Deliberate
// trade-off for the web app: there is no better at-rest store in the browser without a server-side session.
// Mitigations: serve the app only on a trusted origin (tailnet, HTTPS), no third-party scripts, the key is never
// shown in the UI (masked), and a profile delete removes it. iOS home-screen web apps keep their own storage
// (separate from Safari). Use scoped, revocable tokens for web profiles (see docs/BUILD.md "Web-App (PWA)").
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { migrateStoredProfiles, serializeStoredProfiles, type StoredProfile } from './migrate';
import type { ConnectionProfile } from './profiles';
import { headersSlot, legacyHeaders, restoreHeaders, serializeHeaders, withoutHeaders } from './secretHeaders';

const PROFILES_KEY = 'hermes.profiles.v1';
const ACTIVE_KEY = 'hermes.activeProfile.v1';
/**
 * raw copy of an unparseable profile list (kept until the user deletes app data; never overwritten). A later,
 * DIFFERENT corrupt value goes to `${PROFILES_CORRUPT_KEY}.2` … `.${PROFILES_CORRUPT_SLOTS}`; once all are taken
 * the last slot holds the latest one (bounded storage, the first copy always survives).
 */
export const PROFILES_CORRUPT_KEY = `${PROFILES_KEY}.corrupt`;
export const PROFILES_CORRUPT_SLOTS = 5;
const corruptSlotKey = (n: number) => (n === 1 ? PROFILES_CORRUPT_KEY : `${PROFILES_CORRUPT_KEY}.${n}`);

/** keep a quarantine copy of `raw` unless an identical one exists (a storage error propagates: caller handles it) */
async function quarantineCorrupt(raw: string): Promise<void> {
  for (let n = 1; n <= PROFILES_CORRUPT_SLOTS; n++) {
    const key = corruptSlotKey(n);
    const existing = await AsyncStorage.getItem(key).catch(() => null);
    if (existing === raw) return;
    if (existing === null || n === PROFILES_CORRUPT_SLOTS) {
      await AsyncStorage.setItem(key, raw);
      return;
    }
  }
}
/** raw copy of a newer-format list, taken when the user unlocks writing with this (older) version */
export const PROFILES_NEWER_KEY = `${PROFILES_KEY}.newer`;

/**
 * What loadProfiles found (Settings shows a notice):
 *  - `recovered`: the stored list was unreadable JSON → started empty, the raw value is in PROFILES_CORRUPT_KEY
 *  - `newer`: written by a newer app version → READ-ONLY until the user explicitly unlocks (unlockProfiles)
 *  - `unreadable`: storage could not be read at all → READ-ONLY (saving now would replace the real list)
 */
export type ProfilesStorageState = 'ok' | 'recovered' | 'newer' | 'unreadable';

let storageState: ProfilesStorageState = 'ok';
const readOnly = () => storageState === 'newer' || storageState === 'unreadable';

export function profilesStorageState(): ProfilesStorageState {
  return storageState;
}

/** saveProfiles refused: the stored list is read-only (newer version / unreadable) until unlockProfiles() */
export class ProfilesReadOnlyError extends Error {
  readonly code = 'profiles_read_only';
  constructor() {
    super('Gespeicherte Verbindungen sind schreibgeschützt (neuere App-Version oder Lesefehler). Einstellungen → Verbindungen.');
    this.name = 'ProfilesReadOnlyError';
  }
}

export function isProfilesReadOnlyError(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === 'profiles_read_only';
}

/**
 * The user chose to overwrite the read-only list with this version's format: keep a raw copy of a newer-format list
 * first (PROFILES_NEWER_KEY), then allow saving again. Fields this version doesn't know are lost on the next save.
 */
export async function unlockProfiles(): Promise<void> {
  if (!readOnly()) return;
  if (storageState === 'newer') {
    const raw = await AsyncStorage.getItem(PROFILES_KEY);
    if (raw) await AsyncStorage.setItem(PROFILES_NEWER_KEY, raw);
  }
  storageState = 'ok';
}
const keyName = (id: string) => `hermes.apikey.${id.replace(/[^A-Za-z0-9._-]/g, '_')}`;

async function getSecret(id: string): Promise<string> {
  try {
    if (Platform.OS === 'web') return (await AsyncStorage.getItem(keyName(id))) ?? '';
    return (await SecureStore.getItemAsync(keyName(id))) ?? '';
  } catch {
    return '';
  }
}

async function setSecret(id: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (value) await AsyncStorage.setItem(keyName(id), value);
    else await AsyncStorage.removeItem(keyName(id));
    return;
  }
  if (value) await SecureStore.setItemAsync(keyName(id), value);
  else await SecureStore.deleteItemAsync(keyName(id));
}

/**
 * Load + migrate (settings/migrate.ts). A migrated list is written back once; the old preset ids are kept,
 * so their secure-store keys and the conversations bound to them stay valid.
 */
export async function loadProfiles(): Promise<{ profiles: ConnectionProfile[]; activeId: string | null }> {
  let stored: StoredProfile[] = [];
  storageState = 'ok';
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(PROFILES_KEY);
  } catch {
    // NOT "no profiles": never let a save replace the list we could not read
    storageState = 'unreadable';
    raw = null;
  }
  try {
    const m = migrateStoredProfiles(raw);
    stored = m.profiles;
    if (m.corrupt && raw) {
      // keep what was there (first copy wins, a different later value gets its own slot), then go on empty
      storageState = 'recovered';
      await quarantineCorrupt(raw);
    }
    if (m.newer) storageState = 'newer';
    // custom headers may hold secrets: move headers stored with the metadata by older builds to the
    // secure store first, then rewrite the metadata without them
    const legacy = legacyHeaders(stored);
    let moved = false;
    if (legacy.length) {
      moved = await Promise.all(legacy.map((h) => setSecret(headersSlot(h.id), h.value)))
        .then(() => true)
        .catch(() => false);
    }
    const meta = moved ? stored.map(withoutHeaders) : stored;
    if ((m.changed || moved) && !readOnly()) await AsyncStorage.setItem(PROFILES_KEY, serializeStoredProfiles(meta)).catch(() => {});
  } catch {
    stored = [];
    // the quarantine copy could not be written: don't overwrite the original either
    if (storageState === 'recovered') storageState = 'unreadable';
  }
  const profiles = await Promise.all(
    stored.map(async (p) => {
      const headers = restoreHeaders(await getSecret(headersSlot(p.id)), p.headers);
      return { ...withoutHeaders(p), ...(headers ? { headers } : {}), apiKey: await getSecret(p.id) };
    }),
  );
  const activeId = await AsyncStorage.getItem(ACTIVE_KEY).catch(() => null);
  return { profiles, activeId };
}

/**
 * Persist the list. Order: changed secrets (API key, headers), secrets of removed profiles, then the metadata.
 * It throws on the first failure and `previous` must stay the baseline for the retry (settings/profileStore.ts):
 * every step is idempotent, so a retry only repeats what the compare against the persisted state still shows.
 */
export async function saveProfiles(profiles: ConnectionProfile[], previous: ConnectionProfile[]): Promise<void> {
  if (readOnly()) throw new ProfilesReadOnlyError();
  const prevKeys = new Map(previous.map((p) => [p.id, p.apiKey]));
  const prevHeaders = new Map(previous.map((p) => [p.id, serializeHeaders(p.headers)]));
  const removed = previous.filter((p) => !profiles.some((q) => q.id === p.id));
  const results = await Promise.allSettled([
    ...profiles.filter((p) => prevKeys.get(p.id) !== p.apiKey).map((p) => setSecret(p.id, p.apiKey)),
    ...profiles
      .filter((p) => prevHeaders.get(p.id) !== serializeHeaders(p.headers) || !prevHeaders.has(p.id))
      .map((p) => setSecret(headersSlot(p.id), serializeHeaders(p.headers))),
    // before the metadata: a failed delete keeps the profile listed (retry works) instead of orphaning its key
    ...removed.flatMap((p) => [setSecret(p.id, ''), setSecret(headersSlot(p.id), '')]),
  ]);
  // settle everything first: a retry must not race writes of the failed attempt that are still running
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) throw failed.reason;
  const meta: StoredProfile[] = profiles.map(({ apiKey: _k, ...rest }) => withoutHeaders(rest));
  await AsyncStorage.setItem(PROFILES_KEY, serializeStoredProfiles(meta));
}

export async function saveActiveId(id: string): Promise<void> {
  await AsyncStorage.setItem(ACTIVE_KEY, id);
}

/** Own image-search provider key (Settings → Medien → Bildersuche), one slot per provider; same store as the profile keys. */
export const loadImageKey = (provider: string): Promise<string> => getSecret(`imgsearch.${provider}`);
export const saveImageKey = (provider: string, value: string): Promise<void> => setSecret(`imgsearch.${provider}`, value.trim());

/**
 * Pending recovery of a redeemed pair code (onboarding/pairRecovery.ts): the device token of a redeem whose profile
 * save failed. Same store and protection as the profile keys; '' = none (saving '' deletes it).
 */
export const loadPairRecoverySecret = (): Promise<string> => getSecret('pairRecovery');
export const savePairRecoverySecret = (value: string): Promise<void> => setSecret('pairRecovery', value);
