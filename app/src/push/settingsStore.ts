/**
 * Per-profile notification settings (AsyncStorage `hui.push.v1`, no secrets: device tokens are not secret
 * on their own and are needed to unregister). Tiny external store for useSyncExternalStore.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { DEFAULT_PUSH_SETTINGS, type PushProfileSettings } from './model';

const KEY = 'hui.push.v1';
type State = { loaded: boolean; profiles: Record<string, PushProfileSettings> };

let state: State = { loaded: false, profiles: {} };
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

function emit() {
  for (const l of listeners) l();
}

export function loadPushSettings(): Promise<void> {
  if (!loading) {
    loading = AsyncStorage.getItem(KEY)
      .then((raw) => {
        const doc = raw ? (JSON.parse(raw) as { profiles?: Record<string, PushProfileSettings> }) : null;
        state = { loaded: true, profiles: doc?.profiles && typeof doc.profiles === 'object' ? doc.profiles : {} };
      })
      .catch(() => {
        state = { loaded: true, profiles: {} };
      })
      .finally(emit);
  }
  return loading;
}

export function getPushSettings(profileId: string): PushProfileSettings {
  return { ...DEFAULT_PUSH_SETTINGS, ...state.profiles[profileId] };
}

export function allPushSettings(): Record<string, PushProfileSettings> {
  return state.profiles;
}

export function setPushSettings(profileId: string, patch: Partial<PushProfileSettings>): PushProfileSettings {
  const next = { ...getPushSettings(profileId), ...patch };
  state = { ...state, profiles: { ...state.profiles, [profileId]: next } };
  emit();
  void AsyncStorage.setItem(KEY, JSON.stringify({ profiles: state.profiles })).catch(() => {});
  return next;
}

export function removePushSettings(profileId: string): void {
  if (!state.profiles[profileId]) return;
  const rest = { ...state.profiles };
  delete rest[profileId];
  state = { ...state, profiles: rest };
  emit();
  void AsyncStorage.setItem(KEY, JSON.stringify({ profiles: rest })).catch(() => {});
}

function subscribe(l: () => void) {
  listeners.add(l);
  void loadPushSettings();
  return () => listeners.delete(l);
}
const snapshot = () => state;

export function usePushSettingsState(): State {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
