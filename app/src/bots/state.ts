/**
 * App-wide bot state (bots/core.ts): the attention store ("Wartet auf dich"), the drawer tab (Chats | Bots, remembered
 * per device like the sidebar) and bots the server refused (no key → "Nicht verbunden").
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createStore } from '../background/noticeState';
import { ATTENTION_GRACE_MS, createAttentionStore, type AttentionItem } from './core';

export const attention = createAttentionStore();

/** Live attention items, oldest first; re-renders when one passes its deadline. */
export function useAttention(): AttentionItem[] {
  const ver = useSyncExternalStore(attention.subscribe, attention.version, attention.version);
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => attention.snapshot(), [ver, tick]);
  const next = items.reduce((m, i) => (i.expiresAt && i.expiresAt < m ? i.expiresAt : m), Infinity);
  useEffect(() => {
    if (!Number.isFinite(next)) return;
    const id = setTimeout(() => setTick((n) => n + 1), Math.max(1000, next + ATTENTION_GRACE_MS - Date.now() + 50));
    return () => clearTimeout(id);
  }, [next]);
  return items;
}

// ------------------------------------------------------------------ drawer tab

export type DrawerTab = 'chats' | 'bots';
const TAB_KEY = 'hermes.drawerTab.v1';
const tabStore = createStore<DrawerTab>('chats');
let tabLoaded = false;

export function setDrawerTab(tab: DrawerTab): void {
  tabStore.set(tab);
  void AsyncStorage.setItem(TAB_KEY, tab).catch(() => {});
}

function loadTab(): void {
  if (tabLoaded) return;
  tabLoaded = true;
  void AsyncStorage.getItem(TAB_KEY)
    .then((v) => {
      if (v === 'bots' || v === 'chats') tabStore.set(v);
    })
    .catch(() => {});
}

export function useDrawerTab(): DrawerTab {
  loadTab();
  return useSyncExternalStore(tabStore.subscribe, tabStore.get, tabStore.get);
}

// ------------------------------------------------------------------ bots the server refused

/** `${profileId}/${botKey}` of bots whose Bot Chat lookup answered 401/403 (profile without API_SERVER_KEY) */
export const unreachableStore = createStore<ReadonlySet<string>>(new Set());

export function setUnreachable(key: string, on: boolean): void {
  const cur = unreachableStore.get();
  if (cur.has(key) === on) return;
  const next = new Set(cur);
  if (on) next.add(key);
  else next.delete(key);
  unreachableStore.set(next);
}

export function useUnreachable(): ReadonlySet<string> {
  return useSyncExternalStore(unreachableStore.subscribe, unreachableStore.get, unreachableStore.get);
}

// ------------------------------------------------------------------ chats publish their pending approvals

type PendingApproval = { runId: string; requestId?: string; timestamp: number; receivedAt?: number; deadlineAt?: number; expiresAt?: number; expired?: boolean };

/**
 * A mounted Hermes chat (open or running in the background) reports its pending approval cards for "Wartet auf dich"
 * (bots/core.ts). Expired cards are not reported; unmounting clears them.
 */
export function useReportAttention(conversationId: string | undefined, profileId: string, bot: string | undefined, approvals: readonly PendingApproval[] | undefined): void {
  const key = (approvals ?? [])
    .filter((a) => !a.expired)
    .map((a) => `${a.requestId ?? a.runId}:${a.deadlineAt ?? a.expiresAt ?? ''}`)
    .join('|');
  useEffect(() => {
    if (!conversationId) return;
    const list = (approvals ?? [])
      .filter((a) => !a.expired)
      .map((a) => ({
        requestId: a.requestId ?? a.runId,
        runId: a.runId,
        profileId,
        bot,
        // Hermes' timestamp is server seconds; the device time it arrived is better when known
        since: a.receivedAt ?? (a.timestamp < 1e11 ? a.timestamp * 1000 : a.timestamp),
        ...(a.deadlineAt ?? a.expiresAt ? { expiresAt: a.deadlineAt ?? a.expiresAt } : {}),
      }));
    attention.setChat(conversationId, list);
    // `key` covers what matters of `approvals` (a new array on every streaming update)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, profileId, bot, key]);
  useEffect(() => {
    if (!conversationId) return;
    return () => attention.setChat(conversationId, []);
  }, [conversationId]);
}
