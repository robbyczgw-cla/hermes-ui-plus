import { useRef } from 'react';
import type { Segment } from '../protocol/types';
import { advanceSegments, type SegmentsState } from './parseCache';

/**
 * Incrementally split a (streaming) assistant text into segments. Feeds only the delta to the
 * stream parser; closed segments keep their identity so memoized children don't re-render.
 * Idempotent per (text, complete) so StrictMode double renders are harmless.
 *
 * `cacheKey` (the message id): a finished answer's final segments are kept in the parse cache, so the next mount
 * of the same answer (chat reopened, scrolled back into view) skips the parse (parseCache.advanceSegments).
 */
export function useSegments(text: string, complete: boolean, cacheKey?: string): Segment[] {
  const ref = useRef<SegmentsState | null>(null);
  const st = advanceSegments(ref.current, text, complete, cacheKey);
  ref.current = st;
  return st.segs;
}
