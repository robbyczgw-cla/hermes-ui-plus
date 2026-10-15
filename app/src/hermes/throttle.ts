/**
 * Leading+trailing throttle with injectable timers (testable). Used to cap React state updates
 * during token streaming at ~30 fps.
 *
 * With `requestFrame` (requestAnimationFrame: app, web, desktop) an update runs at the start of a frame instead of
 * at an arbitrary moment inside one: the next frame once the interval is over (so a React commit no longer lands
 * mid-frame and pushes that frame's work over its budget). The interval stays the minimum spacing, and also the
 * longest wait for that frame: a fallback timer runs the update when no frame comes (hidden tab, app in the
 * background). `flush` / `cancel` act at once, as before. Without `requestFrame` (node, tests): timers only.
 */
export type ThrottleDeps = {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  requestFrame?: (fn: () => void) => unknown;
  cancelFrame?: (handle: unknown) => void;
};

export type Throttled = {
  /** request an update: runs now if the interval has elapsed, else once at the end of the interval */
  call(): void;
  /** run pending update immediately (if any) */
  flush(): void;
  /** drop a pending update */
  cancel(): void;
};

const raf = (fn: () => void) => requestAnimationFrame(() => fn());
const caf = (h: unknown) => cancelAnimationFrame(h as number);

const realDeps: ThrottleDeps = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  // looked up per use: absent in node (tests keep the timer-only behaviour)
  get requestFrame() {
    return typeof requestAnimationFrame === 'function' ? raf : undefined;
  },
  get cancelFrame() {
    return typeof cancelAnimationFrame === 'function' ? caf : undefined;
  },
};

/**
 * Adaptive streaming update interval by the length of the streaming answer: per-update cost grows
 * with the text (segments, markdown tail, layout), so long answers update less often.
 * 33 ms (~30 fps) below 8 K chars, 66 ms below 32 K, 120 ms above.
 */
export function streamIntervalForLength(len: number): number {
  return len < 8_000 ? 33 : len < 32_000 ? 66 : 120;
}

/** `streamIntervalForLength` of the last message (the streaming one), text + reasoning. */
export function streamIntervalFor(messages: readonly { text: string; reasoning?: string }[]): number {
  const last = messages[messages.length - 1];
  return last ? streamIntervalForLength(last.text.length + (last.reasoning?.length ?? 0)) : 33;
}

/** `intervalMs` may be a function: read on every call (adaptive rate). */
export function createThrottle(
  fn: () => void,
  intervalMs: number | (() => number),
  deps: ThrottleDeps = realDeps
): Throttled {
  const interval = typeof intervalMs === 'function' ? intervalMs : () => intervalMs;
  let last = -Infinity;
  let timer: unknown = null;
  let frame: unknown = null;
  let pending = false;

  function unschedule(): void {
    if (timer !== null) deps.clearTimeout(timer);
    if (frame !== null) deps.cancelFrame?.(frame);
    timer = null;
    frame = null;
  }

  function run(): void {
    unschedule();
    pending = false;
    last = deps.now();
    fn();
  }

  /** frame / fallback timer: only a still pending update runs (a cancelled one stays dropped) */
  function fire(): void {
    if (pending) run();
    else unschedule();
  }

  /** the interval is over: run on the next frame – or after one more interval if no frame comes */
  function due(): void {
    timer = null;
    const requestFrame = deps.requestFrame;
    if (!requestFrame) return run();
    frame = requestFrame(fire);
    timer = deps.setTimeout(fire, Math.max(1, interval()));
  }

  return {
    call() {
      pending = true;
      if (timer !== null || frame !== null) return;
      const wait = last + interval() - deps.now();
      if (wait > 0) timer = deps.setTimeout(due, wait);
      else due();
    },
    flush() {
      if (pending) run();
      else unschedule();
    },
    cancel() {
      unschedule();
      pending = false;
    },
  };
}
