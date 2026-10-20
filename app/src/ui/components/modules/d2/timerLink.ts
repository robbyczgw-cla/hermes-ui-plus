/**
 * Follow-up timers in one chat ("make it 3 minutes" after a 2-minute timer was started): the model answers with a new
 * `timer` node in a newer message while the old one keeps running. Mounted single countdowns register here so a newer
 * timer can find its predecessor:
 *  - same explicit `id` (the skill asks for it when a timer is changed) → the newer timer takes over on its own: the
 *    old one is reset (its alarm cancelled) and the new one starts;
 *  - same label (also both without one, as small models write them) → the newer timer offers "start this one instead"
 *    and says that the earlier one is still running. Different labels ("Tea", "Eggs") are independent timers.
 * Only mounted timers take part (an old message scrolled far out of view is not touched). Pure matching + a tiny
 * subscribable registry; no React here.
 */

export type LiveTimer = {
  conversationId: string;
  messageId: string;
  /** message creation time (epoch ms), orders timers by message */
  createdAt?: number;
  /** the model's own id, not a generated fallback */
  explicitId?: string;
  label: string;
  /** remaining ms while running or paused; null when idle or done */
  active: () => number | null;
  /** a newer timer took over: stop this one */
  replace: () => void;
};

export type TimerRef = Pick<LiveTimer, 'conversationId' | 'messageId' | 'createdAt' | 'explicitId' | 'label'>;

type Entry = LiveTimer & { seq: number };

/** fallback ids the validator generates when the model gave none (`timer-seg-3`, `timer-n`, `timer-seg-2.1.0`, `-2`) */
export function isGeneratedTimerId(id: string): boolean {
  return /^timer-(seg-\d+|n)(\.\d+)*(-\d+)?$/.test(id);
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** The newest running/paused timer `me` follows up on (same explicit id first, else same label), or null. */
export function findPredecessor(me: TimerRef & { seq?: number }, candidates: Iterable<Entry>): { timer: LiveTimer; sameId: boolean } | null {
  let best: { e: Entry; sameId: boolean } | null = null;
  const older = (c: Entry) =>
    me.createdAt !== undefined && c.createdAt !== undefined ? c.createdAt < me.createdAt : me.seq !== undefined && c.seq < me.seq;
  for (const c of candidates) {
    if (c.conversationId !== me.conversationId || c.messageId === me.messageId || !older(c)) continue;
    const sameId = !!me.explicitId && c.explicitId === me.explicitId;
    if (!sameId && norm(c.label) !== norm(me.label)) continue;
    if (c.active() === null) continue;
    const newer = !best || (c.createdAt ?? c.seq) > (best.e.createdAt ?? best.e.seq);
    if (!best || (sameId && !best.sameId) || (sameId === best.sameId && newer)) best = { e: c, sameId };
  }
  return best ? { timer: best.e, sameId: best.sameId } : null;
}

const live = new Set<Entry>();
const subs = new Set<() => void>();
let version = 0;
let seq = 0;

/** Something changed (a timer registered, left, started or stopped). */
export function notifyTimers(): void {
  version++;
  for (const fn of subs) fn();
}

export function subscribeTimers(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function timersVersion(): number {
  return version;
}

/** Register a mounted timer; returns its sequence number and the unregister function. */
export function registerTimer(t: LiveTimer): { seq: number; unregister: () => void } {
  const e: Entry = { ...t, seq: ++seq };
  live.add(e);
  notifyTimers();
  return {
    seq: e.seq,
    unregister: () => {
      live.delete(e);
      notifyTimers();
    },
  };
}

export function predecessorOf(me: TimerRef & { seq?: number }): { timer: LiveTimer; sameId: boolean } | null {
  return findPredecessor(me, live);
}
