import { CONSTANTS, IF_NAME, getFunction } from './functions.ts';
import { approxEq, fin, toNumber } from './numeric.ts';
import { CalcError } from './types.ts';
import type { Ast, EvalResult, Scope } from './types.ts';

const hasOwn = Object.prototype.hasOwnProperty;

function scopeHas(scope: Scope, name: string): boolean {
  if (scope instanceof Map) return scope.has(name);
  return hasOwn.call(scope, name);
}

function scopeGet(scope: Scope, name: string): unknown {
  if (scope instanceof Map) return scope.get(name);
  return (scope as Record<string, unknown>)[name];
}

function scopeNames(scope: Scope): string[] {
  const names = scope instanceof Map ? Array.from(scope.keys()) : Object.keys(scope);
  return names.filter((k) => typeof k === 'string');
}

/**
 * Truth value helper: NaN stays NaN ("unknown"), otherwise 1 for non-zero, 0 for zero.
 * All values in the engine are numbers; comparisons and logic yield 1 / 0.
 */
function truth(x: number): number {
  return Number.isNaN(x) ? NaN : x !== 0 ? 1 : 0;
}

function lookup(scope: Scope, name: string, pos: number, end: number): number {
  if (scopeHas(scope, name)) return toNumber(scopeGet(scope, name));
  const c = CONSTANTS.get(name);
  if (c !== undefined) return c;
  const known = scopeNames(scope).filter((k) => k.length < 40);
  const shown = known.slice(0, 12).join(', ');
  const low = name.toLowerCase();
  const near = known.find((k) => k.toLowerCase() === low);
  const hint = near
    ? ` – meintest du „${near}“?`
    : shown
      ? ` (verfügbar: ${shown}${known.length > 12 ? ', …' : ''})`
      : '';
  throw new CalcError('unknown_identifier', `Unbekannter Bezeichner „${name}“${hint}`, pos, end);
}

function ev(a: Ast, scope: Scope): number {
  switch (a.type) {
    case 'num':
      return a.value;
    case 'var':
      return lookup(scope, a.name, a.pos, a.end);
    case 'unary': {
      const v = ev(a.arg, scope);
      if (a.op === '-') return v === 0 ? 0 : -v;
      if (a.op === '+') return v;
      return Number.isNaN(v) ? NaN : v === 0 ? 1 : 0;
    }
    case 'cond': {
      const t = truth(ev(a.test, scope));
      if (Number.isNaN(t)) return NaN;
      return t ? ev(a.then, scope) : ev(a.else, scope);
    }
    case 'call': {
      if (a.name === IF_NAME) {
        const t = truth(ev(a.args[0], scope));
        if (Number.isNaN(t)) return NaN;
        return t ? ev(a.args[1], scope) : ev(a.args[2], scope);
      }
      const def = getFunction(a.name);
      if (!def) throw new CalcError('unknown_function', `Unbekannte Funktion „${a.name}“`, a.pos, a.end);
      const args: number[] = [];
      let bad = false;
      for (const x of a.args) {
        const v = ev(x, scope); // all arguments are evaluated, so unknown names are always reported
        if (Number.isNaN(v)) bad = true;
        args.push(v);
      }
      return bad ? NaN : fin(def.run(args));
    }
    case 'binary': {
      if (a.op === '&&') {
        const l = truth(ev(a.left, scope));
        if (Number.isNaN(l)) return NaN;
        if (l === 0) return 0;
        return truth(ev(a.right, scope));
      }
      if (a.op === '||') {
        const l = truth(ev(a.left, scope));
        if (Number.isNaN(l)) return NaN;
        if (l === 1) return 1;
        return truth(ev(a.right, scope));
      }
      const l = ev(a.left, scope);
      const r = ev(a.right, scope);
      if (Number.isNaN(l) || Number.isNaN(r)) return NaN;
      switch (a.op) {
        case '+': return fin(l + r);
        case '-': return fin(l - r);
        case '*': return fin(l * r);
        case '/': return r === 0 ? NaN : fin(l / r);
        case '%': return r === 0 ? NaN : fin(l % r);
        case '^': return fin(Math.pow(l, r));
        case '<': return l < r && !approxEq(l, r) ? 1 : 0;
        case '<=': return l < r || approxEq(l, r) ? 1 : 0;
        case '>': return l > r && !approxEq(l, r) ? 1 : 0;
        case '>=': return l > r || approxEq(l, r) ? 1 : 0;
        case '==': return approxEq(l, r) ? 1 : 0;
        case '!=': return approxEq(l, r) ? 0 : 1;
        default: return NaN;
      }
    }
  }
  return NaN;
}

/**
 * Evaluates an AST. Never throws. `value` is `null` when the result is NaN/Infinity
 * (division by zero, sqrt of a negative number, missing input value, ...).
 * Unknown identifiers are errors (not null), because they usually mean a typo in the expression.
 */
export function evaluate(ast: Ast, scope: Scope): EvalResult {
  try {
    const v = ev(ast, scope);
    return { ok: true, value: Number.isFinite(v) ? (v === 0 ? 0 : v) : null };
  } catch (e) {
    if (e instanceof CalcError) return { ok: false, error: e.toInfo() };
    return {
      ok: false,
      error: { code: 'internal', message: 'Interner Fehler bei der Berechnung', pos: -1, end: -1 },
    };
  }
}
