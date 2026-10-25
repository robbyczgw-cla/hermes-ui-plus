/**
 * Recovery of a Hermes answer whose stream was lost after Hermes accepted the turn (pure, node:test).
 *
 * A phone that switches WiFi ↔ LTE or sends the app to the background drops the SSE connection ("Software caused
 * connection abort"), but the UI bridge keeps the Hermes run going (bridge/src/bridge.mjs) and Hermes stores the
 * finished turn in its session. So such a turn is not a failed answer:
 *
 *   streaming ──transport error after HTTP 200──▶ interrupted (status `stopped`, `interrupted` = ms; tools kept)
 *   interrupted ──re-attached to the bridge's recording of the turn──▶ streaming again (live; hermes/reattach.ts)
 *   interrupted ──live inbox event of the session──▶ done (final text from the event; applyInboxAnswer)
 *   interrupted ──stored session has the final answer──▶ done (polled with backoff, on foreground / reconnect)
 *   interrupted ──nothing within RECOVERY_WINDOW_MS──▶ error (`interrupted` kept: "Erneut" checks the session first)
 *
 * The message keeps its id in every transition, so the inbox, the poll and the transcript sync (remoteSync
 * reconcileTranscript) all replace the SAME message – a late second source never appends a duplicate answer.
 */
import type { TKey } from '../i18n/core.ts';
import { makeT } from '../i18n/core.ts';
import { finalize } from './chatState.ts';
import { closePending, isLostRunStatus, isTerminalRunStatus, pendingOf, setPending } from './approvals.ts';
import { RUN_LOST_KEY } from './turnEnd.ts';
import { mergeAssistantDetails, sameUserTurn } from './sessionMapping.ts';
import type { ChatMessage, Usage } from './types';

/** give up after this long without an answer (from the moment the stream was lost) */
export const RECOVERY_WINDOW_MS = 10 * 60_000;
/** poll delays of the stored session (the last one repeats) */
export const RECOVERY_DELAYS_MS: readonly number[] = [3000, 6000, 12000, 20000, 30000, 45000, 60000];
/** while the bridge may still re-attach the turn live: at once, then soon again (offline; the last one repeats) */
export const REATTACH_DELAYS_MS: readonly number[] = [0, 1000, 2000, 4000, 8000, 15000];
/** device vs. server clock tolerance when matching a stored turn / inbox event to the interrupted one */
export const CLOCK_SKEW_MS = 5 * 60_000;

export const INTERRUPTED_LOST_KEY: TKey = 'backends.hermes.errors.interruptedLost';
const deT = makeT('de', 'de-DE');

/** the stream of this message was lost after Hermes accepted it and the answer is still being recovered */
export function isRecovering(m: ChatMessage | undefined): boolean {
  return !!m && m.role === 'assistant' && m.status === 'stopped' && typeof m.interrupted === 'number';
}

/** recovering, or recovery gave up (error) – a late answer may still replace it */
export function isRecoverable(m: ChatMessage | undefined): boolean {
  return !!m && m.role === 'assistant' && (m.status === 'stopped' || m.status === 'error') && typeof m.interrupted === 'number';
}

function lastIndex(list: readonly ChatMessage[], pred: (m: ChatMessage) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) if (pred(list[i])) return i;
  return -1;
}

/** index of the newest message still being recovered, or -1 */
export const recoveringIndex = (list: readonly ChatMessage[]) => lastIndex(list, isRecovering);
/** index of the newest recoverable message (recovering or given up), or -1 */
export const recoverableIndex = (list: readonly ChatMessage[]) => lastIndex(list, isRecoverable);

/**
 * the stream was lost after acceptance: keep text/tools, close running tools, wait for the answer.
 * Pending approvals stay: Hermes (behind the bridge) keeps waiting for them – the card remains live and is
 * re-checked via GET /v1/runs/{completionId} (hermes/approvals.ts applyRunStatus).
 */
export function markInterrupted(m: ChatMessage, now: number): ChatMessage {
  return setPending({ ...finalize(setPending(m, []), 'stopped', undefined, now), interrupted: now }, pendingOf(m));
}

/**
 * Restored transcript: an answer that was persisted while still streaming (app killed / chat switched; stored as
 * `stopped` WITHOUT `metrics.endedAt` – every hook-finalised message has one) becomes a recovering message, so the
 * stored session fills in the final answer. Only the last message of the list; returns `list` when unchanged.
 */
export function resumeCutOff(list: ChatMessage[]): ChatMessage[] {
  const last = list[list.length - 1];
  if (!last || last.role !== 'assistant' || last.status !== 'stopped' || last.interrupted !== undefined || last.metrics?.endedAt !== undefined) return list;
  if (list[list.length - 2]?.role !== 'user') return list;
  return [...list.slice(0, -1), { ...last, interrupted: last.createdAt }];
}

/**
 * Token counts for an answer filled in later (the stream with its final usage chunk was lost): from the run status.
 * Unchanged when the message already has counts.
 */
export function withRunUsage(m: ChatMessage, usage: Usage): ChatMessage {
  if (m.usage || m.metrics?.inputTokens !== undefined || m.metrics?.outputTokens !== undefined) return m;
  return { ...m, usage, metrics: { ...m.metrics, inputTokens: usage.promptTokens, outputTokens: usage.completionTokens } };
}

/** a filled-in answer without token counts whose run status may still have them */
export function needsRunUsage(m: ChatMessage | undefined): m is ChatMessage {
  return !!m && m.role === 'assistant' && m.status === 'done' && m.recoveredAt !== undefined && !!m.completionId && !m.usage && m.metrics?.inputTokens === undefined && m.metrics?.outputTokens === undefined;
}

/**
 * recovery gave up: the normal error bubble with "Erneut" (`interrupted` stays: retry checks the session first).
 * `lost`: Hermes no longer knows the run (404 / Hermes ≥ 0.22.3 `unknown`), most likely it restarted mid-turn.
 */
export function failInterrupted(m: ChatMessage, now: number, lost = false): ChatMessage {
  const key = lost ? RUN_LOST_KEY : INTERRUPTED_LOST_KEY;
  return { ...finalize(m, 'error', deT(key), now, { key }), interrupted: m.interrupted };
}

/**
 * Polls in a row that must report the run as over (terminal status, no stored answer) before recovery gives up early
 * instead of waiting out RECOVERY_WINDOW_MS: one more stored-session check covers an answer stored right after its end.
 * Only statuses that say so explicitly (`completed` waits: the stored turn may just not match yet; a 404 waits too:
 * servers without run status for chat completions answer it for a live run).
 */
export const RUN_OVER_CONFIRMATIONS = 2;
const EARLY_END = new Set(['unknown', 'failed', 'cancelled', 'canceled', 'interrupted', 'error']);

/** A stored assistant turn that is complete: text and not ended by a tool call (Hermes still working). */
export function isFinalAnswer(m: ChatMessage | undefined): m is ChatMessage {
  return !!m && m.role === 'assistant' && !!m.text.trim() && m.finishReason !== 'tool_calls' && m.status !== 'error';
}

/** the run is over (answer recovered): still-open approvals are logged (expired / cancelled), never dropped silently */
function withoutRecovery(m: ChatMessage): ChatMessage {
  const { interrupted: _i, error: _e, errorText: _k, statusNote: _s, ...rest } = closePending(m, Date.now());
  return rest;
}

/** `local` (interrupted) completed by the stored turn `remote`: final text, tool details, reasoning; same id. */
export function recoveredMessage(local: ChatMessage, remote: ChatMessage): ChatMessage {
  const base: ChatMessage = {
    ...withoutRecovery(local),
    text: remote.text,
    // a turn Hermes stored as interrupted (`cancelled`, sessionMapping) stays "Gestoppt"
    status: remote.status === 'stopped' ? 'stopped' : 'done',
    finishReason: remote.finishReason ?? 'stop',
    metrics: { ...local.metrics, endedAt: remote.metrics?.endedAt ?? local.metrics?.endedAt ?? local.interrupted },
    recoveredAt: Date.now(),
  };
  if (remote.truncated) base.truncated = true;
  return withRemoteTextOffsets(mergeAssistantDetails(base, remote, true), remote);
}

/**
 * The text was replaced by the stored one: interim-note cuts (`ToolEvent.textAt`, progressNotes.ts) must point
 * into that text – taken from the stored call with the same id, dropped otherwise (no split rather than a wrong one).
 */
function withRemoteTextOffsets(m: ChatMessage, remote: ChatMessage): ChatMessage {
  const at = new Map(remote.tools.map((t) => [t.id, t.textAt]));
  let changed = false;
  const tools = m.tools.map((t) => {
    const r = at.get(t.id);
    if (t.textAt === r) return t;
    changed = true;
    if (r === undefined) {
      const { textAt: _t, ...rest } = t;
      return rest;
    }
    return { ...t, textAt: r };
  });
  return changed ? { ...m, tools } : m;
}

function previousUser(list: readonly ChatMessage[], idx: number): ChatMessage | undefined {
  for (let i = idx - 1; i >= 0; i--) if (list[i].role === 'user') return list[i];
  return undefined;
}

/**
 * The stored answer to the turn of `list[idx]` in the mapped session transcript, or null when Hermes has not
 * finished it yet. The newest stored user turn with the same text (not older than the local one, ± clock skew)
 * is the run; a tool-call id overlap with the local message wins over that.
 */
export function findRemoteAnswer(list: readonly ChatMessage[], idx: number, remote: readonly ChatMessage[]): ChatMessage | null {
  return matchRemoteTurn(list, idx, remote).answer;
}

/** `stored`: the stored session has this turn's user row (Hermes took it); `answer`: its final answer, if any */
export function matchRemoteTurn(list: readonly ChatMessage[], idx: number, remote: readonly ChatMessage[]): { stored: boolean; answer: ChatMessage | null } {
  const none = { stored: false, answer: null };
  const local = list[idx];
  const user = previousUser(list, idx);
  if (!local || !user) return none;
  const ids = new Set(local.tools.map((t) => t.id));
  const inWindow = (at: number | undefined) => !(at && user.createdAt && at < user.createdAt - CLOCK_SKEW_MS);
  // the same question asked (and answered) before within the window: those stored rows are the EARLIER runs –
  // ours is the (n+1)-th matching stored row, never an older one while ours has not been stored yet (review H8)
  let earlier = 0;
  for (let i = 0; i < idx; i++) {
    const u = list[i];
    if (u === user || u.role !== 'user' || !sameUserTurn(user, u.text) || !inWindow(u.createdAt)) continue;
    const a = list[i + 1];
    if (a?.role === 'assistant' && a.status === 'done') earlier++;
  }
  const candidates: (ChatMessage | null)[] = [];
  for (let ri = 0; ri < remote.length; ri++) {
    const r = remote[ri];
    if (r.role !== 'user' || !sameUserTurn(user, r)) continue;
    if (!inWindow(r.createdAt)) continue; // an older run of the same question
    const ra = remote[ri + 1]?.role === 'assistant' ? remote[ri + 1] : undefined;
    if (ra && ids.size && ra.tools.some((t) => ids.has(t.id))) return { stored: true, answer: isFinalAnswer(ra) ? ra : null };
    candidates.push(ra ?? null); // a stored question without an answer yet: Hermes is still working
  }
  if (candidates.length <= earlier) return none; // our turn is not stored yet
  const ours = candidates[candidates.length - 1];
  return { stored: true, answer: ours && isFinalAnswer(ours) ? ours : null };
}

/**
 * "Erneut" on a recoverable answer: the stored session check found nothing final, but the run may still be going
 * (or the check itself failed): back to "recovering" (polled again) instead of a duplicate send (review M4).
 */
export function resumeRecovering(m: ChatMessage, now: number): ChatMessage {
  const { error: _e, errorText: _k, ...rest } = m;
  return { ...rest, status: 'stopped', interrupted: now };
}

/** Replace the recovering (or the given) message with its stored final answer; null when there is none yet. */
export function applyRemoteAnswer(list: ChatMessage[], remote: readonly ChatMessage[], idx = recoveringIndex(list)): ChatMessage[] | null {
  if (idx < 0) return null;
  const answer = findRemoteAnswer(list, idx, remote);
  if (!answer) return null;
  const next = list.slice();
  next[idx] = recoveredMessage(list[idx], answer);
  return next;
}

export type InboxAnswer = { id: string; content: string; timestamp: number };

/**
 * A live inbox event of the session (the bridge reports turns it could not stream) completes the recoverable
 * message in place – never appended as a second answer. null when there is nothing to recover or the event is
 * older than the interrupted turn.
 */
export function applyInboxAnswer(list: ChatMessage[], ev: InboxAnswer): ChatMessage[] | null {
  const idx = recoverableIndex(list);
  if (idx < 0 || !ev.content.trim()) return null;
  const m = list[idx];
  if (ev.timestamp && ev.timestamp < m.createdAt - CLOCK_SKEW_MS) return null;
  if (inboxAmbiguous(list, idx, ev)) return null;
  const next = list.slice();
  const base = withoutRecovery(m);
  next[idx] = {
    ...base,
    // the event carries the final text only: live interim-note offsets no longer apply
    tools: base.tools.some((t) => t.textAt !== undefined) ? base.tools.map(({ textAt: _t, ...t }) => t) : base.tools,
    text: ev.content,
    status: 'done',
    finishReason: 'stop',
    metrics: { ...m.metrics, endedAt: ev.timestamp || m.metrics?.endedAt || m.interrupted },
    recoveredAt: Date.now(),
  };
  return next;
}

/**
 * The event carries only the session's latest answer, no run / turn identity. When an earlier turn of this chat
 * lies within the clock-skew window (or already has exactly this answer), a delayed / replayed event may belong
 * to THAT turn: it must not be assigned directly – the stored session (matched by turn) decides instead
 * (review H8). The poll (`recoverNow` / Recovery.inbox) handles it.
 */
export function inboxAmbiguous(list: readonly ChatMessage[], idx: number, ev: InboxAnswer): boolean {
  const content = ev.content.trim();
  const user = previousUser(list, idx);
  const since = (user?.createdAt ?? list[idx].createdAt) - CLOCK_SKEW_MS;
  for (let i = 0; i < idx; i++) {
    const m = list[i];
    if (m === user) continue;
    if (m.role === 'assistant' && m.text.trim() === content) return true; // that answer was delivered already
    if (m.role === 'user' && m.createdAt >= since) return true; // another turn the event could belong to
  }
  return false;
}

// ------------------------------------------------------------------ driver

export type RecoveryTimers = { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void };

export type RecoveryDeps = {
  /** current transcript (source of truth of the chat hook) */
  get(): ChatMessage[];
  /** replace the transcript (and persist) */
  commit(list: ChatMessage[]): void;
  /** mapped stored session transcript; null = server has no session API; throws = offline, try later */
  fetchRemote(): Promise<ChatMessage[] | null>;
  /** the live inbox (UI bridge) may still deliver the answer */
  inboxAvailable(): boolean;
  /** status of the message's original run (GET /v1/runs/{completionId}); null = unknown (no id / not reachable) */
  runStatus?(m: ChatMessage): Promise<string | null>;
  /** the recovering message can be re-attached live at the bridge (hermes/reattach.ts canReattach) */
  canReattach?(m: ChatMessage): boolean;
  /**
   * re-attach it: `live` = it streams again (the hook owns it now; a new loss starts the recovery again), `gone` = the
   * bridge refused (the stored session decides from now on), `retry` = offline / busy, try again later
   */
  reattach?(m: ChatMessage): Promise<'live' | 'gone' | 'retry'>;
  now?: () => number;
  timers?: RecoveryTimers;
  windowMs?: number;
  delaysMs?: readonly number[];
};

export type Recovery = {
  /** (re)start polling when a message is recovering (after an interrupted turn, on mount) */
  start(): void;
  /** app came to the foreground / the inbox reconnected: check now */
  poke(): void;
  /** live inbox event of this chat's session; true when it completed a message */
  inbox(ev: InboxAnswer): boolean;
  /**
   * one check before re-sending the turn of message `id` ("Erneut"): `recovered` = the stored answer; `resend` =
   * the original run is known to be over without an answer (or never reached Hermes); `wait` = it may still be
   * running or the check failed – never send it twice.
   */
  checkTurn(id: string): Promise<TurnCheck>;
  dispose(): void;
};

export type TurnCheck = { kind: 'recovered'; list: ChatMessage[] } | { kind: 'resend' } | { kind: 'wait' };

const defaultTimers: RecoveryTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function createRecovery(d: RecoveryDeps): Recovery {
  const now = d.now ?? Date.now;
  const timers = d.timers ?? defaultTimers;
  const windowMs = d.windowMs ?? RECOVERY_WINDOW_MS;
  const delays = d.delaysMs ?? RECOVERY_DELAYS_MS;
  let timer: unknown = null;
  let attempt = 0;
  let inflight = false;
  let disposed = false;
  /** polls in a row whose run status said the run is over (`overId` = that message) */
  let overSeen = 0;
  let overId: string | undefined;
  /** the message whose run Hermes last reported as gone (404 / `unknown`): its give-up text says so */
  let lastLost: string | undefined;

  const clear = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };

  const schedule = () => {
    clear();
    if (disposed || inflight) return;
    const list = d.get();
    const idx = recoveringIndex(list);
    if (idx < 0) {
      attempt = 0;
      return;
    }
    const left = (list[idx].interrupted as number) + windowMs - now();
    const steps = d.canReattach?.(list[idx]) && d.reattach ? REATTACH_DELAYS_MS : delays;
    const delay = Math.max(0, Math.min(steps[Math.min(attempt, steps.length - 1)], left));
    attempt++;
    timer = timers.set(() => {
      timer = null;
      void check();
    }, delay);
  };

  const check = async () => {
    if (inflight || disposed) return;
    inflight = true;
    clear();
    const before = d.get();
    const at = recoveringIndex(before);
    if (at >= 0 && d.reattach && d.canReattach?.(before[at])) {
      // the bridge still has the turn: continue it live instead of waiting for the stored answer
      let outcome: 'live' | 'gone' | 'retry';
      try {
        outcome = await d.reattach(before[at]);
      } catch {
        outcome = 'retry';
      }
      if (disposed) return;
      if (outcome === 'live') {
        inflight = false;
        attempt = 0;
        return; // streaming again: a new loss restarts the recovery (start())
      }
      if (outcome === 'gone') attempt = 0; // from now on the stored session, with its own delays
    }
    let remote: ChatMessage[] | null | undefined;
    try {
      remote = await d.fetchRemote();
    } catch {
      remote = undefined; // offline / server busy: next attempt
    }
    let list = d.get();
    let idx = recoveringIndex(list);
    let next = idx >= 0 && remote ? applyRemoteAnswer(list, remote, idx) : null;
    // no stored answer yet: does the run still exist on Hermes? (a restart forgets it: 404 / `unknown`)
    let status: string | null = null;
    if (idx >= 0 && !next && remote !== undefined && d.runStatus) {
      const id = list[idx].id;
      try {
        status = await d.runStatus(list[idx]);
      } catch {
        status = null;
      }
      if (disposed) return;
      list = d.get();
      idx = recoveringIndex(list);
      if (idx >= 0 && list[idx].id !== id) status = null;
      if (status !== null && isLostRunStatus(status)) lastLost = id;
      else if (status !== null && lastLost === id) lastLost = undefined;
      overSeen = status !== null && EARLY_END.has(status) ? (overId === id ? overSeen + 1 : 1) : 0;
      overId = id;
      next = idx >= 0 && remote ? applyRemoteAnswer(list, remote, idx) : null;
    }
    inflight = false;
    if (disposed) return;
    if (idx < 0) return; // recovered meanwhile (inbox / transcript sync) or the chat moved on
    const runOver = overSeen >= RUN_OVER_CONFIRMATIONS;
    if (next) {
      d.commit(next);
    } else if (runOver || now() >= (list[idx].interrupted as number) + windowMs || (remote === null && !d.inboxAvailable())) {
      const failed = list.slice();
      failed[idx] = failInterrupted(list[idx], now(), lastLost === list[idx].id);
      d.commit(failed);
      overSeen = 0;
    }
    schedule();
  };

  /** one stored-session check of the recoverable message `id` (also given-up ones), committed when found */
  const checkRecoverable = async (id: string) => {
    let remote: ChatMessage[] | null;
    try {
      remote = await d.fetchRemote();
    } catch {
      return;
    }
    if (disposed || !remote) return;
    const list = d.get();
    const idx = list.findIndex((m) => m.id === id);
    if (idx < 0 || !isRecoverable(list[idx])) return;
    const next = applyRemoteAnswer(list, remote, idx);
    if (next) {
      d.commit(next);
      schedule();
    }
  };

  // Polling has a deadline, but coming back online or reopening the chat must still recover a late answer.
  // Make one check on these explicit triggers without restarting the expired polling window.
  const checkLateAnswer = () => {
    if (disposed) return;
    const list = d.get();
    const idx = recoverableIndex(list);
    if (idx >= 0) void checkRecoverable(list[idx].id);
  };

  return {
    start() {
      attempt = 0;
      schedule();
      if (recoveringIndex(d.get()) < 0) checkLateAnswer();
    },
    poke() {
      if (recoveringIndex(d.get()) >= 0) void check();
      else checkLateAnswer();
    },
    inbox(ev) {
      const list = d.get();
      const idx = recoverableIndex(list);
      if (idx >= 0 && ev.content.trim() && inboxAmbiguous(list, idx, ev)) {
        // no turn identity in the event: match the stored session by turn instead (the answer arrived, so it is there)
        void checkRecoverable(list[idx].id);
        return false;
      }
      const next = applyInboxAnswer(list, ev);
      if (!next) return false;
      d.commit(next);
      schedule(); // nothing left to recover → stops
      return true;
    },
    async checkTurn(id): Promise<TurnCheck> {
      let remote: ChatMessage[] | null;
      try {
        remote = await d.fetchRemote();
      } catch {
        return { kind: 'wait' }; // inconclusive: offline / server busy
      }
      let list = d.get();
      let idx = list.findIndex((m) => m.id === id);
      if (idx < 0) return { kind: 'wait' };
      const match = remote ? matchRemoteTurn(list, idx, remote) : { stored: false, answer: null };
      if (match.answer) {
        const next = applyRemoteAnswer(list, remote!, idx);
        if (next) return { kind: 'recovered', list: next };
      }
      let status: string | null = null;
      try {
        status = d.runStatus ? await d.runStatus(list[idx]) : null;
      } catch {
        status = null;
      }
      list = d.get();
      idx = list.findIndex((m) => m.id === id);
      if (idx < 0) return { kind: 'wait' };
      if (status !== null) return isTerminalRunStatus(status) ? { kind: 'resend' } : { kind: 'wait' };
      // run state unknown: Hermes has the turn but no answer yet → still working; not stored at all → resend
      if (remote === null) return { kind: 'resend' }; // no session API: nothing to recover from
      return match.stored ? { kind: 'wait' } : { kind: 'resend' };
    },
    dispose() {
      disposed = true;
      clear();
    },
  };
}
