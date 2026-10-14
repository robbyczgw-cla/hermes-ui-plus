/**
 * Leading+trailing throttle with injectable timers (testable). Used to cap React state updates
 * during token streaming at ~30 fps.
 */
export type ThrottleDeps = {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

export type Throttled = {
  /** request an update: runs now if the interval has elapsed, else once at the end of the interval */
  call(): void;
  /** run pending update immediately (if any) */
  flush(): void;
  /** drop a pending update */
  cancel(): void;
};

const realDeps: ThrottleDeps = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
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
  let handle: unknown = null;
  let pending = false;

  function run(): void {
    handle = null;
    pending = false;
    last = deps.now();
    fn();
  }

  return {
    call() {
      if (handle !== null) {
        pending = true;
        return;
      }
      const wait = last + interval() - deps.now();
      if (wait <= 0) {
        run();
      } else {
        pending = true;
        handle = deps.setTimeout(run, wait);
      }
    },
    flush() {
      if (handle !== null) {
        deps.clearTimeout(handle);
        handle = null;
      }
      if (pending) run();
    },
    cancel() {
      if (handle !== null) deps.clearTimeout(handle);
      handle = null;
      pending = false;
    },
  };
}
