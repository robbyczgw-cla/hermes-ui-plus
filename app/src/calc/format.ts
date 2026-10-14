import { roundHalfAway } from './numeric.ts';

/** Non-breaking space: keeps value and unit on one line. */
export const NBSP = ' ';
/** Shown for values that cannot be computed (null / NaN / Infinity). */
export const DASH = '–';

export type FormatKind = 'number' | 'currency' | 'percent' | 'duration' | 'integer';
export type DurationUnit = 'months' | 'years' | 'hours' | 'minutes' | 'seconds';

export interface FormatOptions {
  /** Default 'number'. */
  format?: FormatKind;
  /**
   * Fraction digits. With `decimals` the output always shows exactly that many (0..10).
   * Without: number = auto (max. 2, more for tiny values, trailing zeros trimmed),
   * currency = 2, percent = auto (max. 2, trimmed), integer = 0.
   */
  decimals?: number;
  /** Appended after a non-breaking space (number, integer, currency, percent). Ignored for duration. */
  unit?: string;
  /** 'de-DE' (default), 'en-*' or 'es-*' (anything else falls back to de-DE). */
  locale?: string;
  /** ISO code, default 'EUR'. EUR € · USD $ · GBP £; other codes are shown as the code itself. */
  currency?: string;
  /** What the value of a `duration` means. Default 'months'. */
  durationUnit?: DurationUnit;
}

interface Loc {
  dec: string;
  group: string;
  currencyPrefix: boolean;
  percentSpace: boolean;
  /** Spanish (CLDR minimumGroupingDigits=2): 4-digit integers are not grouped. */
  minGroup?: number;
  yearLabel?: string;
}
const DE: Loc = { dec: ',', group: '.', currencyPrefix: false, percentSpace: true };
const ES: Loc = { dec: ',', group: '.', currencyPrefix: false, percentSpace: true, minGroup: 5, yearLabel: 'a' };
const EN: Loc = { dec: '.', group: ',', currencyPrefix: true, percentSpace: false };

function localeOf(locale: string | undefined): Loc {
  if (typeof locale === 'string' && /^es\b/i.test(locale)) return ES;
  return typeof locale === 'string' && /^en\b/i.test(locale) ? EN : DE;
}

const SYMBOLS: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };

function clampDecimals(d: unknown): number | undefined {
  if (typeof d !== 'number' || !Number.isFinite(d)) return undefined;
  return Math.min(10, Math.max(0, Math.floor(d)));
}

/** Formats |x| with min/max fraction digits and grouping. x must be finite and >= 0. */
function fixed(abs: number, minFrac: number, maxFrac: number, loc: Loc): { text: string; isZero: boolean } {
  const r = roundHalfAway(abs, maxFrac);
  if (r >= 1e21) {
    const ex = r.toExponential(2).replace('.', loc.dec).replace('e+', 'e');
    return { text: ex, isZero: false };
  }
  const s = r.toFixed(maxFrac);
  const parts = s.split('.');
  const int = loc.minGroup && parts[0].length < loc.minGroup ? parts[0] : parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, loc.group);
  let frac = parts[1] ?? '';
  while (frac.length > minFrac && frac.endsWith('0')) frac = frac.slice(0, -1);
  return { text: frac ? int + loc.dec + frac : int, isZero: r === 0 };
}

/** Auto precision for plain numbers: `base` digits, more for values below 1 (two significant digits). */
function autoFrac(abs: number, base: number): number {
  if (abs === 0 || abs >= 1) return base;
  return Math.min(8, base + Math.max(0, Math.floor(-Math.log10(abs))));
}

function duration(v: number, unit: DurationUnit, loc: Loc = DE): string {
  const neg = v < 0;
  const abs = Math.abs(v);
  let out: string;
  if (unit === 'months' || unit === 'years') {
    const total = Math.round(abs * (unit === 'years' ? 12 : 1));
    const y = Math.floor(total / 12);
    const m = total % 12;
    const parts: string[] = [];
    if (y) parts.push(`${y} ${loc.yearLabel ?? 'J'}`);
    if (m) parts.push(`${m} ${loc.yearLabel ? 'm' : 'M'}`);
    out = parts.length ? parts.join(' ') : loc.yearLabel ? '0 m' : '0 M';
  } else {
    const mult = unit === 'hours' ? 3600 : unit === 'minutes' ? 60 : 1;
    const total = Math.round(abs * mult);
    const h = Math.floor(total / 3600);
    const mi = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const parts: string[] = [];
    if (h) parts.push(`${h} h`);
    if (mi) parts.push(`${mi} min`);
    if (s) parts.push(`${s} s`);
    out = parts.length ? parts.join(' ') : '0 s';
  }
  return neg && out[0] !== '0' ? '-' + out : out;
}

/**
 * Formats a calc result for display. `null`/`undefined`/NaN/Infinity -> "–".
 *
 * Conventions (documented in README.md):
 * - `percent` MULTIPLIES by 100: the expression yields a fraction (0.045 -> "4,5 %").
 *   Inputs given in percent units (4.5) are divided by 100 inside the expression (`zins / 100`).
 * - `duration` takes a number of months by default (`durationUnit` changes that):
 *   63 months -> "5 J 3 M", 7 -> "7 M", 24 -> "2 J"; hours/minutes/seconds -> "1 h 5 min 3 s".
 *   Fractions are rounded to whole months / seconds.
 * - Rounding is half away from zero (2,5 -> 3, 1.005 -> 1,01).
 * - Separators: de-DE "1.234,56 €" (NBSP before unit/symbol), en "$1,234.56".
 */
export function formatValue(v: number | null | undefined, opts: FormatOptions = {}): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DASH;
  const kind: FormatKind = opts.format ?? 'number';
  const loc = localeOf(opts.locale);
  const dec = clampDecimals(opts.decimals);
  const unit = typeof opts.unit === 'string' ? opts.unit.trim() : '';
  const neg = v < 0;
  const abs = Math.abs(v);
  let body: string;
  let suffixUnit = unit;

  switch (kind) {
    case 'duration':
      return duration(v, opts.durationUnit ?? 'months', loc);
    case 'integer': {
      const f = fixed(abs, 0, 0, loc);
      body = neg && !f.isZero ? '-' + f.text : f.text;
      break;
    }
    case 'currency': {
      const code = (opts.currency || 'EUR').toUpperCase();
      const symbol = SYMBOLS[code] ?? code;
      const d = dec ?? 2;
      const f = fixed(abs, d, d, loc);
      const sign = neg && !f.isZero ? '-' : '';
      body = loc.currencyPrefix ? `${sign}${symbol}${f.text}` : `${sign}${f.text}${NBSP}${symbol}`;
      if (unit === symbol || unit.toUpperCase() === code) suffixUnit = '';
      break;
    }
    case 'percent': {
      const p = abs * 100;
      const f = dec === undefined ? fixed(p, 0, 2, loc) : fixed(p, dec, dec, loc);
      body = (neg && !f.isZero ? '-' : '') + f.text + (loc.percentSpace ? NBSP : '') + '%';
      if (unit === '%') suffixUnit = '';
      break;
    }
    default: {
      const f = dec === undefined ? fixed(abs, 0, autoFrac(abs, 2), loc) : fixed(abs, dec, dec, loc);
      body = neg && !f.isZero ? '-' + f.text : f.text;
    }
  }
  // English puts a currency sign in front ("$1,375"), also when it is only given as `unit` of a
  // plain number, so "€347,475.93" and "€1,375" never mix with "1,375 €" within one calc.
  if (suffixUnit && loc.currencyPrefix && (kind === 'number' || kind === 'integer')) {
    const sym = currencySymbolOf(suffixUnit);
    if (sym) return body.startsWith('-') ? `-${sym}${body.slice(1)}` : `${sym}${body}`;
  }
  return suffixUnit ? `${body}${NBSP}${suffixUnit}` : body;
}

/** '€' / 'EUR' -> '€' (only EUR, USD, GBP and their signs); anything else -> undefined. */
export function currencySymbolOf(unit: string): string | undefined {
  const u = unit.trim();
  if (Object.values(SYMBOLS).includes(u)) return u;
  return SYMBOLS[u.toUpperCase()];
}
