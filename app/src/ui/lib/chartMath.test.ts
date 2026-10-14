import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSeries, categories, barPath, monotonePath, arcPath, foldSlices, labelStride } from './chartMath.ts';

test('cleanSeries tolerates partial data', () => {
  const s = cleanSeries([{ name: 'A', data: [{ x: 'Jan', y: 1 }, { x: 'Feb' }, null, { x: 3, y: '2' }] }, 'junk', { data: [] }]);
  assert.equal(s.length, 2);
  assert.deepEqual(s[0].points, [{ x: 'Jan', y: 1 }, { x: '3', y: 2 }]);
  assert.equal(s[1].name, 'Reihe 3');
  assert.deepEqual(cleanSeries(undefined), []);
});
test('categories union in order', () => {
  assert.deepEqual(categories([{ points: [{ x: 'a' }, { x: 'b' }] }, { points: [{ x: 'b' }, { x: 'c' }] }]), ['a', 'b', 'c']);
});
test('paths', () => {
  assert.equal(barPath(0, 10, 100, 100), '');
  assert.ok(barPath(0, 10, 100, 40).startsWith('M0,100V44'));
  assert.ok(monotonePath([{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }]).includes('C'));
  assert.ok(arcPath(50, 50, 40, 20, 0, Math.PI / 2).includes('A40,40'));
  assert.ok(arcPath(50, 50, 40, 0, 0, Math.PI * 2).length > 0);
});
test('foldSlices + labelStride', () => {
  const pts = Array.from({ length: 10 }, (_, i) => ({ x: 'p' + i, y: i + 1 }));
  const f = foldSlices(pts, 8);
  assert.equal(f.length, 8);
  assert.equal(f[7].x, 'Andere');
  assert.equal(f.reduce((s, p) => s + p.y, 0), 55);
  assert.equal(labelStride(['Januar', 'Februar'], 100), 1);
  assert.ok(labelStride(['Januar', 'Februar'], 20) > 1);
});

import { labelHasUnit, labelWithUnit } from './chartMath.ts';
test('axis label does not repeat a unit it already contains', () => {
  assert.equal(labelWithUnit('°C', '°C'), '°C');
  assert.equal(labelWithUnit('Temperatur (°C)', '°C'), 'Temperatur (°C)');
  assert.equal(labelWithUnit('Temperatur', '°C'), 'Temperatur (°C)');
  assert.equal(labelWithUnit('Umsatz in €', '€'), 'Umsatz in €');
  assert.equal(labelWithUnit('Umsatz', undefined), 'Umsatz');
  assert.equal(labelWithUnit('Strecke', 'm'), 'Strecke (m)');
  assert.equal(labelHasUnit('Länge in m', 'm'), true);
  assert.equal(labelHasUnit('Menge', 'm'), false);
});
