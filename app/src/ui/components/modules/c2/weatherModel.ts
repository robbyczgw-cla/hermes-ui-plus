/**
 * Pure weather helpers (docs/SPEC-modules-v3.md `weather`): tolerant reading, condition → icon
 * layers / i18n key, night variants, °C/°F + km/h/mph conversion, shared min–max scale for the
 * daily range bars, temperature colours. No React / RN imports (node:test).
 */
import { normalizeWeatherCondition, parseClock } from '../../../../protocol/validate.ts';
import type { HuiWeatherCondition } from '../../../../protocol/types.ts';

export type Unit = 'C' | 'F';
export type WCurrent = { temp: number; condition: HuiWeatherCondition; feelsLike?: number; wind?: number; humidity?: number; precip?: number };
export type WHour = { time: string; minutes: number | null; temp: number; condition: HuiWeatherCondition; precip?: number };
export type WDay = { date: string; min: number; max: number; condition: HuiWeatherCondition; precip?: number };
export type WeatherData = { location: string; unit: Unit; current?: WCurrent; hourly: WHour[]; daily: WDay[] };

const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);
const pct = (v: unknown): number | undefined => {
  const n = num(v);
  return n === undefined ? undefined : Math.min(100, Math.max(0, n));
};

const ALIASES: Record<string, HuiWeatherCondition> = {
  sun: 'sunny',
  'partly-cloudy': 'partly',
  partlycloudy: 'partly',
  'mostly-sunny': 'partly',
  'partly-cloudy-night': 'partly-night',
  'night-clear': 'clear-night',
  'night-partly': 'partly-night',
  clouds: 'cloudy',
  'mostly-cloudy': 'cloudy',
  mist: 'fog',
  haze: 'fog',
  thunderstorm: 'thunder',
  storm: 'thunder',
  windy: 'wind',
  'light-rain': 'drizzle',
  'heavy-rain': 'rain',
  'rain-showers': 'showers',
  hail: 'sleet',
};

/** Protocol condition with a few common model aliases; unknown → 'cloudy'. */
export function toCondition(v: unknown): HuiWeatherCondition {
  const s = typeof v === 'string' ? v.trim().toLowerCase().replace(/[_\s]+/g, '-') : '';
  return ALIASES[s] ?? normalizeWeatherCondition(s);
}

export function readWeather(node: Record<string, unknown>): WeatherData {
  const unitRaw = typeof node.unit === 'string' ? node.unit.trim().toUpperCase().replace(/^°/, '') : '';
  const unit: Unit = unitRaw === 'F' ? 'F' : 'C';
  const location = typeof node.location === 'string' ? node.location.trim().slice(0, 100) : '';
  let current: WCurrent | undefined;
  if (isRec(node.current)) {
    const c = node.current;
    const temp = num(c.temp);
    if (temp !== undefined) {
      const wind = num(c.wind);
      current = { temp, condition: toCondition(c.condition), feelsLike: num(c.feelsLike), wind: wind === undefined ? undefined : Math.max(0, wind), humidity: pct(c.humidity), precip: pct(c.precip) };
    }
  }
  const hourly: WHour[] = [];
  if (Array.isArray(node.hourly)) {
    for (const r of node.hourly) {
      if (hourly.length >= 24) break;
      if (!isRec(r) || typeof r.time !== 'string') continue;
      const temp = num(r.temp);
      if (temp === undefined) continue;
      hourly.push({ time: r.time, minutes: parseClock(r.time) ?? null, temp, condition: toCondition(r.condition), precip: pct(r.precip) });
    }
  }
  const daily: WDay[] = [];
  if (Array.isArray(node.daily)) {
    for (const r of node.daily) {
      if (daily.length >= 10) break;
      if (!isRec(r) || typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(r.date)) continue;
      let min = num(r.min);
      let max = num(r.max);
      if (min === undefined || max === undefined) continue;
      if (min > max) [min, max] = [max, min];
      daily.push({ date: r.date.slice(0, 10), min, max, condition: toCondition(r.condition), precip: pct(r.precip) });
    }
  }
  return { location, unit, current, hourly, daily };
}

/* ───────────── units ───────────── */

export function convertTemp(v: number, from: Unit, to: Unit): number {
  if (from === to) return v;
  return to === 'F' ? (v * 9) / 5 + 32 : ((v - 32) * 5) / 9;
}

/** Wind speed: km/h with °C data, mph with °F data (protocol convention). */
export function convertWind(v: number, from: Unit, to: Unit): number {
  if (from === to) return v;
  return to === 'F' ? v / 1.609344 : v * 1.609344;
}

/** "−3°" (typographic minus, no "-0"). */
export function formatTemp(v: number, withUnit?: Unit): string {
  let r = Math.round(v);
  if (Object.is(r, -0)) r = 0;
  const s = r < 0 ? `−${Math.abs(r)}` : String(r);
  return `${s}°${withUnit ?? ''}`;
}

/* ───────────── conditions ───────────── */

export type CloudTone = 'light' | 'dark';
export type Precip = 'drizzle' | 'rain' | 'snow' | 'sleet';
export type ConditionParts = {
  sun?: 'full' | 'small';
  moon?: 'full' | 'small';
  stars?: boolean;
  cloud?: CloudTone;
  /** second, smaller cloud behind (cloudy / overcast) */
  backCloud?: boolean;
  precip?: Precip;
  bolt?: boolean;
  fog?: boolean;
  wind?: boolean;
};

/** Icon layers per condition (the component composes and animates them). */
export function conditionParts(c: HuiWeatherCondition): ConditionParts {
  switch (c) {
    case 'clear':
    case 'sunny':
      return { sun: 'full' };
    case 'clear-night':
      return { moon: 'full', stars: true };
    case 'partly':
      return { sun: 'small', cloud: 'light' };
    case 'partly-night':
      return { moon: 'small', cloud: 'light' };
    case 'cloudy':
      return { cloud: 'light', backCloud: true };
    case 'overcast':
      return { cloud: 'dark', backCloud: true };
    case 'fog':
      return { cloud: 'light', fog: true };
    case 'drizzle':
      return { cloud: 'light', precip: 'drizzle' };
    case 'rain':
      return { cloud: 'dark', precip: 'rain' };
    case 'showers':
      return { sun: 'small', cloud: 'light', precip: 'rain' };
    case 'thunder':
      return { cloud: 'dark', bolt: true, precip: 'drizzle' };
    case 'snow':
      return { cloud: 'light', precip: 'snow' };
    case 'sleet':
      return { cloud: 'light', precip: 'sleet' };
    case 'wind':
      return { wind: true };
    default:
      return { cloud: 'light' };
  }
}

export type ConditionKey =
  | 'clear' | 'sunny' | 'partly' | 'cloudy' | 'overcast' | 'fog' | 'drizzle' | 'rain'
  | 'showers' | 'thunder' | 'snow' | 'sleet' | 'wind' | 'clearNight' | 'partlyNight';

/** i18n key under `ui.weather.cond.*`. */
export function conditionKey(c: HuiWeatherCondition): ConditionKey {
  return c === 'clear-night' ? 'clearNight' : c === 'partly-night' ? 'partlyNight' : c;
}

/** Simple night heuristic for hourly items without explicit night conditions. */
export function isNightHour(hour: number): boolean {
  return hour < 6 || hour >= 21;
}

/** Day conditions → their night variant (and back) for the given time of day. */
export function withDaypart(c: HuiWeatherCondition, night: boolean): HuiWeatherCondition {
  if (night) {
    if (c === 'clear' || c === 'sunny') return 'clear-night';
    if (c === 'partly') return 'partly-night';
    return c;
  }
  if (c === 'clear-night') return 'clear';
  if (c === 'partly-night') return 'partly';
  return c;
}

/** Hourly condition with the night variant applied when the item's clock time is at night. */
export function hourCondition(h: Pick<WHour, 'condition' | 'minutes'>): HuiWeatherCondition {
  if (h.minutes == null) return h.condition;
  return withDaypart(h.condition, isNightHour(Math.floor(h.minutes / 60)));
}

/* ───────────── daily scale ───────────── */

export type TempScale = { lo: number; hi: number };

/** One shared scale for all daily range bars (+ optional extra values such as the current temp). */
export function tempScale(days: readonly Pick<WDay, 'min' | 'max'>[], extra: readonly number[] = [], minSpan = 4): TempScale | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const d of days) {
    lo = Math.min(lo, d.min);
    hi = Math.max(hi, d.max);
  }
  for (const v of extra) {
    if (!Number.isFinite(v)) continue;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  lo = Math.floor(lo);
  hi = Math.ceil(hi);
  if (hi - lo < minSpan) {
    const pad = (minSpan - (hi - lo)) / 2;
    lo = Math.floor(lo - pad);
    hi = Math.ceil(hi + pad);
  }
  return { lo, hi };
}

export function scalePos(v: number, s: TempScale): number {
  const span = s.hi - s.lo;
  if (span <= 0) return 0.5;
  return Math.min(1, Math.max(0, (v - s.lo) / span));
}

/** Range bar geometry as fractions of the track; a minimum width keeps tiny ranges visible. */
export function rangeBar(min: number, max: number, s: TempScale, minWidth = 0.06): { left: number; width: number } {
  let left = scalePos(Math.min(min, max), s);
  let right = scalePos(Math.max(min, max), s);
  if (right - left < minWidth) {
    const mid = (left + right) / 2;
    left = Math.max(0, Math.min(1 - minWidth, mid - minWidth / 2));
    right = left + minWidth;
  }
  return { left, width: right - left };
}

/* ───────────── temperature colours ───────────── */

const STOPS: [number, string][] = [
  [-15, '#6E8BEF'],
  [0, '#4DA8E8'],
  [10, '#3FBFA3'],
  [18, '#E3BE3B'],
  [26, '#F08F3A'],
  [35, '#E0504A'],
];

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Colour for a temperature in °C (cold blue → teal → amber → red), clamped at the ends. */
export function tempColor(celsius: number): string {
  if (!Number.isFinite(celsius)) return STOPS[2][1];
  if (celsius <= STOPS[0][0]) return STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i];
    if (celsius <= t1) {
      const [t0, c0] = STOPS[i - 1];
      const f = (celsius - t0) / (t1 - t0);
      const a = hexToRgb(c0);
      const b = hexToRgb(c1);
      const mixed = a.map((x, k) => Math.round(x + (b[k] - x) * f));
      return `#${mixed.map((x) => x.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
    }
  }
  return STOPS[STOPS.length - 1][1];
}

/* ───────────── labels ───────────── */

/** 'today' | 'tomorrow' | weekday 0–6 (local) for an ISO date relative to `todayIso`. */
export function dayKind(date: string, todayIso: string): 'today' | 'tomorrow' | number {
  if (date === todayIso) return 'today';
  const [y, m, d] = date.split('-').map(Number);
  const [ty, tm, td] = todayIso.split('-').map(Number);
  const a = new Date(y, m - 1, d);
  const b = new Date(ty, tm - 1, td);
  const diff = Math.round((a.getTime() - b.getTime()) / 86400000);
  if (diff === 1) return 'tomorrow';
  return a.getDay();
}

/** Show the precipitation chance only when it matters (≥ 10 %), rounded to 5 % steps like most apps. */
export function precipLabel(p: number | undefined, lang = 'de'): string | null {
  if (p === undefined || p < 10) return null;
  return formatPercent(Math.round(p / 5) * 5, lang);
}

/** "40 %" (de/es, with a narrow no-break space) or "40%" (en). */
export function formatPercent(p: number, lang = 'de'): string {
  return lang === 'en' ? `${Math.round(p)}%` : `${Math.round(p)}\u202F%`;
}
