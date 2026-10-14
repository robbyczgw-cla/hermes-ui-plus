/**
 * Throttled persistence of a live transcript (pure, node:test). A streaming answer is saved at most every
 * `intervalMs` (trailing, so the newest state is written), at once when a message is added, and on demand
 * (`flush`, app background). The repo stores a still-streaming message as `stopped` (messages.stripMessage),
 * so a killed app restores the partial answer marked as stopped instead of losing it.
 */
import type { ChatMessage } from '../hermes/types.ts';

export type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void };

const defaultTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function createThrottledSaver(save: (messages: ChatMessage[]) => void, intervalMs = 2500, timers: Timers = defaultTimers) {
  let latest: ChatMessage[] | null = null;
  let saved: ChatMessage[] | null = null;
  let timer: unknown = null;

  const cancel = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };
  const write = () => {
    cancel();
    if (!latest || latest === saved || !latest.length) return;
    saved = latest;
    save(latest);
  };

  return {
    /** a message was added (user bubble / placeholder): persist right away */
    now(messages: ChatMessage[]) {
      latest = messages;
      write();
    },
    /** the list changed (streaming tokens, tool events): persist within `intervalMs` */
    update(messages: ChatMessage[]) {
      latest = messages;
      if (timer !== null || messages === saved) return;
      timer = timers.set(() => {
        timer = null;
        write();
      }, intervalMs);
    },
    /** write the newest state now (app goes to the background / chat unmounts) */
    flush: write,
    dispose: cancel,
  };
}
