// "Newest request wins" for async UI work whose inputs can change while it runs (pure, latestRun.test.ts):
// a connection test that finishes after the user edited the key, an image-search key test after the provider
// changed … Each begin() invalidates the previous run; invalidate() (edit, unmount) invalidates the current one.
export type LatestRun = {
  /** start a run: `current()` is false as soon as a newer run began or invalidate() was called; `signal` aborts then */
  begin(): { signal: AbortSignal; current(): boolean };
  invalidate(): void;
};

export function createLatestRun(): LatestRun {
  let seq = 0;
  let ctrl: AbortController | null = null;
  return {
    begin() {
      ctrl?.abort();
      const mine = new AbortController();
      ctrl = mine;
      const my = ++seq;
      return { signal: mine.signal, current: () => my === seq };
    },
    invalidate() {
      seq++;
      ctrl?.abort();
      ctrl = null;
    },
  };
}
