/**
 * Crop / rotate geometry for the on-device quick edits (pure, crop.test.ts). Display rects live in
 * the coordinate space of the preview box; `toImageRect` maps them to image pixels for
 * expo-image-manipulator's `crop({originX, originY, width, height})`.
 */

export type Rect = { x: number; y: number; w: number; h: number };
export type CropPreset = 'free' | '1:1' | '4:3' | '16:9';
export const CROP_PRESETS: readonly CropPreset[] = ['1:1', '4:3', '16:9', 'free'];

/** width / height of a preset; null = free. Landscape presets flip for portrait images (4:3 → 3:4). */
export function presetAspect(p: CropPreset, imgW: number, imgH: number): number | null {
  if (p === 'free') return null;
  const [a, b] = p === '1:1' ? [1, 1] : p === '4:3' ? [4, 3] : [16, 9];
  return imgH > imgW ? b / a : a / b;
}

/** Image box inside a container with `contain` fit (letterboxed), in container coordinates. */
export function fitContain(imgW: number, imgH: number, boxW: number, boxH: number): Rect {
  if (!(imgW > 0 && imgH > 0 && boxW > 0 && boxH > 0)) return { x: 0, y: 0, w: 0, h: 0 };
  const s = Math.min(boxW / imgW, boxH / imgH);
  const w = imgW * s;
  const h = imgH * s;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

/** Largest centered rect of `aspect` inside `bounds` (null aspect → 90 % of the bounds). */
export function centeredCrop(bounds: Rect, aspect: number | null): Rect {
  if (aspect === null || !(aspect > 0)) {
    const w = bounds.w * 0.9;
    const h = bounds.h * 0.9;
    return { x: bounds.x + (bounds.w - w) / 2, y: bounds.y + (bounds.h - h) / 2, w, h };
  }
  let w = bounds.w;
  let h = w / aspect;
  if (h > bounds.h) {
    h = bounds.h;
    w = h * aspect;
  }
  return { x: bounds.x + (bounds.w - w) / 2, y: bounds.y + (bounds.h - h) / 2, w, h };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Drag the whole rect, kept inside `bounds`. */
export function moveRect(r: Rect, dx: number, dy: number, bounds: Rect): Rect {
  return {
    ...r,
    x: clamp(r.x + dx, bounds.x, bounds.x + bounds.w - r.w),
    y: clamp(r.y + dy, bounds.y, bounds.y + bounds.h - r.h),
  };
}

/**
 * Drag the bottom-right corner: free = width/height independently; with an aspect the height
 * follows the width. Never smaller than `min`, never outside `bounds`.
 */
export function resizeRect(r: Rect, dx: number, dy: number, bounds: Rect, aspect: number | null, min = 40): Rect {
  const maxW = bounds.x + bounds.w - r.x;
  const maxH = bounds.y + bounds.h - r.y;
  if (aspect === null) {
    return { ...r, w: clamp(r.w + dx, Math.min(min, maxW), maxW), h: clamp(r.h + dy, Math.min(min, maxH), maxH) };
  }
  // follow the dominant drag direction, then fit both limits
  let w = Math.abs(dx) >= Math.abs(dy * aspect) ? r.w + dx : r.w + dy * aspect;
  const maxWByH = maxH * aspect;
  const limit = Math.min(maxW, maxWByH);
  const minW = Math.min(Math.max(min, min * aspect), limit);
  w = clamp(w, minW, limit);
  return { ...r, w, h: w / aspect };
}

/** Display rect (inside the letterboxed `image` rect) → integer pixel rect of the image, clamped. */
export function toImageRect(display: Rect, image: Rect, imgW: number, imgH: number): { originX: number; originY: number; width: number; height: number } {
  const s = image.w > 0 ? imgW / image.w : 1;
  let originX = Math.round((display.x - image.x) * s);
  let originY = Math.round((display.y - image.y) * s);
  originX = clamp(originX, 0, Math.max(0, imgW - 1));
  originY = clamp(originY, 0, Math.max(0, imgH - 1));
  const width = clamp(Math.round(display.w * s), 1, imgW - originX);
  const height = clamp(Math.round(display.h * s), 1, imgH - originY);
  return { originX, originY, width, height };
}

/** Size after a rotation by a multiple of 90°. */
export function rotatedSize(w: number, h: number, degrees: number): { width: number; height: number } {
  const q = ((Math.round(degrees / 90) % 4) + 4) % 4;
  return q % 2 === 1 ? { width: h, height: w } : { width: w, height: h };
}
