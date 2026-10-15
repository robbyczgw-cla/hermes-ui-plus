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

/** Cells up to this many characters never wrap ("Ja", "Mittel", "Robo X1"). */
export const SHORT_CELL_CHARS = 12;
/** Cells with a digit up to this many characters never wrap: numbers, ranges, years, amounts ("c. 1011–1021", "1.299 €"). */
export const NUMERIC_CELL_CHARS = 18;

/**
 * A cell that must stay on one line: short, or a short number / range / date / amount (at most 3 words).
 * Android otherwise breaks such a cell anywhere once the column gets narrow ("c. 1011–1 / 021").
 */
export function isUnbreakableCell(text: string): boolean {
  const s = text.trim();
  const n = [...s].length;
  if (n === 0) return false;
  if (n <= SHORT_CELL_CHARS) return true;
  return n <= NUMERIC_CELL_CHARS && /\d/.test(s) && s.split(/\s+/).length <= 3;
}

/** Characters of `text` that must fit on one line: the whole cell when unbreakable, else its longest word. */
export function unbreakableChars(text: string): number {
  return isUnbreakableCell(text) ? [...text.trim()].length : longestWordLength(text);
}

/**
 * Smallest column width in which no cell breaks inside a number/range or a word (`charPx` = average glyph width at
 * font scale 1, `padding` = horizontal cell padding). Glyphs grow with `fontScale`, padding does not.
 */
export function cellMinWidth(texts: readonly string[], fontScale = 1, charPx = 8, padding = CELL_PADDING_PX): number {
  const chars = texts.reduce((m, t) => Math.max(m, unbreakableChars(t)), 0);
  return chars > 0 ? Math.ceil(chars * charPx * normScale(fontScale)) + padding : 0;
}

/**
 * The same text with its line-break opportunities glued (spaces → no-break space, a dash or slash between word
 * joiners), for unbreakable cells only; a safety net when the width estimate is a little short.
 */
export function keepTogether(text: string): string {
  // links / code / URLs keep their syntax untouched
  if (!isUnbreakableCell(text) || /\]\(|`|:\/\//.test(text)) return text;
  return text.replace(/ /g, '\u00a0').replace(/([–—\-/])/g, '\u2060$1\u2060');
}

/** Markdown pipe-table column width: wide enough for its content up to a cap, never narrower than its unbreakable cells. */
export function markdownColumnWidth(cells: readonly string[], fontScale = 1): number {
  const plain = cells.map((c) => c.replace(/[*_`]/g, ''));
  const scale = normScale(fontScale);
  const max = plain.reduce((m, c) => Math.max(m, [...c].length), 3);
  const want = Math.min(Math.round(260 * scale), Math.max(72, Math.round(max * 8 * scale) + 22));
  return Math.max(want, cellMinWidth(plain, scale, 8, 22));
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
export function canFitTable(viewport: number, widths: readonly number[], numeric: readonly boolean[], headers: readonly string[], fontScale = 1, keep?: readonly number[]): boolean {
  if (viewport <= 0) return false;
  const min = widths.reduce((sum, _w, ci) => sum + fitMinWidth(widths, numeric, headers, ci, fontScale, keep), 0);
  return min <= viewport;
}

/**
 * Minimum width of column `ci` in fit-to-width mode (the cell's `minWidth`; `canFitTable` sums these). `keep[ci]` is
 * the column's unbreakable content width (cellMinWidth): a text column never squeezes a number/range below it.
 */
export function fitMinWidth(widths: readonly number[], numeric: readonly boolean[], headers: readonly string[], ci: number, fontScale = 1, keep?: readonly number[]): number {
  const w = widths[ci] ?? 0;
  if (numeric[ci]) return w;
  const textMin = Math.max(Math.round(TEXT_COLUMN_FIT_MIN * normScale(fontScale)), headerMinWidth(headers[ci] ?? '', fontScale));
  return Math.min(w, Math.max(textMin, keep?.[ci] ?? 0));
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
  keep?: readonly number[],
): TableLayoutMode {
  if (!(viewport > 0)) return 'measuring';
  const totalW = widths.reduce((a, b) => a + b, 0);
  const fits = totalW <= viewport || canFitTable(viewport, widths, numeric, headers, fontScale, keep);
  if (fits) return 'fill';
  return tableCardMode(viewport, false, widths.length, pref) ? 'cards' : 'scroll';
}
