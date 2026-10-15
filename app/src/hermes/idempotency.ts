/**
 * Idempotent send (pure, node:test). Every Hermes turn the app sends carries an `Idempotency-Key`; the UI bridge
 * records the turn under it (bridge/src/replay.mjs): the same key never starts a second Hermes turn, and a lost stream
 * is continued at a byte offset (stream.ts). Hermes itself ignores the key on streaming requests (docs/HERMES-API.md).
 *
 * The key lives on the assistant message of the turn (`sendKey`). "Erneut" re-uses it only when the earlier attempt
 * may have reached the bridge without the app ever seeing an answer (a send that failed before any byte of the answer
 * arrived): if the bridge started that turn, the retry re-attaches to it instead of asking Hermes a second time; if
 * not, the bridge runs it as a new turn. Any visible answer, a stop, a one-turn override or an accepted (recovering)
 * turn gets a fresh key: the user wants a new answer then.
 *
 * Bridge refusals of a plain send (no resume offset): `resume_unavailable` / `idempotency_key_conflict` mean the key can
 * never run again (dead key) → the failed answer gets a fresh key, so "Erneut" is not stuck until the record expires.
 * `turn_unrecorded`: that turn ran without a recording → its answer is in the stored session (recovery, no resend).
 */
import { newId } from './chatState.ts';
import type { TurnOverride } from './turnOverride.ts';
import type { ChatMessage } from './types';

export function newSendKey(): string {
  return newId('turn');
}

/** the key to send again for a retry of `answer`, or undefined (→ new key) */
export function reusableSendKey(answer: ChatMessage | undefined, override?: TurnOverride): string | undefined {
  if (!answer || answer.role !== 'assistant' || !answer.sendKey) return undefined;
  if (override && (override.model || override.note || override.webSearch === false)) return undefined;
  if (answer.status !== 'error') return undefined;
  // accepted by Hermes (completion id seen) or being recovered: that turn exists, retry asks for a new one
  if (answer.completionId || typeof answer.interrupted === 'number') return undefined;
  if (answer.text || answer.reasoning || answer.tools.length > 0 || answer.approval) return undefined;
  return answer.sendKey;
}

/** the bridge ran this key's turn but has no recording of it: recover the answer from the stored session */
export const UNRECORDED_TURN_CODE = 'turn_unrecorded';
const DEAD_KEY_CODES: ReadonlySet<string> = new Set(['resume_unavailable', 'idempotency_key_conflict', UNRECORDED_TURN_CODE]);

/**
 * The key a failed send leaves on its answer for the next retry: a fresh one when the bridge refused `key` for good
 * (`code` of the error answer), else `key` (reusableSendKey decides later whether it is re-used).
 * `turn_unrecorded` lands here only when the session cannot be recovered: the user's retry then asks anew.
 */
export function sendKeyAfterFailure(key: string, code: string | undefined): string {
  return code && DEAD_KEY_CODES.has(code) ? newSendKey() : key;
}

/**
 * A failed send whose answer is (or will be) in the stored session: lost after Hermes accepted the turn, or a retry the
 * bridge refused because that key's turn already ran without a recording. Recover it there, never send it twice.
 */
export function answerInSession(e: { accepted?: boolean; code?: string }): boolean {
  return !!e.accepted || e.code === UNRECORDED_TURN_CODE;
}
