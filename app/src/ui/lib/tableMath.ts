/** Table header sizing helpers (pure, tested). */

const HEAD_CHAR_PX = 8; // caption, weight 600 (slightly wider than body average)
const CELL_PADDING_PX = 28; // horizontal cell padding (2 x spacing.m, rounded up)
const SORT_ARROW_PX = 16; // 12 px chevron + 4 px gap, always reserved so the width never jumps on sort

export function longestWordLength(label: string): number {
  return label.split(/\s+/).reduce((m, w) => Math.max(m, [...w].length), 0);
}

/**
 * Smallest header-cell width in which no word of `label` breaks mid-word (incl. sort arrow). `fontScale` is the
 * system font scale (Android/iOS accessibility setting): glyphs grow with it, padding and arrow do not.
 */
export function headerMinWidth(label: string, fontScale = 1): number {
  return Math.ceil(longestWordLength(label) * HEAD_CHAR_PX * normScale(fontScale)) + CELL_PADDING_PX + SORT_ARROW_PX;
}

/** a smaller-than-default font really needs less room: only a non-finite or ≤ 0 scale falls back to 1 */
function normScale(fontScale: number): number {
  return Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
}

/** `prev` when it holds the same values as `next` (same length, `===` per item), else `next` */
export function keepArrayIdentity<T>(prev: readonly T[] | undefined, next: T[]): T[] {
  if (!prev || prev.length !== next.length) return next;
  for (let i = 0; i < next.length; i++) if (prev[i] !== next[i]) return next;
  return prev as T[];
}

/** Share of non-empty cells that must parse as numbers for a column to count as numeric. */
export const NUMERIC_COLUMN_SHARE = 0.8;

type SortCell = string | number | null | undefined;

function cellString(c: SortCell): string {
  return c === null || c === undefined ? '' : String(c);
}

/**
 * Column-consistent comparator: a mostly numeric column sorts by parsed value (cells without a
 * number go last, in both directions), any other column by locale string. Never mixes the two
 * per pair, so the order stays transitive.
 */
export function sortTableRows<R extends SortCell[]>(
  rows: R[],
  col: number,
  dir: 1 | -1,
  numericCol: boolean,
  locale: string,
  parse: (v: unknown) => number | undefined,
): R[] {
  const keyed = rows.map((r, i) => ({ r, i, n: numericCol ? parse(r[col]) : undefined, s: cellString(r[col]) }));
  keyed.sort((a, b) => {
    if (numericCol) {
      if (a.n === undefined && b.n === undefined) return a.i - b.i;
      if (a.n === undefined) return 1;
      if (b.n === undefined) return -1;
      if (a.n !== b.n) return (a.n - b.n) * dir;
      return a.i - b.i;
    }
    // empty cells last
    if (!a.s && b.s) return 1;
    if (a.s && !b.s) return -1;
    return a.s.localeCompare(b.s, locale) * dir || a.i - b.i;
  });
  return keyed.map((k) => k.r);
}

/** Smallest width of a numeric cell that never clips its text (tabular digits, padding included). */
export function numericCellMinWidth(texts: string[], fontScale = 1): number {
  const longest = texts.reduce((m, t) => Math.max(m, [...t].length), 0);
  return Math.ceil(longest * 8.2 * normScale(fontScale)) + CELL_PADDING_PX;
}

/** Tables up to this many rows are never collapsed ("Alle N zeigen" for two hidden rows is silly, UX7). */
export const TABLE_COLLAPSE_ABOVE = 10;
/** Rows shown while a longer table is collapsed (hides at least 3). */
export const TABLE_COLLAPSED_ROWS = 8;

/** Rows to show for a table with `total` rows (collapsed unless `expanded`). */
export function visibleTableRows(total: number, expanded: boolean): number {
  return expanded || total <= TABLE_COLLAPSE_ABOVE ? total : TABLE_COLLAPSED_ROWS;
}

export type ScrollEdges = { scrolled: boolean; atEnd: boolean };

/**
 * Edge state of a horizontally scrolled table (left shadow / right fade). Only these booleans are kept in
 * React state, so a scroll event re-renders the table only when an edge appears or disappears.
 */
export function scrollEdges(x: number, viewport: number, contentW: number): ScrollEdges {
  return { scrolled: x > 4, atEnd: x + viewport >= contentW - 4 };
}

/** Narrowest a wrapping text column may get in fit-to-width mode at font scale 1 (phone: ~3 short words per line). */
export const TEXT_COLUMN_FIT_MIN = 110;

/**
 * Fit-to-width: when every column fits at its minimum (numbers never clipped, text ≥ TEXT_COLUMN_FIT_MIN and never
 * narrower than its longest header word), the table fills the viewport and text WRAPS instead of scrolling sideways.
 */
export function canFitTable(viewport: number, widths: readonly number[], numeric: readonly boolean[], headers: readonly string[], fontScale = 1): boolean {
  if (viewport <= 0) return false;
  const min = widths.reduce((sum, _w, ci) => sum + fitMinWidth(widths, numeric, headers, ci, fontScale), 0);
  return min <= viewport;
}

/** Minimum width of column `ci` in fit-to-width mode (the cell's `minWidth`; `canFitTable` sums these). */
export function fitMinWidth(widths: readonly number[], numeric: readonly boolean[], headers: readonly string[], ci: number, fontScale = 1): number {
  const w = widths[ci] ?? 0;
  return numeric[ci] ? w : Math.min(w, Math.max(Math.round(TEXT_COLUMN_FIT_MIN * normScale(fontScale)), headerMinWidth(headers[ci] ?? '', fontScale)));
}

/** Below this viewport width a table that cannot fit becomes a stack of row cards instead of a sideways-scrolling grid. */
export const TABLE_CARDS_MAX_VIEWPORT = 520;

export type TableLayoutPref = 'cards' | 'grid' | null;

/**
 * Phone card layout decision: cards only when the grid cannot fit the viewport (`fits` = the table fills
 * the width, text wrapping) and the viewport is narrow. A one-column table has nothing to gain from cards.
 * The user's toggle (`pref`) overrides the default in both directions, but never forces cards where the
 * grid fits or the screen is wide.
 */
export function tableCardMode(viewport: number, fits: boolean, ncols: number, pref: TableLayoutPref): boolean {
  if (viewport <= 0 || viewport >= TABLE_CARDS_MAX_VIEWPORT || fits || ncols < 2) return false;
  return pref !== 'grid';
}

/**
 * How a table renders, decided once from the OUTER width (`viewport`, measured outside any horizontal ScrollView):
 * - `measuring`: no width yet (first frame) – render invisibly, decide after onLayout
 * - `fill`: every column fits at its minimum → plain View (no horizontal ScrollView), cells split the width, text wraps
 * - `cards`: phone and the grid cannot fit → one card per row
 * - `scroll`: wide screen (or the user chose "Als Tabelle") and the grid cannot fit → fixed column widths, sideways scroll
 *
 * `fill` must never be rendered inside a horizontal ScrollView: there the row has no definite width, and Yoga
 * (Android/iOS) ignores `flexBasis: 0` and sizes every cell to its one-line content – the table grows past the
 * screen instead of wrapping (RN-web's CSS flexbox does not, which is why the web check passed).
 */
export type TableLayoutMode = 'measuring' | 'fill' | 'cards' | 'scroll';

export function tableLayoutMode(
  viewport: number,
  widths: readonly number[],
  numeric: readonly boolean[],
  headers: readonly string[],
  pref: TableLayoutPref,
  fontScale = 1,
): TableLayoutMode {
  if (!(viewport > 0)) return 'measuring';
  const totalW = widths.reduce((a, b) => a + b, 0);
  const fits = totalW <= viewport || canFitTable(viewport, widths, numeric, headers, fontScale);
  if (fits) return 'fill';
  return tableCardMode(viewport, false, widths.length, pref) ? 'cards' : 'scroll';
}
