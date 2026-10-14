/**
 * Shared low-frequency ticker behind useNearViewport (native): measures every registered, still-hidden view and
 * fires its `hit` once it is (nearly) on screen. The interval runs only while registrations exist – it stops on the
 * last unregister / hit. Pure (timers and the "near" test injected), tested in nearRegistry.test.ts.
 *
 * Fail-open: a view that cannot be measured – no view / no `measureInWindow`, a 0×0 or non-finite rect, or a measure
 * call that never answers – for `failOpenAfter` ticks in a row counts as visible (like the web path without an
 * IntersectionObserver). Otherwise a slot waiting for its first visibility would wait forever (E2E round 5, N2:
 * restored product cards stuck as blank tiles). A view measured offscreen keeps waiting (lazy loading stays).
 */
export type NearView = { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void };
export type NearEntry = { view: () => NearView | null; hit: () => void };

export type NearRegistry = {
  /** register; returns the (idempotent) unregister */
  add(e: NearEntry): () => void;
  tick(): void;
  size(): number;
  running(): boolean;
};

/** A rect that says where the view is (laid out, finite). */
const usable = (x: number, y: number, w: number, h: number): boolean => [x, y, w, h].every(Number.isFinite) && (w > 0 || h > 0);

export function createNearRegistry(o: {
  tickMs: number;
  isNear: (x: number, y: number, w: number, h: number) => boolean;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
  /** consecutive ticks without a usable measurement after which the view counts as visible (default 3) */
  failOpenAfter?: number;
}): NearRegistry {
  const failOpenAfter = Math.max(1, o.failOpenAfter ?? 3);
  /** per entry: unusable ticks in a row; whether the last measure call is still unanswered */
  const waiting = new Map<NearEntry, { misses: number; asked: boolean }>();
  let timer: unknown = null;
  const stop = () => {
    if (timer !== null) {
      o.clearInterval(timer);
      timer = null;
    }
  };
  const fire = (e: NearEntry) => {
    if (!waiting.delete(e)) return;
    if (!waiting.size) stop();
    e.hit();
  };
  const tick = () => {
    for (const [e, st] of [...waiting]) {
      if (st.asked) st.misses++; // the previous measure call never answered
      st.asked = false;
      const v = e.view();
      if (v?.measureInWindow) {
        st.asked = true;
        v.measureInWindow((x, y, w, h) => {
          st.asked = false;
          if (!waiting.has(e)) return;
          if (!usable(x, y, w, h)) st.misses++;
          else {
            st.misses = 0;
            if (o.isNear(x, y, w, h)) fire(e);
          }
        });
      } else st.misses++;
      if (waiting.has(e) && st.misses >= failOpenAfter) fire(e);
    }
    if (!waiting.size) stop();
  };
  return {
    add(e) {
      waiting.set(e, { misses: 0, asked: false });
      if (timer === null) timer = o.setInterval(tick, o.tickMs);
      return () => {
        waiting.delete(e);
        if (!waiting.size) stop();
      };
    },
    tick,
    size: () => waiting.size,
    running: () => timer !== null,
  };
}
