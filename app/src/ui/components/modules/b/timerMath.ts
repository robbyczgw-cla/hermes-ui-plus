/**
 * Time helpers for recipe chips and step timers (pure, tested).
 */

/** Unit abbreviations for duration labels (German default; pass `S.time` for the active language). */
export type TimeUnits = { h: string; min: string; sec: string };
export const DEFAULT_TIME_UNITS: TimeUnits = { h: 'Std.', min: 'Min.', sec: 'Sek.' };

/** Minutes → "45 Min.", "1 Std.", "1 Std. 15 Min." (null for invalid / ≤ 0). */
export function formatMinutes(min: unknown, u: TimeUnits = DEFAULT_TIME_UNITS): string | null {
  if (typeof min !== 'number' || !Number.isFinite(min) || min <= 0) return null;
  const total = Math.round(min);
  if (total < 1) return null;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m} ${u.min}`;
  return m ? `${h} ${u.h} ${m} ${u.min}` : `${h} ${u.h}`;
}

/** Seconds → short label for a timer button: "30 Sek.", "5 Min.", "1 Std. 30 Min.", "2:30 Min.". */
export function formatTimerLabel(seconds: number, u: TimeUnits = DEFAULT_TIME_UNITS): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} ${u.sec}`;
  if (s % 60 === 0) return formatMinutes(s / 60, u) ?? `0 ${u.min}`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) return `${formatMinutes(m, u)} ${r} ${u.sec}`;
  return `${m}:${String(r).padStart(2, '0')} ${u.min}`;
}

/** Valid step timer seconds (1 s … 24 h) or null. */
export function validTimerSeconds(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const s = Math.round(v);
  return s >= 1 && s <= 24 * 3600 ? s : null;
}

/** Remaining ms of a timer that ends at `endsAt` (0 when passed). */
export function remainingUntil(endsAt: number, now: number): number {
  return Math.max(0, endsAt - now);
}

/** "mm:ss" / "h:mm:ss", rounding UP so a running timer never shows 0:00 early. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

/** Elapsed fraction 0..1 for a progress bar. */
export function timerProgress(totalMs: number, remainingMs: number): number {
  if (!(totalMs > 0)) return 1;
  return Math.min(1, Math.max(0, 1 - remainingMs / totalMs));
}

/**
 * Recipe time chips. Uses the explicit fields; derives `total` from prep + cook if missing
 * and drops a total that equals a single given part (avoids "20 Min. · Gesamt 20 Min.").
 */
export type TimeChipLabels = { prep: string; cook: string; total: string; units: TimeUnits };
const DEFAULT_CHIP_LABELS: TimeChipLabels = { prep: 'Vorbereitung', cook: 'Kochen', total: 'Gesamt', units: DEFAULT_TIME_UNITS };

export function timeChips(time: { prep?: unknown; cook?: unknown; total?: unknown } | undefined, L: TimeChipLabels = DEFAULT_CHIP_LABELS): { label: string; value: string }[] {
  if (!time || typeof time !== 'object') return [];
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
  const prep = num(time.prep);
  const cook = num(time.cook);
  let total = num(time.total);
  if (total === undefined && prep !== undefined && cook !== undefined) total = prep + cook;
  const out: { label: string; value: string }[] = [];
  if (prep !== undefined) out.push({ label: L.prep, value: formatMinutes(prep, L.units)! });
  if (cook !== undefined) out.push({ label: L.cook, value: formatMinutes(cook, L.units)! });
  if (total !== undefined && !(out.length === 1 && Math.round(total) === Math.round((prep ?? cook)!))) out.push({ label: L.total, value: formatMinutes(total, L.units)! });
  return out;
}
