/**
 * Hermes sessions as source of truth – React side (see INTEGRATION.md "Hermes-Sitzungen").
 *
 *   const sync = useHermesSessionSync(profiles)          ChatScreen: list sync on start/foreground/drawer open
 *   <ConversationDrawer remote={sync.remote} … />        source badges, rename/delete propagation
 *   const transcript = useRemoteTranscript(convId, profile)        session component: the message area waits for `settled`
 *   useApplyRemoteTranscript(chat, transcript, conv)               session component: merge into the chat
 *   useRemotePrefetch(activeProfile, { … })                         ChatScreen: fetch never-opened chats ahead (idle / drawer)
 *
 * Per Hermes profile, `syncSessions` (default on). Servers without the session API (older Hermes, UI
 * bridge, mock) answer 404 → the feature switches itself off for that server (hermes/support.ts).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useT } from '../i18n';
import { hermesSessions } from '../hermes/client';
import { mapRemoteMessages } from '../hermes/sessionMapping';
import { isNotFoundError, isUnsupportedError, sessionErrorText, type RemoteSession } from '../hermes/sessions';
import { serverKey, sessionsSupported, setSessionsSupported, subscribeSupport } from '../hermes/support';
import type { ChatMessage } from '../hermes/types';
import { useConversationsInternals } from './ConversationsProvider';
import { applyRemoteSnapshot, isAppConversation, needsRemoteLoad, remoteLoadedAt, SNAPSHOT_SAVE, sourceLabel, syncSources, type SyncFilter } from './remoteSync';
import { inChatScope } from './chatScope';
import { afterFirstPage, hasOlder, loadOlderSessions, pagedSources, SESSION_PAGE, type Cursors } from './sessionPaging';
import {
  createAttemptLog,
  createSharedRequests,
  prefetchAllowed,
  remotePrefetchCandidates,
  runSequential,
  storeFetchedTranscript,
  REMOTE_PREFETCH_MAX,
  type FetchedTranscript,
} from './remotePrefetch';
import { afterIdle } from './idle';
import { isMeteredConnection } from '../images/policy';
import type { ChatScope } from './chatScope';
import type { ConversationMeta } from './types';
import { emitAnswerReady, recoveredAnswers } from '../background/noticeState';
import { botNames, withBot } from '../hermes/bots';
import { botStore, botsNow, ensureBots } from '../hermes/useHermesBots';

/** Structural subset of settings' ConnectionProfile (+ the new optional `syncSessions` flag). */
export type SyncProfile = {
  id: string;
  kind: string;
  baseUrl: string;
  apiKey: string;
  /** Hermes profile setting "Hermes-Sitzungen synchronisieren"; default on */
  syncSessions?: boolean;
  /** "Andere Hermes-Chats anzeigen (Telegram, CLI)"; default off = only the app's own chats */
  showForeignChats?: boolean;
  /** "Cron-Berichte anzeigen" (drawer, live inbox, notifications); default off */
  showCronReports?: boolean;
  /** UI bridge connection (its bots come from GET /bridge/profiles) */
  bridge?: boolean;
  /** Hermes profiles ("bots") entered by hand (hermes/bots.ts) */
  hermesBots?: readonly string[];
};

/** The profile's session filter (remoteSync.SyncFilter); both default off. */
export function syncFilterOf(p: Pick<SyncProfile, 'showForeignChats' | 'showCronReports'> | undefined): SyncFilter {
  return { foreign: p?.showForeignChats === true, cron: p?.showCronReports === true };
}

export type SessionSyncOptions = {
  /** master switch (e.g. while settings are not loaded) */
  enabled?: boolean;
  /** refresh() calls closer than this are skipped unless forced (default 20 s) */
  minIntervalMs?: number;
  /** Settings → Chat → "Chats" (chatScope.ts): what "load older" pages for and counts as a result (default `all`) */
  scope?: ChatScope;
};

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'error' | 'unsupported';

/** What the drawer needs to propagate changes (prop `remote` of ConversationDrawer/ConversationList). */
export type RemoteActions = {
  /** conversation lives in a synced Hermes session (rename/delete can propagate) */
  isSynced(meta: ConversationMeta): boolean;
  /** badge text: Telegram / CLI / App / … (undefined → default Hermes/Claude badge) */
  sourceLabel(meta: ConversationMeta): string | undefined;
  /** PATCH title in Hermes (the caller renames locally first). Throws with a user-facing message. */
  rename(meta: ConversationMeta, title: string): Promise<void>;
  /**
   * May "In Hermes löschen" be offered? Only for the app's own sessions – sessions from Telegram/CLI/cron/other
   * clients are only ever hidden locally.
   */
  canDeleteRemote(meta: ConversationMeta): boolean;
  /** DELETE in Hermes, then remove locally (app sessions only). Throws with a user-facing message (local copy kept). */
  deleteRemote(meta: ConversationMeta): Promise<void>;
};

/** Older sessions on the server (beyond the first page per source, sessionPaging.ts) – the drawer's "load older" row. */
export type OlderSessions = {
  /** a sync-enabled server has older sessions the drawer would show (false until the first list sync) */
  available: boolean;
  loading: boolean;
  /** user-facing error of the last attempt (the next tap retries) */
  error?: string;
  /** page on until a chat the drawer shows was added or nothing older is left (no-op while one runs) */
  load(): void;
};

export type HermesSessionSync = {
  status: SyncStatus;
  error?: string;
  lastSyncAt?: number;
  /** pull the session lists now (throttled unless `force`) */
  refresh(force?: boolean): Promise<void>;
  remote: RemoteActions;
  older: OlderSessions;
};

export function syncEnabled(p: SyncProfile | undefined): p is SyncProfile {
  return !!p && p.kind === 'hermes' && p.syncSessions !== false && !!p.apiKey && /^https?:\/\//i.test(p.baseUrl);
}

function useSupportVersion(): number {
  const ver = useRef(0);
  return useSyncExternalStore(
    useCallback((cb: () => void) => subscribeSupport(() => { ver.current++; cb(); }), []),
    () => ver.current,
    () => ver.current
  );
}

/** Pull GET /api/sessions per source for every sync-enabled Hermes profile and merge into the drawer. */
export function useHermesSessionSync(profiles: SyncProfile[], options: SessionSyncOptions = {}): HermesSessionSync {
  const { controller, ready, remoteActionsRef } = useConversationsInternals();
  const tr = useT();
  // the app language for sync error banners, read by callbacks that must not change identity when it changes
  const trRef = useRef(tr);
  trRef.current = tr;
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [error, setError] = useState<string | undefined>();
  const [lastSyncAt, setLastSyncAt] = useState<number | undefined>();
  const supportVer = useSupportVersion();
  const enabled = options.enabled !== false;
  // per profile: which sessions are shown (default: the app's own only)
  const filterKey = profiles
    .filter((p) => p.kind === 'hermes')
    .map((p) => `${p.id}:${p.showForeignChats ? 1 : 0}${p.showCronReports ? 1 : 0}`)
    .join(',');

  // one entry per server (two profiles on the same server would only duplicate the list)
  const targets = useMemo(() => {
    const seen = new Set<string>();
    return profiles.filter((p) => {
      if (!syncEnabled(p)) return false;
      const k = serverKey(p);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [profiles]);
  // bots (Hermes profiles): every bot's sessions are listed under /p/<bot>/; a changed bot list syncs again
  const botVer = useSyncExternalStore(botStore.subscribe, botStore.version, botStore.version);
  const targetsKey = targets.map((p) => `${p.id}@${serverKey(p)}+${p.hermesBots?.join(',') ?? ''}`).join('|');

  const running = useRef(false);
  const lastRun = useRef(0);
  const scope = options.scope ?? 'all';
  const ref = useRef({ targets, profiles, enabled, ready, scope, minIntervalMs: options.minIntervalMs ?? 20000 });
  ref.current = { targets, profiles, enabled, ready, scope, minIntervalMs: options.minIntervalMs ?? 20000 };

  // paging cursors per server profile (`<id>@<server>`) and source: the async code reads the ref, render the state
  const cursorsRef = useRef<Record<string, Cursors>>({});
  const [cursors, setCursors] = useState<Record<string, Cursors>>({});
  const setCursor = useCallback((key: string, next: Cursors) => {
    cursorsRef.current = { ...cursorsRef.current, [key]: next };
    setCursors(cursorsRef.current);
  }, []);
  const sameServerAs = useCallback((p: SyncProfile) => {
    const key = serverKey(p);
    return (pid: string) => {
      const o = ref.current.profiles.find((x) => x.id === pid);
      return !o || (o.kind === 'hermes' && serverKey(o) === key); // unknown (deleted) profile: legacy match
    };
  }, []);

  // setting switched off / first start after the update: hide foreign entries LOCALLY (offline too; never a
  // Hermes DELETE). Runs for every Hermes profile, also with the sync switched off.
  useEffect(() => {
    if (!ready) return;
    for (const p of ref.current.profiles) {
      if (p.kind === 'hermes') controller.pruneForeign({ id: p.id, kind: 'hermes' }, syncFilterOf(p));
    }
  }, [ready, filterKey, controller]);

  const refresh = useCallback(
    async (force = false) => {
      const { targets: list, enabled: on, ready: rdy, minIntervalMs } = ref.current;
      if (!on || !rdy || running.current) return;
      if (!force && Date.now() - lastRun.current < minIntervalMs) return;
      const active = list.filter((p) => sessionsSupported(p) !== false);
      if (!active.length) {
        setStatus(list.length ? 'unsupported' : 'off');
        return;
      }
      running.current = true;
      lastRun.current = Date.now();
      setStatus('syncing');
      let failure: string | undefined;
      try {
        for (const p of active) {
          const filter = syncFilterOf(p);
          const srcs = syncSources(filter);
          const sameServer = sameServerAs(p);
          // the default profile first, then every known bot (bridge list + manual list), each under /p/<bot>/ with
          // its own paging cursors (the bot's base URL gives it its own cursor key)
          await ensureBots(p);
          for (const bot of [undefined, ...botNames(botsNow(p))]) {
            const conn = withBot(p, bot);
            if (bot && sessionsSupported(conn) === false) continue; // unknown bot (404): skipped until restart
            const client = hermesSessions(conn, 12000);
            const sessions: RemoteSession[] = [];
            const complete: string[] = [];
            const ck = cursorKey(conn);
            try {
              const firstPages: { source: string; count: number; hasMore: boolean }[] = [];
              for (const source of srcs) {
                const page = await client.list({ source, limit: SESSION_PAGE });
                sessions.push(...page.sessions);
                if (!page.hasMore) complete.push(source);
                firstPages.push({ source, count: page.sessions.length, hasMore: page.hasMore });
              }
              // against the cursors as they are NOW (a "load older" may have moved them while this was in flight)
              const next = { ...cursorsRef.current[ck] };
              for (const f of firstPages) next[f.source] = afterFirstPage(next[f.source], f.count, f.hasMore);
              setCursor(ck, next);
              setSessionsSupported(conn, true);
            } catch (e) {
              if (isUnsupportedError(e)) setSessionsSupported(conn, false);
              else failure = sessionErrorText(e, trRef.current);
              if (!bot) break; // the server itself failed: its bots would too
              continue;
            }
            controller.mergeRemote({ id: p.id, kind: 'hermes' }, sessions, { completeSources: complete, filter, sameServer, bot });
          }
        }
      } finally {
        running.current = false;
        setLastSyncAt(Date.now());
        setError(failure);
        setStatus(failure ? 'error' : 'idle');
      }
    },
    [controller, setCursor, sameServerAs]
  );

  // "load older" (drawer end / row): one server at a time, until a chat the drawer shows was added
  const [olderState, setOlderState] = useState<{ loading: boolean; error?: string }>({ loading: false });
  const olderRunning = useRef(false);
  const loadOlder = useCallback(async () => {
    const { targets: list, enabled: on, ready: rdy, scope: sc } = ref.current;
    if (!on || !rdy || olderRunning.current) return;
    olderRunning.current = true;
    setOlderState({ loading: true });
    let failure: string | undefined;
    try {
      outer: for (const p of list) {
        const filter = syncFilterOf(p);
        const sources = pagedSources(filter, sc);
        const profile = { id: p.id, kind: 'hermes' as const };
        const sameServer = sameServerAs(p);
        // the default profile first, then the bots, each with its own cursors (see refresh)
        for (const bot of [undefined, ...botNames(botsNow(p))]) {
          const conn = withBot(p, bot);
          const ck = cursorKey(conn);
          const cur = cursorsRef.current[ck];
          if (!cur || sessionsSupported(conn) === false || !hasOlder(cur, sources)) continue;
          const client = hermesSessions(conn, 12000);
          try {
            const r = await loadOlderSessions({
              cursors: cur,
              sources,
              fetch: (source, offset, limit) => client.list({ source, offset, limit }),
              merge: (sessions) =>
                controller
                  .mergeRemote(profile, sessions, { filter, sameServer, bot })
                  .added.map((id) => controller.get(id))
                  .filter((c): c is ConversationMeta => !!c && !c.archived && inChatScope(c, sc)),
            });
            setCursor(ck, r.cursors);
            if (r.added > 0) break outer;
          } catch (e) {
            if (isUnsupportedError(e)) setSessionsSupported(conn, false);
            else failure = sessionErrorText(e, trRef.current);
          }
        }
      }
    } finally {
      olderRunning.current = false;
      setOlderState({ loading: false, error: failure });
    }
  }, [controller, setCursor, sameServerAs]);
  const olderAvailable = targets.some((p) =>
    [undefined, ...botNames(botsNow(p))].some((bot) => {
      const conn = withBot(p, bot);
      const cur = cursors[cursorKey(conn)];
      return !!cur && sessionsSupported(conn) !== false && hasOlder(cur, pagedSources(syncFilterOf(p), scope));
    }),
  );
  const older = useMemo<OlderSessions>(
    () => ({ available: olderAvailable, loading: olderState.loading, error: olderState.error, load: () => void loadOlder() }),
    [olderAvailable, olderState, loadOlder],
  );

  // on start / when the profile set changes
  useEffect(() => {
    if (ready && enabled) void refresh(true);
  }, [ready, enabled, targetsKey, filterKey, botVer, refresh]);

  // on foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const profileFor = useCallback(
    (meta: ConversationMeta): SyncProfile | undefined => {
      if (meta.profileKind !== 'hermes' || !meta.hermesSessionId) return undefined;
      const p = profiles.find((x) => x.id === meta.profileId);
      return syncEnabled(p) && sessionsSupported(p) !== false ? p : undefined;
    },
    // supportVer: re-evaluate when a server turned out to be unsupported
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profiles, supportVer]
  );

  const remote = useMemo<RemoteActions>(
    () => ({
      isSynced: (meta) => !!profileFor(meta),
      sourceLabel: (meta) => (meta.remote ? sourceLabel(meta.remote.source, tr) : undefined),
      async rename(meta, title) {
        const p = profileFor(meta);
        // a bot's Bot Chat keeps its title on Hermes (Hermes Desktop finds the thread by it, bots/core.ts)
        if (!p || !meta.hermesSessionId || meta.botChat) return;
        try {
          await hermesSessions(withBot(p, meta.hermesProfile)).rename(meta.hermesSessionId, title);
        } catch (e) {
          if (isNotFoundError(e)) return; // never reached the server (no message sent yet)
          // keep the server's error code (`invalid_title` = title taken → the auto title retries a variant)
          const code = (e as { code?: unknown } | null)?.code;
          throw Object.assign(new Error(sessionErrorText(e, tr)), typeof code === 'string' ? { code } : {});
        }
      },
      canDeleteRemote: (meta) => !!profileFor(meta) && isAppConversation(meta) && !meta.botChat,
      async deleteRemote(meta) {
        const p = profileFor(meta);
        if (!p || !meta.hermesSessionId) throw new Error(tr('conversations.sync.notSynced'));
        // sessions from Telegram/CLI/cron/other clients are never deleted on Hermes (hide locally instead)
        if (!isAppConversation(meta)) throw new Error(tr('conversations.sync.foreignNoDelete'));
        try {
          await hermesSessions(withBot(p, meta.hermesProfile)).remove(meta.hermesSessionId);
        } catch (e) {
          // never reached the server (nothing sent yet) / already deleted elsewhere: gone either way
          if (!isNotFoundError(e)) throw new Error(sessionErrorText(e, tr));
        }
        controller.hideRemote(meta.id);
      },
    }),
    [profileFor, controller, tr]
  );

  // bulk delete (Settings → "Alle Chats löschen" has no sync of its own) uses the current remote actions
  useEffect(() => {
    remoteActionsRef.current = remote;
    return () => {
      if (remoteActionsRef.current === remote) remoteActionsRef.current = null;
    };
  }, [remote, remoteActionsRef]);

  return { status, error, lastSyncAt, refresh, remote, older };
}

/** paging cursors belong to one profile on one server and bot (a changed URL starts over; a bot's URL has /p/<bot>) */
function cursorKey(p: SyncProfile): string {
  return `${p.id}@${serverKey(p)}`;
}

// ------------------------------------------------------------------ one conversation

const transcriptRequests = createSharedRequests<FetchedTranscript>();

/**
 * GET /api/sessions/<id>/messages (newest 500 rows incl. compacted ones) mapped to ChatMessages – the one request
 * behind opening a synced chat and fetching it ahead (useRemotePrefetch); concurrent calls for the same session share
 * it. Throws like the sessions client.
 */
export function fetchRemoteTranscript(profile: SyncProfile, sessionId: string): Promise<FetchedTranscript> {
  return transcriptRequests.run(`${serverKey(profile)}|${sessionId}`, async () => {
    const page = await hermesSessions(profile, 15000).messages(sessionId, { order: 'latest', limit: 500, includeCompacted: true });
    setSessionsSupported(profile, true);
    const newest = page.messages.reduce((m, r) => Math.max(m, r.timestamp ?? 0), 0);
    return { remote: mapRemoteMessages(page.messages), newest };
  });
}

export type RemoteTranscript = {
  /**
   * the chat can show its own content: nothing to load, cache available, load finished/failed, or timed out. Before
   * that the message area shows a placeholder and a send waits (the session itself is mounted right away)
   */
  settled: boolean;
  loading: boolean;
  /** German error of the last load (offline: the cached transcript is shown) */
  error?: string;
  /** bumps whenever a fresh remote transcript arrived */
  revision: number;
  /** stored Hermes transcript mapped to ChatMessages (reconciled with the live chat by useApplyRemoteTranscript) */
  remote: ChatMessage[] | null;
  /**
   * mark this fetch as loaded (`loadedAt`) – called by useApplyRemoteTranscript AFTER the reconciled transcript
   * was saved, so a fetch whose result never reached storage (chat switched meanwhile) stays due (Astra F08)
   */
  ack?: () => void;
  refresh(): void;
};

/**
 * Loads the stored Hermes transcript of a synced conversation when opened and whenever the session
 * list reports newer server activity (foreground sync). The session mounts right away; its message area waits for
 * `settled` (ChatScreen HermesSession).
 */
export function useRemoteTranscript(conversationId: string | undefined, profile: SyncProfile | undefined, options: { timeoutMs?: number } = {}): RemoteTranscript {
  const { store, controller, ready } = useConversationsInternals();
  const tr = useT();
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  const meta = conversationId ? state.items.find((c) => c.id === conversationId) : undefined;
  const supportVer = useSupportVersion();
  const usable = ready && !!meta?.remote && !!meta.hermesSessionId && syncEnabled(profile) && sessionsSupported(profile) !== false;
  const needs = usable && needsRemoteLoad(meta);
  // a cached transcript can be shown right away; a never-loaded remote-only chat waits for the fetch
  const hasCache = !!meta && (meta.origin !== 'remote' || !!meta.remote?.loadedAt);

  const [s, setS] = useState<{ id?: string; loading: boolean; error?: string; revision: number; remote: ChatMessage[] | null; ack?: () => void; done: boolean; timedOut: boolean }>(() => ({
    id: conversationId,
    loading: false,
    revision: 0,
    remote: null,
    done: false,
    timedOut: false,
  }));
  // reset when switching conversations
  if (s.id !== conversationId) setS({ id: conversationId, loading: false, revision: 0, remote: null, done: false, timedOut: false });

  const inflight = useRef<string | null>(null);
  const load = useCallback(async () => {
    if (!conversationId || !meta?.hermesSessionId || !profile || inflight.current === conversationId) return;
    const id = conversationId;
    const sid = meta.hermesSessionId;
    inflight.current = id;
    // the server activity this request can contain (newer activity reported while it is in flight is NOT acked)
    const activityAtStart = store.get().items.find((c) => c.id === id)?.remote?.lastActive;
    setS((p) => (p.id === id ? { ...p, loading: true } : p));
    try {
      const { remote, newest } = await fetchRemoteTranscript(profile, sid);
      const at = remoteLoadedAt(activityAtStart, newest);
      const ack = () => controller.markRemoteLoaded(id, at, newest || undefined);
      setS((p) => (p.id === id ? { ...p, loading: false, error: undefined, done: true, remote, ack, revision: p.revision + 1 } : p));
    } catch (e) {
      if (isUnsupportedError(e)) setSessionsSupported(profile, false);
      const error = isNotFoundError(e) ? tr('conversations.sync.sessionGone') : sessionErrorText(e, tr);
      if (isNotFoundError(e)) controller.markRemoteLoaded(id, Date.now());
      setS((p) => (p.id === id ? { ...p, loading: false, error, done: true } : p));
    } finally {
      if (inflight.current === id) inflight.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, meta?.hermesSessionId, profile, controller, store, supportVer, tr]);

  const lastActive = meta?.remote?.lastActive;
  const loadedAt = meta?.remote?.loadedAt;
  // one automatic attempt per (conversation, server activity, last load) – a failed load (offline) is not
  // retried in a loop; the next list sync with newer activity or refresh() tries again
  const attempted = useRef<string | null>(null);
  useEffect(() => {
    if (!needs || s.id !== conversationId) return;
    const key = `${conversationId}|${lastActive ?? ''}|${loadedAt ?? ''}`;
    if (attempted.current === key) return;
    attempted.current = key;
    void load();
  }, [needs, lastActive, loadedAt, load, s.id, conversationId]);

  // never block the chat for long
  const timeoutMs = options.timeoutMs ?? 8000;
  useEffect(() => {
    if (!needs || hasCache || s.done) return;
    const t = setTimeout(() => setS((p) => (p.id === conversationId ? { ...p, timedOut: true } : p)), timeoutMs);
    return () => clearTimeout(t);
  }, [needs, hasCache, s.done, conversationId, timeoutMs]);

  const settled = !usable || hasCache || s.done || s.timedOut || (!needs && !s.loading);
  return { settled, loading: s.loading, error: s.error, revision: s.revision, remote: s.remote, ack: s.ack, refresh: () => void load() };
}

/**
 * Merge each fresh remote transcript into the mounted chat (reconciled with its LIVE messages, so a
 * turn finished in the meantime is never lost) and persist it. Waits while a turn is streaming.
 * Returns true while a fetched transcript is not applied yet (the message area keeps its placeholder instead of
 * flashing the empty-chat surface for the frame between the fetch and the merge).
 */
export function useApplyRemoteTranscript(
  chat: { messages: ChatMessage[]; status: string; replaceMessages?: (m: ChatMessage[]) => boolean },
  transcript: Pick<RemoteTranscript, 'revision' | 'remote' | 'ack'>,
  conv: { meta: ConversationMeta | undefined; save: (m: ChatMessage[], opts?: { keepOrder?: boolean }) => void; flush: () => Promise<void> }
): boolean {
  const applied = useRef(0);
  // state (not only the ref): an unchanged snapshot replaces nothing, so nothing else would re-render
  const [appliedRevision, setAppliedRevision] = useState(0);
  const { revision, remote, ack } = transcript;
  const { status, messages, replaceMessages } = chat;
  const origin = conv.meta?.origin;
  const convId = conv.meta?.id;
  const save = conv.save;
  const flush = conv.flush;
  useEffect(() => {
    if (!remote || revision === applied.current || status === 'streaming' || !replaceMessages) return;
    // opening a chat does not move it in the list: saved like a fetch ahead (order = activity, SNAPSHOT_SAVE)
    const merged = applyRemoteSnapshot({ messages, remote, origin, replace: replaceMessages, save: (m) => save(m, SNAPSHOT_SAVE), ack });
    if (!merged) return; // refused (turn started): retried on the next render
    applied.current = revision;
    setAppliedRevision(revision);
    // an interrupted answer completed by the stored session: "Antwort ist da" (de-duplicated by message id); the
    // notification waits until it is written – now, not on the debounce timer (it does not run in the Android background)
    const recovered = convId && merged !== messages ? recoveredAnswers(messages, merged) : [];
    if (convId && recovered.length) {
      const written = flush().catch(() => {});
      for (const m of recovered) emitAnswerReady({ conversationId: convId, message: m, late: true, written });
    }
  }, [revision, remote, status, messages, replaceMessages, origin, save, flush, convId, ack]);
  return !!remote && revision !== appliedRevision;
}

// ------------------------------------------------------------------ fetch ahead

export type RemotePrefetchOptions = {
  /** session-list sync state: only after a successful sync (`idle`) */
  syncStatus: SyncStatus;
  /** a finished list sync (start / foreground / drawer) may have brought new chats: run again */
  lastSyncAt?: number;
  /** bumped when the drawer opens */
  kick: number;
  /** the open chat and chats whose session is still mounted (running turn) load themselves */
  isMounted(id: string): boolean;
  /** first run after this idle delay (default 1500 ms) */
  delayMs?: number;
  /** Settings → Chat → "Chats" (chatScope.ts): `device` fetches no app chat from another device (default `all`) */
  scope?: ChatScope;
};

/**
 * Fetch the transcripts of the most recent Hermes chats of the ACTIVE profile that were never opened here (at most
 * REMOTE_PREFETCH_MAX per run, one request at a time, through the same request + reconcile + save path as opening
 * one), so the first tap on them is instant. Runs once the JS thread is idle after a successful list sync and when
 * the drawer opens. Only chats the drawer shows (the profile's filter: "show other Hermes chats" / cron reports, and the
 * device's "Chats" scope);
 * nothing when sync is off / unsupported, offline, on a metered link (where the platform says so) or in the
 * background. A profile switch / filter change cancels the run; a failed request ends it (likely offline) and that chat
 * is not tried again for REMOTE_PREFETCH_RETRY_MS.
 */
export function useRemotePrefetch(profile: SyncProfile | undefined, o: RemotePrefetchOptions): void {
  const { store, controller, ready } = useConversationsInternals();
  useSupportVersion(); // re-evaluate `usable` when a server turns out to be unsupported
  const [log] = useState(() => createAttemptLog());
  const usable = ready && syncEnabled(profile) && sessionsSupported(profile) !== false;
  const filter = syncFilterOf(profile);
  const scope = o.scope ?? 'all';
  const profileKey = usable && profile ? `${profile.id}@${serverKey(profile)}|${filter.foreign ? 1 : 0}${filter.cron ? 1 : 0}|${scope}` : '';
  // the pass reads the current profile / mounted chats when it runs, not the ones of the render that scheduled it
  const live = useRef({ profile, isMounted: o.isMounted, scope });
  useLayoutEffect(() => {
    live.current = { profile, isMounted: o.isMounted, scope };
  });
  const run = useRef<{ key: string; cancelled: boolean } | null>(null);

  // profile switch / filter change / unmount: the running pass stops before its next request and stores nothing more
  useEffect(
    () => () => {
      if (run.current) run.current.cancelled = true;
      run.current = null;
    },
    [profileKey],
  );

  const { syncStatus, lastSyncAt, kick, delayMs = 1500 } = o;
  useEffect(() => {
    if (!profileKey || run.current) return;
    const nav = (globalThis as { navigator?: { onLine?: unknown } }).navigator;
    const online = typeof nav?.onLine === 'boolean' ? nav.onLine : undefined;
    const allowed = prefetchAllowed({ syncStatus, online, metered: isMeteredConnection(), foreground: AppState.currentState === 'active' });
    if (!allowed) return;
    const pass = { key: profileKey, cancelled: false };
    const cancelIdle = afterIdle(() => {
      const p = live.current.profile;
      if (pass.cancelled || run.current || !p) return;
      const ids = remotePrefetchCandidates(store.get().items, {
        profileId: p.id,
        filter: syncFilterOf(p),
        scope: live.current.scope,
        exclude: (id) => live.current.isMounted(id),
        skip: log.recent,
      }).map((c) => c.id);
      if (!ids.length) return;
      run.current = pass;
      const isMounted = (id: string) => live.current.isMounted(id);
      const cancelled = () => pass.cancelled;
      const step = async (id: string): Promise<boolean> => {
        const meta = controller.get(id);
        if (!meta?.hermesSessionId || meta.remote?.loadedAt || isMounted(id)) return true;
        const activityAtStart = meta.remote?.lastActive;
        try {
          const conn = withBot(p, meta.hermesProfile); // a bot's chat lives under /p/<bot>/
          const fetched = await fetchRemoteTranscript(conn, meta.hermesSessionId);
          await storeFetchedTranscript(controller, id, fetched, { activityAtStart, isMounted, cancelled });
          log.record(id, true);
          return true;
        } catch (e) {
          log.record(id, false);
          if (isUnsupportedError(e)) setSessionsSupported(withBot(p, meta.hermesProfile), false);
          // a missing session drops out with the next list sync; anything else (offline, timeout, 5xx): stop here
          if (!isNotFoundError(e)) pass.cancelled = true;
          return false;
        }
      };
      void runSequential(ids, step, { cancelled, max: REMOTE_PREFETCH_MAX, between: () => new Promise<void>((r) => afterIdle(r, 200)) }).finally(() => {
        if (run.current === pass) run.current = null;
      });
    }, delayMs);
    return () => {
      pass.cancelled = pass.cancelled || run.current !== pass; // a pass that already started keeps going
      cancelIdle();
    };
  }, [profileKey, syncStatus, lastSyncAt, kick, delayMs, store, controller, log]);
}
