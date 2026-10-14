import { test } from 'node:test';
import assert from 'node:assert/strict';
import { showKeyboardHints } from './keyboardHints.ts';

test('keyboard hints: web desktop with a mouse only', () => {
  assert.equal(showKeyboardHints({ platform: 'web', width: 1280, finePointer: true }), true);
  // phone layout (also a narrow desktop window / the 390 px test viewport)
  assert.equal(showKeyboardHints({ platform: 'web', width: 390, finePointer: true }), false);
  // tablet / phone browser: touch only
  assert.equal(showKeyboardHints({ platform: 'web', width: 1024, finePointer: false }), false);
  // native apps never
  assert.equal(showKeyboardHints({ platform: 'android', width: 1280, finePointer: true }), false);
  assert.equal(showKeyboardHints({ platform: 'ios', width: 1024, finePointer: true }), false);
});
