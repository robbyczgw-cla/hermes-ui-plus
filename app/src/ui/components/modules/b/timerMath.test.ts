import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCountdown, formatMinutes, formatTimerLabel, remainingUntil, timeChips, timerProgress, validTimerSeconds } from './timerMath.ts';

test('formatMinutes', () => {
  assert.equal(formatMinutes(45), '45 Min.');
  assert.equal(formatMinutes(60), '1 Std.');
  assert.equal(formatMinutes(75), '1 Std. 15 Min.');
  assert.equal(formatMinutes(0), null);
  assert.equal(formatMinutes(-5), null);
  assert.equal(formatMinutes('20'), null);
});

test('formatTimerLabel', () => {
  assert.equal(formatTimerLabel(30), '30 Sek.');
  assert.equal(formatTimerLabel(300), '5 Min.');
  assert.equal(formatTimerLabel(150), '2:30 Min.');
  assert.equal(formatTimerLabel(5400), '1 Std. 30 Min.');
});

test('validTimerSeconds', () => {
  assert.equal(validTimerSeconds(600), 600);
  assert.equal(validTimerSeconds(0), null);
  assert.equal(validTimerSeconds(90000), null);
  assert.equal(validTimerSeconds(NaN), null);
  assert.equal(validTimerSeconds('60'), null);
  assert.equal(validTimerSeconds(59.6), 60);
});

test('countdown math rounds up and never goes negative', () => {
  const end = 1_000_000;
  assert.equal(remainingUntil(end, end - 61_500), 61_500);
  assert.equal(remainingUntil(end, end + 5), 0);
  assert.equal(formatCountdown(61_500), '1:02');
  assert.equal(formatCountdown(999), '0:01');
  assert.equal(formatCountdown(0), '0:00');
  assert.equal(formatCountdown(3_725_000), '1:02:05');
  assert.equal(timerProgress(10_000, 2_500), 0.75);
  assert.equal(timerProgress(10_000, 20_000), 0);
  assert.equal(timerProgress(0, 0), 1);
});

test('timeChips derives total and avoids duplicates', () => {
  assert.deepEqual(timeChips({ prep: 15, cook: 30 }), [
    { label: 'Vorbereitung', value: '15 Min.' },
    { label: 'Kochen', value: '30 Min.' },
    { label: 'Gesamt', value: '45 Min.' },
  ]);
  assert.deepEqual(timeChips({ total: 20, prep: 20 }), [{ label: 'Vorbereitung', value: '20 Min.' }]);
  assert.deepEqual(timeChips({ total: 90 }), [{ label: 'Gesamt', value: '1 Std. 30 Min.' }]);
  assert.deepEqual(timeChips(undefined), []);
  assert.deepEqual(timeChips({ prep: 'x' as unknown as number }), []);
});
