/**
 * Own voice API keys (STT / TTS), stored like profile API keys: expo-secure-store on Android/iOS
 * (Keychain / Keystore), AsyncStorage (= localStorage of the app origin) on web – same documented
 * trade-off as settings/storage.ts. The values are kept in memory for requests only; they are never
 * logged, never put into settings JSON and never shown in the UI (only "saved" / "not saved").
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

export type VoiceKeySlot = 'stt' | 'tts';

const IS_WEB = Platform.OS === 'web';
const keyName = (slot: VoiceKeySlot) => `hermes.voice.apikey.${slot}`;

const values: Record<VoiceKeySlot, string> = { stt: '', tts: '' };
let snapshot: Record<VoiceKeySlot, boolean> = { stt: false, tts: false };
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  snapshot = { stt: !!values.stt, tts: !!values.tts };
  for (const l of listeners) l();
}

async function read(slot: VoiceKeySlot): Promise<string> {
  try {
    return (IS_WEB ? await AsyncStorage.getItem(keyName(slot)) : await SecureStore.getItemAsync(keyName(slot))) ?? '';
  } catch {
    return '';
  }
}

export function loadVoiceApiKeys(): Promise<void> {
  if (!loadPromise) {
    const dirty = { ...values };
    loadPromise = Promise.all([read('stt'), read('tts')]).then(([stt, tts]) => {
      // a key typed before the load finished wins
      if (values.stt === dirty.stt) values.stt = stt;
      if (values.tts === dirty.tts) values.tts = tts;
      emit();
    });
  }
  return loadPromise;
}

/** The saved key ('' = none). */
export async function getVoiceApiKey(slot: VoiceKeySlot): Promise<string> {
  await loadVoiceApiKeys();
  return values[slot];
}

/** Save ('' deletes). Throws if the secure store refuses. */
export async function setVoiceApiKey(slot: VoiceKeySlot, value: string): Promise<void> {
  const v = value.trim();
  if (IS_WEB) {
    if (v) await AsyncStorage.setItem(keyName(slot), v);
    else await AsyncStorage.removeItem(keyName(slot));
  } else if (v) {
    await SecureStore.setItemAsync(keyName(slot), v);
  } else {
    await SecureStore.deleteItemAsync(keyName(slot));
  }
  values[slot] = v;
  emit();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const getSnapshot = () => snapshot;

/** `{stt, tts}` = key saved; loads lazily on first mount. */
export function useVoiceApiKeys(): Record<VoiceKeySlot, boolean> {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    void loadVoiceApiKeys();
  }, []);
  return s;
}
