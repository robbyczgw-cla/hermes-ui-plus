/**
 * Watchlist cards (design §13 #3, mockup 06): pure helpers for the open card, the receipts and the tray. Products are
 * items with a `price` (Hermes'), the user's wish price `target`, `checked` = bought and `hidden` = off the list.
 * The price history is read from the card's own versions (design §7: no extra storage). No React.
 */
import type { ItemChange, LiveCard, LiveCardState, LiveItem } from './model.ts';

/** Most points the sparkline takes (the newest ones). */
export const MAX_SERIES = 60;

const isPrice = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * A product's price over the card's Hermes versions (where the prices come from; the user's batches never change
 * them), oldest first, one point per version that lists it with a price.
 */
export function priceSeries(card: LiveCard, id: string): number[] {
  const out: number[] = [];
  for (const v of card.versions) {
    if (v.author !== 'hermes') continue;
    const p = v.state.items.find((it) => it.id === id)?.price;
    if (isPrice(p)) out.push(p);
  }
  return out.slice(-MAX_SERIES);
}

/** Price change since the product's first price in this card (v1 for the products Hermes started with). */
export function priceDelta(card: LiveCard, id: string, current: number | undefined): number | undefined {
  if (!isPrice(current)) return undefined;
  const first = priceSeries(card, id)[0];
  return isPrice(first) ? Math.round((current - first) * 100) / 100 : undefined;
}

/** At or under the wish price. */
export function underTarget(it: Pick<LiveItem, 'price' | 'target'>): boolean {
  return isPrice(it.price) && isPrice(it.target) && it.price <= it.target;
}

export interface WatchCounts {
  /** products on the list (not hidden) */
  shown: number;
  hidden: number;
  /** shown products at or under their wish price, not bought yet */
  under: number;
  bought: number;
}

export function watchCounts(state: LiveCardState): WatchCounts {
  const c: WatchCounts = { shown: 0, hidden: 0, under: 0, bought: 0 };
  for (const it of state.items) {
    if (it.hidden) {
      c.hidden++;
      continue;
    }
    c.shown++;
    if (it.checked) c.bought++;
    else if (underTarget(it)) c.under++;
  }
  return c;
}

/** Time of the newest Hermes version (when the prices were checked), or undefined. */
export function pricesAt(card: LiveCard): number | undefined {
  for (let i = card.versions.length - 1; i >= 0; i--) if (card.versions[i].author === 'hermes') return card.versions[i].at;
  return undefined;
}

/** Wish price as the user typed it ("249", "249,90 €") → number; empty → null (clear); junk → undefined. */
export function parsePriceInput(s: string): number | null | undefined {
  const v = s.replace(/[€$£\s]/g, '').replace(/^(\d{1,3}(?:\.\d{3})+)(,\d{1,2})?$/, (_m, a: string, b?: string) => a.replace(/\./g, '') + (b ?? '')).replace(',', '.');
  if (!v) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return undefined;
  const n = Number(v);
  return n > 0 && n < 1e7 ? n : undefined;
}

/** One receipt / history line's right side: "269 € → 239 €", a wish price, or a flag the line words itself. */
export interface WatchLineDetail {
  before?: string;
  after?: string;
  flag?: 'target' | 'hidden' | 'shown';
}

export function watchChangeDetail(c: ItemChange, price: (n: number, currency?: string) => string): WatchLineDetail {
  const cur = c.item.currency;
  const fmt = (v: unknown) => (isPrice(v) ? price(v, cur) : '');
  if (c.kind !== 'changed') return isPrice(c.item.price) ? { after: price(c.item.price, cur) } : {};
  const f = c.fields ?? {};
  if (f.price) return { before: fmt(f.price[0]), after: fmt(f.price[1]) };
  if (f.target) return { before: fmt(f.target[0]), after: fmt(f.target[1]), flag: 'target' };
  if (f.hidden) return { flag: f.hidden[1] ? 'hidden' : 'shown' };
  for (const k of ['text', 'brand', 'priceNote', 'badge', 'verdict'] as const) {
    const v = f[k];
    if (v) return { before: v[0] === undefined || v[0] === null ? '' : String(v[0]), after: v[1] === undefined || v[1] === null ? '' : String(v[1]) };
  }
  return {};
}
