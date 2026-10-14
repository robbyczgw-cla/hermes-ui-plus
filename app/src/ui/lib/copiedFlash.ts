/**
 * Short "Kopiert" / "Copied" state of a copy button (code boxes, tool-detail sections, answer copy, hui copy buttons):
 * the button swaps to a check + localized label for COPIED_MS, a second tap restarts the window. Pure (timers injected,
 * tested in copiedFlash.test.ts); the React side is useCopiedFlash.
 */
export const COPIED_MS = 1500;

type Timers = { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (id: never) => void };

export function createCopiedFlash(set: (on: boolean) => void, ms: number = COPIED_MS, timers: Timers = { setTimeout: (fn, t) => setTimeout(fn, t), clearTimeout: (id) => clearTimeout(id) }) {
  let id: unknown = null;
  const stop = () => {
    if (id !== null) timers.clearTimeout(id as never);
    id = null;
  };
  return {
    flash() {
      stop();
      set(true);
      id = timers.setTimeout(() => {
        id = null;
        set(false);
      }, ms);
    },
    dispose: stop,
  };
}
