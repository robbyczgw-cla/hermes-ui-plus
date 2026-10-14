import { tokenize } from './tokenize.ts';
import { getFunction, functionNames, RESERVED_NAMES } from './functions.ts';
import { CalcError, MAX_AST_DEPTH, MAX_AST_NODES } from './types.ts';
import type { Ast, BinaryOp, Token, UnaryOp } from './types.ts';

/**
 * Precedence, low -> high:
 *   1 ?:  (right)   2 ||   3 &&   4 == !=  (non-assoc)   5 < <= > >=  (non-assoc)
 *   6 + -           7 * / %      8 unary - + !           9 ^ (right; binds tighter than unary
 *   minus on its left: -2^2 = -4; the exponent may itself be unary: 2^-3)
 */
const BINARY: ReadonlyMap<string, { prec: number; nonAssoc: boolean }> = new Map([
  ['||', { prec: 2, nonAssoc: false }],
  ['&&', { prec: 3, nonAssoc: false }],
  ['==', { prec: 4, nonAssoc: true }],
  ['!=', { prec: 4, nonAssoc: true }],
  ['<', { prec: 5, nonAssoc: true }],
  ['<=', { prec: 5, nonAssoc: true }],
  ['>', { prec: 5, nonAssoc: true }],
  ['>=', { prec: 5, nonAssoc: true }],
  ['+', { prec: 6, nonAssoc: false }],
  ['-', { prec: 6, nonAssoc: false }],
  ['*', { prec: 7, nonAssoc: false }],
  ['/', { prec: 7, nonAssoc: false }],
  ['%', { prec: 7, nonAssoc: false }],
]);

function describe(t: Token): string {
  switch (t.type) {
    case 'eof': return 'Ende des Ausdrucks';
    case 'num': return `Zahl ${t.text}`;
    case 'id': return `Bezeichner „${t.text}“`;
    default: return `„${t.text}“`;
  }
}

function astDepth(a: Ast): number {
  switch (a.type) {
    case 'num':
    case 'var':
      return 1;
    case 'unary':
      return 1 + astDepth(a.arg);
    case 'binary':
      return 1 + Math.max(astDepth(a.left), astDepth(a.right));
    case 'cond':
      return 1 + Math.max(astDepth(a.test), astDepth(a.then), astDepth(a.else));
    case 'call': {
      let m = 0;
      for (const x of a.args) m = Math.max(m, astDepth(x));
      return 1 + m;
    }
  }
}

function suggest(name: string, candidates: string[]): string {
  const low = name.toLowerCase();
  const hit = candidates.find((c) => c.toLowerCase() === low);
  return hit ? ` – meintest du „${hit}“?` : '';
}

/** Parses an expression into an AST. Throws CalcError (and only CalcError). */
export function parse(src: string): Ast {
  const tokens = tokenize(src);
  if (tokens.length === 1) throw new CalcError('empty', 'Leerer Ausdruck', 0);
  let p = 0;
  let nodes = 0;
  let nest = 0;

  const peek = (): Token => tokens[p];
  const next = (): Token => tokens[p++];
  const mk = <T extends Ast>(node: T): T => {
    if (++nodes > MAX_AST_NODES) {
      throw new CalcError('too_complex', `Ausdruck zu komplex (max. ${MAX_AST_NODES} Elemente)`, node.pos, node.end);
    }
    return node;
  };
  const enter = (t: Token) => {
    if (++nest > MAX_AST_DEPTH) {
      throw new CalcError('too_deep', `Ausdruck zu tief verschachtelt (max. ${MAX_AST_DEPTH} Ebenen)`, t.pos, t.end);
    }
  };
  const leave = () => {
    nest--;
  };

  const unexpected = (t: Token, expecting: boolean): CalcError => {
    if (t.type === 'eof') {
      return new CalcError('syntax', 'Ausdruck endet unerwartet – es fehlt ein Wert oder eine schließende Klammer', t.pos, t.end);
    }
    if (t.type === ',') {
      return new CalcError(
        'syntax',
        'Unerwartetes Komma – Dezimalzahlen mit Punkt schreiben (3.5 statt 3,5); Kommas trennen nur Funktionsargumente',
        t.pos,
        t.end,
      );
    }
    if (t.type === ')') return new CalcError('syntax', 'Unerwartete schließende Klammer „)“', t.pos, t.end);
    if (t.type === ':') return new CalcError('syntax', '„:“ ohne passendes „?“', t.pos, t.end);
    if (t.type === '?') return new CalcError('syntax', '„?“ ohne Bedingung davor', t.pos, t.end);
    if (expecting) {
      return new CalcError('syntax', `Wert erwartet, gefunden: ${describe(t)}`, t.pos, t.end);
    }
    return new CalcError(
      'syntax',
      `Unerwartet: ${describe(t)} – fehlt ein Operator dazwischen (z. B. * für Multiplikation)?`,
      t.pos,
      t.end,
    );
  };

  function parseTernary(): Ast {
    const start = peek();
    enter(start);
    try {
      const test = parseBinary(2);
      if (peek().type !== '?') return test;
      next();
      const a = parseTernary();
      if (peek().type !== ':') {
        const t = peek();
        throw new CalcError('syntax', 'Im Bedingungsausdruck „? :“ fehlt der „:“-Teil', t.pos, t.end);
      }
      next();
      const b = parseTernary();
      return mk({ type: 'cond', test, then: a, else: b, pos: test.pos, end: b.end });
    } finally {
      leave();
    }
  }

  function parseBinary(minPrec: number): Ast {
    let left = parseUnary();
    let lastNonAssoc = -1;
    for (;;) {
      const t = peek();
      if (t.type !== 'op') break;
      const info = BINARY.get(t.text);
      if (!info || info.prec < minPrec) break;
      if (info.nonAssoc && lastNonAssoc === info.prec) {
        throw new CalcError(
          'syntax',
          `Verkettete Vergleiche („a < b < c“) sind nicht erlaubt – mit && verbinden (a < b && b < c)`,
          t.pos,
          t.end,
        );
      }
      next();
      const right = parseBinary(info.prec + 1);
      lastNonAssoc = info.nonAssoc ? info.prec : -1;
      left = mk({ type: 'binary', op: t.text as BinaryOp, left, right, pos: left.pos, end: right.end });
    }
    return left;
  }

  function parseUnary(): Ast {
    const t = peek();
    if (t.type === 'op' && (t.text === '-' || t.text === '+' || t.text === '!')) {
      next();
      enter(t);
      try {
        const arg = parseUnary();
        return mk({ type: 'unary', op: t.text as UnaryOp, arg, pos: t.pos, end: arg.end });
      } finally {
        leave();
      }
    }
    return parsePower();
  }

  function parsePower(): Ast {
    const base = parsePrimary();
    const t = peek();
    if (t.type === 'op' && t.text === '^') {
      next();
      enter(t);
      try {
        const exp = parseUnary(); // right-assoc, allows 2^-n
        return mk({ type: 'binary', op: '^', left: base, right: exp, pos: base.pos, end: exp.end });
      } finally {
        leave();
      }
    }
    return base;
  }

  function parsePrimary(): Ast {
    const t = next();
    if (t.type === 'num') return mk({ type: 'num', value: t.value, pos: t.pos, end: t.end });
    if (t.type === '(') {
      const inner = parseTernary();
      const close = peek();
      if (close.type !== ')') {
        throw new CalcError('syntax', 'Klammer wird nicht geschlossen – „)“ fehlt', t.pos, t.end);
      }
      next();
      return inner;
    }
    if (t.type === 'id') {
      if (RESERVED_NAMES.has(t.text)) {
        throw new CalcError('reserved', `Name „${t.text}“ ist reserviert und nicht verwendbar`, t.pos, t.end);
      }
      if (peek().type === '(') {
        const fn = getFunction(t.text);
        if (!fn) {
          throw new CalcError(
            'unknown_function',
            `Unbekannte Funktion „${t.text}“${suggest(t.text, functionNames())} (erlaubt: ${functionNames().join(', ')})`,
            t.pos,
            t.end,
          );
        }
        next();
        const args: Ast[] = [];
        if (peek().type !== ')') {
          for (;;) {
            args.push(parseTernary());
            if (peek().type === ',') {
              next();
              continue;
            }
            break;
          }
        }
        const close = peek();
        if (close.type !== ')') {
          if (close.type === 'eof') {
            throw new CalcError('syntax', `Klammer von „${t.text}(“ wird nicht geschlossen – „)“ fehlt`, t.pos, t.end);
          }
          throw unexpected(close, false);
        }
        next();
        if (args.length < fn.min || args.length > fn.max) {
          const want = fn.max === Infinity ? `mindestens ${fn.min}` : fn.min === fn.max ? `${fn.min}` : `${fn.min} bis ${fn.max}`;
          throw new CalcError(
            'arity',
            `Funktion „${t.text}“ erwartet ${want} Argument(e), erhalten: ${args.length}`,
            t.pos,
            close.end,
          );
        }
        return mk({ type: 'call', name: t.text, args, pos: t.pos, end: close.end });
      }
      return mk({ type: 'var', name: t.text, pos: t.pos, end: t.end });
    }
    // a lone operator etc.
    throw unexpected(t, true);
  }

  const ast = parseTernary();
  const rest = peek();
  if (rest.type !== 'eof') throw unexpected(rest, false);
  if (astDepth(ast) > MAX_AST_DEPTH) {
    throw new CalcError('too_deep', `Ausdruck zu tief verschachtelt (max. ${MAX_AST_DEPTH} Ebenen)`, ast.pos, ast.end);
  }
  return ast;
}

/** Distinct variable names used by the AST, in order of first appearance. */
export function collectIdentifiers(ast: Ast): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const walk = (a: Ast) => {
    switch (a.type) {
      case 'var':
        if (!seen.has(a.name)) {
          seen.add(a.name);
          out.push(a.name);
        }
        return;
      case 'unary': walk(a.arg); return;
      case 'binary': walk(a.left); walk(a.right); return;
      case 'cond': walk(a.test); walk(a.then); walk(a.else); return;
      case 'call': a.args.forEach(walk); return;
      default: return;
    }
  };
  walk(ast);
  return out;
}
