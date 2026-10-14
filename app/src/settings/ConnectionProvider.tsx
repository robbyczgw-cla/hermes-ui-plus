import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { setWebImageBridge, bridgeConnFromProfiles } from '../images/web';
import { setTrustedImageOrigins } from '../images/trust';
import { partitionByFlavor } from '../flavor';
import { parseDevProfiles } from './devProfiles';
import {
  builtinProfiles,
  mergeWithBuiltins,
  cleanBaseUrl,
  pickActiveId,
  PRESET_DEMO_ID,
  type ConnectionProfile,
} from './profiles';
import { createProfileStore } from './profileStore';
import { loadProfiles, profilesStorageState, saveActiveId, saveProfiles, unlockProfiles as unlockStoredProfiles, type ProfilesStorageState } from './storage';

// Personal dev builds only (docs/BUILD.md "Dev profiles"): EXPO_PUBLIC_* values are inlined into the
// JS bundle at build time. Must be read with static dot access so Expo can inline it.
// Dev profiles of kinds this flavor hides are dropped (flavor.ts).
const DEV_RAW = parseDevProfiles(process.env.EXPO_PUBLIC_DEV_PROFILES);
const DEV = (() => {
  const profiles = partitionByFlavor(DEV_RAW.profiles).visible;
  return { ...DEV_RAW, profiles, activeId: profiles.some((p) => p.id === DEV_RAW.activeId) ? DEV_RAW.activeId : undefined };
})();
if (DEV.error) console.warn(DEV.error);
/** true when this bundle contains dev profiles (Settings shows a warning footnote). */
export const HAS_DEV_PROFILES = DEV.profiles.length > 0;

type ConnectionContextValue = {
  ready: boolean;
  profiles: ConnectionProfile[];
  active: ConnectionProfile;
  setActive(id: string): void;
  upsertProfile(p: ConnectionProfile): Promise<void>;
  deleteProfile(id: string): Promise<void>;
  /** built-in profiles (demo + dev profiles) cannot be deleted */
  isBuiltin(id: string): boolean;
  /** what loading the stored list found (storage.ts): `newer` / `unreadable` = read-only until `unlockProfiles()` */
  storageState: ProfilesStorageState;
  /** the user explicitly allows overwriting a read-only list with this version's format */
  unlockProfiles(): Promise<void>;
};

const Ctx = createContext<ConnectionContextValue | null>(null);

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const builtins = useMemo(() => [...builtinProfiles(), ...DEV.profiles], []);
  const builtinIds = useMemo(() => new Set(builtins.map((b) => b.id)), [builtins]);
  const [activeId, setActiveId] = useState<string>(() => pickActiveId(builtins, null, DEV.activeId));
  const [ready, setReady] = useState(false);
  const [storageState, setStorageState] = useState<ProfilesStorageState>('ok');
  // profile list: serialized mutations, published only after the write succeeded (settings/profileStore.ts)
  const store = useMemo(
    () =>
      createProfileStore({
        initial: builtins,
        builtinIds,
        save: saveProfiles,
        clean: (p) => ({
          ...p,
          name: p.name.trim(),
          baseUrl: cleanBaseUrl(p.kind, p.baseUrl),
          apiKey: p.apiKey.trim(),
          model: p.model?.trim() || undefined,
          sessionKey: p.sessionKey?.trim() || undefined,
        }),
        // stored profiles of kinds this build hides (flavor.ts): never shown, written back unchanged
        load: async () => {
          const { profiles: stored, activeId: storedActive } = await loadProfiles();
          const { visible, hidden } = partitionByFlavor(stored);
          const merged = mergeWithBuiltins(visible, builtins);
          return { visible: merged, hidden, activeId: storedActive };
        },
      }),
    [builtins, builtinIds],
  );
  const profiles = useSyncExternalStore(store.subscribe, store.get, store.get);

  useEffect(() => {
    let alive = true;
    void store.init().then((storedActive) => {
      if (!alive) return;
      if (storedActive !== undefined) setActiveId(pickActiveId(store.get(), storedActive, DEV.activeId));
      setStorageState(profilesStorageState());
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [store]);

  // Web image search always uses the user's Hermes bridge profile, whichever profile is active.
  useEffect(() => setWebImageBridge(bridgeConnFromProfiles(profiles, activeId)), [profiles, activeId]);
  // signed attachment links of the user's own servers load without a tap (images/trust.ts, review H1)
  useEffect(() => setTrustedImageOrigins(profiles.map((p) => p.baseUrl)), [profiles]);

  const setActive = useCallback((id: string) => {
    setActiveId(id);
    saveActiveId(id).catch(() => {});
  }, []);

  const upsertProfile = useCallback((p: ConnectionProfile) => store.upsert(p), [store]);

  const deleteProfile = useCallback(
    async (id: string) => {
      if (!(await store.remove(id))) return;
      const next = store.get();
      setActiveId((cur) => {
        if (cur !== id) return cur;
        const fallback = pickActiveId(next, null, DEV.activeId);
        saveActiveId(fallback).catch(() => {});
        return fallback;
      });
    },
    [store],
  );

  const isBuiltin = useCallback((id: string) => builtinIds.has(id), [builtinIds]);

  const unlockProfiles = useCallback(async () => {
    await unlockStoredProfiles();
    setStorageState(profilesStorageState());
  }, []);

  const active = profiles.find((p) => p.id === activeId) ?? profiles.find((p) => p.id === PRESET_DEMO_ID) ?? profiles[0];
  const value = useMemo(
    () => ({ ready, profiles, active, setActive, upsertProfile, deleteProfile, isBuiltin, storageState, unlockProfiles }),
    [ready, profiles, active, setActive, upsertProfile, deleteProfile, isBuiltin, storageState, unlockProfiles],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Active profile or null outside <ConnectionProvider> (Gallery, tests) – for optional cosmetics like the persona loader. */
export function useActiveProfile(): ConnectionProfile | null {
  return useContext(Ctx)?.active ?? null;
}

export function useConnection(): ConnectionContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useConnection() outside <ConnectionProvider>');
  return v;
}
