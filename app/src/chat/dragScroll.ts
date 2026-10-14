/**
 * Pure offset math for drag auto-scroll in the inverted chat list (offset 0 = bottom).
 * dy > 0 reveals content further DOWN the screen, which means a SMALLER offset.
 * Returns the clamped next offset and the distance actually scrolled (same sign as dy).
 */
export function dragScrollStep(offset: number, dy: number, maxOffset = Infinity): { next: number; moved: number } {
  const next = Math.min(Math.max(0, maxOffset), Math.max(0, offset - dy));
  return { next, moved: offset - next };
}
