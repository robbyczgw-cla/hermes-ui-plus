import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHANGE_SIGN } from './changeSign.ts';

test('receipt signs: every kind of change has its own sign; opened again never looks like ticked', () => {
  const signs = Object.values(CHANGE_SIGN);
  assert.equal(new Set(signs).size, signs.length);
  assert.notEqual(CHANGE_SIGN.unchecked, CHANGE_SIGN.checked);
  assert.equal(CHANGE_SIGN.checked, '✓');
  assert.equal(CHANGE_SIGN.unchecked, '○');
});
