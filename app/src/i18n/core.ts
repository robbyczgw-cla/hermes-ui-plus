// Pure i18n logic (no React / native imports) so it is unit-testable with node:test.
import { brandVars } from '../brand.ts';
import { de } from './de.ts';
// en/es: eager in Node/tests, lazy `import()` in the app bundle (metro.config.js swaps dicts.ts → dicts.app.ts)
import { EAGER_DICTS, importDictionary } from './dicts.ts';

export type Lang = 'de' | 'en' | 'es';
export type LangSetting = 'system' | Lang;
export const LANG_STORAGE_KEY = 'hui.lang';
const BRAND_VARS = brandVars();
const LOCALE_FOR: Record<Lang, string> = { de: 'de-DE', en: 'en-US', es: 'es-ES' };

type Dict = typeof de;
type Paths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];
export type TKey = Paths<Dict>;
export type Vars = Record<string, string | number>;

const loaded: Partial<Record<Lang, Dict>> = { de, ...EAGER_DICTS };
/**
 * Loaded dictionaries. German is always there (source of truth + fallback); in the app en/es appear
 * after `loadDictionary()` (I18nProvider does that before rendering a language). Typed as complete
 * for tests, where all languages are loaded eagerly.
 */
export const dictionaries = loaded as Record<Lang, Dict>;

export function hasDictionary(lang: Lang): boolean {
  return !!loaded[lang];
}

const pending: Partial<Record<Lang, Promise<void>>> = {};

/** Load a language's dictionary (no-op when loaded). Rejections are retried on the next call. */
export function loadDictionary(lang: Lang): Promise<void> {
  if (loaded[lang] || lang === 'de') return Promise.resolve();
  return (pending[lang] ??= importDictionary(lang).then(
    (d) => {
      loaded[lang] = d;
    },
    (e: unknown) => {
      delete pending[lang];
      throw e;
    },
  ));
}

export function isLangSetting(v: unknown): v is LangSetting {
  return v === 'system' || v === 'de' || v === 'en' || v === 'es';
}

/** Resolve the setting + device locale tags (e.g. ['de-AT','en-US']) to a language and BCP47 tag. */
export function resolveLocale(
  setting: LangSetting,
  deviceTags: readonly string[] = [],
): { lang: Lang; locale: string } {
  if (setting === 'system') {
    for (const tag of deviceTags) {
      const lang = tag.toLowerCase().split(/[-_]/)[0];
      if (lang === 'de' || lang === 'en' || lang === 'es') return { lang, locale: tag.replace('_', '-') };
    }
    return { lang: 'en', locale: 'en-US' };
  }
  return { lang: setting, locale: LOCALE_FOR[setting] };
}

function lookup(dict: Dict, key: string): string | undefined {
  let cur: unknown = dict;
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object' && part in cur) cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return typeof cur === 'string' ? cur : undefined;
}

/** Read a balanced {...} group starting at s[i]==='{'; returns [inner, indexAfter]. */
function readBraces(s: string, i: number): [string, number] {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1];
  }
  return [s.slice(i + 1), s.length];
}

/**
 * Interpolate `{name}` and `{count, plural, =0 {..} one {..} other {..}}` (`#` = formatted count).
 * Unknown variables are left as `{name}`.
 */
export function interpolate(template: string, vars: Vars | undefined, locale: string): string {
  let out = '';
  let i = 0;
  while (i < template.length) {
    const ch = template[i];
    if (ch !== '{') {
      out += ch;
      i++;
      continue;
    }
    const [inner, next] = readBraces(template, i);
    i = next;
    const m = /^\s*(\w+)\s*(?:,\s*plural\s*,([\s\S]*))?$/.exec(inner);
    if (!m) {
      out += `{${inner}}`;
      continue;
    }
    const [, name, body] = m;
    const v = vars?.[name];
    if (v === undefined) {
      out += `{${inner}}`;
    } else if (body === undefined) {
      out += String(v);
    } else {
      out += pluralize(body, Number(v), locale, vars);
    }
  }
  return out;
}

// Hermes (React Native's engine on Android/iOS) ships Intl.NumberFormat/DateTimeFormat but NOT
// Intl.PluralRules or Intl.RelativeTimeFormat — `new Intl.PluralRules()` throws
// "undefined cannot be used as a constructor". Feature-detect and fall back for de/en.
const HAS_PLURAL_RULES = typeof Intl !== 'undefined' && typeof (Intl as { PluralRules?: unknown }).PluralRules === 'function';
const HAS_RELATIVE_TIME = typeof Intl !== 'undefined' && typeof (Intl as { RelativeTimeFormat?: unknown }).RelativeTimeFormat === 'function';

/** CLDR plural category; de/en only need one/other (integers: 1 → one). */
export function pluralCategory(locale: string, n: number, hasIntl = HAS_PLURAL_RULES): string {
  if (hasIntl) {
    try {
      // hermes-compat-ok: guarded by HAS_PLURAL_RULES + try, de/en fallback below
      return new Intl.PluralRules(locale).select(n);
    } catch {
      /* fall through */
    }
  }
  return n === 1 ? 'one' : 'other';
}

function pluralize(body: string, n: number, locale: string, vars: Vars | undefined): string {
  const forms: Record<string, string> = {};
  let i = 0;
  while (i < body.length) {
    const sel = /^\s*(=\d+|\w+)\s*\{/.exec(body.slice(i));
    if (!sel) break;
    const bracePos = i + sel[0].length - 1;
    const [text, next] = readBraces(body, bracePos);
    forms[sel[1]] = text;
    i = next;
  }
  const cat = pluralCategory(locale, n);
  const chosen = forms[`=${n}`] ?? forms[cat] ?? forms.other ?? '';
  const num = numberFormat(locale).format(n);
  return interpolate(chosen.replace(/#/g, num), vars, locale);
}

export type TFn = (key: TKey, vars?: Vars) => string;

/**
 * Build a translate function. Missing key in `lang` (or `lang` not loaded yet) falls back to German,
 * then to the key itself. {app} {appShort} {bridge} {scheme} (brand.ts) are always available.
 */
export function makeT(lang: Lang, locale: string): TFn {
  return (key, vars) => {
    const dict = loaded[lang];
    const raw = (dict ? lookup(dict, key) : undefined) ?? lookup(de, key) ?? key;
    return interpolate(raw, vars ? { ...BRAND_VARS, ...vars } : BRAND_VARS, locale);
  };
}

// Intl formatters are expensive to construct (Hermes on Android: JNI), cheap to reuse → cache per
// (locale, options). Options objects are small literals; keyed by their JSON.
const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const FORMAT_CACHE_MAX = 64;

function cached<F>(map: Map<string, F>, key: string, make: () => F): F {
  let f = map.get(key);
  if (!f) {
    if (map.size >= FORMAT_CACHE_MAX) map.clear();
    f = make();
    map.set(key, f);
  }
  return f;
}

/** Cached `Intl.NumberFormat` for (locale, opts). */
export function numberFormat(locale: string, opts?: Intl.NumberFormatOptions): Intl.NumberFormat {
  return cached(numberFormats, opts ? `${locale}|${JSON.stringify(opts)}` : locale, () => new Intl.NumberFormat(locale, opts));
}

/** Cached `Intl.DateTimeFormat` for (locale, opts). */
export function dateTimeFormat(locale: string, opts?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return cached(dateFormats, opts ? `${locale}|${JSON.stringify(opts)}` : locale, () => new Intl.DateTimeFormat(locale, opts));
}

export function formatNumber(locale: string, n: number, opts?: Intl.NumberFormatOptions): string {
  return numberFormat(locale, opts).format(n);
}

export function formatDate(
  locale: string,
  d: Date | number,
  opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
): string {
  return dateTimeFormat(locale, opts).format(d);
}

/** Relative time ("vor 5 Minuten" / "5 minutes ago"); picks the largest fitting unit. */
export function formatRelative(locale: string, d: Date | number, now: Date | number = Date.now()): string {
  const diffSec = Math.round((+d - +now) / 1000);
  const abs = Math.abs(diffSec);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400],
    ['hour', 3600], ['minute', 60], ['second', 1],
  ];
  for (const [unit, secs] of units) {
    if (abs >= secs || unit === 'second') {
      const value = Math.trunc(diffSec / secs);
      if (HAS_RELATIVE_TIME) {
        try {
          // hermes-compat-ok: guarded by HAS_RELATIVE_TIME + try, relativeFallback below
          return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(value, unit);
        } catch {
          /* fall through */
        }
      }
      return relativeFallback(locale, value, unit);
    }
  }
  return '';
}

const REL_UNITS: Record<'de' | 'en' | 'es', Record<string, [string, string]>> = {
  es: { year: ['año', 'años'], month: ['mes', 'meses'], week: ['semana', 'semanas'], day: ['día', 'días'], hour: ['hora', 'horas'], minute: ['minuto', 'minutos'], second: ['segundo', 'segundos'] },
  de: { year: ['Jahr', 'Jahren'], month: ['Monat', 'Monaten'], week: ['Woche', 'Wochen'], day: ['Tag', 'Tagen'], hour: ['Stunde', 'Stunden'], minute: ['Minute', 'Minuten'], second: ['Sekunde', 'Sekunden'] },
  en: { year: ['year', 'years'], month: ['month', 'months'], week: ['week', 'weeks'], day: ['day', 'days'], hour: ['hour', 'hours'], minute: ['minute', 'minutes'], second: ['second', 'seconds'] },
};

/** Minimal "vor 5 Minuten" / "in 2 days" for engines without Intl.RelativeTimeFormat. */
export function relativeFallback(locale: string, value: number, unit: string): string {
  const lang: 'de' | 'en' | 'es' = locale.toLowerCase().startsWith('de') ? 'de' : locale.toLowerCase().startsWith('es') ? 'es' : 'en';
  if (value === 0) {
    const today = unit === 'day';
    return { de: today ? 'heute' : 'jetzt', en: today ? 'today' : 'now', es: today ? 'hoy' : 'ahora' }[lang];
  }
  const n = Math.abs(value);
  const forms = REL_UNITS[lang][unit] ?? [unit, unit];
  const word = n === 1 ? forms[0] : forms[1];
  if (lang === 'de') return value < 0 ? `vor ${n} ${word}` : `in ${n} ${word}`; // dative plural: "vor 2 Tagen"
  if (lang === 'es') return value < 0 ? `hace ${n} ${word}` : `en ${n} ${word}`;
  return value < 0 ? `${n} ${word} ago` : `in ${n} ${word}`;
}

/**
 * Web: keep `<html lang>` in step with the UI language. The exported index.html carries the build default (`de`), so an
 * English UI was announced as German (browser "translate from German?" prompt, screen reader voice). No-op off the web.
 */
export function applyDocumentLang(doc: { documentElement?: { lang: string } | null } | undefined, lang: string): void {
  const el = doc?.documentElement;
  if (el && el.lang !== lang) el.lang = lang;
}
