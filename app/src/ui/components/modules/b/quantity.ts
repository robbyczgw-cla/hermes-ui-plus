/**
 * Recipe quantity scaling (pure, no RN imports – tested with node:test).
 *
 *   scaleQuantity(200, 'g', 1.5)   → { qty: 300, unit: 'g', text: '300 g' }
 *   scaleQuantity(1, 'EL', 0.75)   → { qty: 0.75, unit: 'EL', text: '¾ EL' }
 *   scaleQuantity(800, 'g', 2)     → { qty: 1.6, unit: 'kg', text: '1,6 kg' }
 *   scaleQuantity(1, 'Prise', 3)   → { qty: 2, unit: 'Prisen', text: '2 Prisen' }   (sub-linear)
 *
 * Rules (German kitchen conventions):
 *  - mass/volume (g, kg, ml, cl, l): "kitchen" rounding (1 g steps < 10, 5 g < 100, 10 g < 1000),
 *    1000 g → kg / 1000 ml → l, < 1 kg → g, < 0,1 l → ml; litres show ¼ ½ ¾ when close.
 *  - spoons and cups (EL, TL, Tasse, Becher, cup): nearest ¼ or ⅓ as a fraction, min ¼.
 *  - countables (no unit, Stück, Zehe, Dose, Bund, Scheibe …): nearest ½ below 3, whole numbers
 *    above; never 0 (min ½, or 1 for things that cannot be halved such as Ei / Dose / Packung).
 *  - Prise / Msp. / Spritzer: scale sub-linearly (sqrt) and round to whole, min 1.
 *  - unknown units: 2 significant decimals, shown as decimal with German comma.
 */

import type { Lang } from '../../../../i18n/core.ts';

export type UnitKind = 'mass' | 'volume' | 'spoon' | 'pinch' | 'count' | 'other';

type UnitDef = { canonical: string; kind: UnitKind; /** factor to base unit (g or ml) */ base?: number; plural?: string; indivisible?: boolean };

const UNITS: Record<string, UnitDef> = {
  g: { canonical: 'g', kind: 'mass', base: 1 },
  gr: { canonical: 'g', kind: 'mass', base: 1 },
  gramm: { canonical: 'g', kind: 'mass', base: 1 },
  kg: { canonical: 'kg', kind: 'mass', base: 1000 },
  kilo: { canonical: 'kg', kind: 'mass', base: 1000 },
  kilogramm: { canonical: 'kg', kind: 'mass', base: 1000 },
  ml: { canonical: 'ml', kind: 'volume', base: 1 },
  milliliter: { canonical: 'ml', kind: 'volume', base: 1 },
  cl: { canonical: 'cl', kind: 'volume', base: 10 },
  dl: { canonical: 'dl', kind: 'volume', base: 100 },
  l: { canonical: 'l', kind: 'volume', base: 1000 },
  liter: { canonical: 'l', kind: 'volume', base: 1000 },
  el: { canonical: 'EL', kind: 'spoon' },
  'esslöffel': { canonical: 'EL', kind: 'spoon' },
  tl: { canonical: 'TL', kind: 'spoon' },
  'teelöffel': { canonical: 'TL', kind: 'spoon' },
  tasse: { canonical: 'Tasse', kind: 'spoon', plural: 'Tassen' },
  tassen: { canonical: 'Tasse', kind: 'spoon', plural: 'Tassen' },
  becher: { canonical: 'Becher', kind: 'spoon' },
  cup: { canonical: 'cup', kind: 'spoon', plural: 'cups' },
  cups: { canonical: 'cup', kind: 'spoon', plural: 'cups' },
  prise: { canonical: 'Prise', kind: 'pinch', plural: 'Prisen' },
  prisen: { canonical: 'Prise', kind: 'pinch', plural: 'Prisen' },
  msp: { canonical: 'Msp.', kind: 'pinch' },
  'msp.': { canonical: 'Msp.', kind: 'pinch' },
  messerspitze: { canonical: 'Msp.', kind: 'pinch' },
  spritzer: { canonical: 'Spritzer', kind: 'pinch' },
  schuss: { canonical: 'Schuss', kind: 'pinch' },
  'stück': { canonical: 'Stück', kind: 'count' },
  stk: { canonical: 'Stück', kind: 'count' },
  'stk.': { canonical: 'Stück', kind: 'count' },
  zehe: { canonical: 'Zehe', kind: 'count', plural: 'Zehen' },
  zehen: { canonical: 'Zehe', kind: 'count', plural: 'Zehen' },
  dose: { canonical: 'Dose', kind: 'count', plural: 'Dosen', indivisible: true },
  dosen: { canonical: 'Dose', kind: 'count', plural: 'Dosen', indivisible: true },
  bund: { canonical: 'Bund', kind: 'count' },
  scheibe: { canonical: 'Scheibe', kind: 'count', plural: 'Scheiben' },
  scheiben: { canonical: 'Scheibe', kind: 'count', plural: 'Scheiben' },
  zweig: { canonical: 'Zweig', kind: 'count', plural: 'Zweige' },
  zweige: { canonical: 'Zweig', kind: 'count', plural: 'Zweige' },
  blatt: { canonical: 'Blatt', kind: 'count' },
  'blätter': { canonical: 'Blatt', kind: 'count' },
  pck: { canonical: 'Pck.', kind: 'count', indivisible: true },
  'pck.': { canonical: 'Pck.', kind: 'count', indivisible: true },
  packung: { canonical: 'Packung', kind: 'count', plural: 'Packungen', indivisible: true },
  packungen: { canonical: 'Packung', kind: 'count', plural: 'Packungen', indivisible: true },
  'würfel': { canonical: 'Würfel', kind: 'count' },
  knolle: { canonical: 'Knolle', kind: 'count', plural: 'Knollen' },
  stange: { canonical: 'Stange', kind: 'count', plural: 'Stangen' },
  stangen: { canonical: 'Stange', kind: 'count', plural: 'Stangen' },
  handvoll: { canonical: 'Handvoll', kind: 'count' },
  // Spanish input aliases (mapped to the internal German canonical units)
  gramo: { canonical: 'g', kind: 'mass', base: 1 },
  gramos: { canonical: 'g', kind: 'mass', base: 1 },
  kilogramo: { canonical: 'kg', kind: 'mass', base: 1000 },
  litro: { canonical: 'l', kind: 'volume', base: 1000 },
  litros: { canonical: 'l', kind: 'volume', base: 1000 },
  mililitro: { canonical: 'ml', kind: 'volume', base: 1 },
  mililitros: { canonical: 'ml', kind: 'volume', base: 1 },
  cda: { canonical: 'EL', kind: 'spoon' },
  'cda.': { canonical: 'EL', kind: 'spoon' },
  cucharada: { canonical: 'EL', kind: 'spoon' },
  cucharadas: { canonical: 'EL', kind: 'spoon' },
  cdta: { canonical: 'TL', kind: 'spoon' },
  'cdta.': { canonical: 'TL', kind: 'spoon' },
  cucharadita: { canonical: 'TL', kind: 'spoon' },
  cucharaditas: { canonical: 'TL', kind: 'spoon' },
  taza: { canonical: 'Tasse', kind: 'spoon', plural: 'Tassen' },
  tazas: { canonical: 'Tasse', kind: 'spoon', plural: 'Tassen' },
  pizca: { canonical: 'Prise', kind: 'pinch', plural: 'Prisen' },
  pizcas: { canonical: 'Prise', kind: 'pinch', plural: 'Prisen' },
  diente: { canonical: 'Zehe', kind: 'count', plural: 'Zehen' },
  dientes: { canonical: 'Zehe', kind: 'count', plural: 'Zehen' },
  lata: { canonical: 'Dose', kind: 'count', plural: 'Dosen', indivisible: true },
  latas: { canonical: 'Dose', kind: 'count', plural: 'Dosen', indivisible: true },
  rodaja: { canonical: 'Scheibe', kind: 'count', plural: 'Scheiben' },
  rodajas: { canonical: 'Scheibe', kind: 'count', plural: 'Scheiben' },
  rama: { canonical: 'Zweig', kind: 'count', plural: 'Zweige' },
  ramas: { canonical: 'Zweig', kind: 'count', plural: 'Zweige' },
  paquete: { canonical: 'Packung', kind: 'count', plural: 'Packungen', indivisible: true },
  paquetes: { canonical: 'Packung', kind: 'count', plural: 'Packungen', indivisible: true },
  ud: { canonical: 'Stück', kind: 'count' },
  'ud.': { canonical: 'Stück', kind: 'count' },
  unidad: { canonical: 'Stück', kind: 'count' },
  unidades: { canonical: 'Stück', kind: 'count' },
  'puñado': { canonical: 'Handvoll', kind: 'count' },
};

/** Items that cannot sensibly be halved when they appear without a unit ("2 Eier"). */
const INDIVISIBLE_ITEMS = /^(ei|eier|eigelb|eiweiß|dotter|huevos?|yemas?|claras?)(?![\p{L}])/iu;

export function unitInfo(unit: string | undefined): UnitDef & { known: boolean } {
  const u = (unit ?? '').trim();
  if (!u) return { canonical: '', kind: 'count', known: true };
  const def = UNITS[u.toLowerCase()];
  if (def) return { ...def, known: true };
  return { canonical: u, kind: 'other', known: false };
}

/* ───────────── number formatting ───────────── */

const FRACTIONS: [number, string][] = [
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [1 / 2, '½'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
];

/** Display language of quantities: German kitchen conventions (default) or English separators/units. */
export type QLang = Lang;

const ES_UNITS: Record<string, string> = {
  EL: 'cda.', TL: 'cdta.', Prise: 'pizca', Prisen: 'pizcas', 'Msp.': 'pizca', Spritzer: 'chorrito', Schuss: 'chorro',
  Tasse: 'taza', Tassen: 'tazas', Becher: 'vaso', cup: 'taza', cups: 'tazas', 'Stück': 'ud.', Zehe: 'diente', Zehen: 'dientes',
  Dose: 'lata', Dosen: 'latas', Bund: 'manojo', Scheibe: 'rodaja', Scheiben: 'rodajas', Zweig: 'rama', Zweige: 'ramas',
  Blatt: 'hoja', 'Pck.': 'paq.', Packung: 'paquete', Packungen: 'paquetes', 'Würfel': 'cubito', Knolle: 'bulbo', Knollen: 'bulbos',
  Stange: 'tallo', Stangen: 'tallos', Handvoll: 'puñado',
};

/** Unit label shown in the UI: EL/TL become tbsp/tsp in English; everything else stays as authored. */
export function displayUnit(unit: string, lang: QLang = 'de'): string {
  if (lang === 'es') {
    const es = ES_UNITS[unit];
    if (es) return es;
  }
  if (lang === 'en') {
    if (unit === 'EL') return 'tbsp';
    if (unit === 'TL') return 'tsp';
  }
  return unit;
}

/** Decimal, max `decimals`, trailing zeros trimmed, thousands separator (German 1.234,5 / English 1,234.5). */
export function formatDecimal(n: number, decimals = 2, lang: QLang = 'de'): string {
  if (!Number.isFinite(n)) return '–';
  const neg = n < 0;
  const [i, f = ''] = Math.abs(n).toFixed(decimals).split('.');
  const frac = f.replace(/0+$/, '');
  const en = lang === 'en';
  const int = lang === 'es' && i.length < 5 ? i : i.replace(/\B(?=(\d{3})+(?!\d))/g, en ? ',' : '.');
  return (neg ? '-' : '') + int + (frac ? (en ? '.' : ',') + frac : '');
}

/** Snap to the nearest whole + {0, ¼, ⅓, ½, ⅔, ¾}. `allowThirds=false` uses quarters only. */
export function snapFraction(n: number, allowThirds = true): number {
  if (!(n > 0)) return 0;
  const whole = Math.floor(n);
  const rest = n - whole;
  const cands = allowThirds ? [0, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1] : [0, 1 / 4, 1 / 2, 3 / 4, 1];
  let best = 0;
  for (const c of cands) if (Math.abs(rest - c) < Math.abs(rest - best)) best = c;
  return whole + best;
}

/** 1.5 → "1 ½", 0.25 → "¼", 2 → "2", 1.2 → "1,2" (no fraction glyph matches). */
export function formatFraction(n: number, lang: QLang = 'de'): string {
  if (!Number.isFinite(n)) return '–';
  const whole = Math.floor(n + 1e-9);
  const rest = n - whole;
  if (rest < 1e-6) return formatDecimal(whole, 0, lang);
  for (const [v, glyph] of FRACTIONS) {
    if (Math.abs(rest - v) < 0.01) return whole ? `${formatDecimal(whole, 0, lang)} ${glyph}` : glyph;
  }
  return formatDecimal(n, 2, lang);
}

/* ───────────── scaling ───────────── */

export type ScaledQuantity = {
  /** Rounded quantity in `unit` (null if the ingredient has no quantity: "Salz nach Geschmack"). */
  qty: number | null;
  /** Display unit, possibly converted (g → kg) or pluralised (Prise → Prisen). */
  unit: string;
  /** "1 ½ EL", "300 g", "" when no quantity and no unit. */
  text: string;
};

function roundMetric(base: number): number {
  // base = grams or millilitres
  if (base < 1) return Math.round(base * 10) / 10 || 0.1;
  if (base < 10) return Math.round(base);
  if (base < 100) return Math.round(base / 5) * 5;
  if (base < 1000) return Math.round(base / 10) * 10;
  return Math.round(base / 50) * 50;
}

function scaleMetric(qty: number, def: UnitDef, lang: QLang): { qty: number; unit: string; text: string } {
  const isMass = def.kind === 'mass';
  const base = qty * (def.base ?? 1);
  const rounded = roundMetric(base);
  if (rounded >= 1000) {
    const big = rounded / 1000;
    const unit = isMass ? 'kg' : 'l';
    if (!isMass) {
      const snapped = snapFraction(big, false);
      if (Math.abs(snapped - big) < 0.02 && snapped !== Math.floor(snapped)) return { qty: snapped, unit, text: `${formatFraction(snapped, lang)} ${unit}` };
    }
    return { qty: big, unit, text: `${formatDecimal(big, 2, lang)} ${unit}` };
  }
  // keep the author's bigger unit for nice litre fractions (¼ l, ½ l, ¾ l)
  if (!isMass && def.canonical === 'l' && rounded >= 100) {
    const l = rounded / 1000;
    const snapped = snapFraction(l, false);
    if (snapped > 0 && Math.abs(snapped - l) < 0.02) return { qty: snapped, unit: 'l', text: `${formatFraction(snapped, lang)} l` };
  }
  const unit = isMass ? 'g' : 'ml';
  return { qty: rounded, unit, text: `${formatDecimal(rounded, 1, lang)} ${unit}` };
}

function plural(def: UnitDef, qty: number): string {
  return qty > 1 && def.plural ? def.plural : def.canonical;
}

/**
 * Scales one ingredient quantity by `factor` (= new servings / original servings).
 * `item` is only used to detect indivisible countables ("Eier").
 */
export function scaleQuantity(qty: number | null | undefined, unit: string | undefined, factor: number, item = '', lang: QLang = 'de'): ScaledQuantity {
  const def = unitInfo(unit);
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  if (typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0) {
    const u = displayUnit(def.canonical, lang);
    return { qty: null, unit: u, text: u };
  }
  const raw = qty * f;
  switch (def.kind) {
    case 'mass':
    case 'volume':
      return scaleMetric(raw, def, lang);
    case 'spoon': {
      const v = Math.max(0.25, snapFraction(raw));
      const u = displayUnit(plural(def, v), lang);
      return { qty: v, unit: u, text: `${formatFraction(v, lang)} ${u}` };
    }
    case 'pinch': {
      // seasoning does not scale linearly
      const v = Math.max(1, Math.round(qty * Math.sqrt(f)));
      const u = displayUnit(plural(def, v), lang);
      return { qty: v, unit: u, text: `${v} ${u}` };
    }
    case 'count': {
      const indivisible = def.indivisible || (!def.canonical && INDIVISIBLE_ITEMS.test(item.trim()));
      let v: number;
      if (indivisible) v = Math.max(1, Math.round(raw));
      else if (raw < 3) v = Math.max(0.5, Math.round(raw * 2) / 2);
      else v = Math.round(raw);
      // an author's quarter/third (¼ Bund) survives when not scaled
      if (f === 1) v = raw;
      const u = displayUnit(plural(def, v), lang);
      const num = formatFraction(v, lang);
      return { qty: v, unit: u, text: u ? `${num} ${u}` : num };
    }
    default: {
      const v = raw >= 10 ? Math.round(raw) : Math.round(raw * 100) / 100;
      return { qty: v, unit: def.canonical, text: `${formatDecimal(v, 2, lang)} ${def.canonical}` };
    }
  }
}

const EN_ES_PLURAL = /(?:s|x|z|ch|sh)$/i;

/** English plural of the last word ("red pepper" → "red peppers", "berry" → "berries"). */
function englishPlural(item: string): string {
  const m = /^(.*?)([A-Za-z]+)$/.exec(item);
  if (!m) return item;
  const [, head, word] = m;
  if (/[^aeiou]y$/i.test(word)) return `${head}${word.slice(0, -1)}ies`;
  if (/^(?:potato|tomato)$/i.test(word) || EN_ES_PLURAL.test(word)) return `${head}${word}es`;
  return `${head}${word}s`;
}

/**
 * Item name for a scaled countable: the author's `plural` when given, else (English only, unit-less
 * singular → more than one) a regular English plural. Other languages keep the item as written.
 */
export function scaledItem(item: string, qty: number | null | undefined, unit: string | undefined, factor: number, lang: QLang = 'de', pluralForm?: string): string {
  const name = item.trim();
  if (typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0) return name;
  const def = unitInfo(unit);
  if (def.kind !== 'count' || def.canonical) return name; // "2 Bund Petersilie": the unit carries the plural
  const scaled = scaleQuantity(qty, unit, factor, item, lang).qty ?? qty;
  const many = scaled > 1;
  if (pluralForm?.trim()) return many ? pluralForm.trim() : name;
  if (lang === 'en' && qty <= 1 && many) return englishPlural(name);
  return name;
}

/** "250 g Mehl", "2 Eier", "Salz" – used for the shopping list and the reply text. */
export function ingredientLine(qty: number | null | undefined, unit: string | undefined, item: string, factor: number, lang: QLang = 'de', pluralForm?: string): string {
  const s = scaleQuantity(qty, unit, factor, item, lang);
  const name = scaledItem(item, qty, unit, factor, lang, pluralForm);
  return s.text ? `${s.text} ${name}`.trim() : name;
}

/** Clamp servings to a sane range for the stepper. */
export const MIN_SERVINGS = 1;
export const MAX_SERVINGS = 24;
export function clampServings(n: number): number {
  if (!Number.isFinite(n)) return MIN_SERVINGS;
  return Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, Math.round(n)));
}
