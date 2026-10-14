// Pure helpers: tolerant accessors for partial (streaming) nodes + number formatting (German default, English via `lang`).
// No RN imports here so `node --test` can run it.

import type { Lang } from '../../i18n/core.ts';

export function asString(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return fallback;
}

export function asOptString(v: unknown): string | undefined {
  const s = asString(v);
  return s.length ? s : undefined;
}

export function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(',', '.'));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Array of objects only (drops partial primitives / nulls that sneak in while streaming). */
export function asObjects(v: unknown): Record<string, unknown>[] {
  return asArray(v).filter(isObject);
}

function groupThousands(intPart: string, sep: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/**
 * Format a number German-style (1.234,5). Avoids Intl so it behaves the same on every JS engine.
 * `maxDecimals` caps fraction digits; trailing zeros are dropped.
 */
export function formatNumber(n: number, maxDecimals = 2, lang: Lang = 'de'): string {
  if (!Number.isFinite(n)) return '–';
  const neg = n < 0;
  const abs = Math.abs(n);
  const fixed = abs.toFixed(maxDecimals);
  let [i, f = ''] = fixed.split('.');
  f = f.replace(/0+$/, '');
  const en = lang === 'en';
  // es-ES (CLDR minimumGroupingDigits=2): 1234 stays "1234", 12345 becomes "12.345"
  const out = (lang === 'es' && i.length < 5 ? i : groupThousands(i, en ? ',' : '.')) + (f ? (en ? '.' : ',') + f : '');
  return (neg ? '−' : '') + out;
}

/** Compact axis label: 1.200 → "1,2 Tsd.", 3.400.000 → "3,4 Mio." */
export function formatCompact(n: number, lang: Lang = 'de'): string {
  if (!Number.isFinite(n)) return '–';
  const abs = Math.abs(n);
  if (lang === 'en') {
    if (abs >= 1e9) return formatNumber(n / 1e9, 1, lang) + 'B';
    if (abs >= 1e6) return formatNumber(n / 1e6, 1, lang) + 'M';
    if (abs >= 1e4) return formatNumber(n / 1e3, 1, lang) + 'K';
    return formatNumber(n, abs < 10 ? 2 : abs < 100 ? 1 : 0, lang);
  }
  if (lang === 'es') {
    if (abs >= 1e12) return formatNumber(n / 1e12, 1, lang) + ' B';
    if (abs >= 1e9) return formatNumber(n / 1e9, 1, lang) + ' mil M';
    if (abs >= 1e6) return formatNumber(n / 1e6, 1, lang) + ' M';
    if (abs >= 1e4) return formatNumber(n / 1e3, 1, lang) + ' mil';
    return formatNumber(n, abs < 10 ? 2 : abs < 100 ? 1 : 0, lang);
  }
  if (abs >= 1e9) return formatNumber(n / 1e9, 1) + ' Mrd.';
  if (abs >= 1e6) return formatNumber(n / 1e6, 1) + ' Mio.';
  if (abs >= 1e4) return formatNumber(n / 1e3, 1) + ' Tsd.';
  return formatNumber(n, abs < 10 ? 2 : abs < 100 ? 1 : 0);
}

export function withUnit(s: string, unit?: string, lang: Lang = 'de'): string {
  if (!unit) return s;
  if (unit === '%') return lang === 'en' ? s + '%' : s + ' %';
  if (unit === '€' || unit === '$' || unit.length <= 3) return s + ' ' + unit;
  return s + ' ' + unit;
}

/** Nice axis ticks covering [min, max] (always includes 0 when the data is all-positive). */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min > 0) min = 0;
  if (max < 0) max = 0;
  if (min === max) max = min + 1;
  const span = max - min;
  if (!Number.isFinite(span)) return [min, max];
  const raw = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return boundedTicks(min, max, step, (v) => v) ?? [min, max];
}

/** Hard cap on generated ticks: a chart never needs more, and it bounds every caller. */
export const MAX_TICKS = 64;

/**
 * Ticks `k * step` covering [min, max] by an integer index (no float accumulation, so the loop always
 * advances). Returns null when the span, step or ends are not finite or the count exceeds MAX_TICKS
 * (e.g. values near ±Number.MAX_VALUE, where the rounded end overflows to Infinity).
 */
export function boundedTicks(min: number, max: number, step: number, round: (v: number) => number): number[] | null {
  if (!(step > 0) || !Number.isFinite(step)) return null;
  const k0 = Math.floor(min / step);
  const k1 = Math.ceil(max / step);
  if (!Number.isFinite(k0) || !Number.isFinite(k1) || !Number.isFinite(k0 * step) || !Number.isFinite(k1 * step)) return null;
  const n = k1 - k0;
  if (!(n >= 0) || n > MAX_TICKS) return null;
  const ticks: number[] = [];
  for (let i = 0; i <= n; i++) {
    const v = round((k0 + i) * step);
    if (!Number.isFinite(v)) return null;
    ticks.push(v);
  }
  return ticks;
}

/** Clamp helper. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Round to the nearest step relative to `min` (slider). */
export function snap(v: number, min: number, step: number): number {
  if (!(step > 0)) return v;
  const n = Math.round((v - min) / step) * step + min;
  const decimals = (String(step).split('.')[1] ?? '').length;
  return Number(n.toFixed(decimals));
}

/** Qualifier words before a number: "ca. 51.000", "~12", "ab 3,5", "> 100". */
const NUM_PREFIX = /^(?:(?:ca|circa|etwa|rund|ungef(?:ä|ae)hr|approx|about|around|ab|bis|von|über|unter|max|min|c)\.?|[~≈<>≤≥])\s*/i;
/** Magnitude suffix directly after the number: "1,2 Mio.", "3 Mrd", "5k". */
const NUM_MAGNITUDE: Array<[RegExp, number]> = [
  [/^(?:mrd|bn|billion(?:s|en)?|milliarden?)\b/i, 1e9],
  [/^B\b/, 1e9],
  [/^(?:mio|mill|millionen?|millones|millions?)\b/i, 1e6],
  [/^M\b/, 1e6],
  [/^(?:tsd|tausend|thousand|mil)\b/i, 1e3],
  [/^k\b/i, 1e3],
];

/**
 * Parse a table cell as a number for sorting / alignment. Understands German and English
 * separators ("1.234,5", "1,234.5"), qualifier prefixes ("ca. 51.000"), units and signs
 * ("+12 %", "−3,4 Mio. €", "300.000 €") and magnitude words ("1,2 Mio." = 1 200 000).
 */
export function parseCellNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  let s = v.trim();
  s = s.replace(NUM_PREFIX, '');
  if (!/^[+\-−–]?\s?[€$£]?\s?\d/.test(s)) return undefined;
  const m = s.match(/[+\-−–]?\s?[€$£]?\s?[\d.,'\s]*\d/);
  if (!m) return undefined;
  let num = m[0].replace(/[€$£\s']/g, '').replace(/[−–]/g, '-');
  const lastComma = num.lastIndexOf(',');
  const lastDot = num.lastIndexOf('.');
  if (lastComma > lastDot) num = num.replace(/\./g, '').replace(',', '.');
  else if (lastDot > lastComma && lastComma >= 0) num = num.replace(/,/g, '');
  else if (lastComma < 0 && lastDot >= 0 && /^[+-]?\d{1,3}(\.\d{3})+$/.test(num)) num = num.replace(/\./g, '');
  let n = Number(num);
  if (!Number.isFinite(n)) return undefined;
  const rest = s.slice((m.index ?? 0) + m[0].length).trimStart();
  for (const [re, mult] of NUM_MAGNITUDE) {
    if (re.test(rest)) {
      n *= mult;
      break;
    }
  }
  return n;
}

/** True if the cell looks like a number/amount (short, starts numeric). */
export function isNumericCell(v: unknown): boolean {
  if (typeof v === 'number') return true;
  return typeof v === 'string' && v.length <= 24 && parseCellNumber(v) !== undefined && !/^\d{1,2}\.\s?[A-Za-zÄÖÜäöü]/.test(v.trim());
}
