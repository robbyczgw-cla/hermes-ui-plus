/**
 * Approval queue, expiry, restore and history for one assistant message (pure, node:test).
 *
 * Wire facts (Hermes v0.21):
 *  - `approval.request` has NO deadline. The server waits `approvals.timeout` (hermes-host: 300 s, not advertised in
 *    /v1/capabilities) and then denies ("silence is not consent"); the turn continues.
 *  - `GET /v1/runs/{completionId}` reports `status:"waiting_for_approval"` + `approval:{…event}` (only the LATEST
 *    request). Answering one sets the status back to `running` even if a second one is still pending, and an expired
 *    request stays in the status until the run ends → the client deadline decides whether a restored one is live.
 *  - several requests can be pending at once (parallel tool calls) → a queue keyed by `request_id`.
 *
 * Message fields: `pendingApprovals` (runtime queue, oldest first; `approval` mirrors its head for older readers) and
 * `approvalLog` (persisted history rows). Every request ends in exactly one log row: once/session/always/deny,
 * `expired` (deadline passed) or `cancelled` (run ended / stopped without an answer).
 */
import type { ApprovalOutcome, ApprovalRecord, ApprovalRequest, ChatMessage } from './types.ts';
import { pushTrace } from './trace.ts';

/** Hermes default `approvals.timeout` (fallback when neither event nor server advertises one) */
export const DEFAULT_APPROVAL_TIMEOUT_S = 300;
/** live events: ignore the server timestamp when the clocks differ by more than this */
export const MAX_CLOCK_SKEW_MS = 60_000;
/** stored command length per history row */
export const LOG_COMMAND_MAX = 300;
/** history rows kept per message */
export const LOG_MAX = 30;
/** only turns this young are checked against GET /v1/runs/{id} */
export const RESTORE_WINDOW_MS = 30 * 60_000;

export type DeadlineSource = 'server' | 'advertised' | 'default';

/** stable identity of a request */
export function approvalKey(a: Pick<ApprovalRequest, 'requestId' | 'runId' | 'timestamp' | 'command'>): string {
  return a.requestId ?? `${a.runId}:${a.timestamp}:${a.command}`;
}

export function deadlineSource(a: Pick<ApprovalRequest, 'expiresAt' | 'timeoutSeconds'>): DeadlineSource {
  return a.expiresAt ? 'server' : a.timeoutSeconds ? 'advertised' : 'default';
}

export type DeadlineOptions = {
  /** device ms when the request arrived */
  receivedAt: number;
  /** `approvals.timeout` advertised by the server (capabilities), seconds */
  advertisedTimeoutS?: number;
  /**
   * restored from GET /v1/runs: the request may be minutes old. With the server's `Date` header the age is measured
   * on the server clock; without it the server timestamp is trusted when it is not in the future.
   */
  restored?: { serverNowMs?: number };
};

/**
 * Effective deadline in device ms: server `expires_at` → start + event/advertised timeout → start + 300 s.
 * start = server timestamp when plausible (live: within ±60 s of our clock; restored: age from the server clock).
 */
export function resolveDeadline(a: ApprovalRequest, o: DeadlineOptions): number {
  const ts = typeof a.timestamp === 'number' && Number.isFinite(a.timestamp) && a.timestamp > 0 ? a.timestamp * 1000 : undefined;
  let start = o.receivedAt;
  let skew = 0; // server clock − device clock
  if (o.restored) {
    if (o.restored.serverNowMs) skew = o.restored.serverNowMs - o.receivedAt;
    if (ts !== undefined) start = Math.min(o.receivedAt, ts - skew);
  } else if (ts !== undefined && Math.abs(o.receivedAt - ts) <= MAX_CLOCK_SKEW_MS) {
    start = Math.min(ts, o.receivedAt);
  } else if (ts !== undefined) {
    skew = ts - o.receivedAt; // clocks disagree: the event was just sent, so its timestamp is "server now"
  }
  if (a.expiresAt) return a.expiresAt - skew;
  const timeout = a.timeoutSeconds ?? (o.advertisedTimeoutS && o.advertisedTimeoutS > 0 ? o.advertisedTimeoutS : DEFAULT_APPROVAL_TIMEOUT_S);
  return start + timeout * 1000;
}

/** stamp receipt + deadline on a request (live event or restore) */
export function withDeadline(a: ApprovalRequest, o: DeadlineOptions): ApprovalRequest {
  const timeoutSeconds = a.timeoutSeconds ?? (o.advertisedTimeoutS && o.advertisedTimeoutS > 0 ? o.advertisedTimeoutS : undefined);
  const b: ApprovalRequest = { ...a, receivedAt: a.receivedAt ?? o.receivedAt };
  if (timeoutSeconds) b.timeoutSeconds = timeoutSeconds;
  b.deadlineAt = resolveDeadline(b, o);
  if (o.restored) b.restored = true;
  return b;
}

const deadlineOf = (a: ApprovalRequest): number =>
  a.deadlineAt ?? resolveDeadline(a, { receivedAt: a.receivedAt ?? a.timestamp * 1000 });

/** true when the request can still be answered (not expired, deadline not reached) */
export function isLive(a: ApprovalRequest, now: number): boolean {
  return !a.expired && now < deadlineOf(a);
}

/** pending queue of a message (older messages only have `approval`) */
export function pendingOf(m: ChatMessage | undefined): ApprovalRequest[] {
  if (!m) return [];
  return m.pendingApprovals ?? (m.approval ? [m.approval] : []);
}

/** set the queue; `approval` mirrors the first live request (else the first one) */
export function setPending(m: ChatMessage, list: ApprovalRequest[]): ChatMessage {
  const { pendingApprovals: _p, approval: _a, ...rest } = m;
  if (!list.length) return rest;
  return { ...rest, pendingApprovals: list, approval: list.find((a) => !a.expired) ?? list[0] };
}

function logged(m: ChatMessage, key: string): boolean {
  return !!m.approvalLog?.some((r) => (r.requestId ?? `${r.runId}:${r.requestedAt}`) === key || r.requestId === key);
}

/** a new request (live event or restore): queued once per key; already answered/expired ones are ignored */
export function addApproval(m: ChatMessage, a: ApprovalRequest, now: number): ChatMessage {
  const key = approvalKey(a);
  const queue = pendingOf(m);
  if (queue.some((p) => approvalKey(p) === key) || logged(m, key)) return m;
  const item = a.deadlineAt ? a : withDeadline(a, { receivedAt: a.receivedAt ?? now });
  const next = setPending(m, [...queue, item]);
  return pushTrace(next, 'approval', now, {
    text: a.command,
    data: { requestId: a.requestId, description: a.description, runId: a.runId, restored: a.restored || undefined },
  });
}

function record(a: ApprovalRequest, outcome: ApprovalOutcome, at: number): ApprovalRecord {
  const command = a.command.length > LOG_COMMAND_MAX ? `${a.command.slice(0, LOG_COMMAND_MAX - 1)}…` : a.command;
  const r: ApprovalRecord = { runId: a.runId, command, outcome, requestedAt: a.receivedAt ?? a.timestamp * 1000, at };
  if (a.requestId) r.requestId = a.requestId;
  if (a.description) r.description = a.description;
  return r;
}

function appendLog(m: ChatMessage, a: ApprovalRequest, outcome: ApprovalOutcome, at: number): ChatMessage {
  const log = [...(m.approvalLog ?? []), record(a, outcome, at)].slice(-LOG_MAX);
  return pushTrace({ ...m, approvalLog: log }, 'approval_answer', at, { text: outcome, data: { requestId: a.requestId } });
}

/** the request `key` got its answer (or a terminal outcome): leaves the queue, one history row + timeline step */
export function resolveApproval(m: ChatMessage, key: string, outcome: ApprovalOutcome, now: number): ChatMessage {
  const queue = pendingOf(m);
  const a = queue.find((p) => approvalKey(p) === key);
  if (!a) return m;
  const rest = queue.filter((p) => p !== a);
  const base = setPending(m, rest);
  // an expired request was logged when it expired; removing its card adds no second row
  return a.expired ? base : appendLog(base, a, outcome, now);
}

/** hide an expired card / a request the server no longer knows (no answer is sent) */
export function dismissApproval(m: ChatMessage, key: string, now: number): ChatMessage {
  const a = pendingOf(m).find((p) => approvalKey(p) === key);
  if (!a) return m;
  return resolveApproval(m, key, isLive(a, now) ? 'cancelled' : 'expired', now);
}

/**
 * Deadline passed: the request is marked `expired` (card stays with disabled buttons and "Abgelaufen – abgelehnt")
 * and logged as `expired`. Returns `m` unchanged when nothing expired.
 */
export function expireApprovals(m: ChatMessage, now: number): ChatMessage {
  const queue = pendingOf(m);
  if (!queue.some((a) => !a.expired && now >= deadlineOf(a))) return m;
  let out = m;
  const next = queue.map((a) => {
    if (a.expired || now < deadlineOf(a)) return a;
    out = appendLog(out, a, 'expired', now);
    return { ...a, expired: true };
  });
  return setPending(out, next);
}

/** The run ended (finish / stop / recovered answer): every open request is closed and logged. */
export function closePending(m: ChatMessage, now: number): ChatMessage {
  const queue = pendingOf(m);
  if (!queue.length) return m.approval || m.pendingApprovals ? setPending(m, []) : m;
  let out = m;
  for (const a of queue) if (!a.expired) out = appendLog(out, a, now >= deadlineOf(a) ? 'expired' : 'cancelled', now);
  return setPending(out, []);
}

/** earliest deadline of a live request in the list (for the expiry timer), or undefined */
export function nextDeadline(list: readonly ChatMessage[]): number | undefined {
  let min: number | undefined;
  for (const m of list) for (const a of pendingOf(m)) if (!a.expired) min = min === undefined ? deadlineOf(a) : Math.min(min, deadlineOf(a));
  return min;
}

/** expire every due request in the transcript; returns `list` when nothing changed */
export function expireAll(list: ChatMessage[], now: number): ChatMessage[] {
  let changed = false;
  const next = list.map((m) => {
    const e = expireApprovals(m, now);
    if (e !== m) changed = true;
    return e;
  });
  return changed ? next : list;
}

/** all pending requests of a transcript (newest message last), for the card stack */
export function allPending(list: readonly ChatMessage[]): ApprovalRequest[] {
  const out: ApprovalRequest[] = [];
  for (const m of list) if (m.role === 'assistant') out.push(...pendingOf(m));
  return out;
}

/** index of the message holding the request `key`, or -1 */
export function findApproval(list: readonly ChatMessage[], key: string): number {
  for (let i = list.length - 1; i >= 0; i--) if (pendingOf(list[i]).some((a) => approvalKey(a) === key)) return i;
  return -1;
}

// ------------------------------------------------------------------ restore (GET /v1/runs/{id})

export type RunStatus = {
  /** `waiting_for_approval` | running | completed | failed | cancelled | … ; `not_found` for 404 */
  status: string;
  approval?: ApprovalRequest;
  /** server clock from the HTTP `Date` header (ms), for restored deadlines */
  serverNowMs?: number;
};

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'canceled', 'incomplete', 'expired', 'stopped', 'not_found', 'error']);

export function isTerminalRunStatus(status: string): boolean {
  return TERMINAL.has(status);
}

/**
 * Assistant messages whose run may still wait for an approval: they carry a completion id, are young, and the
 * stream is open or was lost after acceptance (interrupted / cut off). Newest first, at most 3.
 */
export function restoreCandidates(list: readonly ChatMessage[], now: number, windowMs = RESTORE_WINDOW_MS): number[] {
  const out: number[] = [];
  for (let i = list.length - 1; i >= 0 && out.length < 3; i--) {
    const m = list[i];
    if (m.role !== 'assistant' || !m.completionId || now - m.createdAt > windowMs) continue;
    const open = m.status === 'streaming' || (m.status === 'stopped' && (typeof m.interrupted === 'number' || m.metrics?.endedAt === undefined));
    if (open || pendingOf(m).length) out.push(i);
  }
  return out;
}

/**
 * Apply the polled run status to its message: a waiting request becomes a live card again (unless it is already
 * answered or past its deadline → logged as expired); a terminal status closes what is still queued.
 * `running` keeps the queue (another parallel request may still wait).
 */
export function applyRunStatus(m: ChatMessage, s: RunStatus, now: number, advertisedTimeoutS?: number): ChatMessage {
  if (s.status === 'waiting_for_approval' && s.approval) {
    const a = withDeadline(s.approval, { receivedAt: now, advertisedTimeoutS, restored: { serverNowMs: s.serverNowMs } });
    const key = approvalKey(a);
    if (logged(m, key) || pendingOf(m).some((p) => approvalKey(p) === key)) return expireApprovals(m, now);
    if (!isLive(a, now)) return appendLog(m, a, 'expired', now);
    return addApproval(m, a, now);
  }
  if (isTerminalRunStatus(s.status)) return closePending(m, now);
  return expireApprovals(m, now);
}

// ------------------------------------------------------------------ expiry timer

export type ExpiryTimers = { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void };

/**
 * One timer for the earliest deadline of the transcript. `update(list)` after every change; at the deadline
 * `onDue(now)` runs (the hook applies expireAll and persists).
 */
export function createExpiryTimer(onDue: (now: number) => void, deps: { now?: () => number; timers?: ExpiryTimers } = {}) {
  const now = deps.now ?? Date.now;
  const timers: ExpiryTimers = deps.timers ?? {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  let handle: unknown = null;
  let at: number | undefined;
  const clear = () => {
    if (handle !== null) timers.clear(handle);
    handle = null;
    at = undefined;
  };
  return {
    update(list: readonly ChatMessage[]) {
      const due = nextDeadline(list);
      if (due === at) return;
      clear();
      if (due === undefined) return;
      at = due;
      // setTimeout caps at ~24.8 days; deadlines are minutes away
      handle = timers.set(() => {
        handle = null;
        at = undefined;
        onDue(now());
      }, Math.max(0, due - now()));
    },
    dispose: clear,
  };
}

// ------------------------------------------------------------------ late-tap guard

export const APPROVAL_EXPIRED_CODE = 'approval_expired';

/**
 * null when an answer may be sent for `a` now; otherwise the error code (no request is sent):
 * `approval_expired` (deadline passed, Hermes already denied) or `approval_not_pending` (no longer queued).
 */
export function answerBlocked(a: ApprovalRequest | undefined, now: number): string | null {
  if (!a) return 'approval_not_pending';
  return isLive(a, now) ? null : APPROVAL_EXPIRED_CODE;
}
