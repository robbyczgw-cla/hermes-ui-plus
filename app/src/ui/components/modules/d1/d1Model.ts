/**
 * Pure logic for the `places` and `products` modules (docs/SPEC-modules-v4.md §B): normalising partial
 * (streaming) nodes, rating / price / count formatting, opening-state text, hours table, compare
 * table, category icons, replies and the one-sentence screen-reader labels.
 * No React / RN imports (node:test). Number formatting reuses calc/format.ts (no new Intl APIs).
 */
import { formatValue } from '../../../../calc/format.ts';
import type { TFn } from '../../../../i18n/core.ts';

type Rec = Record<string, unknown>;
export type NumLang = 'de' | 'en' | 'es';

export const MAX_PLACES = 10;
export const MAX_PRODUCTS = 10;
export const MAX_SCORES = 5;
export const MAX_COMPARE = 3;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);
const objs = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter((x): x is Rec => !!x && typeof x === 'object' && !Array.isArray(x)) : []);
const strs = (v: unknown, max = 20): string[] => (Array.isArray(v) ? v.map(str).filter((x): x is string => !!x).slice(0, max) : []);

export function numLang(lang: string): NumLang {
  return lang === 'en' || lang === 'es' ? lang : 'de';
}
const LOCALE: Record<NumLang, string> = { de: 'de-DE', en: 'en-US', es: 'es-ES' };

/* ───────────── numbers ───────────── */

/** Rating with one decimal and the language's separator: 4,6 (de/es) · 4.6 (en). Clamped to 0–5. */
export function formatRating(r: number, lang: NumLang = 'de'): string {
  const v = Math.max(0, Math.min(5, r));
  const s = (Math.round(v * 10) / 10).toFixed(1);
  return lang === 'en' ? s : s.replace('.', ',');
}

/** Star fills (5 entries, each 0 / 0.5 / 1), rating rounded to the nearest half. */
export function starFills(r: number): number[] {
  const h = Math.round(Math.max(0, Math.min(5, r)) * 2) / 2;
  return [0, 1, 2, 3, 4].map((i) => (h >= i + 1 ? 1 : h >= i + 0.5 ? 0.5 : 0));
}

/** Review counts: grouped below 10 000 ("2.345" / "2,345"), compact above ("12,5 Tsd." / "12.5K" / "12,5 mil"). */
export function formatCount(n: number, lang: NumLang = 'de'): string {
  const v = Math.max(0, Math.round(n));
  if (v < 10000) return formatValue(v, { format: 'integer', locale: LOCALE[lang] });
  const big = v >= 1e6;
  const scaled = big ? v / 1e6 : v / 1000;
  const r = scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10;
  const s = lang === 'en' ? String(r) : String(r).replace('.', ',');
  if (lang === 'en') return s + (big ? 'M' : 'K');
  if (lang === 'es') return `${s} ${big ? 'M' : 'mil'}`;
  return `${s} ${big ? 'Mio.' : 'Tsd.'}`;
}

/**
 * Product price via the calc formatter (the app's currency formatting): whole amounts without cents
 * ("349 €", "€349"), otherwise two decimals ("349,99 €"). Unknown ISO codes are shown as the code.
 */
export function formatPrice(price: number, currency: string | undefined, lang: NumLang = 'de'): string {
  const code = (currency && /^[A-Za-z]{3}$/.test(currency.trim()) ? currency.trim() : currency === '€' ? 'EUR' : currency === '$' ? 'USD' : currency === '£' ? 'GBP' : 'EUR').toUpperCase();
  const whole = Math.abs(price - Math.round(price)) < 0.005;
  return formatValue(price, { format: 'currency', currency: code, locale: LOCALE[lang], decimals: whole ? 0 : 2 });
}

/** '€€' / '$$$' / 2 → { level: 2, symbol: '€' }; anything else → null. */
export function priceLevel(v: unknown): { level: number; symbol: string } | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const l = Math.round(v);
    return l >= 1 && l <= 4 ? { level: l, symbol: '€' } : null;
  }
  const s = str(v);
  if (!s) return null;
  const m = /^([€$£¥₩])\1{0,3}$/.exec(s);
  return m ? { level: s.length, symbol: m[1] } : null;
}

/* ───────────── places ───────────── */

export type PlaceItem = {
  key: string;
  name: string;
  category?: string;
  address?: string;
  lat?: number;
  lng?: number;
  rating?: number;
  reviews?: number;
  price?: { level: number; symbol: string };
  openNow?: boolean;
  hours: string[];
  hoursToday?: string;
  phone?: string;
  website?: string;
  imageQuery?: string;
  image?: string;
  distance?: string;
  note?: string;
  tags: string[];
};

export type PlacesModel = {
  title?: string;
  layout: 'carousel' | 'list';
  items: PlaceItem[];
  /** an item is still streaming (render a skeleton card for it) */
  pending: boolean;
  source?: unknown;
  basis?: unknown;
};

const validLat = (v: number | undefined) => (v !== undefined && v >= -90 && v <= 90 ? v : undefined);
const validLng = (v: number | undefined) => (v !== undefined && v >= -180 && v <= 180 ? v : undefined);

function placeOf(p: Rec, i: number, used: Set<string>): PlaceItem | null {
  const name = str(p.name);
  if (!name) return null;
  let key = str(p.id) ?? `p${i}`;
  while (used.has(key)) key += '_';
  used.add(key);
  const lat = validLat(num(p.lat));
  const lng = validLng(num(p.lng));
  const rating = num(p.rating);
  const reviews = num(p.reviews);
  return {
    key,
    name,
    category: str(p.category),
    address: str(p.address),
    ...(lat !== undefined && lng !== undefined ? { lat, lng } : {}),
    rating: rating !== undefined && rating >= 0 && rating <= 5 ? rating : undefined,
    reviews: reviews !== undefined && reviews >= 0 ? Math.round(reviews) : undefined,
    price: priceLevel(p.price) ?? undefined,
    openNow: typeof p.openNow === 'boolean' ? p.openNow : undefined,
    hours: strs(p.hours, 14),
    hoursToday: str(p.hoursToday),
    phone: str(p.phone),
    website: str(p.website),
    imageQuery: str(p.imageQuery),
    image: str(p.image),
    distance: str(p.distance),
    note: str(p.note),
    tags: strs(p.tags, 8),
  };
}

/**
 * While streaming, the stream parser has already dropped the still-open last item (prunePartialItems), so
 * every item that reaches here is complete and is shown; `pending` adds one skeleton card for the next item
 * until the block ends. (Dropping one more here made each list lag by a completed item — GPT review #19.)
 */
export function normalizePlaces(node: unknown, streaming = false): PlacesModel {
  const n = (node && typeof node === 'object' ? node : {}) as Rec;
  const raw = objs(n.places).slice(0, MAX_PLACES);
  const complete = raw;
  const used = new Set<string>();
  const items = complete.map((p, i) => placeOf(p, i, used)).filter((p): p is PlaceItem => !!p);
  return {
    title: str(n.title),
    layout: n.layout === 'list' ? 'list' : 'carousel',
    items,
    pending: streaming && raw.length > 0 && raw.length < MAX_PLACES,
    source: n.source,
    basis: n.basis,
  };
}

/* ── opening hours ── */

type Range = { start: number; end: number; startText: string; endText: string };

const TIME = String.raw`(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?`;
const RANGE_RE = new RegExp(`${TIME}\\s*(?:uhr|h)?\\s*(?:–|-|—|to|bis|a|hasta)\\s*${TIME}\\s*(?:uhr|h)?`, 'gi');

function toMinutes(h: string, m: string | undefined, ap: string | undefined): number {
  let hh = Number(h) % 24;
  const a = ap?.toLowerCase().replace(/\./g, '');
  if (a === 'pm' && hh < 12) hh += 12;
  if (a === 'am' && hh === 12) hh = 0;
  return hh * 60 + (m ? Number(m) : 0);
}
function timeText(h: string, m: string | undefined, ap: string | undefined): string {
  if (ap) return `${Number(h)}${m ? `:${m}` : ''} ${ap.toUpperCase().replace(/\./g, '')}`;
  return `${Number(h)}:${m ?? '00'}`;
}

/** "12:00–15:00, 19–23 Uhr" → ranges in minutes since midnight (end after midnight → +24 h). */
export function parseRanges(s: string): Range[] {
  const out: Range[] = [];
  RANGE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RANGE_RE.exec(s))) {
    const start = toMinutes(m[1], m[2], m[3]);
    let end = toMinutes(m[4], m[5], m[6]);
    if (end <= start) end += 24 * 60;
    out.push({ start, end, startText: timeText(m[1], m[2], m[3]), endText: timeText(m[4], m[5], m[6]) });
  }
  return out;
}

const CLOSED_RE = /\b(geschlossen|ruhetag|closed|cerrado)\b/i;
const OPENS_RE = new RegExp(`(?:öffnet|opens?|abre)\\s*(?:um|at|a las)?\\s*${TIME}`, 'i');

export type OpenKind = 'open' | 'closed' | 'unknown';
export type OpenState = { kind: OpenKind; text: string };

/**
 * "Jetzt geöffnet · bis 23:00" / "Geschlossen · öffnet 19:00" / "Heute 12:00–23:00".
 * `now` = minutes since midnight (picks the matching range of split hours); without it the
 * first opening / last closing time is used. Returns null when nothing is known.
 */
export function openState(p: Pick<PlaceItem, 'openNow' | 'hoursToday'>, tr: TFn, now?: number): OpenState | null {
  // "Heute 9:00–18:00" / "Today …" / "Hoy …": the "today" prefix is ours
  const today = p.hoursToday?.replace(/^\s*(heute|today|hoy)\s*:?\s*/i, '') || undefined;
  const ranges = today ? parseRanges(today) : [];
  const closedToday = !!today && !ranges.length && CLOSED_RE.test(today);
  // "öffnet 9:00" / "opens 9 AM" / "abre a las 9:00"
  const opens = !ranges.length && today ? OPENS_RE.exec(today) : null;
  if (p.openNow === true) {
    let close: Range | undefined;
    if (now !== undefined) close = ranges.find((r) => (now >= r.start && now < r.end) || (now + 1440 >= r.start && now + 1440 < r.end));
    close = close ?? ranges[ranges.length - 1];
    return { kind: 'open', text: close ? tr('ui.places.openUntil', { time: close.endText }) : tr('ui.places.openNow') };
  }
  if (p.openNow === false) {
    if (closedToday) return { kind: 'closed', text: tr('ui.places.closedToday') };
    const next = now !== undefined ? ranges.find((r) => r.start > now) : ranges[0];
    const at = next?.startText ?? (opens ? timeText(opens[1], opens[2], opens[3]) : undefined);
    return { kind: 'closed', text: at ? tr('ui.places.closedOpensAt', { time: at }) : tr('ui.places.closed') };
  }
  if (closedToday) return { kind: 'closed', text: tr('ui.places.closedToday') };
  if (today) return { kind: 'unknown', text: ranges.length ? tr('ui.places.hoursToday', { hours: today }) : today };
  return null;
}

/* ── weekly hours table ── */

// longest prefixes first ("dom" before "do", "mar" = Tuesday in Spanish)
const DAY_PREFIXES: [string, number][] = [
  ['sonntag', 0], ['montag', 1], ['dienstag', 2], ['mittwoch', 3], ['donnerstag', 4], ['freitag', 5], ['samstag', 6],
  ['sunday', 0], ['monday', 1], ['tuesday', 2], ['wednesday', 3], ['thursday', 4], ['friday', 5], ['saturday', 6],
  ['domingo', 0], ['lunes', 1], ['martes', 2], ['miércoles', 3], ['miercoles', 3], ['jueves', 4], ['viernes', 5], ['sábado', 6], ['sabado', 6],
  ['dom', 0], ['lun', 1], ['mar', 2], ['mié', 3], ['mie', 3], ['jue', 4], ['vie', 5], ['sáb', 6], ['sab', 6],
  ['sun', 0], ['mon', 1], ['tue', 2], ['wed', 3], ['thu', 4], ['fri', 5], ['sat', 6],
  ['so', 0], ['mo', 1], ['di', 2], ['mi', 3], ['do', 4], ['fr', 5], ['sa', 6], ['lu', 1], ['ma', 2], ['ju', 4], ['vi', 5],
];

export function weekdayOf(label: string): number | null {
  const l = label.trim().toLowerCase().replace(/\.$/, '');
  if (/[-–]/.test(l)) return null; // "Mo–Fr" covers several days
  for (const [p, d] of DAY_PREFIXES) if (l === p || (l.startsWith(p) && p.length >= 3)) return d;
  return null;
}

export type HoursRow = { day: string; hours: string; weekday: number | null; days: number[] };

function dayRange(label: string): number[] {
  const parts = label.split(/\s*[-–]\s*/);
  if (parts.length !== 2) {
    const d = weekdayOf(label);
    return d === null ? [] : [d];
  }
  const a = weekdayOf(parts[0]);
  const b = weekdayOf(parts[1]);
  if (a === null || b === null) return [];
  const out: number[] = [];
  // week runs Mon (1) … Sun (0 → 7)
  const A = a === 0 ? 7 : a;
  const B = b === 0 ? 7 : b;
  for (let d = A; d <= (B >= A ? B : B + 7); d++) out.push(d % 7);
  return out;
}

/** "Mo: 12:00–23:00" / "Mo–Fr 9–18 Uhr" / "Sonntag geschlossen" → label + hours (+ which weekdays it covers). */
export function parseHoursLines(lines: string[]): HoursRow[] {
  return lines.map((line) => {
    const m = /^\s*([A-Za-zÀ-ÿ]{2,12}\.?(?:\s*[-–]\s*[A-Za-zÀ-ÿ]{2,12}\.?)?)\s*[:\s]\s*(.+)$/.exec(line);
    if (!m) return { day: '', hours: line.trim(), weekday: null, days: [] };
    const days = dayRange(m[1].replace(/\./g, ''));
    if (!days.length) return { day: '', hours: line.trim(), weekday: null, days: [] };
    return { day: m[1].trim(), hours: m[2].trim(), weekday: days.length === 1 ? days[0] : null, days };
  });
}

/* ── categories / icons ── */

export type PlaceKind = 'food' | 'cafe' | 'bar' | 'hotel' | 'sight' | 'park' | 'shop' | 'health' | 'pin';

const PLACE_KINDS: [PlaceKind, RegExp][] = [
  ['cafe', /caf[eé]|kaffee|coffee|bäcker|backer|bakery|panader|gelat|eis(diele|café)?\b|pastic|konditor|tea\b|tee/i],
  ['bar', /\bbar\b|pub\b|wein|wine|vino|enoteca|cocktail|brauerei|brewery|cervecer|beer|bier|taverne?\b/i],
  ['food', /restaurant|ristorante|restaurante|trattoria|osteria|pizzer|bistro|essen|food|küche|kitchen|cocina|taberna|tapas|sushi|burger|imbiss|steak|grill|diner|brasserie|ramen|curry|kebab|mensa|comida/i],
  ['hotel', /hotel|hostel|b&b|bnb|pension|unterkunft|lodg|alojamiento|apartment|ferienwohnung|resort|gasthof/i],
  ['sight', /museum|museo|galerie|gallery|kirche|church|iglesia|basilica|basilika|dom\b|cathedral|kathedrale|catedral|monument|denkmal|sehenswürd|sight|castle|schloss|burg|castillo|palast|palace|palacio|ruin|tempel|temple|forum|kolosseum|colosseum|theater|theatre|teatro|plaza|platz/i],
  ['park', /park|garten|garden|jard[ií]n|strand|beach|playa|natur|nature|wald|forest|see\b|lake|lago|berg|mountain|aussicht|viewpoint|mirador/i],
  ['health', /apotheke|pharmac|farmacia|arzt|doctor|médico|medico|hospital|klinik|clinic|zahnarzt|dentist/i],
  ['shop', /shop|store|laden|geschäft|tienda|markt|market|mercado|supermarkt|boutique|mall|kaufhaus|buchhandlung|bookstore/i],
];

export function placeKind(category: string | undefined, name = ''): PlaceKind {
  const s = `${category ?? ''} ${category ? '' : name}`;
  for (const [k, re] of PLACE_KINDS) if (re.test(s)) return k;
  return 'pin';
}

/* ── actions / text ── */

/** Phone for the `call` action: optional leading "+", digits only (3–15 digits), else null. */
export function cleanPhone(p: string | undefined): string | null {
  if (!p) return null;
  const plus = p.trim().startsWith('+') || p.trim().startsWith('00');
  let digits = p.replace(/\D/g, '');
  if (p.trim().startsWith('00')) digits = digits.slice(2);
  if (digits.length < 3 || digits.length > 15) return null;
  return (plus ? '+' : '') + digits;
}

/** "example.com" → "https://example.com"; only http(s); null for anything else. */
export function cleanUrl(u: string | undefined): string | null {
  if (!u) return null;
  const s = u.trim();
  if (/^https?:\/\/[^\s/]+\.[^\s]+/i.test(s)) return s;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s)) return `https://${s}`;
  return null;
}

/** Display domain of a website ("www.roscioli.com/x" → "roscioli.com"). */
export function urlHost(u: string): string {
  return u.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0];
}

/** "Trattoria · €€ · 0,8 km" (only known parts). */
export function placeMeta(p: PlaceItem): string {
  return [p.category, p.price ? p.price.symbol.repeat(p.price.level) : undefined, p.distance].filter(Boolean).join(' · ');
}

/** Text for the `add_to_list` item ("Roscioli – Via dei Giubbonari 21"). */
export function placeListItem(p: PlaceItem): string {
  return p.address ? `${p.name} – ${p.address}` : p.name;
}

export function ratingA11y(rating: number | undefined, reviews: number | undefined, tr: TFn, lang: NumLang): string | undefined {
  if (rating === undefined) return undefined;
  const r = formatRating(rating, lang);
  return reviews !== undefined ? tr('ui.places.ratingCountA11y', { rating: r, n: reviews, count: formatCount(reviews, lang) }) : tr('ui.places.ratingA11y', { rating: r });
}

const sentence = (parts: (string | undefined | false)[]) =>
  parts
    .filter((x): x is string => !!x)
    .map((s) => s.trim().replace(/[.。]+$/, ''))
    .join('. ') + '.';

/** One screen-reader sentence per card: name, kind, price, distance, rating, open state, note. */
export function placeA11y(p: PlaceItem, tr: TFn, lang: NumLang, now?: number): string {
  const meta = [p.category, p.price ? tr('ui.places.priceA11y', { level: p.price.level }) : undefined, p.distance ? tr('ui.places.distanceA11y', { distance: p.distance }) : undefined]
    .filter(Boolean)
    .join(', ');
  return sentence([p.name, meta, ratingA11y(p.rating, p.reviews, tr, lang), openState(p, tr, now)?.text, p.note]);
}

/** Markers for the existing `map` renderer (only places with coordinates). */
export function placesMapNode(id: string, items: PlaceItem[], title?: string): Rec | null {
  const markers = items
    .filter((p) => p.lat !== undefined && p.lng !== undefined)
    .map((p) => ({ lat: p.lat as number, lng: p.lng as number, title: p.name, ...(p.address || p.category ? { description: [p.category, p.address].filter(Boolean).join(' · ') } : {}), ...(p.imageQuery ? { imageQuery: p.imageQuery } : {}) }));
  if (!markers.length) return null;
  return { type: 'map', id, ...(title ? { title } : {}), markers, ...(markers.length === 1 ? { zoom: 16 } : {}) };
}

/* ───────────── products ───────────── */

export type Spec = { label: string; value: string };
export type Score = { label: string; value: number };
/** `priceText`: the model sent a display string instead of a number ("ab 349 €") */
export type Offer = { merchant: string; price?: number; priceText?: string; url: string };

export type ProductItem = {
  key: string;
  name: string;
  brand?: string;
  imageQuery?: string;
  image?: string;
  price?: number;
  currency?: string;
  priceNote?: string;
  rating?: number;
  reviews?: number;
  badge?: string;
  /** one-line verdict (ranked lists) */
  verdict?: string;
  /** category scores 0–10 */
  scores: Score[];
  specs: Spec[];
  pros: string[];
  cons: string[];
  offers: Offer[];
  url?: string;
};

export type ProductsModel = {
  title?: string;
  layout: 'carousel' | 'grid';
  items: ProductItem[];
  pending: boolean;
  compare: boolean;
  /** ranked top list → numbered rows */
  ranked: boolean;
  source?: unknown;
  basis?: unknown;
};

function productOf(p: Rec, i: number, used: Set<string>): ProductItem | null {
  const name = str(p.name);
  if (!name) return null;
  let key = str(p.id) ?? `p${i}`;
  while (used.has(key)) key += '_';
  used.add(key);
  const price = num(p.price);
  const rating = num(p.rating);
  const reviews = num(p.reviews);
  const specs = objs(p.specs)
    // label '' = value-only spec (model sent plain strings; see protocol normProductSpecs)
    .map((s) => ({ label: str(s.label) ?? '', value: typeof s.value === 'number' ? String(s.value) : str(s.value) }))
    .filter((s): s is Spec => !!s.value)
    .slice(0, 6);
  const offers: Offer[] = [];
  for (const o of objs(p.offers)) {
    const merchant = str(o.merchant);
    const url = cleanUrl(str(o.url));
    if (!merchant || !url) continue;
    const op = num(o.price);
    const priceText = op === undefined ? str(o.price) : undefined;
    offers.push({ merchant, url, ...(op !== undefined && op >= 0 ? { price: op } : {}), ...(priceText ? { priceText } : {}) });
    if (offers.length >= 4) break;
  }
  const scoreSrc: [unknown, unknown][] = Array.isArray(p.scores) ? objs(p.scores).map((x) => [x.label, x.value]) : p.scores && typeof p.scores === 'object' ? Object.entries(p.scores as Rec) : [];
  const scores: Score[] = [];
  for (const [l, v] of scoreSrc) {
    const label = str(l);
    const value = num(v);
    if (label && value !== undefined) scores.push({ label, value: Math.round(Math.max(0, Math.min(10, value)) * 10) / 10 });
    if (scores.length >= MAX_SCORES) break;
  }
  return {
    key,
    name,
    brand: str(p.brand),
    verdict: str(p.verdict),
    scores,
    imageQuery: str(p.imageQuery),
    image: str(p.image),
    price: price !== undefined && price >= 0 ? price : undefined,
    currency: str(p.currency),
    priceNote: str(p.priceNote),
    rating: rating !== undefined && rating >= 0 && rating <= 5 ? rating : undefined,
    reviews: reviews !== undefined && reviews >= 0 ? Math.round(reviews) : undefined,
    badge: str(p.badge),
    specs,
    pros: strs(p.pros, 8),
    cons: strs(p.cons, 8),
    offers,
    url: cleanUrl(str(p.url)) ?? undefined,
  };
}

export function normalizeProducts(node: unknown, streaming = false): ProductsModel {
  const n = (node && typeof node === 'object' ? node : {}) as Rec;
  const raw = objs(n.products).slice(0, MAX_PRODUCTS);
  const complete = raw;
  const used = new Set<string>();
  const items = complete.map((p, i) => productOf(p, i, used)).filter((p): p is ProductItem => !!p);
  return {
    title: str(n.title),
    layout: n.layout === 'grid' ? 'grid' : 'carousel',
    items,
    pending: streaming && raw.length > 0 && raw.length < MAX_PRODUCTS,
    compare: n.compare !== false,
    ranked: n.ranked === true,
    source: n.source,
    basis: n.basis,
  };
}

/** Where "Zum Shop" goes: the product url, else the cheapest offer, else the first offer. */
export function shopTarget(p: ProductItem): Offer | { merchant?: undefined; url: string } | null {
  if (p.url) return { url: p.url };
  return cheapestOffer(p) ?? p.offers[0] ?? null;
}

export function cheapestOffer(p: ProductItem): Offer | null {
  let best: Offer | null = null;
  for (const o of p.offers) if (o.price !== undefined && (!best || best.price === undefined || o.price < best.price)) best = o;
  return best;
}

/** Product price display: own price, else "ab <cheapest offer>" (`from` = true). */
export function displayPrice(p: ProductItem): { price: number; from: boolean } | null {
  if (p.price !== undefined) return { price: p.price, from: false };
  const c = cheapestOffer(p);
  return c && c.price !== undefined ? { price: c.price, from: p.offers.filter((o) => o.price !== undefined).length > 1 } : null;
}

export function productA11y(p: ProductItem, tr: TFn, lang: NumLang, rank?: number): string {
  const dp = displayPrice(p);
  const price = dp ? (dp.from ? tr('ui.products.from', { price: formatPrice(dp.price, p.currency, lang) }) : formatPrice(dp.price, p.currency, lang)) : undefined;
  const name = p.brand && !p.name.toLowerCase().startsWith(p.brand.toLowerCase()) ? `${p.brand} ${p.name}` : p.name;
  return sentence([
    rank !== undefined ? tr('ui.products.rankA11y', { n: rank, name }) : name,
    p.badge,
    price && p.priceNote ? `${price}, ${p.priceNote}` : price ?? p.priceNote,
    ratingA11y(p.rating, p.reviews, tr, lang),
    p.verdict,
    p.scores.map((s) => tr('ui.products.scoreA11y', { label: s.label, value: formatScore(s.value, lang) })).join(', ') || undefined,
    rank === undefined ? p.specs.slice(0, 3).map((s) => (s.label ? `${s.label}: ${s.value}` : s.value)).join(', ') || undefined : undefined,
  ]);
}

/** Category score: up to one decimal, trailing ",0" dropped ("9", "7,5" / "7.5"). */
export function formatScore(v: number, lang: NumLang = 'de'): string {
  const s = String(Math.round(Math.max(0, Math.min(10, v)) * 10) / 10);
  return lang === 'en' ? s : s.replace('.', ',');
}

/** "Ergonomie 9 · 2D 8 · 3D 7" */
export function scoresLine(scores: Score[], lang: NumLang = 'de'): string {
  return scores.map((s) => `${s.label} ${formatScore(s.value, lang)}`).join(' · ');
}

export type ProductKind = 'headphones' | 'gamepad' | 'phone' | 'laptop' | 'watch' | 'camera' | 'screen' | 'box';

const PRODUCT_KINDS: [ProductKind, RegExp][] = [
  ['gamepad', /handheld|konsole|console|consola|game\s?boy|nintendo|switch\b|steam deck|playstation|xbox|retroid|anbernic|miyoo|\bayn\b|odin|powkiddy|ayaneo|controller|gamepad|mando/i],
  ['headphones', /kopfhörer|headphone|headset|earbud|ear\s?buds|in-ear|over-ear|auricular|airpods|buds\b|wh-1000|qc\s?ultra|quietcomfort/i],
  ['watch', /watch|uhr\b|smartwatch|reloj|fitness.?tracker|band\b/i],
  ['phone', /smartphone|iphone|galaxy s|pixel \d|handy|móvil|movil|phone\b|teléfono/i],
  ['laptop', /laptop|notebook|macbook|portátil|portatil|ultrabook|chromebook|thinkpad/i],
  ['camera', /kamera|camera|cámara|camara|dslr|spiegelreflex|objektiv|lens\b|gopro/i],
  ['screen', /fernseher|\btv\b|monitor|display|bildschirm|televisor|oled|beamer|projector|tablet|ipad/i],
];

export function productKind(name: string, brand = ''): ProductKind {
  const s = `${brand} ${name}`;
  for (const [k, re] of PRODUCT_KINDS) if (re.test(s)) return k;
  return 'box';
}

/** Toggle a product in the compare selection (max 3). `full` = the add was refused. */
export function toggleCompare(sel: string[], key: string, max = MAX_COMPARE): { sel: string[]; full: boolean } {
  if (sel.includes(key)) return { sel: sel.filter((k) => k !== key), full: false };
  if (sel.length >= max) return { sel, full: true };
  return { sel: [...sel, key], full: false };
}

/** `[products:<id>] Favorit: <name>` (the readable part in the active language). */
export function productReply(id: string, p: ProductItem, tr: TFn): string {
  const name = p.brand && !p.name.toLowerCase().startsWith(p.brand.toLowerCase()) ? `${p.brand} ${p.name}` : p.name;
  return `[products:${id.replace(/\s+/g, ' ').trim() || 'products'}] ${tr('ui.products.takeReply', { name: name.replace(/\s+/g, ' ').trim() })}`;
}

/* ── compare table ── */

export type CompareRow = {
  key: string;
  label: string;
  cells: (string | null)[];
  /** column indices holding the best value (price: lowest, rating: highest; specs: none) */
  best: number[];
  /** values differ between the columns (missing counts as different) */
  differs: boolean;
};
export type CompareTable = { columns: { key: string; name: string; brand?: string }[]; rows: CompareRow[] };

const labelKey = (s: string) => s.toLowerCase().replace(/[:：]\s*$/, '').replace(/\s+/g, ' ').trim();
const normVal = (s: string | null) => (s === null ? null : s.toLowerCase().replace(/\s+/g, ' ').trim());

function bestIdx(values: (number | undefined)[], dir: 'min' | 'max'): number[] {
  const known = values.filter((v): v is number => v !== undefined);
  if (known.length < 2) return [];
  const target = dir === 'min' ? Math.min(...known) : Math.max(...known);
  if (known.every((v) => v === target)) return [];
  return values.map((v, i) => (v === target ? i : -1)).filter((i) => i >= 0);
}

/**
 * Side-by-side table for 2–3 picks: price (lowest marked best), rating (highest marked best), then the
 * union of spec labels (case-insensitive, first-seen order). Rows nobody has are omitted.
 */
export function buildCompareTable(items: ProductItem[], labels: { price: string; rating: string }, lang: NumLang = 'de'): CompareTable {
  const columns = items.map((p) => ({ key: p.key, name: p.name, ...(p.brand ? { brand: p.brand } : {}) }));
  const rows: CompareRow[] = [];
  const prices = items.map((p) => displayPrice(p)?.price);
  if (prices.some((v) => v !== undefined)) {
    const cells = items.map((p, i) => (prices[i] === undefined ? null : formatPrice(prices[i] as number, p.currency, lang)));
    const sameCurrency = new Set(items.filter((_, i) => prices[i] !== undefined).map((p) => (p.currency ?? 'EUR').toUpperCase())).size <= 1;
    rows.push({ key: 'price', label: labels.price, cells, best: sameCurrency ? bestIdx(prices, 'min') : [], differs: new Set(cells).size > 1 });
  }
  const ratings = items.map((p) => p.rating);
  if (ratings.some((v) => v !== undefined)) {
    const cells = ratings.map((r) => (r === undefined ? null : `${formatRating(r, lang)} ★`));
    rows.push({ key: 'rating', label: labels.rating, cells, best: bestIdx(ratings, 'max'), differs: new Set(cells).size > 1 });
  }
  const order: string[] = [];
  const names = new Map<string, string>();
  for (const p of items)
    for (const s of p.specs) {
      if (!s.label) continue; // value-only specs have no comparable row
      const k = labelKey(s.label);
      if (!names.has(k)) {
        names.set(k, s.label.replace(/[:：]\s*$/, ''));
        order.push(k);
      }
    }
  for (const k of order) {
    const cells = items.map((p) => p.specs.find((s) => labelKey(s.label) === k)?.value ?? null);
    rows.push({ key: `spec:${k}`, label: names.get(k) as string, cells, best: [], differs: new Set(cells.map(normVal)).size > 1 });
  }
  return { columns, rows };
}
