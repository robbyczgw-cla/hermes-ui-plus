import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageStep, sliderKeyTarget, sliderWebProps } from './sliderKeys.ts';

const W = { min: 0, max: 10, step: 1 };

test('arrow keys move one step, clamped', () => {
  assert.equal(sliderKeyTarget('ArrowRight', 3, W), 4);
  assert.equal(sliderKeyTarget('ArrowUp', 3, W), 4);
  assert.equal(sliderKeyTarget('ArrowLeft', 3, W), 2);
  assert.equal(sliderKeyTarget('ArrowDown', 3, W), 2);
  assert.equal(sliderKeyTarget('ArrowRight', 10, W), null);
  assert.equal(sliderKeyTarget('ArrowLeft', 0, W), null);
});
test('PageUp/PageDown jump 2, Home/End jump to the ends', () => {
  assert.equal(sliderKeyTarget('PageUp', 3, W), 5);
  assert.equal(sliderKeyTarget('PageDown', 3, W), 1);
  assert.equal(sliderKeyTarget('PageUp', 9, W), 10);
  assert.equal(sliderKeyTarget('Home', 7, W), 0);
  assert.equal(sliderKeyTarget('End', 7, W), 10);
  assert.equal(sliderKeyTarget('Home', 0, W), null);
});
test('wide ranges page by about a tenth, fractional steps stay clean', () => {
  assert.equal(pageStep({ min: 0, max: 100, step: 1 }), 10);
  assert.equal(sliderKeyTarget('ArrowRight', 0.2, { min: 0, max: 1, step: 0.1 }), 0.3);
  assert.equal(sliderKeyTarget('ArrowRight', 5, { min: 1, max: 5, step: 1 }), null);
});
test('other keys are ignored', () => {
  assert.equal(sliderKeyTarget('a', 3, W), null);
  assert.equal(sliderKeyTarget('Tab', 3, W), null);
});
test('web props expose slider role, aria values and a working keydown handler', () => {
  let got: number | null = null;
  let prevented = false;
  const p = sliderWebProps({ value: 4, range: W, label: 'Gewicht', text: '4', onChange: (v) => (got = v) }) as Record<string, any>;
  assert.equal(p.role, 'slider');
  assert.equal(p['aria-valuenow'], 4);
  assert.equal(p['aria-valuemin'], 0);
  assert.equal(p['aria-valuemax'], 10);
  assert.equal(p.tabIndex, 0);
  p.onKeyDown({ key: 'PageUp', preventDefault: () => (prevented = true) });
  assert.equal(got, 6);
  assert.equal(prevented, true);
  const d = sliderWebProps({ value: 4, range: W, label: 'x', disabled: true, onChange: () => assert.fail() }) as Record<string, any>;
  d.onKeyDown({ key: 'ArrowRight' });
  assert.equal(d.tabIndex, -1);
});
