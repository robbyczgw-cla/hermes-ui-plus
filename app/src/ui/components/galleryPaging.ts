/**
 * Pure paging math for the photo carousel (`gallery` node). Slides are `slideW` wide with `gap` between
 * them; the last slide is reached at the max scroll offset (the next slide peeks in, so pages don't
 * line up with the viewport width). No RN imports → node:test.
 */

/** Movement (px) after which a press on a slide no longer counts as a tap (→ no fullscreen). */
export const TAP_SLOP = 8;
/** A mouse drag of at least this many px advances one page even if it didn't cross the slide middle. */
export const PAGE_FLICK = 40;

export type GalleryGeometry = { n: number; slideW: number; gap: number; viewW: number };

export function maxOffset(g: GalleryGeometry): number {
  return Math.max(0, g.n * g.slideW + (g.n - 1) * g.gap - g.viewW);
}

/** Scroll offset that shows page `page` (clamped; the last page = the end of the strip). */
export function offsetForPage(g: GalleryGeometry, page: number): number {
  const p = Math.max(0, Math.min(g.n - 1, Math.round(page)));
  return Math.min(p * (g.slideW + g.gap), maxOffset(g));
}

/** Page shown at scroll offset `x` (the end of the strip counts as the last page). */
export function pageAtOffset(g: GalleryGeometry, x: number): number {
  if (g.n <= 1) return 0;
  if (x >= maxOffset(g) - 4) return g.n - 1;
  return Math.max(0, Math.min(g.n - 1, Math.round(x / (g.slideW + g.gap))));
}

/**
 * Target page after a mouse drag that started on `startPage` and moved the pointer by `dx`
 * (negative = dragged left = forward). Small flicks still advance one page; long drags land on
 * the nearest page of the final offset.
 */
export function pageAfterDrag(g: GalleryGeometry, startPage: number, dx: number, endOffset: number): number {
  const nearest = pageAtOffset(g, endOffset);
  if (nearest !== startPage) return nearest;
  if (dx <= -PAGE_FLICK) return Math.min(g.n - 1, startPage + 1);
  if (dx >= PAGE_FLICK) return Math.max(0, startPage - 1);
  return startPage;
}

/** True when the pointer moved far enough that the release must not open the fullscreen viewer. */
export function isDrag(dx: number, dy: number): boolean {
  return Math.abs(dx) > TAP_SLOP || Math.abs(dy) > TAP_SLOP;
}
