/**
 * "Is the capture frame ready?" for share-as-image (chat/answers/ShareFrame.tsx). Pure, unit-tested.
 *
 * Inside a capture frame every component that still waits for something visible (a photo loading, an image search,
 * a map sketch measuring itself) holds a busy token. `whenSettled` resolves once no token has been held for
 * `quietMs` (late registrations right after mount count), or at `deadlineMs` at the latest: then `expired` turns
 * true and the components still waiting draw their calm fallback (glyph tile, nothing) instead of a shimmer – the
 * caller waits one more quiet period for that redraw and captures. A capture never waits forever.
 */

export type CaptureOutcome = 'ready' | 'timeout';

export type CaptureTimers = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
};

export type CaptureTracker = {
  /** take a busy token; call the returned function when done (idempotent) */
  hold(): () => void;
  /** busy tokens currently held */
  pending(): number;
  /** true once the deadline passed with tokens still held */
  expired(): boolean;
  /** listen for `expired` turning true; returns unsubscribe */
  onExpire(fn: () => void): () => void;
  /** resolves when quiet for `quietMs` (or at the deadline); starts the clock on the first call */
  whenSettled(): Promise<CaptureOutcome>;
  /** stop all timers (frame unmounted) */
  dispose(): void;
};

export type CaptureTrackerOptions = { quietMs: number; deadlineMs: number; timers?: CaptureTimers };

const realTimers: CaptureTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export function createCaptureTracker({ quietMs, deadlineMs, timers = realTimers }: CaptureTrackerOptions): CaptureTracker {
  let held = 0;
  let isExpired = false;
  let disposed = false;
  let quietTimer: unknown = null;
  let deadlineTimer: unknown = null;
  let settled: Promise<CaptureOutcome> | null = null;
  let resolve: ((o: CaptureOutcome) => void) | null = null;
  const expireListeners = new Set<() => void>();

  const finish = (o: CaptureOutcome) => {
    if (!resolve) return;
    const r = resolve;
    resolve = null;
    if (quietTimer !== null) timers.clearTimeout(quietTimer);
    if (deadlineTimer !== null) timers.clearTimeout(deadlineTimer);
    quietTimer = deadlineTimer = null;
    r(o);
  };

  const armQuiet = () => {
    if (!resolve || disposed) return;
    if (quietTimer !== null) timers.clearTimeout(quietTimer);
    quietTimer = null;
    if (held > 0) return;
    quietTimer = timers.setTimeout(() => {
      quietTimer = null;
      if (held === 0) finish(isExpired ? 'timeout' : 'ready');
    }, quietMs);
  };

  return {
    hold() {
      held++;
      if (quietTimer !== null) {
        timers.clearTimeout(quietTimer);
        quietTimer = null;
      }
      let done = false;
      return () => {
        if (done) return;
        done = true;
        held--;
        armQuiet();
      };
    },
    pending: () => held,
    expired: () => isExpired,
    onExpire(fn) {
      expireListeners.add(fn);
      return () => expireListeners.delete(fn);
    },
    whenSettled() {
      if (settled) return settled;
      settled = new Promise<CaptureOutcome>((r) => {
        resolve = r;
      });
      deadlineTimer = timers.setTimeout(() => {
        deadlineTimer = null;
        if (held === 0) {
          finish(isExpired ? 'timeout' : 'ready');
          return;
        }
        isExpired = true;
        for (const fn of [...expireListeners]) fn();
        // the waiting components now draw their fallback and release their tokens; give them one quiet period,
        // then capture whatever is there
        timers.setTimeout(() => finish('timeout'), quietMs);
        armQuiet();
      }, deadlineMs);
      armQuiet();
      return settled;
    },
    dispose() {
      disposed = true;
      if (quietTimer !== null) timers.clearTimeout(quietTimer);
      if (deadlineTimer !== null) timers.clearTimeout(deadlineTimer);
      quietTimer = deadlineTimer = null;
      expireListeners.clear();
    },
  };
}

/** Does a capture frame on this platform draw `uri` from a local copy (captureImage.ts)? http(s) photos on the web only. */
export function needsLocalCopy(platform: string, capture: boolean, uri: string | null | undefined): boolean {
  return capture && platform === 'web' && !!uri && /^https?:\/\//i.test(uri);
}
