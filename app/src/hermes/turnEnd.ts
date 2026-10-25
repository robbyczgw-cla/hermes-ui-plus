/**
 * How a Hermes turn ended, as the answer shows it (pure, node:test). Hermes ≥ 0.22.3 ("unified gateway") ends turns in
 * more ways than v0.22.2 did:
 *
 *  - `finish_reason: "cancelled"` for an interrupted turn (user Stop, a watchdog); v0.22.2 sent `stop` there.
 *    The answer keeps its partial text and shows the "Stopped" marker, like a stop in the app.
 *  - `finish_reason: "length"` + `hermes.error_code: "iteration_budget_exhausted"` (step limit; v0.22.5) next to the
 *    plain truncation (`output_truncated`). The answer shows the truncated marker, or the step-limit line.
 *  - `finish_reason: "error"` with `error.message` = a bare reason code of the session authority (a refused turn,
 *    HTTP 200 + one final chunk). Non-streaming / plain HTTP: the same codes as `error.code` of a 409 / 400 / 503.
 *    Known codes get a localized explanation; any other message is shown as it is (trimmed).
 *  - any other (future) finish reason: a normal finished answer; without any text a short notice instead of a gap.
 *
 * Wire shapes: docs/HERMES-API.md, fixtures in turnEnd.fixtures.ts.
 */
import type { TKey, Vars } from '../i18n/core.ts';
import type { ChatMessage } from './types';

type ErrorText = { key: TKey; params?: Vars };

/** `permission_denied`: the session belongs to another surface (Bot Chat, Telegram, CLI); the API may not write to it */
export const FOREIGN_CHAT_KEY: TKey = 'backends.hermes.errors.reason.foreignChat';
/** the same refusal in a bot's Bot Chat (Hermes ≥ 0.22.3 owns that chat locally): shown instead of FOREIGN_CHAT_KEY */
export const FOREIGN_BOT_CHAT_KEY: TKey = 'backends.hermes.errors.reason.foreignBotChat';
/** `unknown_execution`: Hermes paused the chat after a restart cut a turn off; the error card also offers a branch */
export const UNKNOWN_EXECUTION_KEY: TKey = 'backends.hermes.errors.reason.unknownExecution';
/** the run of an interrupted answer is gone on Hermes (`unknown` / 404): most likely Hermes restarted meanwhile */
export const RUN_LOST_KEY: TKey = 'backends.hermes.errors.runLost';

/** Hermes session-authority reason codes → explanation (wire code = `error.message` in the stream, `error.code` in HTTP) */
const REASON_KEYS: Readonly<Record<string, TKey>> = {
  permission_denied: FOREIGN_CHAT_KEY,
  unknown_execution: UNKNOWN_EXECUTION_KEY,
  queue_full: 'backends.hermes.errors.reason.queueFull',
  runtime_draining: 'backends.hermes.errors.reason.runtimeDraining',
  storage_unavailable: 'backends.hermes.errors.reason.storageUnavailable',
  admission_conflict: 'backends.hermes.errors.reason.admissionConflict',
  session_deleted: 'backends.hermes.errors.reason.sessionDeleted',
  not_found: 'backends.hermes.errors.reason.notFound',
  admission_queued: 'backends.hermes.errors.reason.admissionQueued',
  chain_moved: 'backends.hermes.errors.reason.chainMoved',
  bot_chat_unbound: 'backends.hermes.errors.reason.botChatUnbound',
};

const REASON_KEY_SET: ReadonlySet<string> = new Set(Object.values(REASON_KEYS));

/** Server error texts are shown as they are, but never unbounded (the card clamps lines; logs and storage do not). */
export const SERVER_ERROR_MAX = 2000;

/** the explanation of a known reason code (`message` is the bare code, or `code` is), else undefined */
export function reasonErrorText(message?: string, code?: string): ErrorText | undefined {
  const m = message?.trim();
  const key = (m && REASON_KEYS[m]) || (code && REASON_KEYS[code.trim()]);
  return key ? { key } : undefined;
}

/** true for a key set by reasonErrorText (the text already says what to do; no "retry in N s" around it) */
export function isReasonKey(key: string | undefined): boolean {
  return !!key && REASON_KEY_SET.has(key);
}

/** an unknown server error text as the answer shows it: trimmed and bounded; undefined when empty */
export function serverErrorText(message?: string): string | undefined {
  const m = message?.trim();
  if (!m) return undefined;
  return m.length > SERVER_ERROR_MAX ? `${m.slice(0, SERVER_ERROR_MAX - 1)}…` : m;
}

/** finish reasons of an interrupted turn (Hermes ≥ 0.22.3 `cancelled`; the spelling variant just in case) */
export function isCancelledFinish(reason: string | undefined): boolean {
  return reason === 'cancelled' || reason === 'canceled';
}

/** key of the line under a cut-off answer (`truncated`): the step limit has its own line */
export function truncatedKey(m: Pick<ChatMessage, 'finishCode'>): TKey {
  return m.finishCode === 'iteration_budget_exhausted' ? 'chat.message.stepLimit' : 'chat.message.truncated';
}

/**
 * Key of the notice under a finished answer that came back without any text (else only an empty bubble would be
 * visible), or null. Any finish reason, also a future one; not for answers that show another end line already
 * (truncated, shortened), are not finished, or did not end with a server finish (local / restored placeholders).
 * The finish reason itself is listed in the answer's details (chat.detail.finishReason).
 */
export function emptyAnswerNotice(
  m: Pick<ChatMessage, 'role' | 'status' | 'text' | 'finishReason' | 'truncated' | 'textCapped'>
): TKey | null {
  if (m.role !== 'assistant' || m.status !== 'done' || m.truncated || m.textCapped || m.text.trim()) return null;
  return m.finishReason === undefined ? null : 'chat.message.emptyAnswer';
}

/** the failure text key to show instead of the stored one in a bot's Bot Chat, or undefined */
export function botChatFailureKey(m: Pick<ChatMessage, 'errorText'>, botChat: boolean): TKey | undefined {
  return botChat && m.errorText?.key === FOREIGN_CHAT_KEY ? FOREIGN_BOT_CHAT_KEY : undefined;
}
