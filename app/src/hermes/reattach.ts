/**
 * Live re-attach of an interrupted answer (pure, node:test). The UI bridge records every keyed turn
 * (bridge/src/replay.mjs); an answer whose stream was lost for longer than the in-stream resume window (stream.ts), or
 * one persisted unfinished by an app that was killed, re-attaches to that recording instead of waiting for the stored
 * session ("nachgeladen"):
 *
 *   recovering ──re-attach at byte 0 (same Idempotency-Key)──▶ streaming (the recording is replayed, then live)
 *   recovering ──409 resume_unavailable / turn_unrecorded──▶ recovering without `resumable` (stored session, recovery.ts)
 *   recovering ──offline / bridge busy──▶ recovering (tried again: recovery.ts REATTACH_DELAYS_MS, foreground, reconnect)
 *
 * The app's SSE parser state is gone after a restart, so the turn is replayed from the start into a fresh copy of the
 * message ("shadow") while the bubble keeps what it shows; the copy takes over once it covers that (or after
 * REATTACH_SWAP_MS, or at the turn's end). Every event is applied exactly once to one message: nothing is doubled,
 * nothing missing, and textReplace / append runs (chatState.ts) work as in a live turn.
 */
import type { ApprovalRecord, ChatMessage, TraceStep } from './types';
import { approvalKey, approvalRecorded, LOG_COMMAND_MAX, LOG_MAX, pendingOf, setPending } from './approvals.ts';
import { pushTrace } from './trace.ts';
import { isRecovering } from './recovery.ts';

/** the replayed copy takes over after this long even when it is shorter (a textReplace shortened the answer) */
export const REATTACH_SWAP_MS = 1500;
/** live re-attaches of one message per mounted chat; a turn that keeps breaking falls back to the stored session */
export const MAX_REATTACHES = 5;

/** bridge refusals after which this turn can never be re-attached (the stored session has to deliver it) */
const GONE_CODES: ReadonlySet<string> = new Set(['resume_unavailable', 'turn_unrecorded', 'idempotency_key_conflict', 'invalid_resume_offset']);

export type ReattachOutcome = 'live' | 'gone' | 'retry';

/** the message at `idx` can be re-attached: recovering, recorded by the bridge, the last answer of its turn */
export function canReattach(list: readonly ChatMessage[], idx: number): boolean {
  const m = list[idx];
  return idx === list.length - 1 && isRecovering(m) && m.resumable === true && !!m.sendKey && list[idx - 1]?.role === 'user';
}

/** outcome of a re-attach request that failed before the stream started (HermesError `code` / `status` / kind) */
export function failedReattach(e: { code?: string; status?: number; kind?: string }): ReattachOutcome {
  if (e.code && GONE_CODES.has(e.code)) return 'gone';
  if (e.kind === 'aborted') return 'retry'; // the chat was closed / a new send took over: nothing was refused
  if (e.kind === 'network' || e.kind === 'timeout' || e.kind === 'stream' || e.kind === 'rate_limit' || e.kind === 'busy' || e.kind === 'server') return 'retry';
  return 'gone'; // 400 / 401 / 403 / 404: not this way
}

/** the bubble while it re-attaches: streaming again, no "loading the answer" note */
export function resumedStreaming(m: ChatMessage): ChatMessage {
  const { interrupted: _i, error: _e, errorText: _k, recoveredAt: _r, ...rest } = m;
  return { ...rest, status: 'streaming' };
}

/** `m` without the re-attach mark: the bridge refused it, the stored session delivers the answer */
export function withoutResumable(m: ChatMessage): ChatMessage {
  if (!m.resumable) return m;
  const { resumable: _r, ...rest } = m;
  return rest;
}

/** the fresh copy the recording is replayed into: same identity, only what the stream does not carry */
export function replayBase(m: ChatMessage): ChatMessage {
  const base: ChatMessage = { id: m.id, role: 'assistant', text: '', tools: [], status: 'streaming', createdAt: m.createdAt };
  if (m.sendKey) base.sendKey = m.sendKey;
  if (m.resumable) base.resumable = true;
  if (m.approvalLog?.length) base.approvalLog = m.approvalLog; // answered requests are not offered again (addApproval)
  if (m.metrics?.firstTokenAt !== undefined) base.metrics = { firstTokenAt: m.metrics.firstTokenAt };
  return base;
}

/** the replayed copy shows at least what the bubble shows */
export function covers(replayed: ChatMessage, shown: ChatMessage): boolean {
  return replayed.text.length >= shown.text.length && replayed.tools.length >= shown.tools.length;
}

/** the replayed copy takes over the bubble: tools keep the times the bubble knew (the replay ran just now) */
export function adoptReplay(shown: ChatMessage, replayed: ChatMessage): ChatMessage {
  const known = new Map(shown.tools.map((t) => [t.id, t]));
  const tools = replayed.tools.map((t) => {
    const old = known.get(t.id);
    if (!old) return t;
    const next = { ...t, startedAt: old.startedAt };
    // a call the bubble had closed only because the app was killed (stored as cancelled) keeps the replay's end
    if (t.status !== 'running' && old.endedAt !== undefined && !old.detail?.cancelled) next.endedAt = old.endedAt;
    return next;
  });
  let adopted: ChatMessage = { ...replayed, id: shown.id, createdAt: shown.createdAt, tools };
  // Approval decisions are app state, not SSE events. They can change while the shadow catches up.
  const recordKey = (r: ApprovalRecord) => r.requestId ?? (r.timestamp !== undefined && r.command.length < LOG_COMMAND_MAX
    ? `${r.runId}:${r.timestamp}:${r.command}`
    : `${r.runId}:${r.requestedAt}:${r.at}:${r.command}`);
  const log = [...new Map([...(replayed.approvalLog ?? []), ...(shown.approvalLog ?? [])].map(r => [recordKey(r), r])).values()].slice(-LOG_MAX);
  if (log.length) adopted = { ...adopted, approvalLog: log };
  const knownPending = new Map(pendingOf(shown).map(a => [approvalKey(a), a]));
  const queue = new Map(pendingOf(replayed).map(a => [approvalKey(a), knownPending.get(approvalKey(a)) ?? a]));
  if (adopted.status === 'streaming') for (const [key, a] of knownPending) queue.set(key, a);
  adopted = setPending(adopted, [...queue.values()].filter(a => a.expired || !approvalRecorded(adopted, a)));
  const answerKey = (m: ChatMessage, step: TraceStep) => {
    const data = step.data as { requestId?: string; requestKey?: string } | undefined;
    if (data?.requestId) return data.requestId;
    if (data?.requestKey) return data.requestKey;
    const records = m.approvalLog?.filter(r => r.at === step.at && r.outcome === step.text);
    return records?.length === 1 ? recordKey(records[0]) : `${step.id}:${step.at}:${step.text}`;
  };
  const answers = new Map((replayed.trace ?? []).filter(s => s.kind === 'approval_answer').map(s => [answerKey(replayed, s), s.id]));
  for (const step of shown.trace ?? []) {
    if (step.kind !== 'approval_answer') continue;
    const oldId = answers.get(answerKey(shown, step));
    // A replay can close a request as cancelled after the displayed copy already recorded its real decision.
    if (oldId) adopted = { ...adopted, trace: adopted.trace?.map(s => s.id === oldId ? { ...step, id: oldId } : s) };
    else adopted = pushTrace(adopted, step.kind, step.at, { text: step.text, data: step.data, endedAt: step.endedAt });
  }
  return adopted;
}
