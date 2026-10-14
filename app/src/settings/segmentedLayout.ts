// When a settings `Segmented` control would cut its labels ("Über Bridge (em…", "Erst nach Ti…" at font scale 1.3 –
// E2E round 4, B4), it renders as a vertical list of radio rows instead (settings/ui.tsx). The decision is a
// conservative width estimate from the label text, the measured width and the system font scale – no native text
// measuring needed, and it never oscillates (the width does not depend on the variant). Pure → tested.

/** label font size of a segment (settings/ui.tsx) */
export const SEGMENT_FONT_SIZE = 13.5;
/** outer padding and gap between segments, inner horizontal padding of a segment (settings/ui.tsx styles) */
export const SEGMENT_PAD = 3;
export const SEGMENT_GAP = 3;
export const SEGMENT_INNER_PAD = 4;

const NARROW = new Set([...'iljtfrI.,:;!|()[]\' ']);
const WIDE = new Set([...'mwMW@%']);

/** rough rendered width of `text` in a semibold system sans at `fontSize` (errs on the wide side) */
export function estimateTextWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const ch of text) {
    if (NARROW.has(ch)) em += 0.32;
    else if (WIDE.has(ch)) em += 0.86;
    else if (ch >= 'A' && ch <= 'Z') em += 0.68;
    else em += 0.57;
  }
  return em * fontSize * 1.04; // semibold selected state
}

/** true → every label fits into its equal share of `width` on one line; `width` 0 (not laid out yet) counts as fitting */
export function segmentedFits(labels: readonly string[], width: number, fontScale = 1): boolean {
  const n = labels.length;
  if (n === 0 || width <= 0) return true;
  const perSegment = (width - 2 * SEGMENT_PAD - (n - 1) * SEGMENT_GAP) / n - 2 * SEGMENT_INNER_PAD;
  const size = SEGMENT_FONT_SIZE * Math.max(1, fontScale);
  return labels.every((l) => estimateTextWidth(l, size) <= perSegment);
}
