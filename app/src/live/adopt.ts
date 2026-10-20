/**
 * "Als Live-Karte weiterführen" (design §15): a plain checklist from earlier in the chat becomes a live card. Its
 * current state (with this device's ticks) is the card's first version; items get readable, stable ids from their
 * text (`milch`, `brot-vom-baecker`) instead of the plain list's index ids. Pure.
 */
import type { HuiChecklistKind } from '../protocol/types.ts';
import { hashItemId, type LiveCardState, type LiveItem } from './model.ts';

const slug = (s: string): string =>
  s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '');

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** ids the validator made up for a node without one (`checklist-seg-3`): no name for a card */
const GENERATED_ID_RE = /^(?:(?:checklist|products|agenda|tabs)-(?:seg-|n)?[\d.]*$|md-tasks-)/;

/**
 * A card id for a list the user adopts: the list's own id as a slug (Hermes' `einkaufsliste_samstag` →
 * `einkaufsliste-samstag`, so its next plain list with that id continues the card), else one from the title; never a
 * taken one.
 */
export function adoptId(want: string | undefined, title: string | undefined, taken: ReadonlySet<string>): string {
  const w = want && !GENERATED_ID_RE.test(want) ? slug(want) : '';
  const base = w && SLUG_RE.test(w) ? w : slug(title ?? '') || 'liste';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

export interface PlainItem {
  text: string;
  qty?: number | string;
  unit?: string;
  category?: string;
  note?: string;
  checked?: boolean;
}

export function adoptChecklist(input: { title?: string; kind?: HuiChecklistKind; groupBy?: 'category' | 'none'; items: readonly PlainItem[] }): LiveCardState {
  const used = new Set<string>();
  const items: LiveItem[] = [];
  for (const it of input.items) {
    const text = String(it.text ?? '').trim();
    if (!text) continue;
    const base = slug(text) || hashItemId(text);
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    const o: LiveItem = { id, text };
    if (it.qty !== undefined && it.qty !== null && String(it.qty) !== '') o.qty = it.qty;
    if (it.unit) o.unit = it.unit;
    if (it.category) o.category = it.category;
    if (it.note) o.note = it.note;
    if (it.checked) o.checked = true;
    items.push(o);
  }
  return { ...(input.title ? { title: input.title } : {}), ...(input.kind ? { kind: input.kind } : {}), ...(input.groupBy ? { groupBy: input.groupBy } : {}), items };
}

/** A readable title from a model's id when the list has none: `einkaufsliste_samstag` → "Einkaufsliste Samstag". */
export function titleFromId(id: string | undefined): string | undefined {
  if (!id || GENERATED_ID_RE.test(id)) return undefined;
  const words = id.split(/[-_.\s]+/).filter((w) => w && !/^\d+$/.test(w));
  if (!words.length || words.join('').length < 3) return undefined;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
