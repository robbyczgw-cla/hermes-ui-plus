// Pure geometry helpers for the native SVG charts (no RN imports; tested with node --test).

export type Pt = { x: number; y: number };
export type SeriesIn = { name: string; data: { x: string | number; y: number }[] };

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Sanitize partial/streaming series: drop points without a finite y, coerce x to string. */
export function cleanSeries(raw: unknown): { name: string; points: { x: string; y: number }[] }[] {
  if (!Array.isArray(raw)) return [];
  const out: { name: string; points: { x: string; y: number }[] }[] = [];
  raw.forEach((s, i) => {
    if (!s || typeof s !== 'object') return;
    const o = s as Record<string, unknown>;
    const name = typeof o.name === 'string' && o.name ? o.name : `Reihe ${i + 1}`;
    const pts: { x: string; y: number }[] = [];
    if (Array.isArray(o.data)) {
      for (const d of o.data) {
        if (!d || typeof d !== 'object') continue;
        const p = d as Record<string, unknown>;
        const y = typeof p.y === 'string' ? Number(p.y) : p.y;
        if (!isFiniteNum(y)) continue;
        const x = typeof p.x === 'string' || typeof p.x === 'number' ? String(p.x) : String(pts.length + 1);
        pts.push({ x, y });
      }
    }
    out.push({ name, points: pts });
  });
  return out;
}

/** Ordered union of x categories across series (first appearance wins). */
export function categories(series: { points: { x: string }[] }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of series) for (const p of s.points) if (!seen.has(p.x)) (seen.add(p.x), out.push(p.x));
  return out;
}

/** Bar path anchored at baseline with rounded data-end (top for positive, bottom for negative). */
export function barPath(x: number, w: number, yBase: number, yVal: number, r = 4): string {
  const h = Math.abs(yBase - yVal);
  if (h < 0.5 || w <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  if (yVal <= yBase) {
    // grows upward
    return `M${x},${yBase}V${yVal + rr}Q${x},${yVal} ${x + rr},${yVal}H${x + w - rr}Q${x + w},${yVal} ${x + w},${yVal + rr}V${yBase}Z`;
  }
  return `M${x},${yBase}V${yVal - rr}Q${x},${yVal} ${x + rr},${yVal}H${x + w - rr}Q${x + w},${yVal} ${x + w},${yVal - rr}V${yBase}Z`;
}

/** Monotone cubic (Fritsch–Carlson) path through points sorted by x. Never overshoots. */
export function monotonePath(pts: Pt[]): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0].x},${pts[0].y}`;
  if (n === 2) return `M${pts[0].x},${pts[0].y}L${pts[1].x},${pts[1].y}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x;
    m[i] = dx[i] === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx[i];
  }
  const tg: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) tg[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  tg[n - 1] = m[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      tg[i] = 0;
      tg[i + 1] = 0;
      continue;
    }
    const a = tg[i] / m[i];
    const b = tg[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      tg[i] = k * a * m[i];
      tg[i + 1] = k * b * m[i];
    }
  }
  let d = `M${r2(pts[0].x)},${r2(pts[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${r2(pts[i].x + h)},${r2(pts[i].y + tg[i] * h)} ${r2(pts[i + 1].x - h)},${r2(pts[i + 1].y - tg[i + 1] * h)} ${r2(pts[i + 1].x)},${r2(pts[i + 1].y)}`;
  }
  return d;
}

function r2(v: number) {
  return Math.round(v * 100) / 100;
}

/** Polar → cartesian, angle 0 = 12 o'clock, clockwise. */
export function polar(cx: number, cy: number, r: number, a: number): Pt {
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
}

/** Pie/donut slice path between angles a0..a1 (radians, clockwise from top). `ri`=0 → pie. */
export function arcPath(cx: number, cy: number, ro: number, ri: number, a0: number, a1: number): string {
  const span = a1 - a0;
  if (span <= 0) return '';
  if (span >= Math.PI * 2 - 1e-6) {
    // full circle: two halves
    const mid = a0 + Math.PI;
    return arcPath(cx, cy, ro, ri, a0, mid) + arcPath(cx, cy, ro, ri, mid, a0 + Math.PI * 2 - 1e-6);
  }
  const large = span > Math.PI ? 1 : 0;
  const p0 = polar(cx, cy, ro, a0);
  const p1 = polar(cx, cy, ro, a1);
  if (ri <= 0) {
    return `M${cx},${cy}L${r2(p0.x)},${r2(p0.y)}A${ro},${ro} 0 ${large} 1 ${r2(p1.x)},${r2(p1.y)}Z`;
  }
  const q1 = polar(cx, cy, ri, a1);
  const q0 = polar(cx, cy, ri, a0);
  return `M${r2(p0.x)},${r2(p0.y)}A${ro},${ro} 0 ${large} 1 ${r2(p1.x)},${r2(p1.y)}L${r2(q1.x)},${r2(q1.y)}A${ri},${ri} 0 ${large} 0 ${r2(q0.x)},${r2(q0.y)}Z`;
}

/** Fold slices beyond `max` (smallest first) into a single "Andere" slice. Keeps original order. */
export function foldSlices(points: { x: string; y: number }[], max = 8, otherLabel = 'Andere'): { x: string; y: number }[] {
  const pos = points.filter((p) => p.y > 0);
  if (pos.length <= max) return pos;
  const keep = new Set([...pos].sort((a, b) => b.y - a.y).slice(0, max - 1));
  const kept = pos.filter((p) => keep.has(p));
  const rest = pos.filter((p) => !keep.has(p)).reduce((s, p) => s + p.y, 0);
  return [...kept, { x: otherLabel, y: rest }];
}

/** Every k-th x label so labels (≈ charWidth px per char) don't collide. */
export function labelStride(labels: string[], slotWidth: number, charWidth = 6.2, pad = 8): number {
  if (!labels.length || slotWidth <= 0) return 1;
  const longest = Math.max(...labels.map((l) => l.length));
  const need = longest * charWidth + pad;
  return Math.max(1, Math.ceil(need / slotWidth));
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

const isWordChar = (c: string | undefined) => !!c && (c.toLowerCase() !== c.toUpperCase() || /\d/.test(c));

/** True if `label` already names `unit` as a whole token ("Temperatur (°C)", "°C", "Umsatz in €"). */
export function labelHasUnit(label: string, unit: string): boolean {
  const u = unit.trim().toLowerCase();
  if (!u) return true;
  const l = label.toLowerCase();
  for (let at = l.indexOf(u); at >= 0; at = l.indexOf(u, at + 1)) {
    const before = at > 0 ? l[at - 1] : undefined;
    const after = l[at + u.length];
    // a unit that starts/ends with a symbol ("°C", "%", "€") needs no boundary on that side
    const startOk = !isWordChar(u[0]) || !isWordChar(before);
    const endOk = !isWordChar(u[u.length - 1]) || !isWordChar(after);
    if (startOk && endOk) return true;
  }
  return false;
}

/** "Label (unit)" unless the label already contains the unit. */
export function labelWithUnit(label: string, unit?: string): string {
  if (!unit || !unit.trim()) return label;
  return labelHasUnit(label, unit) ? label : `${label} (${unit})`;
}
