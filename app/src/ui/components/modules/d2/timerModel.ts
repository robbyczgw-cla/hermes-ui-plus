/**
 * `timer` v2 node normalisation (pure). Backward compatible with v1 {id, label, seconds, autostart}.
 * Kinds: countdown (seconds), until (countdown to an ISO date/time), stopwatch, multi (timers[] ≤ 6).
 */
import { parseUntil, validSeconds } from './timerEngine.ts';

export const MAX_MULTI = 6;

export type TimerItem = { key: string; label: string; seconds: number };

export type TimerSpec =
  | { kind: 'countdown'; label: string; seconds: number | null; autostart: boolean }
  | { kind: 'until'; label: string; until: number }
  | { kind: 'stopwatch'; label: string; autostart: boolean }
  | { kind: 'multi'; label: string; items: TimerItem[]; autostart: boolean };

const str = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

export function normalizeTimer(node: Record<string, unknown>, fallbackLabel = 'Timer'): TimerSpec {
  const label = str(node.label).slice(0, 100) || fallbackLabel;
  const autostart = node.autostart === true;
  if (Array.isArray(node.timers)) {
    const items: TimerItem[] = [];
    const keys = new Set<string>();
    for (const raw of node.timers) {
      if (items.length >= MAX_MULTI) break;
      if (!raw || typeof raw !== 'object') continue;
      const o = raw as Record<string, unknown>;
      const seconds = validSeconds(o.seconds);
      const l = str(o.label).slice(0, 60);
      if (!seconds) continue;
      // the item id verbatim (validator caps it at 64): a second, shorter cut merged distinct ids into one
      // clock / React key; still guarantee uniqueness for unvalidated input
      const id = str(o.id);
      let key = id ? `i:${id}` : `t${items.length}:${l}`;
      for (let n = 2; keys.has(key); n++) key = `${id ? `i:${id}` : `t${items.length}:${l}`}#${n}`;
      keys.add(key);
      items.push({ key, label: l || `${label} ${items.length + 1}`, seconds });
    }
    if (items.length) return { kind: 'multi', label, items, autostart };
  }
  const until = parseUntil(node.until);
  if (until !== null) return { kind: 'until', label, until };
  if (node.mode === 'stopwatch') return { kind: 'stopwatch', label, autostart };
  return { kind: 'countdown', label, seconds: validSeconds(node.seconds), autostart };
}

/** True while a streamed timer node has nothing renderable yet. */
export function timerIsEmpty(spec: TimerSpec): boolean {
  return spec.kind === 'countdown' && spec.seconds === null;
}

/**
 * Subtitle under a countdown timer title: the spoken duration, unless it just repeats the title
 * ("1 Minute" / "1 Minute"); then the mode label is shown instead.
 */
export function timerSubtitle(title: string, durationText: string, modeText: string): string {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  return norm(title) === norm(durationText) ? modeText : durationText;
}
