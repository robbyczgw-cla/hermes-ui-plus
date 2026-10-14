// Pure color math for the theme registry (no React / RN imports → usable from node:test).
// WCAG 2.x relative luminance + contrast ratio, sRGB mixing, contrast-preserving accent adjustment.

export type RGB = { r: number; g: number; b: number };

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#abc` / `#aabbcc` / `aabbcc` → normalized `#aabbcc` (lowercase), else null. */
export function normalizeHex(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const m = HEX_RE.exec(input.trim());
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return `#${h}`;
}

export function hexToRgb(hex: string): RGB {
  const n = normalizeHex(hex);
  if (!n) throw new Error(`invalid hex color: ${hex}`);
  return { r: parseInt(n.slice(1, 3), 16), g: parseInt(n.slice(3, 5), 16), b: parseInt(n.slice(5, 7), 16) };
}

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const hex2 = (v: number) => clamp255(v).toString(16).padStart(2, '0');

export function rgbToHex({ r, g, b }: RGB): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

/** `rgba(…)` string from a hex color + alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${Math.round(alpha * 1000) / 1000})`;
}

/** Linear sRGB mix: t = 0 → a, t = 1 → b. */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance (0 = black … 1 = white). */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1 … 21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Of `candidates`, the one with the highest contrast on `bg`. */
export function bestOn(bg: string, candidates: string[] = ['#ffffff', '#0b0b0f']): string {
  let best = candidates[0];
  let bestRatio = -1;
  for (const c of candidates) {
    const r = contrast(c, bg);
    if (r > bestRatio) {
      best = c;
      bestRatio = r;
    }
  }
  return best;
}

/**
 * Smallest change of `color` (mixed toward black or white, whichever direction raises contrast)
 * so that `contrast(result, bg) >= min`. Returns the color unchanged when it already passes.
 */
export function ensureContrast(color: string, bg: string, min: number): string {
  const c = normalizeHex(color) ?? color;
  if (contrast(c, bg) >= min) return c;
  const target = luminance(bg) > 0.18 ? '#000000' : '#ffffff';
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (contrast(mix(c, target, mid), bg) >= min) hi = mid;
    else lo = mid;
  }
  return mix(c, target, hi);
}
