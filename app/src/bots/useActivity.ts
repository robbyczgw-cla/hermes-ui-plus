/**
 * Shared poller for `GET /bridge/bots/activity` (bots/activity.ts): one request per connection every POLL_MS while at
 * least one view watches (the Bots tab, an open Bot Chat) and the app is in the foreground. Bridge connections only; a
 * direct Hermes connection or an older bridge gives UNKNOWN_ACTIVITY (the app then shows only its own running chats).
 */
import { fetch as expoFetch } from 'expo/fetch';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import type { FetchLike } from '../hermes/stream';
import { fetchActivity, stopRemoteTurn } from './aboutApi';
import { UNKNOWN_ACTIVITY, type ActivitySnapshot } from './activity';

const fetchImpl = expoFetch as unknown as FetchLike;
export const ACTIVITY_POLL_MS = 5_000;
/** after this many "unknown" answers in a row (older bridge) poll slowly */
const SLOW_AFTER = 3;
const SLOW_MS = 60_000;

type Conn = { id: string; baseUrl: string; apiKey: string };
type Entry = { snap: ActivitySnapshot; watchers: number; timer: ReturnType<typeof setTimeout> | null; misses: number; inflight: boolean; conn: Conn };

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  for (const f of Array.from(listeners)) f();
};
let foreground = AppState.currentState === 'active' || Platform.OS === 'web';

function schedule(e: Entry, ms: number) {
  if (e.timer) clearTimeout(e.timer);
  e.timer = setTimeout(() => void tick(e), ms);
}

async function tick(e: Entry) {
  e.timer = null;
  if (!e.watchers || !foreground || e.inflight) return;
  e.inflight = true;
  try {
    const snap = await fetchActivity(fetchImpl, e.conn);
    e.misses = snap.known ? 0 : e.misses + 1;
    e.snap = snap;
    emit();
  } finally {
    e.inflight = false;
    if (e.watchers && foreground) schedule(e, e.misses >= SLOW_AFTER ? SLOW_MS : ACTIVITY_POLL_MS);
  }
}

AppState.addEventListener?.('change', (s) => {
  const next = s === 'active' || Platform.OS === 'web';
  if (next === foreground) return;
  foreground = next;
  for (const e of entries.values()) {
    if (!foreground && e.timer) {
      clearTimeout(e.timer);
      e.timer = null;
    } else if (foreground && e.watchers) schedule(e, 0);
  }
});

function watch(conn: Conn): () => void {
  let e = entries.get(conn.id);
  if (!e || e.conn.baseUrl !== conn.baseUrl || e.conn.apiKey !== conn.apiKey) {
    if (e?.timer) clearTimeout(e.timer);
    e = { snap: UNKNOWN_ACTIVITY, watchers: 0, timer: null, misses: 0, inflight: false, conn };
    entries.set(conn.id, e);
  }
  const entry = e;
  entry.watchers++;
  if (entry.watchers === 1) schedule(entry, 0);
  return () => {
    entry.watchers--;
    if (!entry.watchers && entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
  };
}

/** Ask for a fresh snapshot now (a turn started or ended here, Stop was pressed). */
export function refreshActivity(profileId: string): void {
  const e = entries.get(profileId);
  if (e?.watchers) schedule(e, 300);
}

type Profile = { id: string; kind: string; bridge?: boolean; baseUrl: string; apiKey: string } | undefined;

export function useActivity(p: Profile, enabled = true): ActivitySnapshot {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
    () => version,
  );
  const ok = enabled && !!p && p.kind === 'hermes' && !!p.bridge && !!p.apiKey && /^https?:\/\//i.test(p.baseUrl);
  const id = p?.id ?? '';
  const baseUrl = p?.baseUrl ?? '';
  const apiKey = p?.apiKey ?? '';
  useEffect(() => {
    if (!ok) return;
    return watch({ id, baseUrl, apiKey });
  }, [ok, id, baseUrl, apiKey]);
  return ok ? (entries.get(id)?.snap ?? UNKNOWN_ACTIVITY) : UNKNOWN_ACTIVITY;
}

/** Stop a Bot Chat turn the bridge runs for another device / a lost stream (POST /bridge/chat/stop). */
export function stopBridgeTurn(conn: { baseUrl: string; apiKey: string }, bot: string | null | undefined, sessionId: string) {
  return stopRemoteTurn(fetchImpl, conn, bot, sessionId);
}
