/**
 * Append runs: a streaming answer's text mostly only grows, and every update re-checked that with a full-text
 * `startsWith` (stream parser feed, MEDIA tag memo, incremental markdown) – O(answer) per update.
 *
 * A producer that KNOWS its texts only grew hands out a run token (any object) with each text: the same token on two
 * texts means the longer one extends the shorter one. chatState.ts sets it for the answer text (appends; reset by
 * `textReplace` and by any other text change), the stream parser for its open markdown segment. Consumers keep the
 * token next to the text they saw and call `extendsText`: a length check plus a short compare at the old end instead
 * of the full compare. No token (or another one): the full compare, exactly as before.
 *
 * Tokens live in WeakMaps keyed by the producer's immutable objects (messages, segments): a copy made anywhere else
 * (`{ ...msg, text }`) carries none, so a stale token cannot outlive a text change. Pure (node:test, appendRun.test.ts).
 */

export type AppendRun = object;

/** chars compared at the old end when the run tokens match (cheap guard against a misuse of a token) */
const TAIL_CHECK = 16;

/**
 * `text.startsWith(prev)`. With `prevRun === run` (both set) only the lengths and the last few chars of `prev` are
 * compared.
 */
export function extendsText(prev: string, text: string, prevRun?: AppendRun, run?: AppendRun): boolean {
  if (text.length < prev.length) return false;
  if (run === undefined || prevRun !== run) return text.startsWith(prev);
  const from = Math.max(0, prev.length - TAIL_CHECK);
  for (let i = from; i < prev.length; i++) if (text.charCodeAt(i) !== prev.charCodeAt(i)) return false;
  return true;
}
