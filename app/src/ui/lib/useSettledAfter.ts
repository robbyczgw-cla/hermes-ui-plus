import { useEffect, useState } from 'react';

/**
 * True once `ms` milliseconds passed since mount (or since the last change of `deps`), driven by a plain
 * JS timer. Entrance animations use it to hand their end state to React: an animated style alone may fall
 * back to its mount-time value (opacity 0 / off-screen / zero width) when Reanimated drops the settled
 * UI-thread value after a JS stall (see ui/lib/fadeIn.ts). While `settled` is false the animated style
 * drives the view; afterwards the caller appends a plain final style after it, so the view stays at its
 * end state even if the animated value is gone.
 */
export function useSettledAfter(ms: number, deps: readonly unknown[] = []): boolean {
  const [settled, setSettled] = useState(ms <= 0);
  useEffect(() => {
    if (ms <= 0) {
      setSettled(true);
      return;
    }
    setSettled(false);
    const id = setTimeout(() => setSettled(true), ms);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps]);
  return settled;
}
