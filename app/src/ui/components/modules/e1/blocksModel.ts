/**
 * `blocks` – architecture / building-block diagram: 1–3 columns (variants) of boxes in a small grid,
 * each column with an optional full-width shared base layer, plus a muted caption. Pure model
 * (node:test): reads a raw or normalized node through the protocol validator (one source of truth
 * for aliases and caps), picks the default grid, decides the responsive layout (columns side by side
 * or stacked, boxes per row) and builds the accessibility labels and theme color keys.
 */
import { normalizeNode } from '../../../../protocol/validate.ts';
import type { HuiBasis, HuiBlockStyle, HuiPathIcon, HuiPathTone } from '../../../types';

export type BlockBoxModel = { label: string; sub?: string; icon?: HuiPathIcon; style: HuiBlockStyle; tone: HuiPathTone };
export type BlockBaseModel = { label: string; sub?: string; icon?: HuiPathIcon };
export type BlockColumnModel = { key: string; title?: string; grid: 1 | 2 | 3; items: BlockBoxModel[]; base?: BlockBaseModel };
export type BlocksModel = { title?: string; columns: BlockColumnModel[]; caption?: string; basis?: HuiBasis; source?: string };

type Rec = Record<string, unknown>;

/** Boxes per row when the node names none: 1 for one box, 3 for exactly 3 or 9 boxes, else 2. */
export function defaultGrid(count: number): 1 | 2 | 3 {
  if (count <= 1) return 1;
  if (count === 3 || count === 9) return 3;
  return 2;
}

/** Model of a (possibly partial / un-normalized) blocks node. Never throws; garbage → no columns. */
export function readBlocks(node: unknown): BlocksModel {
  const raw = node && typeof node === 'object' && !Array.isArray(node) ? (node as Rec) : {};
  const n = normalizeNode({ ...raw, type: 'blocks' }) as Rec | null;
  const cols = Array.isArray(n?.columns) ? (n!.columns as Rec[]) : [];
  return {
    title: typeof n?.title === 'string' ? n.title : undefined,
    columns: cols.map((c, i) => {
      const items = ((c.items as Rec[]) ?? []).map((it) => ({
        label: String(it.label),
        sub: typeof it.sub === 'string' ? it.sub : undefined,
        icon: it.icon as HuiPathIcon | undefined,
        style: it.style === 'framed' ? 'framed' : 'soft',
        tone: (it.tone as HuiPathTone | undefined) ?? 'neutral',
      })) as BlockBoxModel[];
      return {
        key: `c${i}`,
        title: typeof c.title === 'string' ? c.title : undefined,
        grid: (c.grid as 1 | 2 | 3 | undefined) ?? defaultGrid(items.length),
        items,
        base: c.base as BlockBaseModel | undefined,
      };
    }),
    caption: typeof n?.caption === 'string' ? n.caption : undefined,
    basis: n?.basis as HuiBasis | undefined,
    source: typeof n?.source === 'string' ? n.source : undefined,
  };
}

/** Smallest box width (dp at font scale 1): a 3-grid drops to 2 (and 2 to 1) below it. */
export const BLOCK_MIN_BOX = 90;
/** Smallest column width (dp at font scale 1) for columns side by side; below it they stack (phone). */
export const BLOCK_MIN_COLUMN = 200;
/** Gap between boxes / between side-by-side columns (dp). */
export const BLOCK_GAP = 8;
export const BLOCK_COLUMN_GAP = 16;

/** App font size × OS font scale, clamped to 1..1.6 (larger text needs wider boxes, never narrower). */
export function layoutScale(appScale: number, osScale: number): number {
  const s = (Number.isFinite(appScale) && appScale > 0 ? appScale : 1) * (Number.isFinite(osScale) && osScale > 0 ? osScale : 1);
  return Math.min(1.6, Math.max(1, s));
}

export type BlocksLayout = {
  /** columns in one row (tablet / desktop) instead of stacked (phone) */
  sideBySide: boolean;
  /** width of one column (0 = not measured yet) */
  columnWidth: number;
  /** boxes per row, per column */
  perRow: number[];
  /** width of one box per column (0 = not measured yet → flex) */
  boxWidth: number[];
};

/**
 * Responsive layout for the measured content width: columns side by side only when every column
 * gets ≥ BLOCK_MIN_COLUMN × scale, else stacked; inside a column the grid shrinks (3 → 2 → 1) while
 * a box would be narrower than BLOCK_MIN_BOX × scale. Width 0 (not measured) → stacked, grid as given.
 */
export function blocksLayout(width: number, columns: readonly Pick<BlockColumnModel, 'grid' | 'items'>[], scale = 1): BlocksLayout {
  const n = columns.length;
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const s = layoutScale(scale, 1);
  const sideBySide = w > 0 && n > 1 && (w - BLOCK_COLUMN_GAP * (n - 1)) / n >= BLOCK_MIN_COLUMN * s;
  const columnWidth = w === 0 ? 0 : sideBySide ? (w - BLOCK_COLUMN_GAP * (n - 1)) / n : w;
  const perRow: number[] = [];
  const boxWidth: number[] = [];
  for (const c of columns) {
    let k = Math.max(1, Math.min(c.grid, c.items.length || 1));
    if (columnWidth > 0) while (k > 1 && (columnWidth - BLOCK_GAP * (k - 1)) / k < BLOCK_MIN_BOX * s) k--;
    perRow.push(k);
    boxWidth.push(columnWidth > 0 ? Math.floor((columnWidth - BLOCK_GAP * (k - 1)) / k) : 0);
  }
  return { sideBySide, columnWidth, perRow, boxWidth };
}

/** Boxes split into rows of `perRow` (the last row may be shorter; the renderer centres it). */
export function rowsOf<T>(items: readonly T[], perRow: number): T[][] {
  const k = Math.max(1, Math.floor(perRow) || 1);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += k) out.push(items.slice(i, i + k));
  return out;
}

/** What the screen reader reads for one box / the base: "Agent 1, Kernel 1". */
export function boxA11yLabel(box: { label: string; sub?: string }): string {
  return box.sub ? `${box.label}, ${box.sub}` : box.label;
}

type BgKey = 'surfaceAlt' | 'surfacePressed' | 'successSoft' | 'warningSoft' | 'dangerSoft';
type FgKey = 'muted' | 'success' | 'warning' | 'danger';
type BorderKey = 'borderStrong' | 'success' | 'warning' | 'danger';

/**
 * Theme color keys of a box. soft = filled (neutral grey; in dark themes the stronger surfacePressed,
 * surfaceAlt is barely lighter than the card there), tone tints for good / warn / bad; framed =
 * transparent with an outline in the tone color. `icon` is the glyph color.
 */
export function boxColorKeys(style: HuiBlockStyle, tone: HuiPathTone, dark: boolean): { bg: BgKey | null; border: BorderKey | null; icon: FgKey } {
  const icon: FgKey = tone === 'good' ? 'success' : tone === 'warn' ? 'warning' : tone === 'bad' ? 'danger' : 'muted';
  if (style === 'framed') return { bg: null, border: tone === 'neutral' ? 'borderStrong' : (icon as BorderKey), icon };
  const bg: BgKey = tone === 'good' ? 'successSoft' : tone === 'warn' ? 'warningSoft' : tone === 'bad' ? 'dangerSoft' : dark ? 'surfacePressed' : 'surfaceAlt';
  return { bg, border: null, icon };
}
