// Line breaking around inline code (pure, node:test): `smartctl -a /dev/sdb` must not split at the space or hyphen,
// and the "." after a code span must not wrap onto a line of its own.

/** Inline code up to this many characters stays on one line on web (`white-space: nowrap`); longer spans wrap. */
export const INLINE_CODE_NOWRAP_CHARS = 32;
/** Average monospace glyph width at 14.5 px (≈ 0.6 em), for column widths that must hold a code span. */
export const MONO_CHAR_PX = 8.8;

const WORD_JOINER = '⁠';
// closing punctuation that belongs to the preceding word (and so to a code span right before it)
const TRAILING_PUNCT = /^[.,;:!?…)\]}»›”’"'%]/;

/** Characters of a code span (code points, not UTF-16 units). */
export const codeChars = (code: string): number => [...code].length;

export function nowrapCode(code: string): boolean {
  return codeChars(code) <= INLINE_CODE_NOWRAP_CHARS && !code.includes('\n');
}

/**
 * Text that follows a code span: when it starts with closing punctuation, a word joiner in front glues it to the
 * span (UAX #14 LB11 – no break before or after WJ, even after the span's trailing space). Invisible, and the code
 * itself stays copyable as-is.
 */
export function bindAfterCode(text: string): string {
  return TRAILING_PUNCT.test(text) ? WORD_JOINER + text : text;
}

/** Longest inline-code span in a Markdown table cell that stays on one line (0 = none). */
export function longestNowrapCode(cell: string): number {
  let max = 0;
  for (const m of cell.matchAll(/`([^`\n]+)`/g)) if (nowrapCode(m[1])) max = Math.max(max, codeChars(m[1]));
  return max;
}
