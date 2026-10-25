/**
 * `Retry-After` handling for Hermes turns (HERMES-API "client implications 6"): a 429 (concurrency
 * cap) or 503 (`gateway_draining`) with a short Retry-After is retried once automatically, but only
 * before any answer bytes were shown. Otherwise the error bubble names the wait time.
 */
import type { ErrorText } from './chatState.ts';
import { isHermesError } from './stream.ts';
import { isReasonKey } from './turnEnd.ts';
import type { ChatMessage } from './types';

/** longest Retry-After (seconds) that is waited for automatically */
export const AUTO_RETRY_MAX_SECONDS = 5;

/** true once the assistant message shows anything (text, reasoning, tools, approval) */
export function hasVisibleOutput(m: ChatMessage | undefined): boolean {
  return !!m && (!!m.text || !!m.reasoning || m.tools.length > 0 || !!m.approval);
}

/**
 * Delay before the automatic retry, or null when the error must be shown. Only the first attempt
 * (`attempt` 0) is retried, only for `rate_limit` / `busy` with `retryAfter` ≤ 5 s, only before output.
 */
export function autoRetryDelayMs(err: unknown, opts: { attempt: number; streamed: boolean }): number | null {
  if (opts.attempt > 0 || opts.streamed || !isHermesError(err)) return null;
  if (err.kind !== 'rate_limit' && err.kind !== 'busy') return null;
  const s = err.retryAfter;
  if (s === undefined || !Number.isFinite(s) || s < 0 || s > AUTO_RETRY_MAX_SECONDS) return null;
  return Math.round(s * 1000);
}

/** "… Bitte in N s erneut versuchen." for rate-limit / busy errors that carry a Retry-After. */
export function retryAfterErrorText(err: unknown): ErrorText | undefined {
  if (!isHermesError(err) || (err.kind !== 'rate_limit' && err.kind !== 'busy')) return undefined;
  // a Hermes reason code (`runtime_draining`, …) has its own explanation, which already says to retry shortly
  if (isReasonKey(err.text?.key)) return undefined;
  const s = err.retryAfter;
  if (s === undefined || !Number.isFinite(s) || s < 0) return undefined;
  return { key: 'backends.hermes.errors.retryAfter', params: { message: err.message.trim(), seconds: s } };
}

/** Resolves after `ms`, or right away when `signal` aborts (never rejects). */
export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done);
  });
}
