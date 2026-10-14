/**
 * Persistent voice settings (AsyncStorage `hermes.voice.settings.v1`), global store.
 * Loaded lazily on first use; `useVoiceSettings()` re-renders on change.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';
import { DEFAULT_VOICE_SETTINGS, normalizeVoiceSettings } from './format';
import type { VoiceSettings } from './types';

const KEY = 'hermes.voice.settings.v1';

let state: VoiceSettings = DEFAULT_VOICE_SETTINGS;
let loadPromise: Promise<VoiceSettings> | null = null;
/** fields the user changed before the stored settings were read: they win over the stored values */
const touched = new Set<keyof VoiceSettings>();
let hydrated = false;
let writeChain: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getVoiceSettings(): VoiceSettings {
  return state;
}

/** Load once from storage (subsequent calls return the same promise). */
export function loadVoiceSettings(): Promise<VoiceSettings> {
  if (!loadPromise) {
    loadPromise = AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (raw) {
          try {
            const stored = normalizeVoiceSettings(JSON.parse(raw));
            // a change made while the read was running keeps its value; everything else comes from storage
            const mine: Partial<VoiceSettings> = {};
            for (const k of touched) (mine as Record<string, unknown>)[k] = state[k];
            state = normalizeVoiceSettings({ ...stored, ...mine });
            emit();
          } catch {
            // corrupted → defaults
          }
        }
        return state;
      })
      .catch(() => state)
      .finally(() => {
        hydrated = true;
        touched.clear();
      });
  }
  return loadPromise;
}

export function updateVoiceSettings(patch: Partial<VoiceSettings>): void {
  if (!hydrated) for (const k of Object.keys(patch) as (keyof VoiceSettings)[]) touched.add(k);
  state = normalizeVoiceSettings({ ...state, ...patch });
  emit();
  // write after the stored values were merged in (otherwise defaults would overwrite them), in call order
  writeChain = writeChain
    .then(() => loadVoiceSettings())
    .then(() => AsyncStorage.setItem(KEY, JSON.stringify(state)))
    .catch(() => undefined);
}

export function subscribeVoiceSettings(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** `[settings, update]`; triggers the lazy load on first mount. */
export function useVoiceSettings(): [VoiceSettings, (patch: Partial<VoiceSettings>) => void] {
  const s = useSyncExternalStore(subscribeVoiceSettings, getVoiceSettings, getVoiceSettings);
  useEffect(() => {
    void loadVoiceSettings();
  }, []);
  return [s, updateVoiceSettings];
}
