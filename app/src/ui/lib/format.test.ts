import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatNumber, formatCompact, niceTicks, snap, asNumber, asObjects } from './format.ts';

test('formatNumber German', () => {
  assert.equal(formatNumber(1234.5), '1.234,5');
  assert.equal(formatNumber(1000000), '1.000.000');
  assert.equal(formatNumber(-3.14159, 2), '−3,14');
  assert.equal(formatNumber(NaN), '–');
});
test('formatCompact', () => {
  assert.equal(formatCompact(12000), '12 Tsd.');
  assert.equal(formatCompact(3400000), '3,4 Mio.');
  assert.equal(formatCompact(5.25), '5,25');
});
test('niceTicks', () => {
  assert.deepEqual(niceTicks(0, 87), [0, 25, 50, 75, 100]);
  assert.deepEqual(niceTicks(5, 5), [0, 2, 4, 6]);
  const t = niceTicks(-12, 30);
  assert.ok(t[0] <= -12 && t[t.length - 1] >= 30 && t.includes(0));
});
test('snap + asNumber + asObjects', () => {
  assert.equal(snap(7.3, 0, 0.5), 7.5);
  assert.equal(snap(13, 10, 5), 15);
  assert.equal(asNumber('3,5'), 3.5);
  assert.equal(asNumber('x'), undefined);
  assert.deepEqual(asObjects([{ a: 1 }, null, 'x', 3]), [{ a: 1 }]);
});
import { parseCellNumber, isNumericCell } from './format.ts';
test('parseCellNumber', () => {
  assert.equal(parseCellNumber('1.234,5'), 1234.5);
  assert.equal(parseCellNumber('1,234.5'), 1234.5);
  assert.equal(parseCellNumber('+12 %'), 12);
  assert.equal(parseCellNumber('−3,4 Mio. €'), -3_400_000);
  assert.equal(parseCellNumber('€ 1.200'), 1200);
  assert.equal(parseCellNumber('Berlin'), undefined);
  assert.equal(parseCellNumber(42), 42);
  assert.equal(isNumericCell('3. Oktober'), false);
  assert.equal(isNumericCell('48,2 %'), true);
});

test('parseCellNumber: qualifier prefixes, units and magnitude words', () => {
  assert.equal(parseCellNumber('ca. 51.000'), 51000);
  assert.equal(parseCellNumber('~ 1.200'), 1200);
  assert.equal(parseCellNumber('ab 3,5'), 3.5);
  assert.equal(parseCellNumber('1,2 Mio.'), 1_200_000);
  assert.equal(parseCellNumber('2 Mrd.'), 2_000_000_000);
  assert.equal(parseCellNumber('300.000 €'), 300000);
  assert.equal(parseCellNumber('12 %'), 12);
  assert.equal(parseCellNumber('−3,5'), -3.5);
  assert.equal(parseCellNumber('-3,5'), -3.5);
  assert.equal(parseCellNumber('5 m'), 5);
  assert.equal(parseCellNumber('1.5k'), 1500);
  assert.equal(parseCellNumber('circa Berlin'), undefined);
  assert.equal(isNumericCell('ca. 51.000'), true);
  assert.equal(isNumericCell('Berlin'), false);
});

// GPT review P1 #1: ticks for values near Number.MAX_VALUE rounded the end to Infinity and the additive loop
// never terminated (froze the JS thread). Run in a terminating worker so a regression fails instead of hanging.
import { expectBounded } from '../../testing/runBounded.test.ts';
import { MAX_TICKS } from './format.ts';
test('niceTicks/looseTicks terminate with finite ticks on huge spans (adversarial, time-bounded)', async () => {
  const fmt = new URL('./format.ts', import.meta.url).href;
  const cm3 = new URL('./chartMath3.ts', import.meta.url).href;
  const cases: Array<[number, number]> = [[0, 1.7e308], [-1.7e308, 0], [-1.7e308, 1.7e308], [Number.MAX_VALUE, Number.MAX_VALUE], [5e-324, 5e-324], [1e300, 1.7e308]];
  for (const [a, b] of cases) {
    for (const [mod, fn] of [[fmt, 'niceTicks'], [cm3, 'looseTicks']] as const) {
      const t = await expectBounded<number[]>(mod, fn, [a, b, 4], 8000);
      assert.ok(t.length >= 2 && t.length <= MAX_TICKS + 1, `${fn}(${a}, ${b}) → ${t.length} ticks`);
      assert.ok(t.every(Number.isFinite), `${fn}(${a}, ${b}) → ${t}`);
      assert.ok(t[0] <= Math.min(a, b) && t[t.length - 1] >= Math.max(a, b) || fn === 'looseTicks', `${fn} covers [${a}, ${b}]`);
    }
  }
});
