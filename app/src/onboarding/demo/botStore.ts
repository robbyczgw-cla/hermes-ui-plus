// What the demo remembers about its bots on this device (onboarding/demo/bots.ts): the bots made with "Neuer Bot" and
// whether Scout's waiting approval was answered. AsyncStorage only, never sent anywhere. Loaded once per app run.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { createStore } from '../../background/noticeState';
import { isTemplateId } from '../../bots/create/core';
import { isBotName } from '../../hermes/bots';
import type { DemoCreatedBot } from './bots';

export type DemoBotsState = {
  loaded: boolean;
  created: DemoCreatedBot[];
  /** Scout's approval: waiting until answered (allow / deny / stop) */
  scoutApproval: 'waiting' | 'answered';
};

const KEY = 'hui.demoBots.v1';
const store = createStore<DemoBotsState>({ loaded: false, created: [], scoutApproval: 'waiting' });
let loading = false;

function sanitize(raw: unknown): Omit<DemoBotsState, 'loaded'> {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const created = (Array.isArray(o.created) ? o.created : [])
    .filter((b): b is DemoCreatedBot => {
      const x = b as Partial<DemoCreatedBot> | null;
      return !!x && isBotName(x.name) && typeof x.label === 'string' && typeof x.job === 'string' && typeof x.how === 'string' && isTemplateId(x.template) && typeof x.color === 'string';
    })
    .slice(0, 20);
  return { created, scoutApproval: o.scoutApproval === 'answered' ? 'answered' : 'waiting' };
}

function load(): void {
  if (loading) return;
  loading = true;
  void AsyncStorage.getItem(KEY)
    .then((v) => store.set({ loaded: true, ...sanitize(v ? JSON.parse(v) : null) }))
    .catch(() => store.set({ ...store.get(), loaded: true }));
}

function persist(next: DemoBotsState): void {
  store.set(next);
  void AsyncStorage.setItem(KEY, JSON.stringify({ created: next.created, scoutApproval: next.scoutApproval })).catch(() => {});
}

export const demoBotStore = {
  get: () => {
    load();
    return store.get();
  },
  subscribe: store.subscribe,
  addCreated(bot: DemoCreatedBot): void {
    const cur = store.get();
    persist({ ...cur, created: [...cur.created.filter((b) => b.name !== bot.name), bot] });
  },
  answerScout(): void {
    const cur = store.get();
    if (cur.scoutApproval !== 'answered') persist({ ...cur, scoutApproval: 'answered' });
  },
};

export function useDemoBotsState(): DemoBotsState {
  load();
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
