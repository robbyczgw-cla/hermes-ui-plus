/**
 * Device-local quick state (AsyncStorage, never synced): the thread per connection (profile id) and the quick
 * settings. Thread entries expire after 24 h (pruned on load, on every write and when the app comes back).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import type { ChatMessage } from '../hermes/types';
import { DEFAULT_QUICK_SETTINGS, parseQuickSettings, parseStoredThread, pruneExpired, serializeThread, type QuickModel, type QuickSettings } from './core';

const THREAD_KEY = (profileId: string) => `hui.quick.thread.v1.${profileId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
const SETTINGS_KEY = 'hui.quick.settings.v1';

type Listener = () => void;

// ───────────────────────── thread ─────────────────────────

const threads = new Map<string, ChatMessage[]>();
const loading = new Map<string, Promise<ChatMessage[]>>();
/** bumped by clearThread: a mounted quick chat drops its messages */
const clearListeners = new Set<(profileId: string) => void>();

export function loadThread(profileId: string): Promise<ChatMessage[]> {
  const hit = threads.get(profileId);
  if (hit) {
    const fresh = [...pruneExpired(hit, Date.now())];
    threads.set(profileId, fresh);
    return Promise.resolve(fresh);
  }
  const running = loading.get(profileId);
  if (running) return running;
  const p = AsyncStorage.getItem(THREAD_KEY(profileId))
    .catch(() => null)
    .then((raw) => {
      const list = threads.get(profileId) ?? parseStoredThread(raw, Date.now());
      threads.set(profileId, list);
      loading.delete(profileId);
      return list;
    });
  loading.set(profileId, p);
  return p;
}

export function saveThread(profileId: string, messages: readonly ChatMessage[]): void {
  const list = [...pruneExpired(messages, Date.now())];
  threads.set(profileId, list);
  if (!list.length) void AsyncStorage.removeItem(THREAD_KEY(profileId)).catch(() => {});
  else void AsyncStorage.setItem(THREAD_KEY(profileId), serializeThread(list)).catch(() => {});
}

/** "Schnellfragen löschen" (settings, thread menu) */
export function clearThread(profileId: string): void {
  saveThread(profileId, []);
  for (const fn of clearListeners) fn(profileId);
}

export function onThreadCleared(fn: (profileId: string) => void): () => void {
  clearListeners.add(fn);
  return () => {
    clearListeners.delete(fn);
  };
}

// ───────────────────────── settings ─────────────────────────

let settings: QuickSettings = DEFAULT_QUICK_SETTINGS;
let settingsLoaded = false;
const settingsListeners = new Set<Listener>();

function loadSettings(): void {
  if (settingsLoaded) return;
  settingsLoaded = true;
  void AsyncStorage.getItem(SETTINGS_KEY)
    .then((raw) => {
      if (raw) setSettings(parseQuickSettings(raw), false);
    })
    .catch(() => {});
}

function setSettings(next: QuickSettings, persist = true): void {
  settings = next;
  for (const fn of settingsListeners) fn();
  if (persist) void AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next)).catch(() => {});
}

export function getQuickSettings(): QuickSettings {
  loadSettings();
  return settings;
}

export function setShowInComposer(on: boolean): void {
  setSettings({ ...settings, showInComposer: on });
}

/** undefined = the server default ("Hermes-Standard") */
export function setQuickModel(profileId: string, model: QuickModel | undefined): void {
  const models = { ...settings.models };
  if (model) models[profileId] = model;
  else delete models[profileId];
  setSettings({ ...settings, models });
}

export function useQuickSettings(): QuickSettings {
  loadSettings();
  return useSyncExternalStore(
    (fn) => {
      settingsListeners.add(fn);
      return () => {
        settingsListeners.delete(fn);
      };
    },
    () => settings,
    () => settings,
  );
}
