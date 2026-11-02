/**
 * Bots A+: one sync round of a bot's screen (bots/timeline.ts). Pure apart from what's injected (node:test).
 *
 * The Bot Chat is looked up by title and its transcript only fetched when it moved. The talk is only asked for its
 * activity: a newer `lastActive` makes the open chat fetch it itself (useRemoteTranscript), which is how another
 * device's turns arrive. Each source fails on its own; what was stored stays and the caller shows a visible row.
 */
import { isNotFoundError, type RemoteSession } from '../hermes/sessions.ts';
import { remoteLoadedAt, SNAPSHOT_SAVE } from '../conversations/remoteSync.ts';
import type { ChatMessage } from '../hermes/types.ts';
import type { FetchedTranscript, TranscriptTarget } from '../conversations/remotePrefetch.ts';
import type { ConversationMeta } from '../conversations/types.ts';

export type FeedSyncDeps = {
  ctl: TranscriptTarget & {
    botChatRemote(id: string, info: { lastActive?: number; remoteCount?: number; preview?: string }): void;
  };
  now(): number;
  lookupBotChat(): Promise<RemoteSession | null>;
  fetchTranscript(sessionId: string): Promise<FetchedTranscript>;
  fetchSession(sessionId: string): Promise<RemoteSession>;
  /** the newest session of this bot's talk in any generation, for when the known id is gone */
  findTalkSession(except: string): Promise<RemoteSession | null>;
  /** the talk goes on under this session, or a new generation */
  moveTalk(talkId: string, sessionId?: string): unknown;
  /** files wait unsent in a composer, which a move would close: not now. A send before the next round moves it with them */
  holdTalkMove?(): boolean;
  /** the server's Bot Chat isn't the one we know: a new one, or the known one was moved aside (bots/adopt.ts rebindBotChat) */
  adopt(session: RemoteSession, known: ConversationMeta | undefined): Promise<unknown>;
};

export type FeedSyncResult = { feedError?: unknown; talkError?: unknown };

/**
 * A read-only source's rows: the server's copy wins for everything it covers, so a job that delivers the same text
 * every day keeps every delivery (the chat engine's reconcile would take it for a re-sent turn). Only what the server's
 * page no longer reaches (it returns the newest rows) stays from the local copy.
 */
export function feedSnapshot(local: readonly ChatMessage[], remote: readonly ChatMessage[]): ChatMessage[] {
  if (!remote.length) return local.slice();
  const oldest = remote[0].createdAt;
  return [...local.filter((m) => m.createdAt < oldest), ...remote];
}

async function fetchInto(d: FeedSyncDeps, meta: ConversationMeta, sessionId: string): Promise<void> {
  const activityAtStart = meta.remote?.lastActive;
  const { remote, newest } = await d.fetchTranscript(sessionId);
  d.ctl.save(meta.id, feedSnapshot(await d.ctl.loadMessages(meta.id), remote), SNAPSHOT_SAVE);
  d.ctl.markRemoteLoaded(meta.id, remoteLoadedAt(activityAtStart, newest), newest || undefined);
}

export async function syncBotFeed(d: FeedSyncDeps, o: { botChatId?: string; retiredIds: readonly string[]; talkId: string }): Promise<FeedSyncResult> {
  const out: FeedSyncResult = {};
  try {
    const s = await d.lookupBotChat();
    const known = o.botChatId ? d.ctl.get(o.botChatId) : undefined;
    if (s && known?.hermesSessionId === s.id) {
      d.ctl.botChatRemote(known.id, { lastActive: s.lastActive, remoteCount: s.messageCount });
      const cur = d.ctl.get(known.id)!;
      if (!cur.remote?.loadedAt || (cur.remote.lastActive ?? 0) > cur.remote.loadedAt) await fetchInto(d, cur, s.id);
    } else if (s) {
      await d.adopt(s, known);
    }
  } catch (e) {
    out.feedError = e;
  }
  // a former Bot Chat doesn't change any more: its transcript once, if this device never had it
  for (const id of o.retiredIds) {
    const m = d.ctl.get(id);
    if (!m?.hermesSessionId || !m.remote || m.remote.loadedAt) continue;
    try {
      await fetchInto(d, m, m.hermesSessionId);
    } catch (e) {
      if (isNotFoundError(e)) d.ctl.markRemoteLoaded(id, Date.now());
      else out.feedError ??= e;
    }
  }
  const talk = d.ctl.get(o.talkId);
  if (talk?.hermesSessionId) {
    try {
      const s = await d.fetchSession(talk.hermesSessionId);
      // Hermes' single-session answer has no last_active (measured on v0.22.5, only the list has it): a changed count
      // says the same, and that's how another device's turn gets here
      const moved = s.messageCount !== talk.remote?.remoteCount;
      d.ctl.botChatRemote(talk.id, { lastActive: s.lastActive ?? (moved ? d.now() : undefined), remoteCount: s.messageCount, preview: s.preview });
    } catch (e) {
      if (!isNotFoundError(e)) out.talkError = e;
      else {
        // no turn yet on any device: the session comes with the first one. Unless another device went on under a newer
        // id, or this one saw it on the server before: deleted elsewhere, and Hermes won't take that id again
        try {
          if (d.holdTalkMove?.()) return out;
          const other = await d.findTalkSession(talk.hermesSessionId);
          if (other) await d.moveTalk(talk.id, other.id);
          else if (talk.remote?.lastActive || talk.remote?.remoteCount) await d.moveTalk(talk.id);
        } catch (e2) {
          out.talkError = e2;
        }
      }
    }
  }
  return out;
}
