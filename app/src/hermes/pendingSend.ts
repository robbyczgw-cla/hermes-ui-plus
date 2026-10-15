// Transcript side of "Send while uploads are still running" (pure, pendingSend.test.ts). useHermesChat shows the
// user message at once (`sendPending`, per-attachment upload state), keeps its attachments in step with the
// uploads (attachments/pendingUploads.ts) and, once every upload is done, turns it into a normal user message +
// the assistant placeholder of the turn that starts then. Cancel removes it again. Persisted (app killed / reload
// meanwhile) it comes back as a queued message the user re-sends or discards (below). The same holds after the uploads,
// until the server accepted the turn ("durable send" below).
import type { Attachment } from '../attachments/types';
import { createAssistantMessage } from './chatState.ts';
import { CLOCK_SKEW_MS, markInterrupted } from './recovery.ts';
import { createUserTurnMatcher, normText, userTextCore } from './sessionMapping.ts';
import type { ChatMessage } from './types';

/** The pending user message's attachments changed. A transcript replaced meanwhile (recovery / sync) gets it back. */
export function patchPendingAttachments(list: readonly ChatMessage[], pending: ChatMessage, atts: Attachment[]): { list: ChatMessage[]; message: ChatMessage } {
  const i = list.findIndex((m) => m.id === pending.id);
  const base = i === -1 ? pending : list[i];
  const message: ChatMessage = { ...base, attachments: atts.length ? atts : undefined, sendPending: true };
  if (i === -1) return { list: [...list, message], message };
  const next = list.slice();
  next[i] = message;
  return { list: next, message };
}

/**
 * Every upload is done: the user message becomes a normal one carrying the sent attachments (remote refs), followed
 * by the assistant placeholder of the turn. The pending message moves to the end if anything was appended after it.
 * `sendKey`: the turn starts now with this Idempotency-Key → the message is unacknowledged until the server takes it.
 */
export function releasePending(list: readonly ChatMessage[], pending: ChatMessage, sent: Attachment[], now: number, sendKey?: string): ChatMessage[] {
  const cur = list.find((m) => m.id === pending.id) ?? pending;
  const { sendPending: _p, attachments: _a, ...rest } = cur;
  const released: ChatMessage = { ...rest, ...(sent.length ? { attachments: sent } : {}) };
  const user = sendKey ? unackedUser(released, sendKey) : released;
  return [...list.filter((m) => m.id !== pending.id), user, createAssistantMessage(now)];
}

/** Cancelled: the message goes (nothing was sent to the model). */
export function dropPending(list: readonly ChatMessage[], id: string): ChatMessage[] {
  return list.some((m) => m.id === id) ? list.filter((m) => m.id !== id) : (list as ChatMessage[]);
}

/** A send whose message would be empty once its attachments are gone (text only whitespace, nothing attached). */
export function pendingIsEmpty(text: string, atts: readonly Attachment[]): boolean {
  return !text.trim() && atts.length === 0;
}

/** The transcript still waits for uploads (last message is a pending user message): counts as a running turn. */
export function hasPendingSend(list: readonly ChatMessage[]): boolean {
  const last = list[list.length - 1];
  return !!last && last.role === 'user' && !!last.sendPending;
}

// ---------------------------------------------------------------- queued after a restart (persisted form)
//
// A message still waiting for its uploads is persisted as `sendQueued` (stripMessage → queuedForStorage), so an app
// killed meanwhile (or a reload) loses neither the text nor the attachment association. Restored, it is a
// failed-but-recoverable bubble: never sent by itself (the context may be stale), only "Erneut senden" (check
// Hermes → upload what is missing → turn) or "Verwerfen" (text back into the composer). Files: native copies in
// <documents>/attachments stay referenced by the stored transcript (start-up prune keeps them); web blobs go to
// IndexedDB (attachments/queuedFiles.ts). Done uploads keep their remoteRef and are not uploaded again.
//
//   queued ──Erneut senden──▶ checking ──stored session has the turn──▶ adopted (shown as sent, answer recovered)
//                                      ──not there / no session API──▶ sending (live sendPending: uploads → turn)
//                                      ──check failed (offline)──────▶ queued + notice (never sent blind)
//   queued ──Verwerfen──▶ discarded (text back into the composer, files deleted)

/** One attachment of a queued message as stored: no progress / error; `remoteRef` kept when its upload was done. */
export function queuedAttachment(a: Attachment): Attachment {
  const { progress: _p, error: _e, errorSource: _s, ...rest } = a as Attachment & { errorSource?: unknown };
  return { ...rest, status: 'ready' };
}

/**
 * Persisted form of a message waiting for its uploads or for the server to accept its turn (`sendPending` /
 * `sendUnacked` are runtime state: neither uploads nor the request can resume). `sendKey` is kept.
 */
export function queuedForStorage(m: ChatMessage): ChatMessage {
  const { sendPending: _p, sendUnacked: _u, attachments, ...rest } = m;
  return { ...rest, ...(attachments?.length ? { attachments: attachments.map(queuedAttachment) } : {}), sendQueued: true };
}

/**
 * Why a restored queued message was not sent: 'upload' = the app stopped while its uploads ran; 'request' = its turn
 * request had started (it carries the Idempotency-Key) but the server had not accepted it yet.
 */
export function queuedNotice(m: Pick<ChatMessage, 'sendKey'>): 'upload' | 'request' {
  return m.sendKey ? 'request' : 'upload';
}

export function isQueued(m: ChatMessage | undefined): boolean {
  return !!m && m.role === 'user' && !!m.sendQueued;
}

/** The queued message as a normal sent user message (Hermes has its turn). */
export function sentFromQueued(m: ChatMessage): ChatMessage {
  const { sendQueued: _q, sendKey: _k, ...rest } = m;
  return rest;
}

// ---------------------------------------------------------------- sent, not yet acknowledged (durable send)
//
// The turn request of a user message is on its way (its uploads, if any, are done) but the bridge / Hermes has not
// accepted it yet (`sendUnacked`, runtime; useHermesChat). The transcript is written to storage BEFORE the request
// starts, in the queued form with the turn's Idempotency-Key (`sendKey`) and without the answer placeholder:
//
//   send ──▶ unacked ──server accepted (HTTP 200)──▶ sent (stored with its answer; a kill now → recovering answer)
//                    ──failed / stopped before────▶ sent + failed answer ("Erneut" re-uses the key, idempotency.ts)
//   killed while unacked ──restart──▶ queued "Nicht gesendet": Erneut senden → check the stored session →
//                                     adopted (Hermes has it) | sent again with the SAME key (the bridge re-attaches
//                                     to a turn it already started, replay.mjs) ; Verwerfen; transcript sync dedupes

/** The user message of a turn that starts now: carries its Idempotency-Key, unacknowledged until the server takes it. */
export function unackedUser(m: ChatMessage, sendKey: string): ChatMessage {
  return { ...m, sendKey, sendUnacked: true };
}

/** The server accepted the turn (or it ended before that): the unacknowledged user message becomes a normal one. */
export function ackSend(list: readonly ChatMessage[]): ChatMessage[] {
  if (!list.some((m) => m.sendUnacked)) return list as ChatMessage[];
  return list.map((m) => {
    if (!m.sendUnacked) return m;
    const { sendUnacked: _u, sendKey: _k, ...rest } = m;
    return rest;
  });
}

/** Stored transcript: the answer placeholder of an unacknowledged send is not stored (the message is queued then). */
export function withoutUnackedAnswers(list: readonly ChatMessage[]): readonly ChatMessage[] {
  if (!list.some((m) => m.sendUnacked)) return list;
  return list.filter((m, i) => !(m.role === 'assistant' && i > 0 && list[i - 1].role === 'user' && list[i - 1].sendUnacked));
}

/** May a stored user row be the queued message's turn? Not when it is older than the tap on Send (clock skew aside). */
export function queuedMayMatch(q: Pick<ChatMessage, 'createdAt'>, remoteAt: number | undefined): boolean {
  return !(remoteAt && q.createdAt && remoteAt < q.createdAt - CLOCK_SKEW_MS);
}

/**
 * Did Hermes already take the turn of the queued message `id` (killed after the turn started but before the
 * transcript was saved)? Its stored user row is the (n+1)-th matching one within the window, n = the same text sent
 * (and answered) from here before – like recovery.matchRemoteTurn. Errs towards "stored": never send twice.
 */
export function queuedTurnStored(list: readonly ChatMessage[], id: string, remote: readonly ChatMessage[]): boolean {
  const q = list.find((m) => m.id === id);
  if (!q) return false;
  const same = createUserTurnMatcher();
  const qCore = normText(userTextCore(q.text).core);
  const local = (m: ChatMessage) => (qCore ? same(q, m.text) : !normText(userTextCore(m.text).core) && !!m.attachments?.length && !!q.attachments?.length);
  let earlier = 0;
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (m === q || m.role !== 'user' || m.sendQueued || m.sendPending || !queuedMayMatch(q, m.createdAt) || !local(m)) continue;
    const a = list[i + 1];
    if (a?.role === 'assistant' && a.status === 'done') earlier++;
  }
  let stored = 0;
  for (const r of remote) if (r.role === 'user' && queuedMayMatch(q, r.createdAt) && same(q, r)) stored++;
  return stored > earlier;
}

export type QueuedCheck = 'stored' | 'notStored' | 'unknown';

/**
 * Result of the check before "Erneut senden". `remote`: the stored session (mapped); null = the server has no session
 * API (nothing to check against: send); 'error' = the fetch failed (offline / busy: do not send blind).
 */
export function checkQueued(list: readonly ChatMessage[], id: string, remote: readonly ChatMessage[] | null | 'error'): QueuedCheck {
  if (remote === 'error') return 'unknown';
  if (remote === null) return 'notStored';
  return queuedTurnStored(list, id, remote) ? 'stored' : 'notStored';
}

/**
 * Hermes has the queued message's turn: it becomes a normal sent message followed by a recovering answer
 * placeholder (recovery.ts fills it from the stored session / live inbox, same as a lost stream).
 */
export function adoptQueued(list: readonly ChatMessage[], id: string, now: number): ChatMessage[] {
  const i = list.findIndex((m) => m.id === id);
  if (i < 0 || !list[i].sendQueued) return list as ChatMessage[];
  const next = list.slice();
  next.splice(i, 1, sentFromQueued(list[i]), markInterrupted(createAssistantMessage(now), now));
  return next;
}

export type QueuedPhase = 'queued' | 'checking' | 'sending' | 'adopted' | 'discarded';
export type QueuedState = { phase: QueuedPhase; notice?: 'checkFailed' };
export type QueuedEvent =
  /** "Erneut senden"; `busy`: another turn (or send) of this chat is running */
  | { type: 'resend'; busy: boolean }
  | { type: 'checked'; result: QueuedCheck }
  /** "Verwerfen" */
  | { type: 'discard' };

export const QUEUED_INITIAL: QueuedState = { phase: 'queued' };

/** Restore UI of one queued message (pure). Taps while a check runs are ignored: one tap → at most one send. */
export function queuedReduce(s: QueuedState, e: QueuedEvent): QueuedState {
  switch (e.type) {
    case 'resend':
      return s.phase === 'queued' && !e.busy ? { phase: 'checking' } : s;
    case 'checked':
      if (s.phase !== 'checking') return s;
      if (e.result === 'stored') return { phase: 'adopted' };
      if (e.result === 'notStored') return { phase: 'sending' };
      return { phase: 'queued', notice: 'checkFailed' };
    case 'discard':
      return s.phase === 'queued' ? { phase: 'discarded' } : s;
  }
}
