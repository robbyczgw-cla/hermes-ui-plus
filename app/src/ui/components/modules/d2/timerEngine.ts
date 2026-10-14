/**
 * Shared timer engine for timer v2, guide step timers and the workout rest/session clocks
 * (docs/SPEC-modules-v4.md). Pure, no React / RN imports, node:test-able.
 *
 * A clock stores ABSOLUTE timestamps while running (`endsAt` for countdowns, `startedAt` for
 * stopwatches), so it survives restarts and background time. Pausing converts to a frozen
 * duration (`accMs`). All functions return a new object (or the same one when nothing changes).
 */

export type ClockMode = 'countdown' | 'stopwatch';
export type ClockStatus = 'idle' | 'running' | 'paused' | 'done';

export type Clock = {
  mode: ClockMode;
  status: ClockStatus;
  /** countdown: full duration incl. ±1 min adjustments (ms); stopwatch: 0 */
  totalMs: number;
  /** running countdown: epoch ms of the end (kept after `done` as the finish time) */
  endsAt: number | null;
  /** running stopwatch: epoch ms the current run segment started */
  startedAt: number | null;
  /** paused/idle countdown: remaining ms · paused stopwatch: elapsed ms */
  accMs: number;
  /** id of the scheduled "done" notification, if any */
  notifId?: string | null;
};

/** upper bound (countdowns to a date can be months away) */
export const MAX_COUNTDOWN_MS = 400 * 24 * 3600 * 1000;
export const ADJUST_STEP_MS = 60_000;

const clampMs = (ms: number) => Math.min(MAX_COUNTDOWN_MS, Math.max(0, Math.round(ms)));

export function countdown(seconds: number): Clock {
  const totalMs = clampMs(seconds * 1000);
  return { mode: 'countdown', status: 'idle', totalMs, endsAt: null, startedAt: null, accMs: totalMs, notifId: null };
}

export function stopwatch(): Clock {
  return { mode: 'stopwatch', status: 'idle', totalMs: 0, endsAt: null, startedAt: null, accMs: 0, notifId: null };
}

/** Remaining ms of a countdown (0 for stopwatches / done). */
export function remainingMs(c: Clock, now: number): number {
  if (c.mode !== 'countdown' || c.status === 'done') return 0;
  if (c.status === 'running') return Math.max(0, (c.endsAt ?? now) - now);
  return Math.max(0, c.accMs);
}

/** Elapsed ms: stopwatch time, or how much of a countdown has passed. */
export function elapsedMs(c: Clock, now: number): number {
  if (c.mode === 'stopwatch') {
    if (c.status === 'running') return c.accMs + Math.max(0, now - (c.startedAt ?? now));
    return c.accMs;
  }
  return Math.max(0, c.totalMs - remainingMs(c, now));
}

/** Countdown: elapsed fraction 0..1 (ring). Stopwatch: fraction of the current minute (sweeps). */
export function progress(c: Clock, now: number): number {
  if (c.mode === 'stopwatch') return (elapsedMs(c, now) % 60_000) / 60_000;
  if (c.status === 'done') return 1;
  if (!(c.totalMs > 0)) return 0;
  return Math.min(1, Math.max(0, 1 - remainingMs(c, now) / c.totalMs));
}

/** Start (idle), resume (paused) or restart (done). A running clock is returned unchanged. */
export function start(c: Clock, now: number): Clock {
  if (c.status === 'running') return c;
  if (c.mode === 'stopwatch') {
    const acc = c.status === 'paused' ? c.accMs : 0;
    return { ...c, status: 'running', startedAt: now, endsAt: null, accMs: acc, notifId: null };
  }
  const rem = c.status === 'paused' && c.accMs > 0 ? c.accMs : c.totalMs;
  if (!(rem > 0)) return c;
  return { ...c, status: 'running', endsAt: now + rem, startedAt: null, accMs: rem, notifId: null };
}

export function pause(c: Clock, now: number): Clock {
  if (c.status !== 'running') return c;
  if (c.mode === 'stopwatch') return { ...c, status: 'paused', accMs: elapsedMs(c, now), startedAt: null };
  const rem = remainingMs(c, now);
  if (rem <= 0) return { ...c, status: 'done', accMs: 0, notifId: null };
  return { ...c, status: 'paused', accMs: rem, endsAt: null, notifId: null };
}

/** Back to the full duration (countdown) or 0 (stopwatch), stopped. */
export function reset(c: Clock): Clock {
  if (c.mode === 'stopwatch') return stopwatch();
  return { ...c, status: 'idle', endsAt: null, startedAt: null, accMs: c.totalMs, notifId: null };
}

/**
 * ±1 min (or any delta) on a countdown. Running: shifts the end; paused/idle: changes the remaining
 * time. Never goes below 1 s remaining (a minus tap near the end does not finish the timer); a done
 * timer restarts with +delta. Stopwatches are unchanged.
 */
export function adjust(c: Clock, deltaMs: number, now: number): Clock {
  if (c.mode !== 'countdown' || !deltaMs) return c;
  if (c.status === 'done') {
    if (deltaMs <= 0) return c;
    const d = clampMs(deltaMs);
    return { ...c, status: 'running', totalMs: d, endsAt: now + d, accMs: d, notifId: null };
  }
  const rem = remainingMs(c, now);
  const nextRem = Math.max(1000, Math.min(MAX_COUNTDOWN_MS, rem + deltaMs));
  const applied = nextRem - rem;
  if (!applied) return c;
  const totalMs = clampMs(Math.max(nextRem, c.totalMs + applied));
  if (c.status === 'running') return { ...c, totalMs, endsAt: now + nextRem, accMs: nextRem, notifId: null };
  // idle: the adjusted value becomes the new full duration (reset returns to it)
  if (c.status === 'idle') return { ...c, totalMs: nextRem, accMs: nextRem };
  return { ...c, totalMs, accMs: nextRem };
}

/** Running countdown whose end has passed → done. */
export function settle(c: Clock, now: number): Clock {
  if (c.mode === 'countdown' && c.status === 'running' && c.endsAt !== null && c.endsAt <= now) return { ...c, status: 'done', accMs: 0 };
  return c;
}

/** Settle a map of clocks; returns the same object when nothing changed, plus the keys that just finished. */
export function settleMap<K extends string>(clocks: Readonly<Partial<Record<K, Clock>>>, now: number): { clocks: Partial<Record<K, Clock>>; done: K[] } {
  const done: K[] = [];
  let out: Partial<Record<K, Clock>> | null = null;
  for (const k of Object.keys(clocks) as K[]) {
    const c = clocks[k];
    if (!c) continue;
    const s = settle(c, now);
    if (s !== c) {
      out = out ?? { ...clocks };
      out[k] = s;
      done.push(k);
    }
  }
  return { clocks: out ?? (clocks as Partial<Record<K, Clock>>), done };
}

/** Next instant (ms) a running countdown in the map ends, or null. */
export function nextEnd(clocks: Readonly<Record<string, Clock | undefined>>): number | null {
  let best: number | null = null;
  for (const c of Object.values(clocks)) {
    if (c && c.mode === 'countdown' && c.status === 'running' && c.endsAt !== null && (best === null || c.endsAt < best)) best = c.endsAt;
  }
  return best;
}

export function isActive(c: Clock | undefined): boolean {
  return !!c && c.status === 'running';
}

/** Tolerant restore of a persisted clock (corrupt → null). */
export function parseClock(x: unknown): Clock | null {
  if (typeof x !== 'object' || x === null) return null;
  const o = x as Record<string, unknown>;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (o.mode !== 'countdown' && o.mode !== 'stopwatch') return null;
  if (o.status !== 'idle' && o.status !== 'running' && o.status !== 'paused' && o.status !== 'done') return null;
  const totalMs = num(o.totalMs) ? clampMs(o.totalMs) : 0;
  const endsAt = num(o.endsAt) ? o.endsAt : null;
  const startedAt = num(o.startedAt) ? o.startedAt : null;
  if (o.status === 'running' && (o.mode === 'countdown' ? endsAt === null : startedAt === null)) return null;
  const accMs = num(o.accMs) ? Math.max(0, o.accMs) : 0;
  return { mode: o.mode, status: o.status, totalMs, endsAt, startedAt, accMs, notifId: typeof o.notifId === 'string' ? o.notifId : null };
}

/* ───────────── countdown to a date ───────────── */

/** Epoch ms of an ISO date/time (`until`), or null. Date-only strings mean local midnight. */
export function parseUntil(v: unknown): number | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const s = v.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dateOnly) {
    const d = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    return Number.isFinite(d.getTime()) ? d.getTime() : null;
  }
  const local = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (local) {
    const d = new Date(Number(local[1]), Number(local[2]) - 1, Number(local[3]), Number(local[4]), Number(local[5]), Number(local[6] ?? 0));
    return Number.isFinite(d.getTime()) ? d.getTime() : null;
  }
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

/** Parts of a long remaining duration: days + h:mm:ss. */
export function splitDuration(ms: number): { days: number; h: number; m: number; s: number } {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return { days: Math.floor(total / 86400), h: Math.floor((total % 86400) / 3600), m: Math.floor((total % 3600) / 60), s: total % 60 };
}

/* ───────────── formatting ───────────── */

const p2 = (n: number) => String(n).padStart(2, '0');

/** Countdown digits "m:ss" / "h:mm:ss", rounding UP so a running timer never shows 0:00 early. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${p2(m)}:${p2(s)}` : `${m}:${p2(s)}`;
}

/** Stopwatch digits "m:ss" / "h:mm:ss", rounding DOWN. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${p2(m)}:${p2(s)}` : `${m}:${p2(s)}`;
}

/** Whole minutes for summaries (≥ 1 once anything ran, rounded). */
export function wholeMinutes(ms: number): number {
  if (!(ms > 0)) return 0;
  return Math.max(1, Math.round(ms / 60_000));
}

/** Valid timer seconds 1 s … 24 h, or null. */
export function validSeconds(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const s = Math.round(v);
  return s >= 1 && s <= 86400 ? s : null;
}
