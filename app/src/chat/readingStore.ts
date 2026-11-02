/**
 * Storage of the per-chat reading state (readingState.ts): one AsyncStorage record, read once at the first use,
 * written debounced and right away when the app goes to the background (a kill after that loses nothing typed).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { useSyncExternalStore } from 'react';
import { createStore } from '../background/noticeState';
import { draftIdsIn, forgetReadingIn, moveDraftIn, parseReading, patchReading, type ChatReading, type ReadingMap, type ReadingPatch } from './readingState';

const KEY = 'hui.reading.v1';
const WRITE_MS = 400;

const store = createStore<ReadingMap>({});
const loadedStore = createStore(false);
let loading: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;
const movesBeforeLoad: [string, string][] = [];

function load(): Promise<void> {
  if (loading) return loading;
  loading = AsyncStorage.getItem(KEY)
    .then((raw) => {
      // changes made before the record was read win over the stored ones
      const stored = parseReading(raw);
      store.set(movesBeforeLoad.reduce((map, [from, to]) => moveDraftIn(map, from, to, Date.now()), { ...stored, ...store.get() }));
      if (movesBeforeLoad.length) schedule();
    })
    .catch(() => {})
    .finally(() => loadedStore.set(true));
  AppState.addEventListener('change', (s) => {
    if (s !== 'active') flushReading();
  });
  return loading;
}

export function flushReading(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!dirty || !loadedStore.get()) return;
  dirty = false;
  void AsyncStorage.setItem(KEY, JSON.stringify(store.get())).catch(() => {});
}

function schedule(): void {
  dirty = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(flushReading, WRITE_MS);
}

/** the chat's stored state (undefined until the record is read: `useReadingLoaded`) */
export function getReading(id: string | undefined): ChatReading | undefined {
  void load();
  return id ? store.get()[id] : undefined;
}

export function updateReading(id: string | undefined, patch: ReadingPatch): void {
  if (!id) return;
  void load();
  const next = patchReading(store.get(), id, patch, Date.now());
  if (next === store.get()) return;
  store.set(next);
  schedule();
}

/** a deleted chat: its draft and position go too */
export function forgetReading(id: string): void {
  const next = forgetReadingIn(store.get(), id);
  if (next === store.get()) return;
  store.set(next);
  schedule();
}

/** the chat `to` replaces `from` (a bot's talk moving on): the unsent draft goes along */
export function moveReadingDraft(from: string, to: string): void {
  if (!loadedStore.get()) {
    movesBeforeLoad.push([from, to]);
    void load();
    return;
  }
  const next = moveDraftIn(store.get(), from, to, Date.now());
  if (next === store.get()) return;
  store.set(next);
  schedule();
}

/** chats with an unsent draft saved; complete once `readingReady` resolved */
export function savedDraftIds(): string[] {
  return draftIdsIn(store.get());
}

/** true once the stored record was read (a restored draft / position can be applied) */
export function useReadingLoaded(): boolean {
  void load();
  return useSyncExternalStore(loadedStore.subscribe, loadedStore.get, loadedStore.get);
}

/** resolves when the stored record was read */
export function readingReady(): Promise<void> {
  return load();
}
