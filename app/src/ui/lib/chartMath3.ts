// Pure math for the v3 chart kinds (hbar, stacked, scatter, radar, gauge, heatmap, waterfall) and the
// stats sparkline. No RN imports; tested with node --test (chartMath3.test.ts).

import { polar, type Pt } from './chartMath.ts';
import { boundedTicks } from './format.ts';

export type Point3 = { x: string; xn?: number; y: number; y2?: string; label?: string; total?: boolean };
export type Series3 = { name: string; points: Point3[] };

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Tolerant series cleaner for partial/streaming data (v3 point shape). Drops points without a finite
 * `y`; keeps numeric `x` as `xn` (scatter), `y2` (heatmap matrix row), `label` (scatter), `total` (waterfall).
 */
export function cleanSeries3(raw: unknown, max = 8): Series3[] {
  if (!Array.isArray(raw)) return [];
  const out: Series3[] = [];
  raw.forEach((s, i) => {
    if (!s || typeof s !== 'object' || out.length >= max) return;
    const o = s as Record<string, unknown>;
    const name = typeof o.name === 'string' && o.name ? o.name : `#${i + 1}`;
    const points: Point3[] = [];
    if (Array.isArray(o.data)) {
      for (const d of o.data) {
        let rx: unknown;
        let ry: unknown;
        let rest: Record<string, unknown> = {};
        if (Array.isArray(d)) {
          rx = d[0];
          ry = d[1];
        } else if (d && typeof d === 'object') {
          rest = d as Record<string, unknown>;
          rx = rest.x;
          ry = rest.y;
        } else continue;
        const y = num(ry);
        if (y === undefined) continue;
        const p: Point3 = { x: typeof rx === 'string' || typeof rx === 'number' ? String(rx) : String(points.length + 1), y };
        const xn = typeof rx === 'number' ? (Number.isFinite(rx) ? rx : undefined) : typeof rx === 'string' && /^\s*-?\d/.test(rx) ? num(rx) : undefined;
        if (xn !== undefined) p.xn = xn;
        if (typeof rest.y2 === 'string' && rest.y2) p.y2 = rest.y2;
        else if (typeof rest.y2 === 'number' && Number.isFinite(rest.y2)) p.y2 = String(rest.y2);
        if (typeof rest.label === 'string' && rest.label) p.label = rest.label;
        if (rest.total === true) p.total = true;
        points.push(p);
      }
    }
    out.push({ name, points });
  });
  return out;
}

/** Ordered union of x categories across series. */
export function cats3(series: { points: { x: string }[] }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of series) for (const p of s.points) if (!seen.has(p.x)) (seen.add(p.x), out.push(p.x));
  return out;
}

/* ───────────── scales ───────────── */

/** Linear map d0..d1 → r0..r1 (degenerate domain maps to the middle of the range). */
export function linearScale(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0;
  if (!span) return () => (r0 + r1) / 2;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** Fallback axis for spans that overflow: the two finite ends (padding can push ±MAX_VALUE to ±Infinity). */
function finitePair(a: number, b: number): number[] {
  const lo = Number.isFinite(a) ? a : -Number.MAX_VALUE;
  const hi = Number.isFinite(b) ? b : Number.MAX_VALUE;
  return [lo, hi];
}

/** Nice ticks that do NOT force zero into the domain (scatter axes). */
export function looseTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min > max) [min, max] = [max, min];
  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 1;
    min -= pad;
    max += pad;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(max - min)) return finitePair(min, max);
  const raw = (max - min) / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return boundedTicks(min, max, step, (v) => Number(v.toPrecision(12))) ?? [min, max];
}

/** Index of the point nearest to (px,py) within `maxDist` (screen px), or null. */
export function nearestPoint(pts: Pt[], px: number, py: number, maxDist = 28): number | null {
  let best: number | null = null;
  let bd = maxDist * maxDist;
  pts.forEach((p, i) => {
    const d = (p.x - px) ** 2 + (p.y - py) ** 2;
    if (d <= bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/* ───────────── hbar ───────────── */

/** Horizontal bar from baseline x0 to xv (row top y, height h) with a rounded data end. */
export function hbarPath(x0: number, xv: number, y: number, h: number, r = 4): string {
  const w = Math.abs(xv - x0);
  if (w < 0.5 || h <= 0) return '';
  const rr = Math.min(r, h / 2, w);
  const f = (v: number) => round2(v);
  if (xv >= x0) return `M${f(x0)},${f(y)}H${f(xv - rr)}Q${f(xv)},${f(y)} ${f(xv)},${f(y + rr)}V${f(y + h - rr)}Q${f(xv)},${f(y + h)} ${f(xv - rr)},${f(y + h)}H${f(x0)}Z`;
  return `M${f(x0)},${f(y)}H${f(xv + rr)}Q${f(xv)},${f(y)} ${f(xv)},${f(y + rr)}V${f(y + h - rr)}Q${f(xv)},${f(y + h)} ${f(xv + rr)},${f(y + h)}H${f(x0)}Z`;
}

/** SVG arc stroke (centerline) from a0 to a1 (radians, 0 = 12 o'clock, clockwise; span ≤ 2π). */
export function arcStroke(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const span = a1 - a0;
  if (span <= 1e-4) return '';
  const p0 = polar(cx, cy, r, a0);
  const p1 = polar(cx, cy, r, Math.min(a1, a0 + Math.PI * 2 - 1e-4));
  return `M${round2(p0.x)},${round2(p0.y)}A${r},${r} 0 ${span > Math.PI ? 1 : 0} 1 ${round2(p1.x)},${round2(p1.y)}`;
}

/* ───────────── stacked ───────────── */

export type StackSeg = { si: number; y0: number; y1: number; v: number };

/**
 * Stack values per category. Positives stack upward from 0, negatives downward. `hidden` series are
 * skipped (legend toggle). Returns segments per category plus the overall extent.
 */
export function stackSeries(
  series: { points: { x: string; y: number }[] }[],
  cats: string[],
  hidden: ReadonlySet<number> = new Set(),
): { stacks: StackSeg[][]; min: number; max: number; totals: number[] } {
  const look = series.map((s) => new Map(s.points.map((p) => [p.x, p.y])));
  let min = 0;
  let max = 0;
  const totals: number[] = [];
  const stacks = cats.map((c) => {
    let pos = 0;
    let neg = 0;
    let tot = 0;
    const segs: StackSeg[] = [];
    look.forEach((m, si) => {
      if (hidden.has(si)) return;
      const v = m.get(c);
      if (v === undefined || v === 0) return;
      tot += v;
      if (v > 0) {
        segs.push({ si, y0: pos, y1: pos + v, v });
        pos += v;
      } else {
        segs.push({ si, y0: neg, y1: neg + v, v });
        neg += v;
      }
    });
    max = Math.max(max, pos);
    min = Math.min(min, neg);
    totals.push(tot);
    return segs;
  });
  return { stacks, min, max, totals };
}

/* ───────────── radar ───────────── */

/** Angle (radians, 0 = 12 o'clock, clockwise) of radar axis i of n. */
export function radarAngle(i: number, n: number): number {
  return n > 0 ? (Math.PI * 2 * i) / n : 0;
}

/** Polygon vertices for one series; values are clamped to 0..max. `scale` (0..1) animates the entrance. */
export function radarPolygon(values: (number | undefined)[], max: number, cx: number, cy: number, r: number, scale = 1): Pt[] {
  const n = values.length;
  return values.map((v, i) => {
    const k = max > 0 ? Math.min(1, Math.max(0, (v ?? 0) / max)) : 0;
    return polar(cx, cy, r * k * scale, radarAngle(i, n));
  });
}

export function polygonPath(pts: Pt[]): string {
  if (!pts.length) return '';
  return pts.map((p, i) => `${i ? 'L' : 'M'}${round2(p.x)},${round2(p.y)}`).join('') + 'Z';
}

/** Outer ring value: explicit max if valid, else a nice number ≥ data max. */
export function radarMax(values: number[], explicit?: number): number {
  if (explicit !== undefined && Number.isFinite(explicit) && explicit > 0) return explicit;
  const m = Math.max(0, ...values.filter((v) => Number.isFinite(v)));
  if (m <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(m)));
  const n = m / mag;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * mag;
}

/** Text anchor for an axis label at angle a. */
export function radarAnchor(a: number): 'start' | 'middle' | 'end' {
  const s = Math.sin(a);
  return Math.abs(s) < 0.2 ? 'middle' : s > 0 ? 'start' : 'end';
}

/**
 * Word-wrap a label into ≤ maxLines lines of ≈ maxChars (overflow ends with …). Words longer than a line
 * break after hyphens first, then hard with a trailing "-" (German compounds: "Akkulauf-" / "zeit").
 */
export function wrapLabel(text: string, maxChars: number, maxLines = 2): string[] {
  const max = Math.max(2, maxChars);
  const words: string[] = [];
  for (const w of text.trim().split(/\s+/).filter(Boolean)) {
    if (w.length <= max) {
      words.push(w);
      continue;
    }
    for (const part of w.split(/(?<=-)/)) {
      let rest = part;
      while (rest.length > max) {
        words.push(rest.slice(0, max - 1) + '-');
        rest = rest.slice(max - 1);
      }
      if (rest) words.push(rest);
    }
  }
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const glue = cur && !cur.endsWith('-') ? ' ' : '';
    const next = cur + glue + w;
    if (next.length <= max || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const out = lines.slice(0, maxLines);
  const last = out[maxLines - 1].replace(/-$/, '');
  out[maxLines - 1] = (last.length >= max ? last.slice(0, max - 1) : last) + '…';
  return out;
}

/* ───────────── gauge ───────────── */

export const GAUGE_START = -Math.PI / 2;
export const GAUGE_END = Math.PI / 2;

/** Gauge range with defaults (0..100) and repair of inverted/degenerate ranges. */
export function gaugeRange(min?: number, max?: number): { min: number; max: number } {
  const lo = min !== undefined && Number.isFinite(min) ? min : 0;
  let hi = max !== undefined && Number.isFinite(max) ? max : 100;
  if (hi <= lo) hi = lo + (max === undefined ? 100 : 1);
  return { min: lo, max: hi };
}

/** Fraction 0..1 of `v` in [min,max] (clamped). */
export function gaugeFraction(v: number, min: number, max: number): number {
  if (!(max > min)) return 0;
  return Math.min(1, Math.max(0, (v - min) / (max - min)));
}

/** Angle on the semicircle (radians, 0 = 12 o'clock): min → −π/2 (9 o'clock), max → +π/2 (3 o'clock). */
export function gaugeAngle(v: number, min: number, max: number): number {
  return GAUGE_START + gaugeFraction(v, min, max) * (GAUGE_END - GAUGE_START);
}

/* ───────────── heatmap ───────────── */

const DAY = 86400000;

/** "YYYY-MM-DD" (optionally with time) → UTC day number (days since epoch), or undefined. */
export function isoDay(s: unknown): number | undefined {
  if (typeof s !== 'string') return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (!m) return undefined;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCDate() !== d) return undefined; // 2026-02-30
  return Math.floor(t / DAY);
}

/** Weekday row 0..6 with Monday = 0 (ISO). */
export function weekdayMon0(day: number): number {
  // 1970-01-01 was a Thursday (Mon0 = 3)
  return (((day + 3) % 7) + 7) % 7;
}

export type CalCell = { col: number; row: number; day: number; value: number | undefined };

/**
 * GitHub-style calendar layout: columns = ISO weeks (Mon..Sun rows), spanning first..last date.
 * Duplicate dates are summed. Month labels sit on the first week column starting on/after the 1st.
 */
export function calendarLayout(points: { x: string; y: number }[]): {
  cells: CalCell[];
  weeks: number;
  months: { col: number; month: number; year: number }[];
  start: number;
  end: number;
} | null {
  const byDay = new Map<number, number>();
  for (const p of points) {
    const d = isoDay(p.x);
    if (d === undefined) continue;
    byDay.set(d, (byDay.get(d) ?? 0) + p.y);
  }
  if (!byDay.size) return null;
  const days = [...byDay.keys()];
  let start = Math.min(...days);
  let end = Math.max(...days);
  if (end - start > 371 * 2) start = end - 371 * 2; // cap at ~2 years
  const gridStart = start - weekdayMon0(start);
  const weeks = Math.floor((end - gridStart) / 7) + 1;
  const cells: CalCell[] = [];
  for (let d = start; d <= end; d++) {
    const off = d - gridStart;
    cells.push({ col: Math.floor(off / 7), row: off % 7, day: d, value: byDay.get(d) });
  }
  const months: { col: number; month: number; year: number }[] = [];
  for (let d = start; d <= end; d++) {
    const dt = new Date(d * DAY);
    const first = dt.getUTCDate() === 1;
    if (!first && d !== start) continue;
    // label sits on the first week column that starts on/after the 1st (start month: column 0)
    const col = d === start ? 0 : Math.ceil((d - gridStart) / 7);
    if (col >= weeks) continue;
    const prev = months[months.length - 1];
    if (prev && col - prev.col < 3) months.pop(); // keep labels ≥ 3 columns apart (newer month wins)
    months.push({ col, month: dt.getUTCMonth(), year: dt.getUTCFullYear() });
  }
  return { cells, weeks, months, start, end };
}

export function dayToIso(day: number): string {
  return new Date(day * DAY).toISOString().slice(0, 10);
}

/** Bucket v in [lo,hi] into 0..levels-1 (lo → 0, hi → levels-1, anything above lo → ≥ 1). */
export function heatLevel(v: number, lo: number, hi: number, levels = 5): number {
  if (!(levels > 1)) return 0;
  if (hi <= lo) return v > lo || (v === lo && lo > 0) ? levels - 1 : 0;
  const r = (v - lo) / (hi - lo);
  if (r <= 0) return 0;
  return Math.min(levels - 1, Math.max(1, Math.ceil(r * (levels - 1))));
}

/** Domain for the heat scale: count-like data (all ≥ 0) starts at 0. */
export function heatDomain(values: number[]): { lo: number; hi: number } {
  const v = values.filter((x) => Number.isFinite(x));
  if (!v.length) return { lo: 0, hi: 1 };
  const mn = Math.min(...v);
  const mx = Math.max(...v);
  return { lo: mn >= 0 ? 0 : mn, hi: mx };
}

function parseHex(c: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Mix two hex colors (t = 0 → a, 1 → b). Returns null when a color is not #rgb/#rrggbb. */
export function mixHex(a: string, b: string, t: number): string | null {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return null;
  const k = Math.min(1, Math.max(0, t));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * k).toString(16).padStart(2, '0')).join('');
}

/** Mix weight of the accent for heat level l (0 = base color, levels-1 = full accent). */
export function heatWeight(level: number, levels = 5): number {
  if (level <= 0 || levels <= 1) return 0;
  return 0.22 + (0.78 * (level - 1)) / Math.max(1, levels - 2);
}

/** Color ramp from `base` (empty/low) to `accent`; `fill` + `opacity` fallback for non-hex colors. */
export function heatRamp(base: string, accent: string, levels = 5): { fill: string; opacity: number }[] {
  return Array.from({ length: levels }, (_, l) => {
    const w = heatWeight(l, levels);
    if (l === 0) return { fill: base, opacity: 1 };
    const m = mixHex(base, accent, w);
    return m ? { fill: m, opacity: 1 } : { fill: accent, opacity: w };
  });
}

/** Relative luminance (0..1) of a hex color (for picking in-cell text color). */
export function luminance(c: string): number {
  const p = parseHex(c);
  if (!p) return 0.5;
  const [r, g, b] = p.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/* ───────────── waterfall ───────────── */

export type WaterfallBar = { x: string; start: number; end: number; delta: number; total: boolean };

/**
 * Running totals. Delta points float from the previous running sum; `total: true` points are drawn
 * from 0 to the CURRENT running sum (their own `y` is ignored, so the chart always adds up).
 */
export function waterfallBars(points: { x: string; y: number; total?: boolean }[]): WaterfallBar[] {
  let run = 0;
  return points.map((p) => {
    if (p.total) return { x: p.x, start: 0, end: run, delta: run, total: true };
    const start = run;
    run += p.y;
    return { x: p.x, start, end: run, delta: p.y, total: false };
  });
}

export function waterfallExtent(bars: WaterfallBar[]): { min: number; max: number } {
  let min = 0;
  let max = 0;
  for (const b of bars) {
    min = Math.min(min, b.start, b.end);
    max = Math.max(max, b.start, b.end);
  }
  return { min, max };
}

/* ───────────── sparkline ───────────── */

/** Finite numbers only, max 60 (latest kept); fewer than 2 → empty. */
export function sparkValues(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const v = raw.map(num).filter((x): x is number => x !== undefined);
  return v.length < 2 ? [] : v.slice(-60);
}

/** Polyline path for a tiny sparkline inside w×h with `pad` px inset; also returns the last point. */
export function sparklinePath(values: number[], w: number, h: number, pad = 3): { d: string; last: Pt } | null {
  if (values.length < 2 || w <= 0 || h <= 0) return null;
  const mn = Math.min(...values);
  const mx = Math.max(...values);
  const sx = linearScale(0, values.length - 1, pad, w - pad);
  const sy = mx === mn ? () => h / 2 : linearScale(mn, mx, h - pad, pad);
  const pts = values.map((v, i) => ({ x: round2(sx(i)), y: round2(sy(v)) }));
  return { d: pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(''), last: pts[pts.length - 1] };
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}
