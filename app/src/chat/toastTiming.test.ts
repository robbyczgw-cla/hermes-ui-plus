import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOAST_MAX_MS, TOAST_MIN_MS, toastDuration } from './toastTiming.ts';

test('toast duration grows with the text length, clamped to 4–8 s', () => {
  assert.equal(toastDuration('Kopiert'), TOAST_MIN_MS);
  assert.equal(toastDuration('x'.repeat(50)), 5000);
  assert.equal(toastDuration('Vorlesen: keine Verbindung. Das klappt gerade nicht, versuch es später noch einmal bitte.'.repeat(3)), TOAST_MAX_MS);
  assert.ok(toastDuration('a'.repeat(40)) > toastDuration('a'.repeat(20)));
});
