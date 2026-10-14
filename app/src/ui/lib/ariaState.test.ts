import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webAriaState } from './ariaState.ts';

test('accessibilityState maps to aria-* attributes', () => {
  assert.deepEqual(webAriaState({ checked: true, disabled: false }), { 'aria-checked': true });
  assert.deepEqual(webAriaState({ checked: false }), { 'aria-checked': false });
  assert.deepEqual(webAriaState({ selected: true, expanded: false, disabled: true }), { 'aria-selected': true, 'aria-expanded': false, 'aria-disabled': true });
  assert.deepEqual(webAriaState(undefined), {});
});

import { webDialogName } from './ariaState.ts';
test('#21 web dialog name goes on the Modal (RNW dialog element), web only', () => {
  assert.deepEqual(webDialogName('Einstellungen', 'web'), { 'aria-label': 'Einstellungen' });
  assert.deepEqual(webDialogName('Einstellungen', 'ios'), {});
  assert.deepEqual(webDialogName(undefined, 'web'), {});
});
