import { evaluate } from './evaluate.ts';
import { collectIdentifiers, parse } from './parse.ts';
import { CACHE_SIZE, CalcError, MAX_EXPR_LENGTH } from './types.ts';
import type { CompileResult, EvalResult, Scope } from './types.ts';

const cache = new Map<string, CompileResult>();

function compileUncached(expr: string): CompileResult {
  try {
    const ast = parse(expr);
    return {
      ok: true,
      ast,
      identifiers: collectIdentifiers(ast),
      fn: (scope: Scope) => evaluate(ast, scope),
    };
  } catch (e) {
    if (e instanceof CalcError) return { ok: false, error: e.toInfo() };
    return {
      ok: false,
      error: { code: 'internal', message: 'Interner Fehler beim Parsen', pos: -1, end: -1 },
    };
  }
}

/**
 * Parses an expression once and returns an evaluator. Results (also failures) are kept in an
 * LRU cache (CACHE_SIZE entries), so calling `compile` on every render is cheap.
 */
export function compile(expr: string): CompileResult {
  if (typeof expr !== 'string') {
    return { ok: false, error: { code: 'type', message: 'Ausdruck muss ein Text sein', pos: -1, end: -1 } };
  }
  if (expr.length > MAX_EXPR_LENGTH) return compileUncached(expr); // not worth caching
  const hit = cache.get(expr);
  if (hit) {
    cache.delete(expr);
    cache.set(expr, hit);
    return hit;
  }
  const res = compileUncached(expr);
  cache.set(expr, res);
  if (cache.size > CACHE_SIZE) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  return res;
}

/** compile + evaluate in one go. */
export function evalExpr(expr: string, scope: Scope): EvalResult {
  const c = compile(expr);
  return c.ok ? c.fn(scope) : { ok: false, error: c.error };
}

/** Test/diagnostic helpers. */
export function cacheSize(): number {
  return cache.size;
}
export function clearCache(): void {
  cache.clear();
}
