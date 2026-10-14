/**
 * Wide-screen sidebar (≥ 900 px): collapsed flag + width, remembered across launches (AsyncStorage,
 * device-local UI state – not part of the synced preferences).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { createStore } from '../background/noticeState';
import { DEFAULT_SIDEBAR, parseSidebarPrefs, type SidebarPrefs } from '../ui/lib/layout';

const KEY = 'hermes.sidebar.v1';

const store = createStore<SidebarPrefs>(DEFAULT_SIDEBAR);
let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  void AsyncStorage.getItem(KEY)
    .then((raw) => store.set(parseSidebarPrefs(raw)))
    .catch(() => {});
}

/** `persist: false` while dragging the width (stored once on release) */
export function setSidebarPrefs(patch: Partial<SidebarPrefs>, persist = true): void {
  const next = { ...store.get(), ...patch };
  store.set(next);
  if (persist) void AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
}

export function toggleSidebar(): void {
  setSidebarPrefs({ collapsed: !store.get().collapsed });
}

export function useSidebarPrefs(): SidebarPrefs {
  load();
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
