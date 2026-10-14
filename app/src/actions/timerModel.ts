/**
 * Pure timer math + persistence format. A timer stores ABSOLUTE end timestamps while running so it
 * survives app restarts and background time; pausing converts to a remaining duration.
 */

export type TimerStatus = 'running' | 'paused' | 'done';

export type TimerRecord = {
  id: string;
  label: string;
  /** full duration */
  totalMs: number;
  status: TimerStatus;
  /** epoch ms when a running timer ends (kept after `done` as the finish time) */
  endsAt: number | null;
  /** frozen remaining time of a paused timer (= totalMs after reset) */
  remainingMs: number;
  createdAt: number;
  /** id of the scheduled "timer done" local notification, if any */
  notificationId: string | null;
  /** optional origin, e.g. `${messageId}:${nodeId}` */
  source?: string;
};

export const MAX_TIMERS = 20;
export const KEEP_DONE_MS = 60 * 60 * 1000;
export const TIMERS_STORAGE_KEY = 'hui.timers';

export function createTimer(o: { id: string; label: string; seconds: number; now: number; source?: string }): TimerRecord {
  const totalMs = Math.max(1000, Math.round(o.seconds * 1000));
  return {
    id: o.id,
    label: o.label,
    totalMs,
    status: 'running',
    endsAt: o.now + totalMs,
    remainingMs: totalMs,
    createdAt: o.now,
    notificationId: null,
    ...(o.source ? { source: o.source } : {}),
  };
}

export function remainingMs(t: TimerRecord, now: number): number {
  if (t.status === 'running') return Math.max(0, (t.endsAt ?? now) - now);
  if (t.status === 'paused') return t.remainingMs;
  return 0;
}

/** Elapsed fraction 0..1 (for progress rings). */
export function progress(t: TimerRecord, now: number): number {
  if (t.status === 'done') return 1;
  return Math.min(1, Math.max(0, 1 - remainingMs(t, now) / t.totalMs));
}

export function pauseTimer(t: TimerRecord, now: number): TimerRecord {
  if (t.status !== 'running') return t;
  const rem = remainingMs(t, now);
  if (rem <= 0) return { ...t, status: 'done', remainingMs: 0 };
  return { ...t, status: 'paused', remainingMs: rem, endsAt: null, notificationId: null };
}

export function resumeTimer(t: TimerRecord, now: number): TimerRecord {
  if (t.status !== 'paused') return t;
  const rem = t.remainingMs > 0 ? t.remainingMs : t.totalMs;
  return { ...t, status: 'running', endsAt: now + rem, remainingMs: rem, notificationId: null };
}

/** Back to the full duration, stopped. */
export function resetTimer(t: TimerRecord): TimerRecord {
  return { ...t, status: 'paused', endsAt: null, remainingMs: t.totalMs, notificationId: null };
}

/** Mark a running timer whose end has passed as done. */
export function settleTimer(t: TimerRecord, now: number): TimerRecord {
  if (t.status === 'running' && t.endsAt !== null && t.endsAt <= now) return { ...t, status: 'done', remainingMs: 0 };
  return t;
}

export function settleAll(list: readonly TimerRecord[], now: number): { list: TimerRecord[]; newlyDone: TimerRecord[] } {
  const newlyDone: TimerRecord[] = [];
  let changed = false;
  const out = list.map((t) => {
    const s = settleTimer(t, now);
    if (s !== t) {
      changed = true;
      newlyDone.push(s);
    }
    return s;
  });
  return { list: changed ? out : (list as TimerRecord[]), newlyDone };
}

/** Drop done timers older than `KEEP_DONE_MS`; cap the list at `MAX_TIMERS` (oldest done, then oldest paused go first). */
export function pruneTimers(list: readonly TimerRecord[], now: number): TimerRecord[] {
  let out = list.filter((t) => !(t.status === 'done' && now - (t.endsAt ?? t.createdAt) > KEEP_DONE_MS));
  if (out.length > MAX_TIMERS) {
    const rank = (t: TimerRecord) => (t.status === 'done' ? 0 : t.status === 'paused' ? 1 : 2);
    const drop = new Set(
      [...out]
        .sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt)
        .slice(0, out.length - MAX_TIMERS)
        .map((t) => t.id),
    );
    out = out.filter((t) => !drop.has(t.id));
  }
  return out;
}

/** Display order: running (soonest first), paused, done. */
export function sortTimers(list: readonly TimerRecord[]): TimerRecord[] {
  const rank = (t: TimerRecord) => (t.status === 'running' ? 0 : t.status === 'paused' ? 1 : 2);
  return [...list].sort((a, b) => rank(a) - rank(b) || (a.endsAt ?? a.createdAt) - (b.endsAt ?? b.createdAt) || a.createdAt - b.createdAt);
}

export function serializeTimers(list: readonly TimerRecord[]): string {
  return JSON.stringify({ f: 1, timers: list });
}

function validTimer(x: unknown): TimerRecord | null {
  if (typeof x !== 'object' || x === null) return null;
  const o = x as Record<string, unknown>;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (typeof o.id !== 'string' || !o.id || typeof o.label !== 'string') return null;
  if (!num(o.totalMs) || o.totalMs < 1000 || o.totalMs > 7 * 24 * 3600 * 1000) return null;
  if (o.status !== 'running' && o.status !== 'paused' && o.status !== 'done') return null;
  if (!num(o.createdAt)) return null;
  const endsAt = num(o.endsAt) ? o.endsAt : null;
  if (o.status === 'running' && endsAt === null) return null;
  const remaining = num(o.remainingMs) ? Math.min(Math.max(0, o.remainingMs), o.totalMs) : o.status === 'done' ? 0 : o.totalMs;
  return {
    id: o.id,
    label: o.label.slice(0, 80),
    totalMs: o.totalMs,
    status: o.status,
    endsAt,
    remainingMs: remaining,
    createdAt: o.createdAt,
    notificationId: typeof o.notificationId === 'string' ? o.notificationId : null,
    ...(typeof o.source === 'string' ? { source: o.source } : {}),
  };
}

/** Tolerant parse (corrupt → []), then settle + prune against `now`. */
export function parseTimers(raw: string | null | undefined, now: number): TimerRecord[] {
  if (!raw) return [];
  try {
    const j = JSON.parse(raw) as { f?: unknown; timers?: unknown };
    if (j?.f !== 1 || !Array.isArray(j.timers)) return [];
    const list = j.timers.map(validTimer).filter((t): t is TimerRecord => t !== null);
    return pruneTimers(settleAll(list, now).list, now);
  } catch {
    return [];
  }
}
