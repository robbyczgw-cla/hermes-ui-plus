/**
 * Suggestion chips: a short phrase must never be cut mid-phrase. On Android a `flexShrink` Text inside a
 * content-sized chip is measured on one line and then laid out again a hair narrower: the last word wraps into a line
 * the chip has no height for and is clipped ("What can you do?" showed as "What can you"). Short phrases fit the
 * chip column on any phone, so they get no shrink at all (measured once, at their own width); only long ones shrink
 * and wrap (up to 2 lines).
 */
export const SHORT_CHIP_CHARS = 22;

export const chipTextShrinks = (text: string): boolean => Array.from(text).length > SHORT_CHIP_CHARS;

/**
 * Measured on Android (smoke `chip_text`, onTextLayout): even without shrink the content-sized Text box of a short chip
 * came out ~0.1 dp narrower than its own one-line width ("What can you do?": box 109.0, lines 87.1 + 22.0 = 109.1), a
 * rounding loss when the measured width is snapped to the pixel grid, so "do?" broke into a second line the box had no
 * height for. A short chip is one line by design: when its text reports more than one line, it asks for the measured
 * one-line width plus 1 dp (`minWidth`) and lays out once more, at the same font size. Returns that width, or null when
 * nothing needs to change (long chips wrap on purpose).
 */
export function chipMinWidth(text: string, lines: readonly { width: number }[]): number | null {
  if (chipTextShrinks(text) || lines.length < 2) return null;
  return Math.ceil(lines.reduce((sum, l) => sum + l.width, 0)) + 1;
}
