// Layout numbers that follow the text size. `fontScale` is the effective scale: the in-app font size
// (theme `fontScale`, FONT_SCALE in themes.ts) times the system font scale (`useWindowDimensions().fontScale`),
// the same product Table.tsx uses. Pure, so the breakpoints are unit-tested (fontScaleLayout.test.ts).

/**
 * Line cap that keeps the same amount of text visible at any text size: a cap of 4 lines at scale 1 holds ~190
 * characters in a chat column, at 2.0 the same 4 lines held only ~95 and cut the advice of a failure message
 * ("… check the connection and try again"). The cap still guards against raw multi-kilobyte error dumps.
 */
export function scaledLineLimit(lines: number, fontScale: number): number {
  const s = Number.isFinite(fontScale) && fontScale > 1 ? fontScale : 1;
  return Math.ceil(lines * s);
}

/** stat card minimum width at text scale 1 (two cards per row on a phone) */
export const STAT_CARD_MIN_WIDTH = 140;

/**
 * Minimum width of one stats card. It grows with the text, so at large system text (2.0 on a phone) the grid wraps
 * to one card per row instead of cutting the value to "1,2…" in a half-width card. Never below the base width.
 */
export function statCardMinWidth(fontScale: number): number {
  const s = Number.isFinite(fontScale) && fontScale > 1 ? fontScale : 1;
  return Math.round(STAT_CARD_MIN_WIDTH * s);
}
