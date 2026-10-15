/**
 * Hermes sessions as source of truth – pure merge logic (no I/O, no React; node:test).
 *
 * - `mergeRemoteSessions`: GET /api/sessions rows → conversation index (match by `hermesSessionId`,
 *   create entries for sessions started elsewhere, adopt Hermes titles, prune vanished remote-only entries)
 * - `reconcileTranscript`: stored session messages (mapped) + local transcript → the transcript to show
 */
import type { TFn, TKey } from '../i18n/core.ts';
import type { ChatMessage } from '../hermes/types.ts';
import type { RemoteSession } from '../hermes/sessions.ts';
import { createUserTurnMatcher, isRemoteMessageId, mergeAssistantDetails, normText } from '../hermes/sessionMapping.ts';
import { isFinalAnswer, isRecoverable, recoveredMessage } from '../hermes/recovery.ts';
import { queuedMayMatch, sentFromQueued } from '../hermes/pendingSend.ts';
import type { ConversationMeta, ProfileRef, RemoteInfo } from './types.ts';
import { DEFAULT_TITLE, PREVIEW_MAX, TITLE_MAX } from './types.ts';
import { makeTitle } from './title.ts';
import { messagesSignature } from './messages.ts';
import { botOf } from '../hermes/bots.ts';

/**
 * Which Hermes sessions the app shows (per Hermes profile, settings `showForeignChats` / `showCronReports`).
 * Default (both off): ONLY the app's own chats = source `api_server` AND an id with the app's session prefix
 * (`hui-`, conversations/ids.ts). Other API clients also use `api_server`, so the source alone is not enough.
 * - `foreign`: also Telegram / CLI sessions and api_server sessions of other clients
 * - `cron`: also cron run reports (drawer entries, live inbox, push)
 * Hiding is LOCAL ONLY: sessions outside the filter are dropped from the drawer and the local store, never
 * deleted on Hermes.
 */
export type SyncFilter = { foreign?: boolean; cron?: boolean };

/** Prefix of the session ids the app creates (`hui-<hex>`, conversations/ids.ts newSessionIdFor('hermes')). */
export const APP_SESSION_PREFIX = 'hui-';
/** Sources listed with `foreign` on (besides the app's own api_server sessions). */
export const FOREIGN_SOURCES = ['telegram', 'cli'];

/** Sources listed in the drawer by default: the app's own sessions only. */
export const DEFAULT_SYNC_SOURCES = ['api_server'];

export function isAppSessionId(id: string | undefined | null): boolean {
  return !!id && id.startsWith(APP_SESSION_PREFIX);
}

/** Sources to fetch (GET /api/sessions?source=…) for a filter. */
export function syncSources(f: SyncFilter = {}): string[] {
  return ['api_server', ...(f.foreign ? FOREIGN_SOURCES : []), ...(f.cron ? ['cron'] : [])];
}

/** Sources the live inbox / push registration asks the bridge for (Telegram/CLI never notify). */
export function inboxSources(f: SyncFilter = {}): string[] {
  return f.cron ? ['api_server', 'cron'] : ['api_server'];
}

/** May a Hermes session (source + id) be shown / delivered under this filter? */
export function sessionAllowed(source: string | undefined, id: string | undefined | null, f: SyncFilter = {}): boolean {
  if (source === 'api_server') return isAppSessionId(id) || !!f.foreign;
  if (source === 'cron') return !!f.cron;
  if (source && FOREIGN_SOURCES.includes(source)) return !!f.foreign;
  return false;
}

/** Hermes cron run session id (`cron_<job>_<YYYYMMDD_HHMMSS>`, also used by the bridge). */
export const CRON_SESSION_RE = /^cron_.+_\d{8}_\d{6}$/;

/**
 * Source of a conversation that is NOT the app's own, or null (created in this app / app session elsewhere).
 * Cron reports are recognised by source OR session id, also when an inbox event created the entry without
 * the remote marker.
 */
export function foreignSource(c: ConversationMeta): string | null {
  if (c.remote?.source === 'cron' || CRON_SESSION_RE.test(c.hermesSessionId ?? '')) return 'cron';
  if (c.origin !== 'remote') return null;
  const source = c.remote?.source;
  return source === 'api_server' && isAppSessionId(c.hermesSessionId) ? null : (source ?? 'unknown');
}

/** Is this conversation the app's own (created here, or an app session from another install/device)? */
export function isAppConversation(c: ConversationMeta): boolean {
  return foreignSource(c) === null;
}

/** Entries of `profileId` that the filter hides (foreign sessions incl. inbox-created cron chats). */
export function foreignToPrune(items: readonly ConversationMeta[], profileId: string, f: SyncFilter = {}): string[] {
  return items
    .filter((c) => {
      if (c.profileKind !== 'hermes' || c.profileId !== profileId) return false;
      const src = foreignSource(c);
      return src !== null && !sessionAllowed(src, c.hermesSessionId, f);
    })
    .map((c) => c.id);
}

const SOURCE_KEYS: Record<string, TKey> = {
  api_server: 'conversations.source.apiServer',
  telegram: 'conversations.source.telegram',
  cli: 'conversations.source.cli',
  discord: 'conversations.source.discord',
  slack: 'conversations.source.slack',
  desktop: 'conversations.source.desktop',
  hermes_browser: 'conversations.source.hermesBrowser',
  dashboard: 'conversations.source.dashboard',
  cron: 'conversations.source.cron',
  oneshot: 'conversations.source.oneshot',
};

/** Badge text for a Hermes session source (unknown sources: the raw id, capitalised). */
export function sourceLabel(source: string | undefined, t: TFn): string | undefined {
  if (!source) return undefined;
  const key = SOURCE_KEYS[source];
  return key ? t(key) : source.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** Deterministic local id for a conversation created from a remote session. */
export function remoteConversationId(sessionId: string): string {
  return `r-${sessionId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)}`;
}

function hash36(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/**
 * Local id for a session whose plain id is already taken by ANOTHER server's conversation (same CLI/Telegram id
 * on two servers) or by a sanitising/truncation collision: namespaced by the profile + full session id.
 */
export function scopedRemoteConversationId(sessionId: string, profileId: string): string {
  return `${remoteConversationId(sessionId).slice(0, 100)}-${hash36(`${profileId}\u0000${sessionId}`)}`;
}

/** Tombstone of a session hidden on ONE server (profile-scoped; bare legacy entries still hide it everywhere). */
export function hiddenKey(profileId: string, sessionId: string): string {
  return `${profileId}::${sessionId}`;
}

/** Is session `sessionId` of a server (`sameServer` of a profile id) hidden by one of these tombstones? */
export function isHiddenSession(hidden: Iterable<string>, sessionId: string, sameServer: (profileId: string) => boolean): boolean {
  for (const h of hidden) {
    if (h === sessionId) return true; // legacy (unscoped) entry
    const at = h.indexOf('::');
    if (at > 0 && h.slice(at + 2) === sessionId && sameServer(h.slice(0, at))) return true;
  }
  return false;
}

/** Hermes titles of some providers start with a `<think>` dump; strip it, bound the length. */
export function cleanRemoteTitle(title: string | undefined): string | undefined {
  if (!title) return undefined;
  const t = title.replace(/<\/?think(?:ing)?>/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!t || /^the user (is|was|asks|wants)\b/i.test(t)) return undefined;
  return makeTitle(t, TITLE_MAX);
}

function clip(s: string | undefined, max = PREVIEW_MAX): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(t);
  return chars.length <= max ? t : chars.slice(0, max - 1).join('').trimEnd() + '…';
}

export type MergeInput = {
  /** the profile the sessions were fetched with (new entries are bound to it) */
  profile: ProfileRef;
  sessions: RemoteSession[];
  /** sources whose list was fetched completely (no `has_more`): vanished remote-only entries are pruned */
  completeSources?: string[];
  /** session ids the user removed from the list */
  hidden?: readonly string[];
  /** never prune the open conversation */
  activeId?: string;
  /**
   * which sessions may be shown (default: the app's own only). Sessions outside it never create entries, and
   * remote-only entries of this profile outside it are removed LOCALLY (`removed`; never deleted on Hermes)
   */
  filter?: SyncFilter;
  /**
   * Is the conversation's profile on the same Hermes server (and account) as `profile`? Session ids are only
   * unique per server: entries of other servers are never matched/updated, tombstones only apply per server.
   * Profiles sharing one server keep deduplicating. Default: every profile counts as the same server (legacy).
   */
  sameServer?: (profileId: string) => boolean;
  /**
   * Hermes profile ("bot") the sessions were listed from (`/p/<bot>/api/sessions`; undefined = default). Sessions are
   * namespaced per bot: only conversations of the same bot are matched / pruned, new entries are bound to it.
   */
  bot?: string;
};

export type MergeResult = { items: ConversationMeta[]; added: string[]; removed: string[]; changed: boolean };

function sameRemote(a: RemoteInfo | undefined, b: RemoteInfo): boolean {
  return !!a && a.source === b.source && a.lastActive === b.lastActive && a.remoteCount === b.remoteCount && a.title === b.title && a.loadedAt === b.loadedAt;
}

/** Should a listed session become a drawer entry? */
export function listable(s: RemoteSession, filter: SyncFilter = {}): boolean {
  return sessionAllowed(s.source, s.id, filter) && s.messageCount > 0 && !s.internalChild && !s.archived;
}

export function mergeRemoteSessions(items: ConversationMeta[], input: MergeInput): MergeResult {
  const filter = input.filter ?? {};
  const hidden = input.hidden ?? [];
  const sameServer = (pid: string) => pid === input.profile.id || (input.sameServer ? input.sameServer(pid) : true);
  const bot = botOf(input.bot);
  const sameBot = (c: ConversationMeta) => botOf(c.hermesProfile) === bot;
  const bySession = new Map<string, number>();
  items.forEach((c, i) => {
    if (c.profileKind !== 'hermes' || !c.hermesSessionId || bySession.has(c.hermesSessionId)) return;
    if (!sameServer(c.profileId) || !sameBot(c)) return; // same id on another server / bot: a different session
    bySession.set(c.hermesSessionId, i);
  });
  const next = items.slice();
  const added: string[] = [];
  const seen = new Set<string>();
  let changed = false;

  for (const s of input.sessions) {
    seen.add(s.id);
    const idx = bySession.get(s.id);
    const lastActive = s.lastActive ?? s.startedAt;
    if (idx !== undefined) {
      const c = next[idx];
      if (foreignSource(c) !== null && !sessionAllowed(s.source, s.id, filter)) continue; // pruned below
      const remote: RemoteInfo = { ...c.remote, source: s.source, lastActive, remoteCount: s.messageCount };
      const rt = cleanRemoteTitle(s.title);
      if (rt) remote.title = rt;
      else delete remote.title;
      let n: ConversationMeta = c;
      if (!sameRemote(c.remote, remote)) n = { ...n, remote };
      if (rt && c.titleSource !== 'user' && c.title !== rt) n = { ...n, title: rt, titleSource: 'remote' };
      if (lastActive > n.updatedAt + 1000) n = { ...n, updatedAt: lastActive };
      if (!c.remote?.loadedAt && c.origin === 'remote') {
        // only the list entry is known: keep preview/count from the server
        const preview = clip(s.preview) || n.preview;
        if (preview !== n.preview || n.messageCount !== Math.max(1, s.messageCount)) n = { ...n, preview, messageCount: Math.max(1, s.messageCount) };
      }
      if (n !== c) {
        next[idx] = n;
        changed = true;
      }
      continue;
    }
    if (!listable(s, filter) || isHiddenSession(hidden, s.id, sameServer)) continue;
    let id = remoteConversationId(s.id);
    // taken by another server's session with the same id, or a sanitising collision: namespaced id
    if (next.some((c) => c.id === id)) id = scopedRemoteConversationId(s.id, bot ? `${input.profile.id}/${bot}` : input.profile.id);
    if (next.some((c) => c.id === id)) continue;
    const title = cleanRemoteTitle(s.title) ?? (s.preview ? makeTitle(s.preview) : DEFAULT_TITLE);
    const meta: ConversationMeta = {
      id,
      title,
      titleSource: cleanRemoteTitle(s.title) ? 'remote' : 'auto',
      profileId: input.profile.id,
      profileKind: 'hermes',
      hermesSessionId: s.id,
      createdAt: s.startedAt || lastActive,
      updatedAt: lastActive,
      // non-empty preview + count keep it out of the "draft" filter until the transcript is loaded
      preview: clip(s.preview) || '…',
      messageCount: Math.max(1, s.messageCount),
      origin: 'remote',
      remote: { source: s.source, lastActive, remoteCount: s.messageCount, ...(cleanRemoteTitle(s.title) ? { title: cleanRemoteTitle(s.title) } : {}) },
      ...(bot ? { hermesProfile: bot } : {}),
    };
    if (s.pinned) meta.pinned = true;
    next.push(meta);
    added.push(id);
    changed = true;
  }

  // remote-only entries outside the filter (toggle switched off / app update): local removal only
  const removed: string[] = [];
  const outside = new Set(foreignToPrune(next, input.profile.id, filter));
  if (outside.size) {
    for (let i = next.length - 1; i >= 0; i--) {
      if (!outside.has(next[i].id)) continue;
      removed.push(next[i].id);
      next.splice(i, 1);
      changed = true;
    }
  }

  // remote-only entries whose session vanished (deleted/archived elsewhere) – only for fully listed sources
  const complete = new Set(input.completeSources ?? []);
  if (complete.size) {
    for (let i = next.length - 1; i >= 0; i--) {
      const c = next[i];
      if (c.origin !== 'remote' || !c.remote || !c.hermesSessionId || c.id === input.activeId) continue;
      if (c.profileId !== input.profile.id || !sameBot(c) || !complete.has(c.remote.source) || seen.has(c.hermesSessionId)) continue;
      // continued in this app since → keep the local copy
      if (c.remote.loadedAt && c.updatedAt > (c.remote.lastActive ?? 0) + 1000) continue;
      removed.push(c.id);
      next.splice(i, 1);
      changed = true;
    }
  }
  return { items: changed ? next : items, added, removed, changed };
}

/**
 * `loadedAt` acknowledged by a transcript fetch: the server activity known when the request STARTED (and the
 * newest fetched row) – never activity reported while it was in flight, never device time (review M2), so a turn
 * that finished meanwhile keeps `needsRemoteLoad` true and is fetched next.
 */
export function remoteLoadedAt(activityAtStart: number | undefined, newestFetched: number): number {
  return Math.max(activityAtStart ?? 0, newestFetched, 1);
}

/**
 * How a fetched Hermes transcript is saved – by the open chat (useApplyRemoteTranscript) and the fetch ahead
 * (storeFetchedTranscript) alike: without moving the chat. The drawer is ordered by ACTIVITY (the server's
 * last_active, lifted by the list sync and by the fetch's newest row when it is acknowledged, indexReducer
 * `remoteLoaded`) and by turns sent here – never by "opened here".
 */
export const SNAPSHOT_SAVE: { readonly keepOrder: true } = Object.freeze({ keepOrder: true });

/** Does opening this conversation need a transcript fetch from Hermes? */
export function needsRemoteLoad(meta: ConversationMeta | undefined): boolean {
  const r = meta?.remote;
  if (!meta?.hermesSessionId || !r) return false;
  if (!r.loadedAt) return true;
  return (r.lastActive ?? 0) > r.loadedAt;
}

/**
 * Combine the local transcript with the stored Hermes transcript (already mapped to ChatMessages).
 * - nothing local → the remote transcript
 * - user turns are aligned in order by their typed text (attachment parts/markers ignored, attachment-only
 *   turns match each other); matched local turns are kept (ids, attachments, UI state) and enriched with
 *   stored tool details/reasoning; an errored/empty local answer is replaced by the stored one; an answer whose
 *   stream was lost (`interrupted`, or persisted mid-stream when the app was killed) is completed by the stored
 *   final answer in place (same id – the live inbox / recovery poll may have done it already, never twice)
 * - regenerate / retry: Hermes keeps every run of a re-sent message ([U, A_old, U, A_new]) while the app shows
 *   the turn once. A stored user turn whose text is repeated by the NEXT stored user turn, where the local
 *   transcript has no second copy, is a superseded run: it is skipped and the local turn aligns with the last run
 * - remote turns after the last aligned one (continued on Telegram/CLI/another device) are appended, except a
 *   user turn + answer that repeats an existing local user turn AND answer (a run the app already shows)
 * - remote turns BETWEEN two aligned ones (sent from another device while this one still showed its cached
 *   history, Sol F06) are inserted right before the later aligned turn, same exceptions; superseded runs are not.
 *   Turns before the first aligned one are not (the local history may be capped at its head)
 * - nothing aligns: remote-only conversations take the remote transcript, app conversations keep the local one
 * - a message queued when the app stopped (`sendQueued`, hermes/pendingSend.ts) that Hermes already has (the turn
 *   started before the transcript was saved) aligns with that stored turn (only one newer than the tap on Send):
 *   it becomes a normal sent message with the stored answer after it – never offered for sending again
 * Returns `local` itself when nothing changed.
 */
export function reconcileTranscript(local: ChatMessage[], remote: ChatMessage[], origin?: 'remote'): ChatMessage[] {
  if (!remote.length) return local;
  if (!local.length) return remote;
  if (origin === 'remote' && local.every((m) => isRemoteMessageId(m.id))) {
    // never continued in the app: the server copy wins (but keep identical objects when unchanged)
    return sameTranscript(local, remote) ? local : remote;
  }

  const out = local.slice();
  const sameUserTurn = createUserTurnMatcher();
  let changed = false;
  let li = 0;
  let lastRemoteUser = -1;
  /** first remote index after the last aligned turn and its answer (-1: nothing aligned yet) */
  let gapFrom = -1;
  /** remote indices of superseded runs (never merged in) */
  let superseded: Set<number> | null = null;
  for (let ri = 0; ri < remote.length; ri++) {
    const r = remote[ri];
    if (r.role !== 'user') continue;
    let found = -1;
    for (let j = li; j < out.length; j++) {
      if (out[j].role === 'user' && sameUserTurn(out[j], r) && (!out[j].sendQueued || queuedMayMatch(out[j], r.createdAt))) {
        found = j;
        break;
      }
    }
    if (found === -1) continue;
    const nr = nextUserIndex(remote, ri + 1);
    if (nr !== -1 && normText(remote[nr].text) === normText(r.text)) {
      const nl = nextUserIndex(out, found + 1);
      if (nl === -1 || !sameUserTurn(out[nl], remote[nr])) {
        // superseded run (see above)
        superseded ??= new Set();
        for (let k = ri; k < nr; k++) superseded.add(k);
        continue;
      }
    }
    if (gapFrom !== -1 && gapFrom < ri) {
      const gap = missingRemote(out, remote, gapFrom, ri, superseded, sameUserTurn);
      if (gap.length) {
        out.splice(found, 0, ...gap);
        found += gap.length;
        changed = true;
      }
    }
    lastRemoteUser = ri;
    gapFrom = remote[ri + 1]?.role === 'assistant' ? ri + 2 : ri + 1;
    li = found + 1;
    const wasQueued = !!out[found].sendQueued;
    if (wasQueued) {
      out[found] = sentFromQueued(out[found]);
      changed = true;
    }
    const ra = remote[ri + 1]?.role === 'assistant' ? remote[ri + 1] : undefined;
    const la = out[found + 1]?.role === 'assistant' ? out[found + 1] : undefined;
    if (ra && la) {
      let merged: ChatMessage;
      if ((isRecoverable(la) || cutOff(la)) && isFinalAnswer(ra)) {
        merged = recoveredMessage(la, ra);
      } else if ((la.status === 'error' || la.status === 'stopped') && !la.text.trim() && ra.text.trim()) {
        merged = { ...ra, id: la.id, ...(la.approvalLog ? { approvalLog: la.approvalLog } : {}) };
      } else {
        merged = mergeAssistantDetails(la, ra);
      }
      if (merged !== la) {
        out[found + 1] = merged;
        changed = true;
      }
      li = found + 2;
    } else if (ra && !la && (found === out.length - 1 || wasQueued)) {
      out.splice(found + 1, 0, ra);
      changed = true;
      li = found + 2;
    }
  }
  if (lastRemoteUser === -1) return origin === 'remote' ? remote : local;
  // remote turns after the last aligned user turn (skip its answer)
  if (gapFrom < remote.length) {
    const tail = missingRemote(out, remote, gapFrom, remote.length, superseded, sameUserTurn);
    if (tail.length) {
      out.push(...tail);
      changed = true;
    }
  }
  return changed ? out : local;
}

/**
 * remote[from, to) that the local transcript does not show yet: not superseded, not a known id, and not a user
 * turn + answer that repeats an existing local user turn AND answer (a run the app already shows)
 */
function missingRemote(
  out: ChatMessage[],
  remote: ChatMessage[],
  from: number,
  to: number,
  superseded: Set<number> | null,
  sameUserTurn: ReturnType<typeof createUserTurnMatcher>
): ChatMessage[] {
  const add: ChatMessage[] = [];
  let known: Set<string> | null = null;
  let answers: Set<string> | null = null;
  for (let k = from; k < to; k++) {
    if (superseded?.has(k)) continue;
    known ??= new Set(out.map((m) => m.id));
    answers ??= new Set(out.filter((m) => m.role === 'assistant' && m.text.trim()).map((m) => normText(m.text)));
    const m = remote[k];
    const next = k + 1 < to ? remote[k + 1] : undefined;
    if (m.role === 'user' && next?.role === 'assistant' && next.text.trim() && answers.has(normText(next.text)) && out.some((u) => u.role === 'user' && sameUserTurn(u, m))) {
      k++; // the same question with the same answer is already shown
      continue;
    }
    if (known.has(m.id)) continue;
    add.push(m);
  }
  return add;
}

/** persisted while still streaming (app killed): `stopped` without the end time every finalised message has */
function cutOff(m: ChatMessage): boolean {
  return m.status === 'stopped' && m.metrics?.endedAt === undefined;
}

function nextUserIndex(list: ChatMessage[], from: number): number {
  for (let i = from; i < list.length; i++) if (list[i].role === 'user') return i;
  return -1;
}

function sameTranscript(a: ChatMessage[], b: ChatMessage[]): boolean {
  // Compare all persisted fields, including tool results, reasoning and terminal status. The storage
  // signature also applies the same caps to cached and remote messages, so unchanged fetches stay stable.
  return a.length === b.length && messagesSignature(a) === messagesSignature(b);
}

/**
 * One fetched remote snapshot into the mounted chat (pure): reconcile, show, save – and only then acknowledge the
 * fetch (`loadedAt`, Astra F08). null = the chat refused the replace (a turn is running): nothing acked.
 */
export function applyRemoteSnapshot(o: {
  messages: ChatMessage[];
  remote: ChatMessage[];
  origin: ConversationMeta['origin'];
  replace: (m: ChatMessage[]) => boolean;
  save: (m: ChatMessage[]) => void;
  ack?: () => void;
}): ChatMessage[] | null {
  const merged = reconcileTranscript(o.messages, o.remote, o.origin);
  if (merged !== o.messages) {
    if (!o.replace(merged)) return null;
    o.save(merged);
  }
  o.ack?.();
  return merged;
}
