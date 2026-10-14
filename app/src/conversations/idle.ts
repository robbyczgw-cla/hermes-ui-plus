/** run `fn` after `delayMs` once the JS thread is idle (requestIdleCallback where available); returns cancel */
export function afterIdle(fn: () => void, delayMs: number): () => void {
  const g = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
  let idle: number | null = null;
  const t = setTimeout(() => {
    if (g.requestIdleCallback) idle = g.requestIdleCallback(fn, { timeout: 5000 });
    else fn();
  }, delayMs);
  return () => {
    clearTimeout(t);
    if (idle !== null) g.cancelIdleCallback?.(idle);
  };
}
