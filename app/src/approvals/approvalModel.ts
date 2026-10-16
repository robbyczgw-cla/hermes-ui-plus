/**
 * Pure view-model logic for the approval sheet (no React / RN imports, runs under node:test).
 *
 * Wire facts (verified against the Hermes Agent source, see docs/HERMES-API.md):
 *  - choices are exactly `once | session | always | deny`; the server sends
 *    [once, deny] (smart_denied or allow_session=false), [once, session, deny] (allow_permanent=false)
 *    or [once, session, always, deny].
 *  - the event has NO deadline field. The server waits `approvals.timeout` (default 300 s) and then
 *    denies. The hook stamps `deadlineAt` (hermes/approvals.ts resolveDeadline: server `expires_at` → start +
 *    advertised timeout → start + 300 s); without it we estimate `start + timeoutSeconds` here.
 *  - scopes on the API path: `session` = only this run (the next message asks again), `always` = Hermes' GLOBAL
 *    command allowlist (Telegram, cron, every channel) → labelled so, with a confirm step at high risk.
 *  - user-facing text is returned as i18n keys (`TKey`); the React layer translates them with `useT()`.
 */

import type { TKey } from '../i18n/core.ts';

export type ApprovalChoiceValue = 'once' | 'session' | 'always' | 'deny';

/** Structural subset of `ApprovalRequest` from ../hermes (kept local so this file stays node-testable). */
export type ApprovalInput = {
  runId?: string;
  requestId?: string;
  command?: string;
  description?: string;
  patternKey?: string;
  choices?: readonly string[];
  smartDenied?: boolean;
  /** server time.time(), seconds */
  timestamp?: number;
  /** effective deadline (device ms), stamped by the hook */
  deadlineAt?: number;
  /** server `expires_at` (ms): the countdown is exact, not an estimate */
  expiresAt?: number;
  /** server-advertised timeout (s) */
  timeoutSeconds?: number;
  /** the deadline passed (Hermes denied) – buttons disabled */
  expired?: boolean;
};

export type RiskLevel = 'normal' | 'elevated' | 'high';

/** `denyPrimary` = Deny as the primary (ink) button: the recommended action of a high-risk request. `danger` = the quiet Deny. */
export type ChoiceKind = 'primary' | 'secondary' | 'danger' | 'denyPrimary';

export type ChoiceView = {
  value: ApprovalChoiceValue;
  labelKey: TKey;
  /** short sub-label shown under the label (scope of the permission) */
  hintKey?: TKey;
  kind: ChoiceKind;
  a11yKey: TKey;
};

export type ApprovalView = {
  /** stable identity of the request (changes => reset sheet state) */
  key: string;
  titleKey: TKey;
  /** command text, trimmed of trailing whitespace; '' if the server sent none (raw: copy / identity only) */
  command: string;
  /** what the sheet shows: invisible / control characters as visible `\u202E`-style escapes (displayCommand) */
  commandDisplay: string;
  /** the command contains escaped or non-ASCII characters → visible warning ("Befehl enthält ungewöhnliche Zeichen") */
  commandUnusual: boolean;
  lineCount: number;
  /** server description, invisible / control characters escaped like the command */
  description: string;
  risk: { level: RiskLevel; labelKey: TKey };
  smartDenied: boolean;
  /** ordered: once, session, always, deny — high risk: deny first (highlighted), allow choices secondary */
  choices: ChoiceView[];
  /** deadline (ms since epoch) */
  deadlineMs: number;
  timeoutSeconds: number;
  /** false only when the server sent the deadline (`expires_at`); the countdown then drops the "ca." */
  deadlineEstimated: boolean;
  /** the request already expired when the view was built */
  expired: boolean;
};

export const DEFAULT_APPROVAL_TIMEOUT_S = 300;
/** If the server clock differs from ours by more than this, ignore the server timestamp. */
export const MAX_CLOCK_SKEW_MS = 60_000;

export const CHOICE_ORDER: readonly ApprovalChoiceValue[] = ['once', 'session', 'always', 'deny'];

const CHOICE_TEXT: Record<ApprovalChoiceValue, { labelKey: TKey; hintKey?: TKey; kind: ChoiceKind; a11yKey: TKey }> = {
  once: {
    labelKey: 'approvals.choice.once.label',
    hintKey: 'approvals.choice.once.hint',
    kind: 'primary',
    a11yKey: 'approvals.choice.once.a11y',
  },
  session: {
    labelKey: 'approvals.choice.session.label',
    hintKey: 'approvals.choice.session.hint',
    kind: 'secondary',
    a11yKey: 'approvals.choice.session.a11y',
  },
  always: {
    labelKey: 'approvals.choice.always.label',
    hintKey: 'approvals.choice.always.hint',
    kind: 'secondary',
    a11yKey: 'approvals.choice.always.a11y',
  },
  deny: { labelKey: 'approvals.choice.deny.label', kind: 'danger', a11yKey: 'approvals.choice.deny.a11y' },
};

export function isApprovalChoice(v: unknown): v is ApprovalChoiceValue {
  return v === 'once' || v === 'session' || v === 'always' || v === 'deny';
}

/**
 * Choice buttons for a risk level. Normal / elevated: "Einmal erlauben" is the primary. High risk: "Ablehnen"
 * comes first and is the only highlighted action; every allow choice is an equal-weight secondary.
 */
export function choicesForRisk(values: readonly ApprovalChoiceValue[], level: RiskLevel): ChoiceView[] {
  const views = values.map(choiceView);
  if (level !== 'high') return views;
  const deny = views.filter((c) => c.value === 'deny').map((c) => ({ ...c, kind: 'denyPrimary' as const }));
  const allow = views.filter((c) => c.value !== 'deny').map((c) => ({ ...c, kind: 'secondary' as const }));
  return [...deny, ...allow];
}

/**
 * Supported choices in display order, deduplicated, unknown values dropped.
 * `deny` is always present (a request must stay refusable); `once` is added if the server sent nothing usable.
 */
export function normalizeChoices(raw: readonly string[] | undefined): ApprovalChoiceValue[] {
  const set = new Set<ApprovalChoiceValue>();
  for (const c of raw ?? []) if (isApprovalChoice(c)) set.add(c);
  if (set.size === 0) set.add('once');
  set.add('deny');
  return CHOICE_ORDER.filter((c) => set.has(c));
}

export function choiceView(value: ApprovalChoiceValue): ChoiceView {
  const t = CHOICE_TEXT[value];
  return { value, labelKey: t.labelKey, hintKey: t.hintKey, kind: t.kind, a11yKey: t.a11yKey };
}

// ---- command display (review: bidi / invisible characters in approval commands) ----------------------------

/**
 * Characters that change how a command LOOKS without being visible themselves: C0/C1 controls (except \n and \t),
 * every format character (\p{Cf}: bidi embeddings/overrides/isolates U+202A–U+202E, U+2066–U+2069, marks
 * U+200E/U+200F/U+061C, zero-width U+200B–U+200D, U+2060, U+FEFF, soft hyphen, tag characters …) and the Unicode
 * line / paragraph separators.
 */
const HIDDEN_CHARS = /(?![\n\t])[\p{Cc}\p{Cf}\u2028\u2029]/gu;
const NON_ASCII = /[^\x00-\x7f]/;

/** `U+202E` → `\u202E`, astral → `\u{E0041}` */
function escapeChar(ch: string): string {
  const cp = ch.codePointAt(0) ?? 0;
  const hex = cp.toString(16).toUpperCase();
  return cp > 0xffff ? `\\u{${hex}}` : `\\u${hex.padStart(4, '0')}`;
}

export type CommandDisplay = {
  /** the text to show: hidden characters replaced by visible escapes */
  text: string;
  /** number of escaped characters */
  escaped: number;
  /** escaped or other non-ASCII characters (homoglyphs, full-width letters …) → show the warning */
  unusual: boolean;
};

/** Make every character of an approval command visible; never changes plain ASCII commands. */
export function displayCommand(command: string): CommandDisplay {
  let escaped = 0;
  const text = command.replace(HIDDEN_CHARS, (ch) => {
    escaped++;
    return escapeChar(ch);
  });
  return { text, escaped, unusual: escaped > 0 || NON_ASCII.test(command) };
}

/** Command without the hidden characters (risk matching: `r\u200Bm -rf` is still `rm -rf`). */
export function stripHidden(command: string): string {
  return command.replace(HIDDEN_CHARS, '');
}

// Heuristic only: the server sends no risk level. Used for styling, never for gating.
const HIGH_RISK: RegExp[] = [
  /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf]/i,
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\s+[^|;&]*\bof=/,
  /\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z)?sh\b/,
  /\bchmod\s+(-[a-z]+\s+)*(777|a\+rwx)/i,
  /\bchown\s+-[a-z]*r/i,
  /\bgit\s+(push\s+[^|;&]*(--force|-f\b)|reset\s+--hard|clean\s+-[a-z]*f)/i,
  /\b(shutdown|reboot|halt|poweroff)\b/,
  /\bkill(all)?\s+-9\b/,
  />\s*\/dev\/(sd|nvme|disk)/,
  /\b(drop\s+(table|database)|truncate\s+table)\b/i,
];
const ELEVATED_RISK: RegExp[] = [/\bdelete\b|\blöschen\b|\boverwrite\b/i, /\b(kill|pkill)\b/, /\b(mv|cp)\s+[^|;&]*\/etc\b/, /\bpip\s+install\b|\bnpm\s+(i|install)\b|\bapt(-get)?\s+(install|remove)\b/];

/**
 * Risk for styling only. `smartDenied` comes from Hermes (its guardian refused) → "flagged"; everything else is an
 * app-side ESTIMATE from the command text, labelled as such in the UI.
 */
export function assessRisk(command: string, description: string, smartDenied: boolean): { level: RiskLevel; labelKey: TKey } {
  if (smartDenied) return { level: 'high', labelKey: 'approvals.risk.flagged' };
  if (HIGH_RISK.some((r) => r.test(command))) return { level: 'high', labelKey: 'approvals.risk.high' };
  if (ELEVATED_RISK.some((r) => r.test(command) || r.test(description))) return { level: 'elevated', labelKey: 'approvals.risk.elevated' };
  return { level: 'normal', labelKey: 'approvals.risk.normal' };
}

/** Start of the server's wait: server timestamp if it plausibly matches our clock, else `now`. */
export function approvalStartMs(timestampSec: number | undefined, now: number): number {
  if (typeof timestampSec !== 'number' || !Number.isFinite(timestampSec) || timestampSec <= 0) return now;
  const ms = timestampSec * 1000;
  return Math.abs(now - ms) <= MAX_CLOCK_SKEW_MS ? Math.min(ms, now) : now;
}

export type ViewOptions = {
  now?: number;
  /** Server `approvals.timeout`; the event does not carry it. Default 300. */
  timeoutSeconds?: number;
};

export function toApprovalView(a: ApprovalInput, opts: ViewOptions = {}): ApprovalView {
  const now = opts.now ?? Date.now();
  const timeoutSeconds =
    a.timeoutSeconds && a.timeoutSeconds > 0
      ? a.timeoutSeconds
      : opts.timeoutSeconds && opts.timeoutSeconds > 0
        ? opts.timeoutSeconds
        : DEFAULT_APPROVAL_TIMEOUT_S;
  const deadlineMs = a.deadlineAt ?? a.expiresAt ?? approvalStartMs(a.timestamp, now) + timeoutSeconds * 1000;
  const command = (a.command ?? '').replace(/\s+$/, '');
  const shown = displayCommand(command);
  const description = displayCommand((a.description ?? '').trim()).text;
  const smartDenied = a.smartDenied === true;
  const risk = assessRisk(stripHidden(command), stripHidden(description), smartDenied);
  return {
    key: a.requestId ?? `${a.runId ?? ''}:${a.timestamp ?? ''}:${command}`,
    titleKey: smartDenied ? 'approvals.title.blocked' : 'approvals.title.request',
    command,
    commandDisplay: shown.text,
    commandUnusual: shown.unusual,
    lineCount: command ? shown.text.split('\n').length : 0,
    description,
    risk,
    smartDenied,
    choices: choicesForRisk(normalizeChoices(a.choices), risk.level),
    deadlineMs,
    timeoutSeconds,
    deadlineEstimated: !a.expiresAt,
    expired: a.expired === true || now >= deadlineMs,
  };
}

/** "Immer erlauben" at high risk needs a second, explicit confirmation (global allowlist, all channels). */
export function needsConfirm(choice: ApprovalChoiceValue, level: RiskLevel): boolean {
  return choice === 'always' && level === 'high';
}

/** error state of a tap after the deadline: nothing is sent, the card explains why */
export const LATE_TAP_ERROR: ResponseError = { messageKey: 'approvals.error.expired', retryable: false };

/** A tap at `now` on a request with this deadline is too late (no request may be sent). */
export function isLateTap(view: Pick<ApprovalView, 'deadlineMs'>, expiredFlag: boolean | undefined, now: number): boolean {
  return expiredFlag === true || now >= view.deadlineMs;
}

// ---- history rows ("✓ Erlaubt (einmal): rm -rf build/") --------------------------------------

export type HistoryOutcome = ApprovalChoiceValue | 'expired' | 'cancelled';

export type HistoryLine = {
  icon: string;
  labelKey: TKey;
  tone: 'success' | 'danger' | 'muted';
  /** first command line, shortened */
  command: string;
};

const HISTORY: Record<HistoryOutcome, { icon: string; labelKey: TKey; tone: HistoryLine['tone'] }> = {
  once: { icon: '✓', labelKey: 'approvals.history.once', tone: 'success' },
  session: { icon: '✓', labelKey: 'approvals.history.session', tone: 'success' },
  always: { icon: '✓', labelKey: 'approvals.history.always', tone: 'success' },
  deny: { icon: '✕', labelKey: 'approvals.history.deny', tone: 'danger' },
  expired: { icon: '⏱', labelKey: 'approvals.history.expired', tone: 'danger' },
  cancelled: { icon: '–', labelKey: 'approvals.history.cancelled', tone: 'muted' },
};

export function historyLine(r: { outcome: string; command: string }, max = 80): HistoryLine {
  const h = HISTORY[r.outcome as HistoryOutcome] ?? HISTORY.cancelled;
  const shown = displayCommand(r.command).text;
  const first = (shown.split('\n')[0] ?? '').trim();
  const multi = shown.includes('\n');
  const command = first.length > max ? `${first.slice(0, max - 1)}…` : multi ? `${first} …` : first;
  return { ...h, command };
}

/** Whole seconds left (>= 0), rounded up so "0:00" only shows at/after the deadline. */
export function remainingSeconds(deadlineMs: number, now: number): number {
  return Math.max(0, Math.ceil((deadlineMs - now) / 1000));
}

/** `m:ss` */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Fraction of the wait still left, 0..1 (for a progress bar). */
export function remainingFraction(deadlineMs: number, timeoutSeconds: number, now: number): number {
  const total = timeoutSeconds * 1000;
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, (deadlineMs - now) / total));
}

export type ResponseError = {
  messageKey: TKey;
  /** retry makes sense (transient); false => request is gone, only dismiss */
  retryable: boolean;
};

/** Map a thrown error from `respondApproval` (HermesError, duck-typed) to a message key. */
export function describeResponseError(err: unknown): ResponseError {
  const e = (typeof err === 'object' && err !== null ? err : {}) as { code?: unknown; kind?: unknown; status?: unknown };
  const code = typeof e.code === 'string' ? e.code : undefined;
  const status = typeof e.status === 'number' ? e.status : undefined;
  if (code === 'approval_expired') return LATE_TAP_ERROR;
  if (code === 'approval_not_pending') return { messageKey: 'approvals.error.notPending', retryable: false };
  if (code === 'approval_not_active' || code === 'run_not_active' || status === 404)
    return { messageKey: 'approvals.error.runEnded', retryable: false };
  if (e.kind === 'auth' || status === 401) return { messageKey: 'approvals.error.auth', retryable: false };
  if (e.kind === 'network' || e.kind === 'timeout') return { messageKey: 'approvals.error.network', retryable: true };
  if (e.kind === 'busy' || e.kind === 'rate_limit') return { messageKey: 'approvals.error.busy', retryable: true };
  return { messageKey: 'approvals.error.generic', retryable: true };
}

// ---- submit state machine (double-tap protection) -------------------------------------------

export type SubmitState =
  | { phase: 'idle' }
  | { phase: 'sending'; choice: ApprovalChoiceValue }
  | { phase: 'error'; choice: ApprovalChoiceValue; error: ResponseError }
  /** answered successfully; the shell removes the sheet (approval -> null) */
  | { phase: 'sent'; choice: ApprovalChoiceValue };

export const IDLE: SubmitState = { phase: 'idle' };

/** Whether a new answer may start. Only from idle, or from a retryable error. */
export function canSubmit(s: SubmitState): boolean {
  return s.phase === 'idle' || (s.phase === 'error' && s.error.retryable);
}

/** Start sending `choice`; returns null if not allowed (ignore the tap). */
export function beginSubmit(s: SubmitState, choice: ApprovalChoiceValue): SubmitState | null {
  return canSubmit(s) ? { phase: 'sending', choice } : null;
}

export function failSubmit(s: SubmitState, err: unknown): SubmitState {
  if (s.phase !== 'sending') return s;
  return { phase: 'error', choice: s.choice, error: describeResponseError(err) };
}

export function succeedSubmit(s: SubmitState): SubmitState {
  return s.phase === 'sending' ? { phase: 'sent', choice: s.choice } : s;
}
