/**
 * Favorites + recently used models per profile (AsyncStorage `hui.modelPrefs.<profileId>`), shared
 * by the in-chat picker and the profile editor. Module-level cache = source of truth; subscribers
 * re-render on change. Logic in modelSearch.ts (tested).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { EMPTY_PREFS, parsePrefs, pushRecent, toggleFavorite, type ModelPrefs } from './modelSearch';

const mem = new Map<string, ModelPrefs>();
const listeners = new Map<string, Set<() => void>>();
const storageKey = (profileId: string) => `hui.modelPrefs.${profileId.replace(/[^A-Za-z0-9._-]/g, '_')}`;

function set(profileId: string, next: ModelPrefs) {
  mem.set(profileId, next);
  listeners.get(profileId)?.forEach((l) => l());
  AsyncStorage.setItem(storageKey(profileId), JSON.stringify(next)).catch(() => {});
}

export type UseModelPrefs = {
  prefs: ModelPrefs;
  toggleFavorite(id: string): void;
  /** remember a pick (newest first); the "Standard" pick (undefined) is ignored */
  recordUse(id: string | undefined): void;
};

export function useModelPrefs(profileId: string): UseModelPrefs {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    let set_ = listeners.get(profileId);
    if (!set_) listeners.set(profileId, (set_ = new Set()));
    set_.add(l);
    if (!mem.has(profileId)) {
      AsyncStorage.getItem(storageKey(profileId))
        .then((raw) => {
          if (mem.has(profileId)) return;
          mem.set(profileId, parsePrefs(raw));
          listeners.get(profileId)?.forEach((x) => x());
        })
        .catch(() => {});
    }
    return () => {
      set_.delete(l);
    };
  }, [profileId]);

  const toggle = useCallback((id: string) => set(profileId, toggleFavorite(mem.get(profileId) ?? EMPTY_PREFS, id)), [profileId]);
  const recordUse = useCallback(
    (id: string | undefined) => {
      const cur = mem.get(profileId) ?? EMPTY_PREFS;
      const next = pushRecent(cur, id);
      if (next !== cur) set(profileId, next);
    },
    [profileId]
  );
  return { prefs: mem.get(profileId) ?? EMPTY_PREFS, toggleFavorite: toggle, recordUse };
}
