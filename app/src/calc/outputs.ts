import { compile } from './compile.ts';
import { RESERVED_NAMES } from './functions.ts';
import { toNumber } from './numeric.ts';
import { MAX_SWEEP_STEPS } from './types.ts';
import type { CalcErrorInfo, CalcOutputDef, OutputResult, Scope } from './types.ts';

const IDENT = /^[\p{L}_][\p{L}\p{N}_]*$/u;

function toMap(inputs: Scope): Map<string, unknown> {
  if (inputs instanceof Map) return new Map(inputs as Map<string, unknown>);
  const m = new Map<string, unknown>();
  for (const k of Object.keys(inputs)) m.set(k, (inputs as Record<string, unknown>)[k]);
  return m;
}

/**
 * Evaluates `outputs` in order against a copy of `inputs`. Each output that has a (valid) `name`
 * becomes visible to LATER outputs; forward references are "unbekannter Bezeichner" errors
 * (with a hint). An output that is not computable (null/error) is visible to later ones as
 * "not computable", so dependents become null too.
 *
 * `scope` is mutated and must be a private Map (use `evaluateOutputs` for the public API).
 */
export function evaluateOutputsInto(scope: Map<string, unknown>, outputs: readonly CalcOutputDef[]): OutputResult[] {
  const results: OutputResult[] = [];
  for (let i = 0; i < outputs.length; i++) {
    const def = outputs[i];
    const name = typeof def?.name === 'string' ? def.name : undefined;
    const c = compile(typeof def?.expr === 'string' ? def.expr : (undefined as unknown as string));
    let value: number | null = null;
    let error: CalcErrorInfo | undefined;
    if (!c.ok) {
      error = c.error;
    } else {
      const r = c.fn(scope);
      if (r.ok) value = r.value;
      else {
        error = r.error;
        if (r.error.code === 'unknown_identifier') {
          // forward reference hint
          for (let j = i + 1; j < outputs.length; j++) {
            const later = outputs[j]?.name;
            if (later && r.error.message.includes(`„${later}“`)) {
              error = { ...r.error, message: `${r.error.message} – „${later}“ wird erst in einem späteren Ergebnis berechnet` };
              break;
            }
          }
        }
      }
    }
    const res: OutputResult = { value };
    if (name !== undefined) res.name = name;
    if (error) res.error = error;
    results.push(res);
    if (name && IDENT.test(name) && !RESERVED_NAMES.has(name)) {
      scope.set(name, value === null ? NaN : value);
    }
  }
  return results;
}

/**
 * Public entry for the Calc component: `inputs` maps input names to their current values
 * (numbers, booleans for toggles, numeric strings are tolerated).
 * Never throws; one result per output, same order.
 */
export function evaluateOutputs(inputs: Scope, outputs: readonly CalcOutputDef[]): OutputResult[] {
  const scope = toMap(inputs);
  for (const [k, v] of scope) scope.set(k, toNumber(v)); // normalise once
  return evaluateOutputsInto(scope, outputs);
}

export interface CalcChartDef {
  kind?: 'line' | 'bar';
  sweep: { input: string; from: number; to: number; steps?: number };
  /** Expression over inputs + outputs (the swept input is replaced by x). */
  y: string;
  label?: string;
}

export interface SweepPoint {
  x: number;
  y: number | null;
}

export type SweepResult =
  | { ok: true; points: SweepPoint[] }
  | { ok: false; error: CalcErrorInfo };

function sweepError(message: string): SweepResult {
  return { ok: false, error: { code: 'sweep', message, pos: -1, end: -1 } };
}

/**
 * Samples `chart.y` for `chart.sweep.input` going from `from` to `to`.
 * `steps` = number of points (clamped to 2..MAX_SWEEP_STEPS = 60; `from === to` gives one point).
 * Every point re-evaluates all outputs (so `y` may reference output names).
 * Returns a single error if `y` does not compile or references unknown names.
 */
export function sweep(chart: CalcChartDef, inputs: Scope, outputs: readonly CalcOutputDef[]): SweepResult {
  const sw = chart?.sweep;
  if (!sw || typeof sw.input !== 'string' || !sw.input) return sweepError('Diagramm: sweep.input fehlt');
  const from = toNumber(sw.from);
  const to = toNumber(sw.to);
  if (Number.isNaN(from) || Number.isNaN(to)) return sweepError('Diagramm: sweep.from / sweep.to müssen Zahlen sein');
  const yc = compile(chart.y);
  if (!yc.ok) return { ok: false, error: yc.error };

  const rawSteps = sw.steps === undefined ? 20 : toNumber(sw.steps);
  const steps = from === to ? 1 : Math.min(MAX_SWEEP_STEPS, Math.max(2, Math.floor(Number.isNaN(rawSteps) ? 20 : rawSteps)));
  const base = toMap(inputs);
  for (const [k, v] of base) base.set(k, toNumber(v));

  const points: SweepPoint[] = [];
  for (let i = 0; i < steps; i++) {
    const x = steps === 1 ? from : i === steps - 1 ? to : from + ((to - from) * i) / (steps - 1);
    const scope = new Map(base);
    scope.set(sw.input, x);
    evaluateOutputsInto(scope, outputs);
    const r = yc.fn(scope);
    if (!r.ok) return { ok: false, error: r.error };
    points.push({ x, y: r.value });
  }
  return { ok: true, points };
}
