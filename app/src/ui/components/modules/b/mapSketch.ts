/**
 * Static map sketch for share-as-image (MapNode in capture mode): the stops as numbered pins on a plain plane, placed
 * by their real relative positions (equirectangular, longitude scaled by cos(latitude)), fitted into the box with one
 * uniform scale and centred. No tiles, no network: a live map cannot be put into an image reliably (it lives in a
 * WebView / sandboxed iframe), so the image shows where the stops are relative to each other. Pure, unit-tested.
 */

export type SketchPoint = { x: number; y: number; n: number };

export function sketchPoints(markers: readonly { lat: number; lng: number; n: number }[], width: number, height: number, pad: number): SketchPoint[] {
  if (!markers.length || width <= 0 || height <= 0) return [];
  const midLat = markers.reduce((s, m) => s + m.lat, 0) / markers.length;
  const k = Math.cos((midLat * Math.PI) / 180);
  const xs = markers.map((m) => m.lng * k);
  const ys = markers.map((m) => -m.lat);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = Math.max(...ys) - minY;
  const innerW = Math.max(0, width - pad * 2);
  const innerH = Math.max(0, height - pad * 2);
  // one stop, or all in one place: the centre
  if (spanX < 1e-9 && spanY < 1e-9) return markers.map((m) => ({ x: width / 2, y: height / 2, n: m.n }));
  const scale = Math.min(spanX > 1e-9 ? innerW / spanX : Infinity, spanY > 1e-9 ? innerH / spanY : Infinity);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  return markers.map((m, i) => ({ x: round(offX + (xs[i] - minX) * scale), y: round(offY + (ys[i] - minY) * scale), n: m.n }));
}

const round = (v: number) => Math.round(v * 10) / 10;
