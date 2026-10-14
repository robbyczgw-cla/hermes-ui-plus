/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCountUp, parseCountUp } from './countUp.ts';

test('count-up: parses the number of a stat value and re-formats interim values in its style', () => {
  const de = parseCountUp('1.234,5 €')!;
  assert.deepEqual(de, { prefix: '', suffix: ' €', value: 1234.5, decimals: 1, group: '.', dec: ',' });
  assert.equal(formatCountUp(de, 617.25), '617,3 €');
  assert.equal(formatCountUp(de, 1234.5), '1.234,5 €');
  const en = parseCountUp('$1,200')!;
  assert.equal(formatCountUp(en, 1000), '$1,000');
  assert.equal(formatCountUp(en, 999.6), '$1,000');
  assert.equal(formatCountUp(parseCountUp('+12 %')!, 6), '+6 %');
  assert.equal(formatCountUp(parseCountUp('3.2x')!, 1.55), '1.6x');
  assert.equal(formatCountUp(parseCountUp('42')!, 0), '0');
  assert.equal(formatCountUp(parseCountUp('8 849 m')!, 8849), '8 849 m');
});

test('count-up: not animated for ranges, fractions, years, zero and text', () => {
  for (const s of ['3/5', '10–12 h', '2026', 'Q3 2025', 'hoch', '', '0', '0 %', '1.2.3', 'v2']) assert.equal(parseCountUp(s), null, s);
});
