// Color-vision-deficiency check for categorical chart palettes (pure math, no React / RN; used by themes.test.ts and
// the palette report). Simulation: Machado, Oliveira & Fernandes (2009) at severity 1.0, applied in linear sRGB.
// Distance: Euclidean OKLab ΔE × 100 (the dataviz convention: ≥ 8 target, ≥ 6 floor with secondary encoding,
// ≥ 15 between neighbours for normal vision).
import { hexToRgb } from './color.ts';

export type Vision = 'normal' | 'protan' | 'deutan';
type M3 = readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];

const MACHADO: Record<Exclude<Vision, 'normal'>, M3> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
};

const toLinear = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** OKLab of a hex color as seen with `vision` (Machado 2009, severity 1). */
export function oklab(hex: string, vision: Vision = 'normal'): [number, number, number] {
  const { r, g, b } = hexToRgb(hex);
  let rgb: [number, number, number] = [toLinear(r), toLinear(g), toLinear(b)];
  if (vision !== 'normal') {
    const m = MACHADO[vision];
    rgb = [0, 1, 2].map((i) => clamp01(m[i][0] * rgb[0] + m[i][1] * rgb[1] + m[i][2] * rgb[2])) as [number, number, number];
  }
  const [R, G, B] = rgb;
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m_ = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m_ - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m_ + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m_ - 0.808675766 * s,
  ];
}

/** OKLab ΔE × 100 between two colors as seen with `vision`. */
export function deltaE(a: string, b: string, vision: Vision = 'normal'): number {
  const x = oklab(a, vision);
  const y = oklab(b, vision);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) * 100;
}

export type PairReport = { a: string; b: string; vision: Vision; dE: number };

/** Worst neighbouring pair (series i and i+1) per vision; with `firstAll`, all pairs among the first n slots too. */
export function worstPairs(palette: readonly string[], firstAll = 0): Record<Vision, PairReport> {
  const pairs: [string, string][] = [];
  for (let i = 0; i + 1 < palette.length; i++) pairs.push([palette[i], palette[i + 1]]);
  for (let i = 0; i < firstAll; i++) for (let j = i + 2; j < firstAll; j++) pairs.push([palette[i], palette[j]]);
  const out = {} as Record<Vision, PairReport>;
  for (const vision of ['normal', 'protan', 'deutan'] as const) {
    let worst: PairReport = { a: '', b: '', vision, dE: Infinity };
    for (const [a, b] of pairs) {
      const dE = deltaE(a, b, vision);
      if (dE < worst.dE) worst = { a, b, vision, dE };
    }
    out[vision] = worst;
  }
  return out;
}
