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

import { a11yStateProps } from './ariaState.ts';
test('a11yStateProps: native keeps accessibilityState only, web adds the aria-* mirror RNW would drop', () => {
  assert.deepEqual(a11yStateProps({ expanded: true }, 'ios'), { accessibilityState: { expanded: true } });
  assert.deepEqual(a11yStateProps({ checked: false, busy: true }, 'android'), { accessibilityState: { checked: false, busy: true } });
  assert.deepEqual(a11yStateProps({ selected: true, expanded: false }, 'web'), { accessibilityState: { selected: true, expanded: false }, 'aria-selected': true, 'aria-expanded': false });
  assert.deepEqual(a11yStateProps(undefined, 'web'), { accessibilityState: undefined });
});

test('webAriaState: a button with selected / checked is aria-pressed (browsers ignore aria-selected / aria-checked there)', () => {
  assert.deepEqual(webAriaState({ selected: true }, 'button'), { 'aria-pressed': true });
  assert.deepEqual(webAriaState({ checked: false }, 'button'), { 'aria-pressed': false });
  assert.deepEqual(webAriaState({ checked: 'mixed', expanded: true }, 'button'), { 'aria-pressed': 'mixed', 'aria-expanded': true });
  // other roles keep their mapping
  assert.deepEqual(webAriaState({ selected: true }, 'tab'), { 'aria-selected': true });
  assert.deepEqual(webAriaState({ checked: true, selected: true }, 'radio'), { 'aria-checked': true, 'aria-selected': true });
  assert.deepEqual(a11yStateProps({ selected: true }, 'web', 'button'), { accessibilityState: { selected: true }, 'aria-pressed': true });
  assert.deepEqual(a11yStateProps({ selected: true }, 'ios', 'button'), { accessibilityState: { selected: true } });
});
