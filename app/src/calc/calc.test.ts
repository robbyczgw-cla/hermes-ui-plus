/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tokenize,
  parse,
  compile,
  evalExpr,
  evaluate,
  evaluateOutputs,
  sweep,
  formatValue,
  NBSP,
  MAX_EXPR_LENGTH,
} from './index.ts';
import { cacheSize, clearCache } from './compile.ts';
import type { Scope } from './index.ts';

/** Evaluate and expect success; returns number | null. */
function v(expr: string, scope: Scope = {}): number | null {
  const r = evalExpr(expr, scope);
  if (!r.ok) assert.fail(`"${expr}" failed: ${r.error.message}`);
  return r.value;
}
function err(expr: string, scope: Scope = {}) {
  const r = evalExpr(expr, scope);
  if (r.ok) assert.fail(`"${expr}" should fail but gave ${r.value}`);
  return r.error;
}
function close(a: number | null, b: number, eps = 1e-9) {
  assert.ok(a !== null && Math.abs(a - b) <= eps, `${a} !~ ${b}`);
}

// ---------------------------------------------------------------- literals
test('number literals', () => {
  assert.equal(v('42'), 42);
  assert.equal(v('3.5'), 3.5);
  assert.equal(v('.5'), 0.5);
  assert.equal(v('1_000'), 1000);
  assert.equal(v('1_000_000.5'), 1000000.5);
  assert.equal(v('1e3'), 1000);
  assert.equal(v('2.5E-3'), 0.0025);
  assert.equal(v('1e+2'), 100);
  assert.equal(v('  7  '), 7);
});

test('German decimal comma is NOT accepted (with hint), bad underscores rejected', () => {
  const e = err('3,5 * 2');
  assert.equal(e.code, 'syntax');
  assert.match(e.message, /Dezimalzahlen mit Punkt/);
  assert.equal(e.pos, 1);
  assert.equal(err('1__0').code, 'number');
  assert.equal(err('1_').code, 'number');
  assert.equal(err('_1').code, 'unknown_identifier'); // identifier, not a number
  assert.equal(err('5.').code, 'number');
  assert.equal(err('1e999').code, 'number');
  assert.equal(err('0x10').code, 'number');
  assert.equal(err('2x').code, 'number');
});

test('1e is not an exponent: "2e" is an error, "2*e" is Euler', () => {
  assert.equal(err('2e').code, 'number');
  close(v('2*e'), 2 * Math.E);
});

// ---------------------------------------------------------------- precedence
test('operator precedence table', () => {
  const table: [string, number][] = [
    ['1 + 2 * 3', 7],
    ['(1 + 2) * 3', 9],
    ['10 - 2 - 3', 5], // left assoc
    ['100 / 10 / 5', 2], // left assoc
    ['2 ^ 3 ^ 2', 512], // right assoc
    ['(2 ^ 3) ^ 2', 64],
    ['-2 ^ 2', -4], // ^ binds tighter than unary minus
    ['(-2) ^ 2', 4],
    ['2 ^ -2', 0.25],
    ['2 ^ -1 ^ 2', 0.5], // 2 ^ (-(1^2))
    ['-3 + 5', 2],
    ['- -3', 3],
    ['+3', 3],
    ['--3', 3],
    ['2 * -3', -6],
    ['10 % 4', 2],
    ['10 % 4 * 3', 6], // same level as *, left assoc
    ['2 + 10 % 4', 4],
    ['-7 % 3', -1], // sign of dividend
    ['2 * 3 ^ 2', 18],
    ['1 + 2 < 4', 1],
    ['1 < 2 == 1', 1], // relational binds tighter than equality
    ['1 == 1 && 2 > 1', 1],
    ['1 || 0 && 0', 1], // && binds tighter than ||
    ['(1 || 0) && 0', 0],
    ['!0 + 1', 2], // ! binds tighter than +
    ['!1 == 0', 1],
    ['1 + 1 == 2', 1],
    ['0 ? 1 : 0 ? 2 : 3', 3], // ternary right assoc
    ['1 ? 2 : 3 + 4', 2],
    ['0 ? 2 : 3 + 4', 7],
    ['1 || 0 ? 5 : 6', 5],
  ];
  for (const [src, want] of table) assert.equal(v(src), want, src);
});

test('comparisons and chained comparison rejection', () => {
  assert.equal(v('1 < 2'), 1);
  assert.equal(v('2 <= 2'), 1);
  assert.equal(v('3 > 4'), 0);
  assert.equal(v('4 >= 4'), 1);
  assert.equal(v('1 == 1'), 1);
  assert.equal(v('1 != 1'), 0);
  assert.equal(v('0.1 + 0.2 == 0.3'), 1); // tolerant equality
  assert.equal(v('0.1 + 0.2 <= 0.3'), 1);
  assert.equal(v('0.1 + 0.2 < 0.3'), 0);
  assert.equal(err('1 < 2 < 3').code, 'syntax');
  assert.equal(err('1 == 1 == 1').code, 'syntax');
  assert.equal(v('(1 < 2) < 3'), 1);
});

test('unicode operators are mapped', () => {
  assert.equal(v('6 × 7'), 42);
  assert.equal(v('6 ÷ 3'), 2);
  assert.equal(v('5 − 2'), 3);
  assert.equal(v('2 ≤ 2 && 3 ≥ 3 && 1 ≠ 2'), 1);
});

// ---------------------------------------------------------------- logic
test('ternary, logic, short circuit', () => {
  assert.equal(v('1 ? 10 : 20'), 10);
  assert.equal(v('0 ? 10 : 20'), 20);
  assert.equal(v('x > 5 ? x : 5', { x: 9 }), 9);
  assert.equal(v('x > 5 ? x : 5', { x: 2 }), 5);
  assert.equal(v('a ? b ? 1 : 2 : 3', { a: 1, b: 0 }), 2);
  assert.equal(v('0 && 1'), 0);
  assert.equal(v('2 && 3'), 1); // logic yields 1/0
  assert.equal(v('0 || 0'), 0);
  assert.equal(v('0 || 5'), 1);
  assert.equal(v('!5'), 0);
  assert.equal(v('!0'), 1);
  assert.equal(v('toggle && x > 1', { toggle: true, x: 2 }), 1);
  assert.equal(v('toggle ? 1 : 2', { toggle: false }), 2);
  // lazy: the dead branch is not evaluated, so division by zero there is harmless
  assert.equal(v('b == 0 ? 0 : a / b', { a: 1, b: 0 }), 0);
  assert.equal(v('if(b == 0, 0, a / b)', { a: 6, b: 3 }), 2);
  assert.equal(v('b != 0 && a / b > 1', { a: 1, b: 0 }), 0);
  assert.equal(v('b == 0 || a / b > 1', { a: 1, b: 0 }), 1);
  // unknown identifiers in a dead branch are only reported when evaluated
  assert.equal(v('1 ? 1 : nope'), 1);
  assert.equal(err('0 ? 1 : nope').code, 'unknown_identifier');
});

test('ternary requires both branches', () => {
  assert.match(err('1 ? 2').message, /„:“/);
  assert.equal(err('1 : 2').code, 'syntax');
  assert.equal(err('? 1 : 2').code, 'syntax');
});

// ---------------------------------------------------------------- functions
test('functions', () => {
  assert.equal(v('min(3, 1, 2)'), 1);
  assert.equal(v('max(3, 1, 2)'), 3);
  assert.equal(v('min(5)'), 5);
  assert.equal(v('round(2.5)'), 3);
  assert.equal(v('round(-2.5)'), -3);
  assert.equal(v('round(1.005, 2)'), 1.01);
  assert.equal(v('round(2.675, 2)'), 2.68);
  assert.equal(v('round(1234.5678, 1)'), 1234.6);
  assert.equal(v('round(1234, -2)'), 1200);
  assert.equal(v('round(1.5, 0.5)'), null); // non-integer digits
  assert.equal(v('floor(2.9)'), 2);
  assert.equal(v('floor(-2.1)'), -3);
  assert.equal(v('ceil(2.1)'), 3);
  assert.equal(v('abs(-4)'), 4);
  assert.equal(v('sqrt(16)'), 4);
  assert.equal(v('sqrt(-1)'), null);
  assert.equal(v('pow(2, 10)'), 1024);
  assert.equal(v('pow(2, 0.5)'), Math.SQRT2);
  assert.equal(v('log(1000)'), 3);
  assert.equal(v('log(0)'), null);
  assert.equal(v('log(-5)'), null);
  assert.equal(v('ln(e)'), 1);
  assert.equal(v('ln(0)'), null);
  assert.equal(v('exp(0)'), 1);
  assert.equal(v('exp(1000)'), null);
  assert.equal(v('clamp(15, 0, 10)'), 10);
  assert.equal(v('clamp(-5, 0, 10)'), 0);
  assert.equal(v('clamp(5, 0, 10)'), 5);
  assert.equal(v('clamp(5, 10, 0)'), null);
  assert.equal(v('if(1, 2, 3)'), 2);
  assert.equal(v('if(0, 2, 3)'), 3);
  assert.equal(v('max(1, min(5, 3)) + abs(-1)'), 4);
});

test('constants and scope shadowing', () => {
  assert.equal(v('pi'), Math.PI);
  assert.equal(v('e'), Math.E);
  close(v('2 * pi * r', { r: 1 }), 2 * Math.PI);
  assert.equal(v('e * 2', { e: 5 }), 10); // scope wins over constants
});

test('arity and unknown functions', () => {
  assert.equal(err('min()').code, 'arity');
  assert.equal(err('round(1,2,3)').code, 'arity');
  assert.equal(err('sqrt(1,2)').code, 'arity');
  assert.equal(err('clamp(1,2)').code, 'arity');
  assert.equal(err('if(1,2)').code, 'arity');
  const e = err('foo(1)');
  assert.equal(e.code, 'unknown_function');
  assert.match(e.message, /foo/);
  assert.match(err('Max(1,2)').message, /meintest du „max“/);
  assert.equal(err('eval("1")').code, 'char'); // string char hit first
  assert.equal(err('x(1)', { x: 1 }).code, 'unknown_function'); // variables are not callable
  assert.equal(err('(1)(2)').code, 'syntax');
  assert.equal(err('min(1,)').code, 'syntax');
  assert.equal(err('min(,1)').code, 'syntax');
});

// ---------------------------------------------------------------- NaN / null
test('division by zero, NaN and Infinity give null', () => {
  assert.equal(v('1 / 0'), null);
  assert.equal(v('0 / 0'), null);
  assert.equal(v('5 % 0'), null);
  assert.equal(v('0 ^ -1'), null);
  assert.equal(v('10 ^ 400'), null);
  assert.equal(v('1e308 * 10'), null);
  assert.equal(v('1 / 0 + 5'), null); // propagates
  assert.equal(v('1 / (1 / 0)'), null); // not "0"
  assert.equal(v('(1 / 0) > 1 ? 1 : 2'), null);
  assert.equal(v('(-8) ^ 0.5'), null);
  assert.equal(v('max(1, 1/0)'), null);
  assert.equal(v('-0'), 0);
  assert.ok(Object.is(v('0 * -1'), 0)); // no negative zero
});

test('scope values: booleans, numeric strings, junk', () => {
  assert.equal(v('t + 1', { t: true }), 2);
  assert.equal(v('s * 2', { s: '21' }), 42);
  assert.equal(v('s * 2', { s: ' 1.5e1 ' }), 30);
  assert.equal(v('s * 2', { s: 'abc' }), null);
  assert.equal(v('s * 2', { s: '' }), null);
  assert.equal(v('s * 2', { s: null }), null);
  assert.equal(v('s * 2', { s: undefined }), null);
  assert.equal(v('s * 2', { s: {} }), null);
  assert.equal(v('s * 2', { s: [1] }), null);
  assert.equal(v('s * 2', { s: NaN }), null);
  assert.equal(v('s * 2', { s: Infinity }), null);
  assert.equal(v('a + b', new Map<string, unknown>([['a', 1], ['b', 2]])), 3);
});

// ---------------------------------------------------------------- errors
test('errors carry German text and position', () => {
  let e = err('1 + * 2');
  assert.equal(e.pos, 4);
  assert.match(e.message, /Position 5/);
  assert.match(e.message, /Wert erwartet/);

  e = err('(1 + 2');
  assert.equal(e.pos, 0);
  assert.match(e.message, /Klammer/);

  e = err('1 + 2)');
  assert.equal(e.pos, 5);
  assert.match(e.message, /schließende Klammer/);

  e = err('2 x');
  assert.equal(e.pos, 2);
  assert.match(e.message, /Operator/);

  e = err('1 +');
  assert.equal(e.pos, 3);
  assert.match(e.message, /endet unerwartet/);

  e = err('a = 5', { a: 1 });
  assert.equal(e.pos, 2);
  assert.match(e.message, /Zuweisung/);

  e = err('a & b', { a: 1, b: 1 });
  assert.match(e.message, /&&/);
  e = err('a | b', { a: 1, b: 1 });
  assert.match(e.message, /\|\|/);

  e = err('"abc"');
  assert.match(e.message, /Zeichenketten/);
  e = err("'a'");
  assert.match(e.message, /Zeichenketten/);
  e = err('a.b', { a: 1 });
  assert.match(e.message, /Eigenschaftszugriff/);
  assert.equal(e.pos, 1);
  e = err('a[0]', { a: 1 });
  assert.equal(e.code, 'char');
  e = err('a; b', { a: 1, b: 1 });
  assert.equal(e.code, 'char');
  e = err('a === 1', { a: 1 });
  assert.equal(e.code, 'char');
  e = err('x + y', { x: 1 });
  assert.equal(e.code, 'unknown_identifier');
  assert.equal(e.pos, 4);
  assert.match(e.message, /„y“/);
  assert.match(e.message, /verfügbar: x/);
  e = err('Zins', { zins: 4 });
  assert.match(e.message, /meintest du „zins“/);
  e = err('');
  assert.equal(e.code, 'empty');
  e = err('   ');
  assert.equal(e.code, 'empty');
  e = err('1 \u0000 2');
  assert.equal(e.code, 'char');
  e = err('1 + 😀');
  assert.equal(e.code, 'char');
  assert.equal(err(42 as unknown as string).code, 'type');
  assert.equal(err(undefined as unknown as string).code, 'type');
});

test('a++b is a + (+b); a+++b too', () => {
  assert.equal(v('a++b', { a: 1, b: 2 }), 3);
  assert.equal(v('a--b', { a: 1, b: 2 }), 3);
});

// ---------------------------------------------------------------- limits & security
test('limits: expression length', () => {
  const ok = '1 + '.repeat(40) + '1'; // within depth/node limits, padded
  assert.equal(v(ok + ' '.repeat(300)), 41);
  const long = '1'.repeat(MAX_EXPR_LENGTH + 1);
  const e = err(long);
  assert.equal(e.code, 'too_long');
  assert.equal(v('1'.repeat(MAX_EXPR_LENGTH).slice(0, 15)), 111111111111111);
  assert.equal(compile(' '.repeat(MAX_EXPR_LENGTH) + '1').ok, false);
  assert.equal(compile(' '.repeat(MAX_EXPR_LENGTH - 1) + '1').ok, true);
});

test('limits: nesting depth', () => {
  const nest = (n: number) => '('.repeat(n) + '1' + ')'.repeat(n);
  assert.equal(v(nest(40)), 1);
  assert.equal(err(nest(60)).code, 'too_deep');
  assert.equal(err(nest(240)).code, 'too_deep'); // 480 chars, must not blow the stack
  assert.equal(err('-'.repeat(300) + '1').code, 'too_deep');
  assert.equal(err('!'.repeat(60) + '1').code, 'too_deep');
  assert.equal(err('2^'.repeat(60) + '2').code, 'too_deep');
  assert.equal(err('abs('.repeat(60) + '1' + ')'.repeat(60)).code, 'too_deep');
  assert.equal(err('1?'.repeat(60) + '1' + ':1'.repeat(60)).code, 'too_deep');
  // left-leaning chain: AST depth grows with every term
  assert.equal(v('1' + '+1'.repeat(40)), 41);
  assert.equal(err('1' + '+1'.repeat(60)).code, 'too_deep');
});

test('limits: node count', () => {
  // wide but shallow: min(...) with many args -> only node count limits it
  const args = Array.from({ length: 150 }, () => '1').join(',');
  assert.equal(v(`max(${args})`), 1); // 151 nodes
  const tooMany = Array.from({ length: 210 }, () => '1').join(',');
  assert.equal(err(`max(${tooMany})`).code, 'too_complex');
  assert.ok(`max(${tooMany})`.length < MAX_EXPR_LENGTH);
});

test('hostile identifiers never resolve', () => {
  const names = [
    'constructor',
    '__proto__',
    'prototype',
    'globalThis',
    'toString',
    'hasOwnProperty',
    'valueOf',
    'window',
    'process',
    'require',
    'this',
    'Function',
    'eval',
    '__defineGetter__',
  ];
  for (const n of names) {
    const e = err(n);
    assert.ok(e.code === 'unknown_identifier' || e.code === 'reserved', `${n}: ${e.code}`);
    const e2 = err(`${n}(1)`);
    assert.ok(e2.code === 'unknown_function' || e2.code === 'reserved', `${n}(): ${e2.code}`);
    // also with scopes that inherit from Object.prototype or have a real prototype chain
    assert.equal(evalExpr(n, {}).ok, false);
    assert.equal(evalExpr(n, new Map()).ok, false);
    assert.equal(evalExpr(n, Object.create({ [n]: 5 })).ok, false); // inherited, not own
  }
  assert.equal(err('constructor.constructor("return 1")()').code, 'char');
  assert.equal(err('a.constructor', { a: 1 }).code, 'char');
  assert.equal(err('a["constructor"]', { a: 1 }).code, 'char');
  assert.equal(err('__proto__ + 1', { __proto__: { x: 1 } } as Scope).code, 'reserved');
  // even a scope that explicitly owns the reserved names cannot expose them
  const own = JSON.parse('{"__proto__": 7, "constructor": 8}') as Scope;
  assert.equal(err('__proto__', own).code, 'reserved');
  assert.equal(err('constructor', own).code, 'reserved');
});

test('no code execution surface: template/regex/arrow/new/import syntax is rejected', () => {
  for (const s of ['`1`', '() => 1', 'new Date()', 'import("x")', '/a/', 'a => a', '1;2', '{}', '[]', '$x', '@', '#', '\\', '~1', '1 ?? 2', '1 ?. 2', 'x++']) {
    assert.equal(evalExpr(s, { x: 1 }).ok, false, s);
  }
});

test('tokenize never returns positions out of range and is deterministic', () => {
  const t = tokenize('a + 12.5*(b)');
  assert.deepEqual(t.map((x) => x.type), ['id', 'op', 'num', 'op', '(', 'id', ')', 'eof']);
  assert.equal(t[2].value, 12.5);
  assert.equal(t[2].pos, 4);
});

test('parse produces expected AST shape and evaluate works on it directly', () => {
  const ast = parse('1 + 2 * x');
  assert.equal(ast.type, 'binary');
  const r = evaluate(ast, { x: 3 });
  assert.deepEqual(r, { ok: true, value: 7 });
  const r2 = evaluate(ast, {});
  assert.equal(r2.ok, false);
});

// ---------------------------------------------------------------- compile / cache
test('compile: ok/err shape, identifiers, caching', () => {
  clearCache();
  const c = compile('a * b + a');
  assert.ok(c.ok);
  if (c.ok) {
    assert.deepEqual(c.identifiers, ['a', 'b']);
    assert.deepEqual(c.fn({ a: 2, b: 3 }), { ok: true, value: 8 });
    assert.deepEqual(c.fn({ a: 2, b: 0 }), { ok: true, value: 2 });
    const bad = c.fn({ a: 1 });
    assert.equal(bad.ok, false);
  }
  assert.equal(compile('a * b + a'), c); // same object from cache
  const bad = compile('1 +');
  assert.equal(bad.ok, false);
  assert.equal(compile('1 +'), bad); // failures are cached too
});

test('compile cache is an LRU with bounded size', () => {
  clearCache();
  const first = compile('1+1');
  for (let i = 0; i < 150; i++) compile(`${i}+1`);
  assert.equal(compile('1+1'), first); // refresh -> most recently used
  for (let i = 1000; i < 1100; i++) compile(`${i}+1`);
  assert.ok(cacheSize() <= 200);
  assert.equal(compile('1+1'), first, 'recently used entry must survive eviction');
  assert.notEqual(compile('0+1'), undefined);
  for (let i = 2000; i < 2300; i++) compile(`${i}+1`);
  assert.equal(cacheSize(), 200);
  assert.notEqual(compile('1+1'), first); // evicted eventually, but recompiles fine
  assert.equal(compile('1+1').ok, true);
});

// ---------------------------------------------------------------- real world
test('annuity loan: P * r / (1 - (1 + r)^-n)', () => {
  const scope = { kredit: 20000, zins: 4.5, monate: 60 };
  const [rr, rate, total, interest] = evaluateOutputs(scope, [
    { name: 'r', expr: 'zins / 100 / 12' },
    { name: 'rate', expr: 'r == 0 ? kredit / monate : kredit * r / (1 - (1 + r) ^ -monate)' },
    { name: 'gesamt', expr: 'rate * monate' },
    { expr: 'gesamt - kredit' },
  ]);
  close(rr.value, 0.00375, 1e-12);
  close(rate.value, 372.86038483, 1e-6);
  const outs = evaluateOutputs(scope, [
    { name: 'r', expr: 'zins / 100 / 12' },
    { name: 'rate', expr: 'r == 0 ? kredit / monate : kredit * r / (1 - (1 + r) ^ -monate)' },
  ]);
  assert.equal(formatValue(outs[1].value, { format: 'currency' }), `372,86${NBSP}€`);
  close(total.value, 22371.62, 0.01);
  assert.ok(interest.value !== null && interest.value > 2300 && interest.value < 2400);
  // zero interest: no division by zero, falls back to linear
  const zero = evaluateOutputs({ ...scope, zins: 0 }, [
    { name: 'r', expr: 'zins / 100 / 12' },
    { expr: 'r == 0 ? kredit / monate : kredit * r / (1 - (1 + r) ^ -monate)' },
  ]);
  close(zero[1].value, 20000 / 60);
  // without the guard the same input gives null (UI shows "–"), not NaN
  assert.equal(v('kredit * r / (1 - (1 + r) ^ -n)', { kredit: 1000, r: 0, n: 12 }), null);
});

test('compound interest, tip splitter, BMI, unit conversion, VAT', () => {
  // compound interest: K * (1 + p/100)^years, monthly savings variant
  close(v('k * (1 + p / 100) ^ j', { k: 10000, p: 3, j: 10 }), 13439.16379, 1e-4);
  close(v('k * (1 + p / 100 / 12) ^ (12 * j)', { k: 10000, p: 3, j: 10 }), 13493.54, 1e-2);
  close(v('s * (((1 + r) ^ n - 1) / r)', { s: 100, r: 0.005, n: 120 }), 16387.93, 1e-2);
  // tip splitter
  const tip = evaluateOutputs({ bill: 86.4, tipPct: 10, people: 3 }, [
    { name: 'tip', expr: 'round(bill * tipPct / 100, 2)' },
    { name: 'total', expr: 'bill + tip' },
    { name: 'each', expr: 'total / max(people, 1)' },
  ]);
  assert.deepEqual(tip.slice(0, 2).map((t) => t.value), [8.64, 95.04]);
  close(tip[2].value, 31.68);
  assert.equal(formatValue(tip[2].value, { format: 'currency' }), `31,68${NBSP}€`);
  // BMI incl. category via nested ternary
  const bmi = evaluateOutputs({ kg: 72, cm: 180 }, [
    { name: 'bmi', expr: 'kg / (cm / 100) ^ 2' },
    { expr: 'bmi < 18.5 ? 1 : bmi < 25 ? 2 : bmi < 30 ? 3 : 4' },
  ]);
  close(bmi[0].value, 22.2222, 1e-4);
  assert.equal(bmi[1].value, 2);
  assert.equal(formatValue(bmi[0].value, { decimals: 1 }), '22,2');
  // unit conversion with select factor + toggle
  close(v('km * (miles ? 0.621371 : 1)', { km: 100, miles: true }), 62.1371);
  assert.equal(v('km * (miles ? 0.621371 : 1)', { km: 100, miles: false }), 100);
  close(v('c * 9 / 5 + 32', { c: 37 }), 98.6);
  // VAT: net -> gross and gross -> net
  const vat = evaluateOutputs({ net: 100, rate: 19 }, [
    { name: 'tax', expr: 'net * rate / 100' },
    { name: 'gross', expr: 'net + tax' },
    { expr: 'gross / (1 + rate / 100)' },
  ]);
  assert.deepEqual(vat.map((x) => x.value), [19, 119, 100]);
});

// ---------------------------------------------------------------- evaluateOutputs
test('evaluateOutputs: order, forward refs, errors, hostile names', () => {
  const r = evaluateOutputs({ a: 2 }, [
    { name: 'b', expr: 'a * 2' },
    { name: 'c', expr: 'b + a' },
    { expr: 'c * d' }, // d unknown
    { name: 'd', expr: 'a' },
    { expr: 'later + 1' }, // forward ref to "later2" below is not this one
    { name: 'later2', expr: '1' },
    { expr: 'later2 + 1' },
  ]);
  assert.deepEqual(r.map((x) => x.value), [4, 6, null, 2, null, 1, 2]);
  assert.equal(r[2].error?.code, 'unknown_identifier');
  assert.equal(r[4].error?.code, 'unknown_identifier');
  const fwd = evaluateOutputs({}, [{ expr: 'x + 1' }, { name: 'x', expr: '5' }]);
  assert.match(fwd[0].error?.message ?? '', /später/);
  assert.equal(fwd[1].value, 5);
  assert.equal(fwd[0].name, undefined);
  assert.equal(fwd[1].name, 'x');
});

test('evaluateOutputs: failed output makes dependents null (no throw), inputs untouched', () => {
  const inputs = { a: 0 };
  const r = evaluateOutputs(inputs, [
    { name: 'q', expr: '1 / a' },
    { expr: 'q + 1' },
    { name: 'bad', expr: '1 +' },
    { expr: 'bad * 2' },
    { expr: undefined as unknown as string },
  ]);
  assert.deepEqual(r.map((x) => x.value), [null, null, null, null, null]);
  assert.equal(r[0].error, undefined); // plain division by zero is not an error
  assert.equal(r[2].error?.code, 'syntax');
  assert.equal(r[3].error, undefined);
  assert.equal(r[4].error?.code, 'type');
  assert.deepEqual(inputs, { a: 0 });
  assert.deepEqual(evaluateOutputs({}, []), []);
});

test('evaluateOutputs: output names that are not identifiers or are reserved are not injected', () => {
  const r = evaluateOutputs({}, [
    { name: '__proto__', expr: '5' },
    { name: 'my var', expr: '6' },
    { expr: '__proto__' },
    { expr: 'x' },
  ]);
  assert.equal(r[0].value, 5);
  assert.equal(r[2].error?.code, 'reserved');
  assert.equal(r[3].error?.code, 'unknown_identifier');
});

test('evaluateOutputs: output shadows input of same name for later outputs', () => {
  const r = evaluateOutputs({ x: 1 }, [{ name: 'x', expr: 'x + 1' }, { expr: 'x' }]);
  assert.deepEqual(r.map((o) => o.value), [2, 2]);
});

// ---------------------------------------------------------------- formatting
test('formatValue: number', () => {
  assert.equal(formatValue(1234.5), '1.234,5');
  assert.equal(formatValue(1234567.891), '1.234.567,89');
  assert.equal(formatValue(0), '0');
  assert.equal(formatValue(42), '42');
  assert.equal(formatValue(-1234.5), '-1.234,5');
  assert.equal(formatValue(22.2222, { decimals: 1 }), '22,2');
  assert.equal(formatValue(3, { decimals: 2 }), '3,00');
  assert.equal(formatValue(2.5, { decimals: 0 }), '3');
  assert.equal(formatValue(1.005, { decimals: 2 }), '1,01');
  assert.equal(formatValue(0.0123), '0,012');
  assert.equal(formatValue(0.5), '0,5');
  assert.equal(formatValue(-0.001, { decimals: 1 }), '0,0'); // no "-0,0"
  assert.equal(formatValue(999.999, { decimals: 2 }), '1.000,00');
  assert.equal(formatValue(72, { unit: 'kg' }), `72${NBSP}kg`);
  assert.equal(formatValue(1e22), '1,00e22');
  assert.equal(formatValue(5, { decimals: 99 }), '5,0000000000');
  assert.equal(formatValue(5, { decimals: -3 }), '5');
});

test('formatValue: null / NaN / Infinity -> dash', () => {
  for (const x of [null, undefined, NaN, Infinity, -Infinity, 'x' as unknown as number]) {
    for (const format of ['number', 'currency', 'percent', 'duration', 'integer'] as const) {
      assert.equal(formatValue(x, { format }), '–');
    }
  }
});

test('formatValue: integer and currency', () => {
  assert.equal(formatValue(1234.5, { format: 'integer' }), '1.235');
  assert.equal(formatValue(-0.4, { format: 'integer' }), '0');
  assert.equal(formatValue(7, { format: 'integer', unit: 'Stück' }), `7${NBSP}Stück`);
  assert.equal(formatValue(372.8625, { format: 'currency' }), `372,86${NBSP}€`);
  assert.equal(formatValue(1234567.5, { format: 'currency' }), `1.234.567,50${NBSP}€`);
  assert.equal(formatValue(-5, { format: 'currency' }), `-5,00${NBSP}€`);
  assert.equal(formatValue(5, { format: 'currency', decimals: 0 }), `5${NBSP}€`);
  assert.equal(formatValue(5, { format: 'currency', currency: 'USD' }), `5,00${NBSP}$`);
  assert.equal(formatValue(5, { format: 'currency', currency: 'chf' }), `5,00${NBSP}CHF`);
  assert.equal(formatValue(1234.5, { format: 'currency', currency: 'USD', locale: 'en-US' }), '$1,234.50');
  assert.equal(formatValue(1234.5, { locale: 'en-US' }), '1,234.5');
  assert.equal(formatValue(12, { format: 'currency', unit: '€' }), `12,00${NBSP}€`); // unit equal to symbol is dropped
  assert.equal(formatValue(12, { format: 'currency', unit: 'pro Monat' }), `12,00${NBSP}€${NBSP}pro Monat`);
});

test('formatValue: percent multiplies by 100', () => {
  assert.equal(formatValue(0.045, { format: 'percent' }), `4,5${NBSP}%`);
  assert.equal(formatValue(0.19, { format: 'percent' }), `19${NBSP}%`);
  assert.equal(formatValue(0.045, { format: 'percent', decimals: 2 }), `4,50${NBSP}%`);
  assert.equal(formatValue(1, { format: 'percent', decimals: 0 }), `100${NBSP}%`);
  assert.equal(formatValue(-0.025, { format: 'percent' }), `-2,5${NBSP}%`);
  assert.equal(formatValue(0.04567, { format: 'percent' }), `4,57${NBSP}%`);
  assert.equal(formatValue(0.045, { format: 'percent', unit: 'p. a.' }), `4,5${NBSP}%${NBSP}p. a.`);
  assert.equal(formatValue(0.045, { format: 'percent', locale: 'en-US' }), '4.5%');
  // convention: an input in percent units (4.5) is divided by 100 in the expression
  const r = evaluateOutputs({ zins: 4.5 }, [{ expr: 'zins / 100' }]);
  assert.equal(formatValue(r[0].value, { format: 'percent' }), `4,5${NBSP}%`);
});

test('formatValue: duration', () => {
  assert.equal(formatValue(63, { format: 'duration' }), '5 J 3 M');
  assert.equal(formatValue(7, { format: 'duration' }), '7 M');
  assert.equal(formatValue(24, { format: 'duration' }), '2 J');
  assert.equal(formatValue(0, { format: 'duration' }), '0 M');
  assert.equal(formatValue(12.4, { format: 'duration' }), '1 J');
  assert.equal(formatValue(-14, { format: 'duration' }), '-1 J 2 M');
  assert.equal(formatValue(5.25, { format: 'duration', durationUnit: 'years' }), '5 J 3 M');
  assert.equal(formatValue(3725, { format: 'duration', durationUnit: 'seconds' }), '1 h 2 min 5 s');
  assert.equal(formatValue(90, { format: 'duration', durationUnit: 'minutes' }), '1 h 30 min');
  assert.equal(formatValue(0.5, { format: 'duration', durationUnit: 'hours' }), '30 min');
  assert.equal(formatValue(0, { format: 'duration', durationUnit: 'seconds' }), '0 s');
  assert.equal(formatValue(63, { format: 'duration', unit: 'x' }), '5 J 3 M'); // unit ignored
});

// ---------------------------------------------------------------- sweep
test('sweep: points, endpoints, output references, clamping', () => {
  const outputs = [{ name: 'rate', expr: 'kredit * (zins / 100 / 12) / (1 - (1 + zins / 100 / 12) ^ -monate)' }];
  const res = sweep(
    { kind: 'line', sweep: { input: 'monate', from: 12, to: 120, steps: 10 }, y: 'rate' },
    { kredit: 20000, zins: 4.5, monate: 60 },
    outputs,
  );
  assert.ok(res.ok);
  if (!res.ok) return;
  assert.equal(res.points.length, 10);
  assert.equal(res.points[0].x, 12);
  assert.equal(res.points[9].x, 120);
  const ys = res.points.map((p) => p.y as number);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] < ys[i - 1], 'rate falls with longer term');
  // direct expression
  const lin = sweep({ sweep: { input: 'x', from: 0, to: 4, steps: 5 }, y: 'x * 2' }, {}, []);
  assert.ok(lin.ok);
  if (lin.ok) assert.deepEqual(lin.points, [0, 1, 2, 3, 4].map((x) => ({ x, y: x * 2 })));
  // clamps to 60 and at least 2; defaults to 20
  const many = sweep({ sweep: { input: 'x', from: 0, to: 1, steps: 1000 }, y: 'x' }, {}, []);
  assert.ok(many.ok && many.points.length === 60);
  const few = sweep({ sweep: { input: 'x', from: 0, to: 1, steps: 1 }, y: 'x' }, {}, []);
  assert.ok(few.ok && few.points.length === 2);
  const def = sweep({ sweep: { input: 'x', from: 0, to: 1 }, y: 'x' }, {}, []);
  assert.ok(def.ok && def.points.length === 20);
  const same = sweep({ sweep: { input: 'x', from: 3, to: 3, steps: 10 }, y: 'x' }, {}, []);
  assert.ok(same.ok && same.points.length === 1);
  const desc = sweep({ sweep: { input: 'x', from: 10, to: 0, steps: 3 }, y: 'x' }, {}, []);
  assert.ok(desc.ok && desc.points.map((p) => p.x).join() === '10,5,0');
  // null points where y is not computable
  const nul = sweep({ sweep: { input: 'x', from: -1, to: 1, steps: 3 }, y: '1 / x' }, {}, []);
  assert.ok(nul.ok && nul.points[1].y === null && nul.points[0].y === -1);
  // the swept input overrides the base value; base inputs untouched
  const base = { x: 100 };
  const o = sweep({ sweep: { input: 'x', from: 1, to: 2, steps: 2 }, y: 'x' }, base, []);
  assert.ok(o.ok && o.points[0].y === 1);
  assert.equal(base.x, 100);
});

test('sweep: errors', () => {
  assert.equal((sweep({ sweep: { input: 'x', from: 0, to: 1 }, y: '1 +' }, {}, []) as { ok: false }).ok, false);
  const unk = sweep({ sweep: { input: 'x', from: 0, to: 1 }, y: 'nope' }, {}, []);
  assert.ok(!unk.ok && unk.error.code === 'unknown_identifier');
  const bad = sweep({ sweep: { input: 'x', from: 'a' as unknown as number, to: 1 }, y: 'x' }, {}, []);
  assert.ok(!bad.ok && bad.error.code === 'sweep');
  const nosweep = sweep({ y: 'x' } as never, {}, []);
  assert.ok(!nosweep.ok);
  const noinput = sweep({ sweep: { input: '', from: 0, to: 1 }, y: 'x' }, {}, []);
  assert.ok(!noinput.ok);
  assert.ok(!sweep(null as never, {}, []).ok);
});

// ---------------------------------------------------------------- fuzz
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const FRAGMENTS = [
  '1', '2.5', '0', '1e3', '1_0', '.5', 'x', 'y', 'pi', 'e', 'foo', 'constructor', '__proto__',
  '+', '-', '*', '/', '%', '^', '<', '<=', '>', '>=', '==', '!=', '&&', '||', '!', '?', ':',
  '(', ')', ',', '.', '=', '&', '|', '"', "'", '[', ']', '{', '}', ';', '$', '\\', '`', '×', '😀', '\u0000', ' ',
  'min(', 'max(', 'round(', 'if(', 'clamp(', 'sqrt(', 'pow(', 'log(', 'ln(', 'exp(', 'abs(', 'floor(', 'ceil(', 'eval(',
];

test('fuzz: random token streams never throw and never hang', () => {
  const rand = rng(12345);
  const scope = { x: 3, y: 0 };
  const start = Date.now();
  let okCount = 0;
  for (let i = 0; i < 20000; i++) {
    const n = 1 + Math.floor(rand() * 40);
    let s = '';
    for (let k = 0; k < n; k++) s += FRAGMENTS[Math.floor(rand() * FRAGMENTS.length)] + (rand() < 0.3 ? ' ' : '');
    let r;
    assert.doesNotThrow(() => {
      r = evalExpr(s, scope);
    }, s);
    assert.ok(r);
    const rr = r as ReturnType<typeof evalExpr>;
    if (rr.ok) {
      okCount++;
      assert.ok(rr.value === null || Number.isFinite(rr.value), s);
    } else {
      assert.ok(typeof rr.error.message === 'string' && rr.error.message.length > 0, s);
      assert.ok(rr.error.pos >= -1 && rr.error.pos <= s.length, `${s} pos ${rr.error.pos}`);
    }
  }
  assert.ok(okCount > 50, `fuzz should also hit valid expressions (got ${okCount})`);
  assert.ok(Date.now() - start < 20000, 'fuzz took too long');
});

test('fuzz: random raw characters and garbage inputs', () => {
  const rand = rng(777);
  for (let i = 0; i < 5000; i++) {
    const n = Math.floor(rand() * 120);
    let s = '';
    for (let k = 0; k < n; k++) s += String.fromCharCode(Math.floor(rand() * (rand() < 0.8 ? 128 : 65536)));
    assert.doesNotThrow(() => evalExpr(s, { x: 1 }), JSON.stringify(s));
  }
  for (const g of [null, undefined, 1, {}, [], true, Symbol.iterator] as unknown[]) {
    assert.doesNotThrow(() => compile(g as string));
    assert.equal(compile(g as string).ok, false);
  }
  assert.doesNotThrow(() => evalExpr('x', null as never));
  assert.doesNotThrow(() => evalExpr('x', undefined as never));
});

test('fuzz: random valid expressions evaluate in bounded time and match a reference', () => {
  const rand = rng(99);
  const ops = ['+', '-', '*'];
  const gen = (d: number): { src: string; val: number } => {
    if (d === 0 || rand() < 0.25) {
      const n = Math.floor(rand() * 20);
      return { src: String(n), val: n };
    }
    const a = gen(d - 1);
    const b = gen(d - 1);
    const op = ops[Math.floor(rand() * ops.length)];
    const val = op === '+' ? a.val + b.val : op === '-' ? a.val - b.val : a.val * b.val;
    return { src: `(${a.src} ${op} ${b.src})`, val };
  };
  for (let i = 0; i < 500; i++) {
    const g = gen(4);
    const r = evalExpr(g.src, {});
    assert.ok(r.ok, g.src);
    if (r.ok) assert.equal(r.value, g.val === 0 ? 0 : g.val, g.src);
  }
});

test('worst-case sized inputs evaluate quickly', () => {
  const t = Date.now();
  const nasty = [
    '9^9^9^9^9^9^9^9',
    '(' .repeat(49) + '1' + ')'.repeat(49),
    Array.from({ length: 190 }, () => 'x').join('+').slice(0, 499),
    'min(' + Array.from({ length: 190 }, () => 'exp(9)').join(',').slice(0, 480) + ')',
    '1e308*1e308*1e308',
  ];
  for (const s of nasty) {
    assert.doesNotThrow(() => evalExpr(s, { x: 1 }));
  }
  assert.equal(v('9^9^9^9'), null);
  assert.ok(Date.now() - t < 1000);
});
