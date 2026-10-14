/**
 * `scale` – pure model (docs/SPEC-modules-v3.md): defaults + clamping of min/max/step, style choice,
 * value snapping, emoji mapping and the reply. node:test-able.
 */
import { oneLine, tag, trimNum, type NumLang } from './format.ts';

type Rec = Record<string, unknown>;

export type ScaleStyle = 'slider' | 'stars' | 'emoji' | 'segments';
export type ScaleModel = {
  id: string;
  question: string;
  min: number;
  max: number;
  step: number;
  style: ScaleStyle;
  labels: { min?: string; max?: string };
  emojis: string[];
};

export const MAX_RANGE = 100;
/** discrete styles show one control per value */
export const MAX_DISCRETE: Record<Exclude<ScaleStyle, 'slider'>, number> = { stars: 10, emoji: 10, segments: 11 };
export const DEFAULT_EMOJIS = ['😞', '🙁', '😐', '🙂', '😄'];

const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) ? n : null;
};

const decimalsOf = (n: number) => (String(n).split('.')[1] ?? '').length;

/** Count of selectable values from min to max by step. */
export function valueCount(m: Pick<ScaleModel, 'min' | 'max' | 'step'>): number {
  return Math.floor((m.max - m.min) / m.step + 1e-9) + 1;
}

/** All selectable values (min, min+step, …, ≤ max). */
export function scaleValues(m: Pick<ScaleModel, 'min' | 'max' | 'step'>): number[] {
  const d = Math.min(6, decimalsOf(m.step) + decimalsOf(m.min));
  return Array.from({ length: valueCount(m) }, (_, i) => Number((m.min + i * m.step).toFixed(d)));
}

export function normalizeScale(node: unknown, fallbackId = 'scale'): ScaleModel {
  const n = isRec(node) ? node : {};
  let min = num(n.min) ?? 1;
  let max = num(n.max) ?? (min < 5 ? 5 : min + 4);
  if (!(max > min)) max = min + 4;
  if (max - min > MAX_RANGE) max = min + MAX_RANGE;
  let step = num(n.step) ?? 1;
  if (!(step > 0) || step > max - min) step = max - min >= 1 ? 1 : (max - min) / 4;
  // never more than ~MAX_RANGE+1 values (e.g. step 0.01 over 0..100)
  if ((max - min) / step > MAX_RANGE) step = (max - min) / MAX_RANGE;
  const emojis = (Array.isArray(n.emojis) ? n.emojis : []).map(str).filter(Boolean).slice(0, 10);
  const count = valueCount({ min, max, step });
  const asked = str(n.style) as ScaleStyle;
  let style: ScaleStyle = asked === 'slider' || asked === 'stars' || asked === 'emoji' || asked === 'segments' ? asked : emojis.length ? 'emoji' : count <= MAX_DISCRETE.segments ? 'segments' : 'slider';
  if (style !== 'slider' && count > MAX_DISCRETE[style]) style = count <= MAX_DISCRETE.segments ? 'segments' : 'slider';
  const labels: ScaleModel['labels'] = {};
  if (isRec(n.labels)) {
    const lo = str(n.labels.min);
    const hi = str(n.labels.max);
    if (lo) labels.min = lo;
    if (hi) labels.max = hi;
  }
  return { id: str(n.id) || fallbackId, question: str(n.question), min, max, step, style, labels, emojis };
}

/** Clamp to [min, max] and snap to the step grid (anchored at min). Non-numbers → null. */
export function clampScale(v: unknown, m: Pick<ScaleModel, 'min' | 'max' | 'step'>): number | null {
  const x = num(v);
  if (x === null) return null;
  const values = scaleValues(m);
  const c = Math.min(m.max, Math.max(m.min, x));
  const i = Math.round((c - m.min) / m.step);
  return values[Math.max(0, Math.min(values.length - 1, i))];
}

/** Emoji for a value: the list (given or default) is stretched over the range. */
export function emojiFor(value: number, m: Pick<ScaleModel, 'min' | 'max' | 'emojis'>): string {
  const list = m.emojis.length ? m.emojis : DEFAULT_EMOJIS;
  const r = m.max > m.min ? (value - m.min) / (m.max - m.min) : 0;
  return list[Math.max(0, Math.min(list.length - 1, Math.round(r * (list.length - 1))))];
}

/** End label for a value (labels.min at min, labels.max at max), else undefined. */
export function endLabel(value: number, m: Pick<ScaleModel, 'min' | 'max' | 'labels'>): string | undefined {
  if (value === m.min) return m.labels.min;
  if (value === m.max) return m.labels.max;
  return undefined;
}

/** "4/5" (decimal comma for de/es). */
export function scaleValueText(value: number, m: Pick<ScaleModel, 'max'>, lang: NumLang = 'de'): string {
  return `${trimNum(value, lang)}/${trimNum(m.max, lang)}`;
}

/** `[scale:<id>] 4/5` + ` (label)` when the value hits a labelled end (protocol: German decimals). */
export function scaleReply(m: ScaleModel, value: number): string {
  const label = endLabel(value, m);
  return `${tag('scale', m.id)} ${scaleValueText(value, m)}${label ? ` (${oneLine(label)})` : ''}`;
}
