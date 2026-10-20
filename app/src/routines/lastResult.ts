/**
 * The last report of a Routine, read from Hermes' session history. Pure, erasable TS.
 *
 * Hermes v0.22.2 (cron/scheduler.py `run_job`) stores every agent run as a fresh session `cron_<job_id>_<YYYYMMDD_HHMMSS>`
 * with source `cron`. The job API has no run/result resource, so this is the partial path the design allows: the newest
 * matching session among the newest 100 cron sessions of the bot, its final assistant message. Script-only runs, runs
 * whose session database could not be opened and older runs beyond that window have no entry here; the UI says so
 * instead of inventing a result. The session id format is a convention, not a run identity: used for lookup only.
 */
import type { MessagesPage, RemoteMessage, RemoteSession, SessionPage } from '../hermes/sessions.ts';

export const CRON_SESSION_WINDOW = 100;

export type LastResult = {
  sessionId: string;
  /** ms */
  at?: number;
  text: string;
};

type SessionsLike = {
  list(p: { source?: string; limit?: number }): Promise<SessionPage>;
  messages(id: string, p: { order?: 'latest' | 'oldest'; limit?: number }): Promise<MessagesPage>;
};

/** Newest session of this job among `sessions` (by start time; the id's timestamp breaks ties). */
export function newestRunSession(jobId: string, sessions: readonly RemoteSession[]): RemoteSession | undefined {
  const prefix = `cron_${jobId}_`;
  let best: RemoteSession | undefined;
  for (const s of sessions) {
    if (!s.id.startsWith(prefix)) continue;
    if (!best || s.startedAt > best.startedAt || (s.startedAt === best.startedAt && s.id > best.id)) best = s;
  }
  return best;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((p) => (p && typeof p === 'object' && (p as { type?: unknown }).type === 'text' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : ''))
    .filter(Boolean)
    .join('\n');
}

/** Final visible assistant text of a run (newest first page), or '' when the run left none. */
export function finalAnswer(messages: readonly RemoteMessage[]): { text: string; at?: number } {
  const sorted = [...messages].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0) || Number(a.id) - Number(b.id));
  for (let i = sorted.length - 1; i >= 0; i--) {
    const m = sorted[i];
    if (!m || m.role !== 'assistant' || m.displayKind === 'hidden') continue;
    const text = textOf(m.content).trim();
    if (text) return { text, at: m.timestamp };
  }
  return { text: '' };
}

/** null = no stored run of this job in the window (not an error). */
export async function loadLastResult(sessions: SessionsLike, jobId: string): Promise<LastResult | null> {
  const page = await sessions.list({ source: 'cron', limit: CRON_SESSION_WINDOW });
  const s = newestRunSession(jobId, page.sessions);
  if (!s) return null;
  const msgs = await sessions.messages(s.id, { order: 'latest', limit: 30 });
  const { text, at } = finalAnswer(msgs.messages);
  if (!text) return null;
  return { sessionId: s.id, at: at ?? s.lastActive ?? s.startedAt, text };
}
