/** Layout maths of the in-app PDF viewer (PdfViewer.web.tsx). Pure, tested in pdfLayout.test.ts. */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
/** canvas pixel budget per page (iOS Safari refuses canvases above ~16.7 MP; also bounds memory per page) */
export const MAX_CANVAS_PIXELS = 12_000_000;

export const clampZoom = (z: number): number => (Number.isFinite(z) ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)) : MIN_ZOOM);

/**
 * Size of one rendered page: CSS width = available width × zoom, height by the page's aspect; the canvas resolution
 * follows the device pixel ratio (at most 2) but stays inside MAX_CANVAS_PIXELS.
 */
export function pageBox(o: { pageWidthPt: number; pageHeightPt: number; availWidth: number; zoom: number; dpr: number }) {
  const cssWidth = Math.max(1, Math.floor(o.availWidth * clampZoom(o.zoom)));
  const scale = cssWidth / o.pageWidthPt;
  const cssHeight = Math.max(1, Math.round(o.pageHeightPt * scale));
  let ratio = Math.min(2, Math.max(1, o.dpr || 1));
  const px = cssWidth * cssHeight * ratio * ratio;
  if (px > MAX_CANVAS_PIXELS) ratio = Math.max(0.25, Math.sqrt(MAX_CANVAS_PIXELS / (cssWidth * cssHeight)));
  return { cssWidth, cssHeight, scale, renderScale: scale * ratio, pixelWidth: Math.floor(cssWidth * ratio), pixelHeight: Math.floor(cssHeight * ratio) };
}

/** 1-based page shown at the reading line (a third down the viewport), from the pages' top offsets. */
export function pageAt(tops: readonly number[], scrollTop: number, viewportHeight: number): number {
  const line = scrollTop + viewportHeight / 3;
  let n = 1;
  for (let i = 0; i < tops.length; i++) if (tops[i] <= line) n = i + 1;
  return n;
}

/** Scroll position that keeps the content point under (x, y) (viewport coordinates) in place across a zoom change. */
export function zoomScroll(o: { scrollLeft: number; scrollTop: number; x: number; y: number; factor: number }) {
  return {
    left: Math.max(0, (o.scrollLeft + o.x) * o.factor - o.x),
    top: Math.max(0, (o.scrollTop + o.y) * o.factor - o.y),
  };
}
