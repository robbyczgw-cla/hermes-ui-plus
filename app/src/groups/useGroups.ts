/**
 * Bot groups of a bridge connection (groups/core.ts): `GET /bridge/groups` once per server, cached app-wide and
 * re-read while something runs (a round, a pending approval). Bridge connections only: a direct Hermes, the demo or an
 * older bridge answer nothing we understand (null) and the app shows no groups at all.
 *
 * `useGroupApprovals` feeds a bot's own chat (chat/ChatView.tsx): an approval a group member asked for is answered
 * there, never in the group (spec 2.6).
 */
import { fetch as expoFetch } from 'expo/fetch';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { answerApproval } from '../hermes/client';
import { withBot } from '../hermes/bots';
import type { FetchLike } from '../hermes/stream';
import type { ApprovalChoice, ApprovalRequest } from '../hermes/types';
import { useT } from '../i18n';
import { createGroup, fetchGroups, type Conn, type Result } from './api';
import { toApprovalRequest, type GroupInfo, type GroupsList } from './core';

export const fetchImpl = expoFetch as unknown as FetchLike;
const TTL_MS = 30_000;
const LIVE_POLL_MS = 4000;

type Entry = { at: number; list: GroupsList | null; loading?: Promise<void> };
const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  for (const f of Array.from(listeners)) f();
};
const keyOf = (c: Conn) => `${c.baseUrl}\n${c.apiKey}`;
/** requests answered here: hidden until the bridge stops listing them */
const answered = new Set<string>();

function ensure(c: Conn, force = false): Promise<void> {
  const k = keyOf(c);
  const e = cache.get(k);
  if (e?.loading) return e.loading;
  if (!force && e && Date.now() - e.at < TTL_MS) return Promise.resolve();
  const loading = fetchGroups(fetchImpl, c)
    .then((list) => {
      cache.set(k, { at: Date.now(), list });
      if (list) for (const id of Array.from(answered)) if (!list.approvals.some((a) => a.requestId === id)) answered.delete(id);
    })
    .catch(() => {
      cache.set(k, { at: Date.now(), list: e?.list ?? null });
    })
    .finally(emit);
  cache.set(k, { at: e?.at ?? 0, list: e?.list ?? null, loading });
  return loading;
}

/** a group was created / changed / deleted elsewhere in the app: read the list again */
export function refreshGroups(c: Conn): Promise<void> {
  return ensure(c, true);
}

function useVersion() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => version,
    () => version,
  );
}

type Profile = { kind: string; bridge?: boolean; baseUrl: string; apiKey: string } | undefined;
export const groupsUsable = (p: Profile): p is NonNullable<Profile> => !!p && p.kind === 'hermes' && !!p.bridge && !!p.apiKey && /^https?:\/\//i.test(p.baseUrl);

/** Poll while `active()` says so (a round runs / an approval waits) and the app is in the foreground. */
function useLivePoll(conn: Conn | null, active: boolean) {
  useEffect(() => {
    if (!conn || !active) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      if (AppState.currentState === 'active') void ensure(conn, true);
      timer = setTimeout(tick, LIVE_POLL_MS);
    };
    timer = setTimeout(tick, LIVE_POLL_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [conn, active]);
}

export type GroupsHandle = {
  /** null: no groups on this connection (not a bridge, older bridge, offline) */
  list: GroupsList | null;
  conn: Conn | null;
  refresh(): void;
  create(body: { name: string; members: string[] }): Promise<Result<GroupInfo>>;
};

/** The groups of a connection (Bots tab, group screen). */
export function useGroups(p: Profile): GroupsHandle {
  useVersion();
  const ok = groupsUsable(p);
  const baseUrl = p?.baseUrl ?? '';
  const apiKey = p?.apiKey ?? '';
  const conn = useMemo(() => (ok ? { baseUrl, apiKey } : null), [ok, baseUrl, apiKey]);
  useEffect(() => {
    if (conn) void ensure(conn);
  }, [conn]);
  const list = conn ? (cache.get(keyOf(conn))?.list ?? null) : null;
  useLivePoll(conn, !!list?.config.enabled && (list.groups.some((g) => g.running) || list.approvals.length > 0));
  const refresh = useCallback(() => {
    if (conn) void ensure(conn, true);
  }, [conn]);
  const create = useCallback(
    async (body: { name: string; members: string[] }) => {
      if (!conn) return { ok: false as const, failure: 'offline' as const };
      const r = await createGroup(fetchImpl, conn, body);
      void ensure(conn, true);
      return r;
    },
    [conn],
  );
  return { list, conn, refresh, create };
}

export type GroupApprovals = {
  approvals: ApprovalRequest[];
  owns(a: ApprovalRequest): boolean;
  respond(a: ApprovalRequest, choice: ApprovalChoice): Promise<void>;
  dismiss(a: ApprovalRequest): void;
};

const NONE: ApprovalRequest[] = [];

/**
 * The pending group approvals of `bot` (undefined = the default bot) for its own chat. Answered with the bot's
 * connection (`POST /p/<bot>/v1/runs/<run>/approval`); the bridge's approval watcher tells the other devices.
 */
export function useGroupApprovals(p: Profile, bot: string | undefined, enabled: boolean): GroupApprovals {
  const ver = useVersion();
  const tr = useT();
  const ok = enabled && groupsUsable(p);
  const baseUrl = p?.baseUrl ?? '';
  const apiKey = p?.apiKey ?? '';
  const conn = useMemo(() => (ok ? { baseUrl, apiKey } : null), [ok, baseUrl, apiKey]);
  // the chat opened or switched to another bot (also from a notification): look now, then every few seconds while
  // groups run
  useEffect(() => {
    if (!conn) return;
    void ensure(conn, true);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void ensure(conn, true);
    });
    return () => sub.remove();
  }, [conn, bot]);
  const list = conn ? (cache.get(keyOf(conn))?.list ?? null) : null;
  useLivePoll(conn, !!list?.config.enabled && (list.groups.some((g) => g.running) || list.approvals.length > 0));
  const key = bot ?? 'default';
  // a new array per poll at most; ChatView's useStableList keeps the card stack's array while the requests stay the same
  const approvals = useMemo(() => {
    const mine = list?.approvals.filter((a) => a.bot === key && !answered.has(a.requestId)) ?? [];
    return mine.length ? mine.map((a) => toApprovalRequest(a, (group) => tr('groups.approval.from', { group }))) : NONE;
    // `ver`: `answered` changed (a card was answered or closed here)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, key, tr, ver]);
  const ids = useMemo(() => new Set(approvals.map((a) => a.requestId)), [approvals]);
  const owns = useCallback((a: ApprovalRequest) => !!a.requestId && ids.has(a.requestId), [ids]);
  const respond = useCallback(
    async (a: ApprovalRequest, choice: ApprovalChoice) => {
      if (!conn) return;
      await answerApproval(withBot({ baseUrl: conn.baseUrl, apiKey: conn.apiKey }, bot), a, choice);
      if (a.requestId) answered.add(a.requestId);
      emit();
      void ensure(conn, true);
    },
    [conn, bot],
  );
  const dismiss = useCallback((a: ApprovalRequest) => {
    if (a.requestId) answered.add(a.requestId);
    emit();
  }, []);
  return useMemo(() => ({ approvals, owns, respond, dismiss }), [approvals, owns, respond, dismiss]);
}
