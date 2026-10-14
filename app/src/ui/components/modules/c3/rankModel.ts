/**
 * `rank` – pure model (docs/SPEC-modules-v3.md): item normalisation, order reconciliation (streaming
 * / persisted order), reorder moves, drag target computation and the reply. node:test-able.
 */
import { oneLine, tag } from './format.ts';

type Rec = Record<string, unknown>;

export const MAX_RANK_ITEMS = 10;

export type RankItem = { key: string; label: string; description?: string };

const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

/** Items with stable keys (explicit id or fallback `i<index>`, duplicates suffixed); ≤ 10. */
export function normalizeRankItems(items: unknown): RankItem[] {
  const out: RankItem[] = [];
  const used = new Set<string>();
  for (const [i, it] of (Array.isArray(items) ? items : []).entries()) {
    const rec = isRec(it) ? it : typeof it === 'string' ? { label: it } : null;
    if (!rec) continue;
    const label = str(rec.label);
    if (!label) continue;
    const raw = str(rec.id);
    let key = raw || `i${i}`;
    let n = 2;
    while (used.has(key)) key = `${raw || `i${i}`}~${n++}`;
    used.add(key);
    const description = str(rec.description);
    out.push({ key, label, ...(description ? { description } : {}) });
    if (out.length >= MAX_RANK_ITEMS) break;
  }
  return out;
}

/** Saved order first (only keys that still exist, no duplicates), then any new keys in node order. */
export function reconcileOrder(saved: readonly string[] | undefined, keys: readonly string[]): string[] {
  const known = new Set(keys);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of saved ?? []) {
    if (known.has(k) && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  for (const k of keys) if (!seen.has(k)) out.push(k);
  return out;
}

/** Move the element at `from` to index `to` (both clamped). Returns a new array. */
export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
  const out = [...arr];
  if (from < 0 || from >= out.length) return out;
  const dest = Math.max(0, Math.min(out.length - 1, to));
  if (dest === from) return out;
  const [x] = out.splice(from, 1);
  out.splice(dest, 0, x);
  return out;
}

/** Move by ±1 (a11y buttons / actions); unchanged at the edges. */
export function stepItem<T>(arr: readonly T[], index: number, dir: -1 | 1): T[] {
  return moveItem(arr, index, index + dir);
}

/** Top offsets for rows of the given heights with a gap between them. */
export function rowTops(heights: readonly number[], gap: number): number[] {
  const tops: number[] = [];
  let y = 0;
  for (const h of heights) {
    tops.push(y);
    y += h + gap;
  }
  return tops;
}

/**
 * Index the dragged row (currently at `from`, rows in display order with `heights`) should land on
 * when its top has moved by `dy`: the slot whose midpoint its centre has crossed.
 */
export function dragTargetIndex(heights: readonly number[], gap: number, from: number, dy: number): number {
  const n = heights.length;
  if (n === 0 || from < 0 || from >= n) return from;
  const tops = rowTops(heights, gap);
  const center = tops[from] + dy + heights[from] / 2;
  let to = from;
  // moving down: pass a row once the centre crosses that row's midpoint
  for (let i = from + 1; i < n; i++) if (center > tops[i] + heights[i] / 2) to = i;
  if (to !== from) return to;
  for (let i = from - 1; i >= 0; i--) if (center < tops[i] + heights[i] / 2) to = i;
  return to;
}

/**
 * Display tops while dragging: rows between `from` and `to` shift by the dragged row's height so a
 * gap opens at `to`. Returns tops indexed like `heights` (current order).
 */
export function previewTops(heights: readonly number[], gap: number, from: number, to: number): number[] {
  const order = moveItem(heights.map((_, i) => i), from, to);
  const tops = rowTops(order.map((i) => heights[i]), gap);
  const out = new Array<number>(heights.length).fill(0);
  order.forEach((orig, pos) => {
    out[orig] = tops[pos];
  });
  return out;
}

/** `[rank:<id>] 1. A · 2. B · 3. C` */
export function rankReply(id: string, labels: readonly string[]): string {
  return `${tag('rank', id)} ${labels.map((l, i) => `${i + 1}. ${oneLine(l)}`).join(' · ')}`;
}
