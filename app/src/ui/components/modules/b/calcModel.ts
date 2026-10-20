/**
 * Pure model for the `calc` node (no RN imports – tested with node:test).
 * Expressions are evaluated ONLY through app/src/calc (safe engine, no eval).
 *
 *  - normalizeCalc(node)          tolerant reader for partial / streaming / sloppy model JSON
 *  - initialValues(inputs)        defaults (clamped, snapped, valid option)
 *  - parseNumberInput(text, inp)  German/English number entry → value or field-level error
 *  - computeOutputs(...)          evaluateOutputs + formatValue → display rows ("–" when invalid)
 *  - buildCalcReply(...)          `[calc:<id>] Kredit 20.000 € · Zins 4,5 % → Rate 372,86 €`
 *  - allocateRounded(total, w)    rounded shares that sum EXACTLY to the rounded total
 */
import { evaluateOutputs, formatValue, sweep, DASH } from '../../../../calc/index.ts';
import type { FormatKind } from '../../../../calc/index.ts';
import { S_DE } from '../a/text.ts';

export type CalcInputKind = 'slider' | 'number' | 'select' | 'toggle';
export type CalcValue = number | boolean | string | null;

export type CalcOption = { label: string; value: number | string };

export type CalcInputDef = {
  name: string;
  label: string;
  kind: CalcInputKind;
  min?: number;
  max?: number;
  step?: number;
  default?: CalcValue;
  unit?: string;
  options: CalcOption[];
};

export type CalcOutputDefN = {
  name?: string;
  label: string;
  expr: string;
  format: FormatKind;
  decimals?: number;
  unit?: string;
  emphasis: boolean;
  /** what the model wrote, when `expr` is a rewrite of it (shown in the formula disclosure) */
  source?: string;
  /** text output: `expr` yields an index into these strings */
  texts?: string[];
};

export type CalcChartDefN = {
  kind: 'line' | 'bar';
  sweep: { input: string; from: number; to: number; steps: number };
  y: string;
  label?: string;
};

export type CalcModel = {
  id: string;
  title?: string;
  inputs: CalcInputDef[];
  outputs: CalcOutputDefN[];
  chart?: CalcChartDefN;
  note?: string;
  assumptions: string[];
};

const IDENT = /^[\p{L}_][\p{L}\p{N}_]*$/u;
const KINDS: CalcInputKind[] = ['slider', 'number', 'select', 'toggle'];
const FORMATS: FormatKind[] = ['number', 'currency', 'percent', 'duration', 'integer'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function readOption(o: unknown, i: number): CalcOption | null {
  if (typeof o === 'string' || typeof o === 'number') {
    const n = num(o);
    return { label: String(o), value: n ?? String(o) };
  }
  if (!isObj(o)) return null;
  const label = str(o.label) ?? (o.value !== undefined ? String(o.value) : undefined);
  if (!label) return null;
  const n = num(o.value);
  return { label, value: n ?? (typeof o.value === 'string' ? o.value : i) };
}

function readInput(o: unknown): CalcInputDef | null {
  if (!isObj(o)) return null;
  const name = str(o.name);
  if (!name || !IDENT.test(name)) return null;
  const kind = KINDS.includes(o.kind as CalcInputKind) ? (o.kind as CalcInputKind) : 'number';
  let min = num(o.min);
  let max = num(o.max);
  if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];
  const stepRaw = num(o.step);
  const d = o.default;
  const def: CalcValue | undefined =
    typeof d === 'boolean' ? d : num(d) !== undefined ? num(d)! : typeof d === 'string' ? d : undefined;
  return {
    name,
    label: str(o.label) ?? name,
    kind,
    min,
    max,
    step: stepRaw !== undefined && stepRaw > 0 ? stepRaw : undefined,
    default: def,
    unit: str(o.unit),
    options: Array.isArray(o.options) ? o.options.map(readOption).filter((x): x is CalcOption => !!x) : [],
  };
}

/* ───────────── source rewrite (JS-isms models write) ─────────────
 *
 * Models often write JavaScript instead of the calc grammar: `x.toFixed(1)`, `Math.round(x)`,
 * `Number(x)`, `===`, spreadsheet names (`IF(`, `MAX(`), and a top-level ternary or `if(…)` that picks a text
 * (`a > b ? '✓ Zug' : '✓ Auto'`, `IF(a > b, "→ Zug", "→ Auto")`).
 * These are rewritten at the SOURCE level into plain engine syntax before the engine sees them.
 * Nothing here evaluates anything: the result is still a string that the safe engine parses, so
 * property access and strings stay impossible (an unknown `.foo` or a leftover quote is still an
 * engine error). Anything that cannot be rewritten safely is left as it is.
 */

/** Placeholder for characters inside a string literal in the mask (never an operator/identifier char). */
const STR = '\u0001';
const IDCH = /[\p{L}\p{N}_]/u;

/** Same length as `src`, every char of a '…' / "…" literal replaced by STR. Null: unterminated string or backtick. */
function maskStrings(src: string): string | null {
  let out = '';
  let q: string | null = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      out += STR;
      if (c === '\\' && i + 1 < src.length) {
        out += STR;
        i++;
      } else if (c === q) q = null;
      continue;
    }
    if (c === '`') return null; // template literal: code inside `${…}`, never rewritten
    if (c === "'" || c === '"') {
      q = c;
      out += STR;
      continue;
    }
    out += c;
  }
  return q ? null : out;
}

/** Index of the `)` matching the `(` at `open` (in the mask), or -1. */
function closeParen(mask: string, open: number, end = mask.length): number {
  let d = 0;
  for (let i = open; i < end; i++) {
    if (mask[i] === '(') d++;
    else if (mask[i] === ')' && --d === 0) return i;
  }
  return -1;
}

/** [start, end) of `mask` without surrounding whitespace and fully wrapping parentheses. */
function core(mask: string, start = 0, end = mask.length): [number, number] {
  for (;;) {
    while (start < end && /\s/.test(mask[start])) start++;
    while (end > start && /\s/.test(mask[end - 1])) end--;
    if (mask[start] === '(' && closeParen(mask, start, end) === end - 1) {
      start++;
      end--;
    } else return [start, end];
  }
}

const isIdAt = (s: string, i: number) => i >= 0 && i < s.length && IDCH.test(s[i]);

const MATH_FNS: Record<string, string> = {
  round: 'round', floor: 'floor', ceil: 'ceil', abs: 'abs', sqrt: 'sqrt', pow: 'pow',
  min: 'min', max: 'max', exp: 'exp', log: 'ln', log10: 'log',
};
const MATH_CONSTS: Record<string, string> = { PI: 'pi', E: 'e' };
const WRAPPERS = ['Number', 'parseFloat'];
/** spreadsheet spelling of the engine's functions (`IF(`, `MAX(`, `ROUND(`, `POWER(`) → engine name */
const SHEET_FNS: Record<string, string> = {
  IF: 'if', MIN: 'min', MAX: 'max', ROUND: 'round', FLOOR: 'floor', CEIL: 'ceil', CEILING: 'ceil', ABS: 'abs',
  SQRT: 'sqrt', POW: 'pow', POWER: 'pow', LOG: 'log', LOG10: 'log', LN: 'ln', EXP: 'exp', CLAMP: 'clamp',
};

/** One rewrite step on the first applicable spot at/after `from`; null when nothing (more) applies. */
type Step = { src: string; next: number; whole?: number } | null;

function stepSimple(src: string, mask: string): Step {
  for (let i = 0; i < mask.length; i++) {
    // === / !==
    if (mask.startsWith('===', i) || mask.startsWith('!==', i)) return { src: src.slice(0, i + 1) + '=' + src.slice(i + 3), next: 0 };
    if (isIdAt(mask, i - 1) || mask[i - 1] === '.') continue;
    // Math.round( → round(  ·  Math.PI → pi
    if (mask.startsWith('Math.', i)) {
      const m = /^Math\.([A-Za-z0-9]+)/.exec(mask.slice(i));
      if (!m) continue;
      const after = mask.slice(i + m[0].length).trimStart();
      const fn = MATH_FNS[m[1]];
      const k = MATH_CONSTS[m[1]];
      if (fn && after.startsWith('(')) return { src: src.slice(0, i) + fn + src.slice(i + m[0].length), next: 0 };
      if (k && !after.startsWith('(') && !isIdAt(mask, i + m[0].length)) return { src: src.slice(0, i) + k + src.slice(i + m[0].length), next: 0 };
      continue;
    }
    // IF( / MAX( … → if( / max(  (never an input name: those are not followed by a parenthesis)
    const sheet = /^([A-Z][A-Z0-9]*)\s*\(/.exec(mask.slice(i));
    if (sheet && SHEET_FNS[sheet[1]]) return { src: src.slice(0, i) + SHEET_FNS[sheet[1]] + src.slice(i + sheet[1].length), next: 0 };
    // Number(x) / parseFloat(x) → (x)
    for (const w of WRAPPERS) {
      if (mask.startsWith(w, i) && !isIdAt(mask, i + w.length)) {
        let j = i + w.length;
        while (/\s/.test(mask[j] ?? '')) j++;
        if (mask[j] === '(') return { src: src.slice(0, i) + src.slice(j), next: 0 };
      }
    }
  }
  return null;
}

/** `X.toLocaleString(…)` → `X`, `X.toFixed(n)` → `round(X, n)`. */
function stepMethod(src: string, mask: string, from: number, method: 'toFixed' | 'toLocaleString'): Step {
  const re = new RegExp(`\\.\\s*(${method})\\s*\\(`, 'g');
  re.lastIndex = from;
  const m = re.exec(mask);
  if (!m) return null;
  const dot = m.index;
  const open = dot + m[0].length - 1;
  const close = closeParen(mask, open);
  if (close < 0) return null;
  const next = dot + 1;
  if (m[1] === 'toLocaleString') return { src: src.slice(0, dot) + src.slice(close + 1), next: 0 };
  const arg = src.slice(open + 1, close).trim();
  if (!/^\d{0,2}$/.test(arg)) return { src, next };
  // operand before the dot: (…), name(…), identifier or number
  let s = dot;
  if (mask[s - 1] === ')') {
    let d = 0;
    for (s = dot - 1; s >= 0; s--) {
      if (mask[s] === ')') d++;
      else if (mask[s] === '(' && --d === 0) break;
    }
    if (s < 0) return { src, next };
    while (isIdAt(mask, s - 1)) s--;
  } else {
    while (s > 0 && (isIdAt(mask, s - 1) || mask[s - 1] === '.')) s--;
  }
  if (s === dot) return { src, next };
  const n = arg === '' ? 0 : Number(arg);
  const out = src.slice(0, s) + `round(${src.slice(s, dot)}, ${n})` + src.slice(close + 1);
  const [a, b] = core(mask);
  return { src: out, next: 0, whole: s === a && close + 1 === b ? n : undefined };
}

type TextNode = { lit: string } | { cond: string; then: TextNode; else: TextNode };

/** `if(c, a, b)` spanning exactly [a, b): the three top-level argument ranges, else null. */
function ifCallArgs(mask: string, a: number, b: number): [number, number][] | null {
  const m = /^if\s*\(/.exec(mask.slice(a, b));
  if (!m || isIdAt(mask, a - 1)) return null;
  const open = a + m[0].length - 1;
  if (closeParen(mask, open, b) !== b - 1) return null;
  const args: [number, number][] = [];
  let d = 0;
  let from = open + 1;
  for (let i = open + 1; i < b - 1; i++) {
    const c = mask[i];
    if (c === '(') d++;
    else if (c === ')') d--;
    else if (c === ',' && d === 0) {
      args.push([from, i]);
      from = i + 1;
    }
  }
  args.push([from, b - 1]);
  return args.length === 3 ? args : null;
}

/**
 * A string literal, `cond ? T : T` or `if(cond, T, T)` (spreadsheet `IF`, real-user round 3) with a numeric `cond`
 * and text branches; null otherwise.
 */
function readTextExpr(src: string, mask: string, start: number, end: number): TextNode | null {
  const [a, b] = core(mask, start, end);
  if (b - a >= 2 && (src[a] === "'" || src[a] === '"') && src[b - 1] === src[a] && mask.slice(a, b).split('').every((c) => c === STR)) {
    // one single literal (not 'a' + 'b'): its closing quote is the last char
    const body = src.slice(a + 1, b - 1);
    let i = 0;
    for (; i < body.length; i++) if (body[i] === '\\') i++; else if (body[i] === src[a]) break;
    if (i < body.length) return null;
    return { lit: body.replace(/\\(.)/g, '$1') };
  }
  const call = ifCallArgs(mask, a, b);
  if (call) {
    const [c, t, e] = call;
    const cond = src.slice(c[0], c[1]).trim();
    if (!cond || mask.slice(c[0], c[1]).includes(STR)) return null;
    const then = readTextExpr(src, mask, t[0], t[1]);
    const els = then && readTextExpr(src, mask, e[0], e[1]);
    return then && els ? { cond, then, else: els } : null;
  }
  let d = 0;
  let q = -1;
  for (let i = a; i < b; i++) {
    const c = mask[i];
    if (c === '(') d++;
    else if (c === ')') d--;
    else if (c === '?' && d === 0) {
      q = i;
      break;
    }
  }
  if (q < 0) return null;
  let nest = 0;
  let colon = -1;
  d = 0;
  for (let i = q + 1; i < b; i++) {
    const c = mask[i];
    if (c === '(') d++;
    else if (c === ')') d--;
    else if (d === 0 && c === '?') nest++;
    else if (d === 0 && c === ':') {
      if (nest === 0) {
        colon = i;
        break;
      }
      nest--;
    }
  }
  if (colon < 0) return null;
  const cond = src.slice(a, q).trim();
  if (!cond || mask.slice(a, q).includes(STR)) return null;
  const then = readTextExpr(src, mask, q + 1, colon);
  const els = then && readTextExpr(src, mask, colon + 1, b);
  return then && els ? { cond, then, else: els } : null;
}

function textToEngine(n: TextNode, texts: string[]): string {
  if ('lit' in n) {
    let i = texts.indexOf(n.lit);
    if (i < 0) i = texts.push(n.lit) - 1;
    return String(i);
  }
  return `(${n.cond}) ? (${textToEngine(n.then, texts)}) : (${textToEngine(n.else, texts)})`;
}

/**
 * Rewrites JS-isms into engine syntax (see above). `texts`: the output picks one of these
 * strings; the engine expression then returns its index. Unchanged input when nothing applies.
 */
export function rewriteExpr(expr: string): { expr: string; decimals?: number; texts?: string[] } {
  let src = expr;
  let whole: number | undefined;
  let mask = maskStrings(src);
  if (!mask) return { expr };
  for (let guard = 0; mask && guard < 100; guard++) {
    const r = stepSimple(src, mask);
    if (!r) break;
    src = r.src;
    mask = maskStrings(src);
  }
  for (const method of ['toLocaleString', 'toFixed'] as const) {
    let from = 0;
    for (let guard = 0; mask && guard < 100; guard++) {
      const r = stepMethod(src, mask, from, method);
      if (!r) break;
      if (r.src === src) {
        from = r.next;
        continue;
      }
      src = r.src;
      mask = maskStrings(src);
      from = 0;
      if (r.whole !== undefined) whole = r.whole;
    }
  }
  if (!mask) return { expr };
  if (mask.includes(STR)) {
    const t = readTextExpr(src, mask, 0, src.length);
    if (t) {
      const texts: string[] = [];
      return { expr: textToEngine(t, texts), texts };
    }
  }
  return whole !== undefined ? { expr: src, decimals: whole } : { expr: src };
}

function readOutput(o: unknown): CalcOutputDefN | null {
  if (!isObj(o)) return null;
  const raw = str(o.expr);
  if (!raw) return null;
  const name = str(o.name);
  const dec = num(o.decimals);
  const rw = rewriteExpr(raw);
  const decimals = dec !== undefined ? dec : rw.decimals;
  return {
    name: name && IDENT.test(name) ? name : undefined,
    label: str(o.label) ?? name ?? 'Ergebnis',
    expr: rw.expr,
    ...(rw.expr !== raw ? { source: raw } : {}),
    ...(rw.texts ? { texts: rw.texts } : {}),
    format: FORMATS.includes(o.format as FormatKind) ? (o.format as FormatKind) : 'number',
    decimals: decimals !== undefined ? Math.max(0, Math.min(10, Math.floor(decimals))) : undefined,
    unit: str(o.unit),
    emphasis: o.emphasis === true,
  };
}

function readChart(o: unknown, inputs: CalcInputDef[]): CalcChartDefN | undefined {
  if (!isObj(o) || !isObj(o.sweep)) return undefined;
  const input = str(o.sweep.input);
  const y = str(o.y);
  if (!input || !y || !inputs.some((i) => i.name === input)) return undefined;
  const inp = inputs.find((i) => i.name === input)!;
  const from = num(o.sweep.from) ?? inp.min;
  const to = num(o.sweep.to) ?? inp.max;
  if (from === undefined || to === undefined || from === to) return undefined;
  const steps = Math.max(2, Math.min(60, Math.floor(num(o.sweep.steps) ?? 20)));
  return { kind: o.kind === 'bar' ? 'bar' : 'line', sweep: { input, from, to, steps }, y, label: str(o.label) };
}

/** Tolerant reader: drops invalid inputs/outputs, de-duplicates input names (first wins). */
export function normalizeCalc(node: unknown): CalcModel {
  const n = isObj(node) ? node : {};
  const seen = new Set<string>();
  const inputs: CalcInputDef[] = [];
  for (const raw of Array.isArray(n.inputs) ? n.inputs : []) {
    const i = readInput(raw);
    if (i && !seen.has(i.name)) {
      seen.add(i.name);
      inputs.push(i);
    }
  }
  const outputs = (Array.isArray(n.outputs) ? n.outputs : []).map(readOutput).filter((x): x is CalcOutputDefN => !!x);
  const assumptions = (Array.isArray(n.assumptions) ? n.assumptions : []).map(str).filter((x): x is string => !!x);
  return {
    id: str(n.id) ?? 'calc',
    title: str(n.title),
    inputs,
    outputs,
    chart: readChart(n.chart, inputs),
    note: str(n.note),
    assumptions,
  };
}

/* ───────────── values ───────────── */

export function snapToStep(v: number, min: number, step: number | undefined): number {
  if (!step || !(step > 0)) return v;
  const n = Math.round((v - min) / step) * step + min;
  const decimals = Math.min(10, (String(step).split('.')[1] ?? '').length + (String(min).split('.')[1] ?? '').length);
  return Number(n.toFixed(decimals));
}

export function sliderRange(inp: CalcInputDef): { min: number; max: number; step: number } {
  const min = inp.min ?? 0;
  const max = inp.max ?? Math.max(min + 100, typeof inp.default === 'number' ? inp.default * 2 : 100);
  const step = inp.step ?? (max - min >= 100 ? 1 : (max - min) / 100);
  return { min, max, step };
}

export function initialValue(inp: CalcInputDef): CalcValue {
  const d = inp.default;
  switch (inp.kind) {
    case 'toggle':
      return d === true || d === 'true' || d === 1;
    case 'select': {
      if (!inp.options.length) return null;
      const hit = inp.options.find((o) => o.value === d || o.label === d || (typeof d === 'number' && Number(o.value) === d));
      return (hit ?? inp.options[0]).value;
    }
    case 'slider': {
      const { min, max, step } = sliderRange(inp);
      const v = typeof d === 'number' ? d : min;
      return Math.min(max, Math.max(min, snapToStep(v, min, step)));
    }
    default:
      return typeof d === 'number' ? d : null;
  }
}

export function initialValues(inputs: CalcInputDef[]): Record<string, CalcValue> {
  const out: Record<string, CalcValue> = {};
  for (const i of inputs) out[i.name] = initialValue(i);
  return out;
}

/** Current value of an input (stored value if valid for the input kind, else its initial value). */
export function valueOf(inp: CalcInputDef, stored: Record<string, CalcValue> | undefined): CalcValue {
  const v = stored && Object.prototype.hasOwnProperty.call(stored, inp.name) ? stored[inp.name] : undefined;
  if (v === undefined) return initialValue(inp);
  if (inp.kind === 'toggle') return typeof v === 'boolean' ? v : initialValue(inp);
  if (inp.kind === 'select') return inp.options.some((o) => o.value === v) ? v : initialValue(inp);
  if (v === null) return null;
  return typeof v === 'number' && Number.isFinite(v) ? v : initialValue(inp);
}

/**
 * Parses what the user typed. Accepts "1234,5", "1.234,5", "1,234.5", "1 234", "-3", "4,5 %".
 * Returns a field-level German error for blank / non-numeric / out-of-range input.
 */
/** Display options: active locale + UI copy (defaults: German, as before). Protocol replies never pass these. */
export type CalcFmt = { locale?: string; text?: Pick<typeof S_DE.calc, 'errEmpty' | 'errInvalid' | 'errMin' | 'errMax' | 'yes' | 'no'> };

export function parseNumberInput(text: string, inp: Pick<CalcInputDef, 'min' | 'max' | 'unit'>, fmt: CalcFmt = {}): { ok: true; value: number } | { ok: false; error: string } {
  const C = fmt.text ?? S_DE.calc;
  let s = (text ?? '').trim();
  if (inp.unit && s.endsWith(inp.unit)) s = s.slice(0, -inp.unit.length).trim();
  s = s.replace(/[\s  ']/g, '').replace(/^−/, '-');
  if (!s) return { ok: false, error: C.errEmpty };
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // the later one is the decimal separator
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = (s.match(/,/g)!.length > 1 ? s.replace(/,/g, '') : s.replace(',', '.'));
  } else if (lastDot >= 0 && /^-?\d{1,3}(\.\d{3}){2,}$/.test(s)) {
    s = s.replace(/\./g, ''); // 1.000.000
  } else if (lastDot >= 0 && /^-?\d{1,3}\.\d{3}$/.test(s)) {
    s = s.replace('.', ''); // German thousands "20.000" (a decimal 20.000 would be typed as 20)
  }
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return { ok: false, error: C.errInvalid };
  const v = Number(s);
  if (!Number.isFinite(v)) return { ok: false, error: C.errInvalid };
  if (inp.min !== undefined && v < inp.min) return { ok: false, error: C.errMin(formatValue(inp.min, { unit: inp.unit, locale: fmt.locale })) };
  if (inp.max !== undefined && v > inp.max) return { ok: false, error: C.errMax(formatValue(inp.max, { unit: inp.unit, locale: fmt.locale })) };
  return { ok: true, value: v };
}

/** Number for an editable text field: "4,5" (German comma, no grouping, full precision). */
export function numberToInputText(v: CalcValue, locale?: string): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  const s = String(Number(v.toPrecision(12)));
  return locale && /^en\b/i.test(locale) ? s : s.replace('.', ',');
}

/** Value with unit for display ("20.000 €", "4,5 %", "ja"). */
export function formatInputValue(inp: CalcInputDef, v: CalcValue, fmt: CalcFmt = {}): string {
  const C = fmt.text ?? S_DE.calc;
  const locale = fmt.locale;
  if (inp.kind === 'toggle') return v ? C.yes : C.no;
  if (inp.kind === 'select') return inp.options.find((o) => o.value === v)?.label ?? DASH;
  if (typeof v !== 'number') return DASH;
  // money with cents always shows two decimals ("86,40 €", but "20.000 €")
  if (inp.unit && CURRENCY_UNITS.has(inp.unit) && !Number.isInteger(v)) return formatValue(v, { format: 'number', unit: inp.unit, decimals: 2, locale });
  return formatValue(v, { format: 'number', unit: inp.unit, decimals: decimalsFor(inp.step), locale });
}

const CURRENCY_UNITS = new Set(['€', '$', '£', 'EUR', 'USD', 'GBP', 'CHF', 'Fr.']);

function decimalsFor(step: number | undefined): number | undefined {
  if (!step) return undefined;
  const d = (String(step).split('.')[1] ?? '').length;
  return d > 0 ? Math.min(4, d) : undefined;
}

/** Scope for the engine: toggles → booleans, select → option value, invalid/blank → null ("–"). */
export function toScope(inputs: CalcInputDef[], values: Record<string, CalcValue>): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  for (const i of inputs) {
    const v = values[i.name];
    s[i.name] = v === undefined ? null : v;
  }
  return s;
}

/* ───────────── outputs ───────────── */

export type OutputRow = {
  label: string;
  text: string;
  value: number | null;
  emphasis: boolean;
  /** model bug (syntax, unknown name): the row shows `notComputable`, details in the formula disclosure */
  error?: string;
};

/**
 * `text.notComputable` labels rows whose formula the engine rejects (default German, used for the
 * protocol reply). A text output (`texts`) shows the chosen string.
 */
export function computeOutputs(model: CalcModel, values: Record<string, CalcValue>, locale?: string, text?: Pick<typeof S_DE.calc, 'notComputable'>): OutputRow[] {
  const res = evaluateOutputs(toScope(model.inputs, values), model.outputs);
  return model.outputs.map((o, i) => {
    const r = res[i];
    const value = r && typeof r.value === 'number' && Number.isFinite(r.value) ? r.value : null;
    const error = r?.error?.message;
    const pick = o.texts && value !== null && Number.isInteger(value) ? o.texts[value] : undefined;
    return {
      label: o.label,
      value,
      text: error ? (text ?? S_DE.calc).notComputable : pick ?? formatValue(o.texts ? null : value, { format: o.format, decimals: o.decimals, unit: o.unit, locale }),
      emphasis: o.emphasis,
      error,
    };
  });
}

/** Rows split for layout: the first emphasised output (or the last output if none) is the hero. */
export function splitHero(rows: OutputRow[]): { hero: OutputRow | null; rest: OutputRow[] } {
  if (!rows.length) return { hero: null, rest: [] };
  let idx = rows.findIndex((r) => r.emphasis);
  if (idx < 0) idx = rows.length === 1 ? 0 : -1;
  if (idx < 0) return { hero: null, rest: rows };
  return { hero: rows[idx], rest: rows.filter((_, i) => i !== idx) };
}

export function computeSweep(model: CalcModel, values: Record<string, CalcValue>): { x: number; y: number }[] | null {
  if (!model.chart) return null;
  const r = sweep(model.chart, toScope(model.inputs, values), model.outputs);
  if (!r.ok) return null;
  const pts = r.points.filter((p): p is { x: number; y: number } => typeof p.y === 'number' && Number.isFinite(p.y));
  return pts.length >= 2 ? pts : null;
}

/* ───────────── reply ───────────── */

export const MAX_REPLY = 4000;

/**
 * `[calc:<id>] Kreditsumme 20.000 € · Zins p. a. 4,5 % · Laufzeit 60 Monate → Monatliche Rate 372,86 €`
 * Emphasised outputs come first; at most 6 outputs; total ≤ 4000 chars. Null when any input is
 * invalid or every output formula is broken (the button is disabled then).
 */
export function buildCalcReply(model: CalcModel, values: Record<string, CalcValue>, rows: OutputRow[]): string | null {
  const ins: string[] = [];
  // nothing computable because every formula is broken: nothing to hand back as a result
  if (rows.length && rows.every((r) => r.error)) return null;
  for (const i of model.inputs) {
    const v = values[i.name];
    if (i.kind !== 'toggle' && i.kind !== 'select' && (typeof v !== 'number' || !Number.isFinite(v))) return null;
    ins.push(i.kind === 'toggle' ? `${i.label}: ${v ? 'ja' : 'nein'}` : i.kind === 'select' ? `${i.label}: ${formatInputValue(i, v ?? null)}` : `${i.label} ${formatInputValue(i, v ?? null)}`);
  }
  const ordered = [...rows.filter((r) => r.emphasis), ...rows.filter((r) => !r.emphasis)].slice(0, 6);
  const outs = ordered.map((r) => `${r.label} ${r.text}`);
  let text = `[calc:${model.id}] ${ins.join(' · ')}${outs.length ? ` → ${outs.join(' · ')}` : ''}`;
  if (text.length > MAX_REPLY) text = text.slice(0, MAX_REPLY - 1) + '…';
  return text;
}

/* ───────────── rounding that adds up ───────────── */

/**
 * Splits `total` proportionally to `weights` and rounds every share to `decimals` such that the
 * shares sum EXACTLY to the rounded total (largest-remainder method; leftover cents go to the
 * largest fractional parts, ties to the earlier entry). Use it whenever rounded parts are shown
 * next to their total (bill split, budget shares, percentages that must add up to 100).
 *
 *   allocateRounded(100, [1, 1, 1])        → [33.34, 33.33, 33.33]
 *   allocateRounded(10, [1, 1, 1], 0)      → [4, 3, 3]
 *   allocateRounded(100, [], 2)            → []
 * Non-finite or negative weights count as 0; if all weights are 0 the total is split equally.
 */
export function allocateRounded(total: number, weights: readonly number[], decimals = 2): number[] {
  const n = weights.length;
  if (!n || !Number.isFinite(total)) return weights.map(() => 0);
  const d = Math.max(0, Math.min(6, Math.floor(decimals)));
  const scale = 10 ** d;
  const sign = total < 0 ? -1 : 1;
  const units = Math.round(Math.abs(total) * scale);
  let w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  let sum = w.reduce((a, b) => a + b, 0);
  if (sum === 0) {
    w = w.map(() => 1);
    sum = n;
  }
  const exact = w.map((x) => (units * x) / sum);
  const floors = exact.map((x) => Math.floor(x + 1e-9));
  let left = units - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, frac: x - floors[i] })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) floors[order[k].i] += 1;
  return floors.map((u) => (sign * u) / scale);
}
