/**
 * Fetching Hermes chats ahead of a tap – pure parts (no I/O, no React; node:test). React side: hermesSync.ts
 * `useRemotePrefetch`.
 *
 * A chat that only exists on Hermes (started on another device / client, never opened here) has no local
 * transcript: opening it waits for GET /api/sessions/<id>/messages. When the app is idle after start (after a
 * successful session-list sync) and when the drawer opens, the transcripts of the most recent such chats are fetched
 * one at a time through the same request + reconcile + save + ack path the open chat uses, so tapping one of them
 * mounts its messages on the first frame.
 *
 * - `remotePrefetchCandidates`: which chats (active profile only, drawer filter + chat scope, never loaded, not open,
 *   not archived)
 * - `createAttemptLog`: a failed fetch is not retried for a while (no hammering on a flaky link)
 * - `runSequential`: one request at a time, bounded, cancellable (profile switch / filter change / unmount)
 * - `storeFetchedTranscript`: what the open chat does with a fetched transcript, for a chat that is not mounted
 * - `sharedRequest`: the prefetch and the chat opened meanwhile share one request
 */
import type { ChatMessage } from '../hermes/types.ts';
import { sortByRecency } from './group.ts';
import { isDraft } from './indexReducer.ts';
import { inChatScope, type ChatScope } from './chatScope.ts';
import { applyRemoteSnapshot, remoteLoadedAt, sessionAllowed, SNAPSHOT_SAVE, type SyncFilter } from './remoteSync.ts';
import type { ConversationMeta } from './types.ts';

/** transcripts fetched ahead per run (the most recent chats in the drawer) */
export const REMOTE_PREFETCH_MAX = 4;
/** a failed fetch of a chat is not tried again for this long (the open path still fetches on a tap) */
export const REMOTE_PREFETCH_RETRY_MS = 5 * 60_000;

/** Chats whose stored Hermes transcript has never been fetched: no local copy, opening one waits for the network. */
export function isUncachedRemote(c: ConversationMeta): boolean {
  return c.origin === 'remote' && !!c.hermesSessionId && !!c.remote && !c.remote.loadedAt;
}

export type CandidateOptions = {
  /** chats of this (active, sync-enabled) Hermes profile only */
  profileId: string;
  /** the profile's drawer filter ("show other Hermes chats", cron reports): nothing outside it is fetched */
  filter: SyncFilter;
  /** Settings → Chat → "Chats" (chatScope.ts): `device` lists no app chat from another device, so none is fetched */
  scope?: ChatScope;
  /** the open chat / chats with a mounted session (they load themselves) */
  exclude?: (id: string) => boolean;
  /** e.g. a recent failure (createAttemptLog) */
  skip?: (id: string) => boolean;
  limit?: number;
};

/** The most recent never-loaded Hermes chats of the profile, newest first, at most `limit`. */
export function remotePrefetchCandidates(items: readonly ConversationMeta[], o: CandidateOptions): ConversationMeta[] {
  const limit = o.limit ?? REMOTE_PREFETCH_MAX;
  if (limit <= 0) return [];
  const pool = items.filter(
    (c) =>
      c.profileKind === 'hermes' &&
      c.profileId === o.profileId &&
      !c.archived &&
      !isDraft(c) &&
      isUncachedRemote(c) &&
      sessionAllowed(c.remote?.source, c.hermesSessionId, o.filter) &&
      inChatScope(c, o.scope ?? 'all') &&
      !o.exclude?.(c.id) &&
      !o.skip?.(c.id),
  );
  return sortByRecency(pool).slice(0, limit);
}

/** Remembers failed fetches per chat: `recent(id)` is true for `retryMs` after a failure; a success forgets it. */
export function createAttemptLog(now: () => number = Date.now, retryMs = REMOTE_PREFETCH_RETRY_MS) {
  const failed = new Map<string, number>();
  return {
    recent(id: string): boolean {
      const at = failed.get(id);
      if (at === undefined) return false;
      if (now() - at < retryMs) return true;
      failed.delete(id);
      return false;
    },
    record(id: string, ok: boolean) {
      if (ok) failed.delete(id);
      else failed.set(id, now());
    },
  };
}

export type RunOptions = {
  /** stop before the next item (and drop nothing already stored) */
  cancelled?: () => boolean;
  /** awaited before every item (yield to the UI: idle callback / a short pause) */
  between?: () => Promise<void>;
  /** at most this many items */
  max?: number;
};

/** Run `step` for each id, strictly one after the other. A throwing step counts as failed, the run goes on. */
export async function runSequential(ids: readonly string[], step: (id: string) => Promise<boolean>, o: RunOptions = {}): Promise<{ done: string[]; failed: string[] }> {
  const done: string[] = [];
  const failed: string[] = [];
  const max = o.max ?? ids.length;
  for (const id of ids.slice(0, max)) {
    if (o.cancelled?.()) break;
    if (o.between) await o.between();
    if (o.cancelled?.()) break;
    let ok = false;
    try {
      ok = await step(id);
    } catch {
      ok = false;
    }
    (ok ? done : failed).push(id);
  }
  return { done, failed };
}

/** The controller surface `storeFetchedTranscript` needs (ConversationController satisfies it). */
export type TranscriptTarget = {
  get(id: string): ConversationMeta | undefined;
  loadMessages(id: string): Promise<ChatMessage[]>;
  save(id: string, messages: ChatMessage[], opts?: { keepOrder?: boolean }): void;
  markRemoteLoaded(id: string, at: number, lastActive?: number): void;
};

export type FetchedTranscript = {
  /** mapped messages (mapRemoteMessages) */
  remote: ChatMessage[];
  /** newest row timestamp (ms, 0 = none) */
  newest: number;
};

/**
 * A fetched transcript for a chat that is NOT mounted: reconciled with the local copy, saved (list order kept)
 * and acknowledged (`loadedAt`) exactly like the open chat does it (applyRemoteSnapshot). Returns false when it was
 * not stored: the chat is gone, was loaded meanwhile, or is mounted now (`isMounted`, checked right before the
 * write – its session applies the same result itself).
 */
export async function storeFetchedTranscript(
  target: TranscriptTarget,
  id: string,
  fetched: FetchedTranscript,
  o: { activityAtStart: number | undefined; isMounted: (id: string) => boolean; cancelled?: () => boolean },
): Promise<boolean> {
  const before = target.get(id);
  if (!before || before.remote?.loadedAt || o.cancelled?.() || o.isMounted(id)) return false;
  const local = await target.loadMessages(id);
  const meta = target.get(id);
  if (!meta || meta.remote?.loadedAt || o.cancelled?.() || o.isMounted(id)) return false;
  const at = remoteLoadedAt(o.activityAtStart, fetched.newest);
  const merged = applyRemoteSnapshot({
    messages: local,
    remote: fetched.remote,
    origin: meta.origin,
    replace: () => true,
    save: (m) => target.save(id, m, SNAPSHOT_SAVE),
    ack: () => target.markRemoteLoaded(id, at, fetched.newest || undefined),
  });
  return merged !== null;
}

/**
 * One in-flight promise per key: a second caller while the first request runs gets the same result (the prefetch of
 * a chat and the chat opened meanwhile cost one request). Settled requests are forgotten.
 */
export function createSharedRequests<T>() {
  const inflight = new Map<string, Promise<T>>();
  return {
    run(key: string, fn: () => Promise<T>): Promise<T> {
      const cur = inflight.get(key);
      if (cur) return cur;
      const p = fn().finally(() => {
        if (inflight.get(key) === p) inflight.delete(key);
      });
      inflight.set(key, p);
      return p;
    },
    has: (key: string) => inflight.has(key),
  };
}

/**
 * May the app fetch ahead right now? Not when the device says it is offline or on a metered / data-saver link (web:
 * `navigator.onLine` / Network Information API; native has no such signal bundled → unknown = allowed) and not when
 * the last session-list sync failed (most likely offline).
 */
export function prefetchAllowed(o: { syncStatus: string; online?: boolean; metered?: boolean; foreground?: boolean }): boolean {
  if (o.foreground === false) return false;
  if (o.online === false || o.metered) return false;
  return o.syncStatus === 'idle';
}
