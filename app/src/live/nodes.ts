/**
 * Live nodes of an answer ↔ the fold's terms (live/model.ts). Three node shapes are live-capable (design §13):
 * - `checklist` → card type `checklist`;
 * - `tabs` whose day tabs hold one `agenda` each (plus an optional `map` tab), or a single `agenda` → `trip`: the
 *   tabs become `days`, the blocks items with their `day`, the map tab the card's `map`;
 * - `products` → `products` (a watchlist).
 * Nodes come validated (protocol/validate.ts keeps `live` only with an explicit slug id and gives live items stable
 * ids). Pure, no React.
 */
import { dayLabelForDate } from './dayLabel.ts';
import type { HuiAgenda, HuiAgendaBlock, HuiChecklist, HuiMap, HuiNode, HuiProduct, HuiProducts, HuiTabs } from '../protocol/types.ts';
import type { FullItem, LiveCardType, LiveDay, LiveFull, LiveMap, LiveMeta } from './model.ts';

export type LiveNodeShape = HuiChecklist | HuiTabs | HuiAgenda | HuiProducts;

/** The card type of a node with `live:true` (undefined: not a live-capable node). */
export function liveTypeOf(node: { type?: unknown; live?: unknown } | null | undefined): LiveCardType | undefined {
  if (!node || node.live !== true) return undefined;
  if (node.type === 'checklist') return 'checklist';
  if (node.type === 'tabs' || node.type === 'agenda') return 'trip';
  if (node.type === 'products') return 'products';
  return undefined;
}

const has = <T>(v: T | undefined | null): v is T => v !== undefined && v !== null;

function blockItem(b: HuiAgendaBlock, day: string): FullItem {
  const it: FullItem = { text: b.title, start: b.start, end: b.end, day };
  if (b.id) it.id = b.id;
  if (b.location) it.location = b.location;
  if (b.kind) it.kind = b.kind;
  if (b.note) it.note = b.note;
  return it;
}

function productItem(p: HuiProduct): FullItem {
  const it: FullItem = { text: p.name };
  if (p.id) it.id = p.id;
  for (const k of ['brand', 'price', 'currency', 'priceNote', 'rating', 'reviews', 'badge', 'verdict', 'image', 'imageQuery', 'url', 'offers', 'specs', 'pros', 'cons', 'scores', 'target'] as const) {
    const v = p[k];
    if (has(v) && !(Array.isArray(v) && !v.length)) (it as Record<string, unknown>)[k] = v;
  }
  return it;
}

function mapOf(m: Partial<HuiMap>): LiveMap | undefined {
  const markers = (m.markers ?? []).map((x) => ({ lat: x.lat, lng: x.lng, title: x.title, ...(x.description ? { description: x.description } : {}), ...(x.number !== undefined ? { number: x.number } : {}) }));
  if (!markers.length) return undefined;
  return { ...(m.title ? { title: m.title } : {}), markers, ...(m.route ? { route: true } : {}) };
}

/** Day id of a tab: its explicit slug, else the agenda's id, else `d<index>` (validate.ts gives tabs of live nodes ids). */
function dayId(tab: { id?: string; children?: HuiNode[] }, agenda: Partial<HuiAgenda> | undefined, i: number): string {
  return tab.id || agenda?.id || `d${i + 1}`;
}

/** A validated live node as a full version, or null. */
export function fullFromNode(node: Partial<LiveNodeShape> | null | undefined): LiveFull | null {
  const type = liveTypeOf(node);
  if (!type || !node || typeof node.id !== 'string' || !node.id) return null;
  const closed = (node as { closed?: boolean }).closed === true;
  const meta: LiveMeta = {};
  const title = (node as { title?: string }).title;
  if (title) meta.title = title;
  if (type === 'checklist') {
    const n = node as Partial<HuiChecklist>;
    if (n.kind) meta.kind = n.kind;
    if (n.groupBy) meta.groupBy = n.groupBy;
    return { type, id: n.id!, meta, items: (n.items ?? []) as FullItem[], ...(closed ? { closed } : {}) };
  }
  if (type === 'products') {
    const n = node as Partial<HuiProducts>;
    if (n.ranked) meta.ranked = true;
    if (n.source) meta.source = n.source;
    if (n.basis) meta.basis = n.basis;
    return { type, id: n.id!, meta, items: (n.products ?? []).map(productItem), ...(closed ? { closed } : {}) };
  }
  // trip
  if (node.type === 'agenda') {
    const a = node as Partial<HuiAgenda>;
    const day: LiveDay = { id: 'd1', label: a.title ?? a.date ?? '', ...(a.date ? { date: a.date } : {}) };
    meta.days = [day];
    return { type, id: a.id!, meta, items: (a.blocks ?? []).map((b) => blockItem(b, day.id)), ...(closed ? { closed } : {}) };
  }
  const t = node as Partial<HuiTabs> & { tabs?: (HuiTabs['tabs'][number] & { id?: string })[] };
  const days: LiveDay[] = [];
  const items: FullItem[] = [];
  (t.tabs ?? []).forEach((tab, i) => {
    const kids = tab.children ?? [];
    const agenda = kids.find((c) => c.type === 'agenda') as Partial<HuiAgenda> | undefined;
    const map = kids.find((c) => c.type === 'map') as Partial<HuiMap> | undefined;
    if (agenda) {
      const id = dayId(tab, agenda, i);
      days.push({ id, label: dayLabelForDate(tab.label, agenda.date), ...(agenda.date ? { date: agenda.date } : {}) });
      for (const b of agenda.blocks ?? []) items.push(blockItem(b, id));
    } else if (map && !meta.map) {
      const m = mapOf(map);
      if (m) meta.map = { ...m, ...(m.title ? {} : tab.label ? { title: tab.label } : {}) };
    }
  });
  if (days.length) meta.days = days;
  return { type, id: t.id!, meta, items, ...(closed ? { closed } : {}) };
}

/**
 * A live-capable node WITHOUT `"live":true` as a full version (the fold decides whether it continues a card, model.ts
 * `continuationOf`), or null. Item ids are dropped: a plain node's ids are positional (`i0`, `b1`) or the model's own
 * for another list; its items match the card's by text. Only trip-shaped tabs (every tab an agenda or a map) count.
 */
export function fullFromPlainNode(node: Partial<LiveNodeShape> | null | undefined): LiveFull | null {
  if (!node || (node as { live?: unknown }).live === true) return null;
  if (node.type === 'tabs') {
    const tabs = (node as Partial<HuiTabs>).tabs ?? [];
    if (!tabs.length || !tabs.every((t) => (t.children ?? []).some((c) => c.type === 'agenda' || c.type === 'map')) || !tabs.some((t) => (t.children ?? []).some((c) => c.type === 'agenda'))) return null;
  }
  const full = fullFromNode({ ...node, id: 'plain', live: true } as Partial<LiveNodeShape>);
  if (!full || !full.items.length) return null;
  return { ...full, id: typeof node.id === 'string' ? node.id : '', items: full.items.map(({ id: _id, ...it }) => it) };
}

/**
 * Cheap pre-check: an answer that may hold a plain live-capable node (checked only in chats with live cards). Models
 * also write the node type as the fence name (```checklist, protocol/streamParser.ts TYPED_FENCE_TYPES): the renderer
 * shows those as components, so the fold must see them too (real-user round 4: the card never moved).
 */
export function mayCarryPlainNode(text: string): boolean {
  if (text.includes('```checklist') || text.includes('```agenda') || text.includes('```products')) return true;
  return text.includes('```hui') && (text.includes('checklist') || text.includes('agenda') || text.includes('products') || text.includes('"tabs"') || text.includes('items'));
}

/** Cheap pre-check so most answers are never parsed for the fold. */
export function mayCarryLiveNode(text: string): boolean {
  return text.includes('"live') && (text.includes('checklist') || text.includes('agenda') || text.includes('products') || text.includes('livePatch'));
}
