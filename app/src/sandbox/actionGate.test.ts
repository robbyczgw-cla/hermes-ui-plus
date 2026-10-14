import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createActionGate } from './actionGate.ts';

const send = { type: 'send', text: 'x' } as const;
const tap = (g: ReturnType<typeof createActionGate>, t: number, x = 100, y = 200) => {
  g.touchStart(x, y, t);
  return g.touchEnd(x + 2, y + 1, t + 120);
};

test('blocks actions without a tap', () => {
  const g = createActionGate();
  assert.deepEqual(g.check(send, 1000), { ok: false, reason: 'no_gesture' });
  assert.equal(tap(g, 2000), true);
  assert.deepEqual(g.check(send, 2300), { ok: true });
});

// Security review M2: the first finger that scrolled the chat across a hostile widget authorized its actions.
test('a scroll / drag across the widget is not a tap', () => {
  const g = createActionGate();
  g.touchStart(100, 400, 0);
  g.touchMove(100, 380);
  g.touchMove(100, 200);
  assert.equal(g.touchEnd(100, 200, 300), false);
  assert.equal(g.check(send, 400).ok, false);
  // moving away and back still counts as a drag
  g.touchStart(100, 400, 1000);
  g.touchMove(100, 300);
  assert.equal(g.touchEnd(100, 401, 1200), false);
  assert.equal(g.check(send, 1300).ok, false);
  // a cancelled touch (the list took over the gesture) is not a tap either
  g.touchStart(100, 400, 2000);
  g.touchCancel();
  assert.equal(g.check(send, 2100).ok, false);
});

test('a long press is not a tap; a touch that is still down makes the action wait (pending)', () => {
  const g = createActionGate();
  g.touchStart(10, 10, 0);
  assert.deepEqual(g.check(send, 50), { ok: false, reason: 'pending' });
  assert.equal(g.touchEnd(10, 10, 1500), false); // > TAP_MAX_MS
  assert.deepEqual(g.check(send, 1501), { ok: false, reason: 'no_gesture' });
  g.touchStart(10, 10, 3000);
  assert.deepEqual(g.check(send, 3050), { ok: false, reason: 'pending' });
  assert.equal(g.touchEnd(11, 10, 3100), true);
  assert.equal(g.check(send, 3101).ok, true); // HtmlBlock re-checks the pending action on touch end
});

test('one action per tap, within the tap window', () => {
  const g = createActionGate({ minIntervalMs: 0 });
  tap(g, 0);
  assert.equal(g.check(send, 200).ok, true);
  assert.deepEqual(g.check(send, 300), { ok: false, reason: 'no_gesture' }); // consumed
  tap(g, 1000);
  assert.equal(g.check(send, 1000 + 120 + 1500 + 1).ok, false); // too late
});

test('web (GPT security M1 / Astra F15): focus moving into the iframe never authorizes an action', () => {
  const g = createActionGate({ minIntervalMs: 0 });
  assert.equal('noteTap' in g, false, 'no focus-based tap source any more');
  // the old API took a "frame focused" flag that opened a 60 s window; extra arguments are ignored now
  const check = g.check as (a: typeof send, now: number, focused?: boolean) => ReturnType<typeof g.check>;
  assert.deepEqual(check(send, 10, true), { ok: false, reason: 'no_gesture' });
  g.noteFrameTap(1000);
  assert.equal(check(send, 1200, true).ok, true);
  assert.deepEqual(check(send, 30_000, true), { ok: false, reason: 'no_gesture' }); // consumed, focus doesn't re-arm
});

test('enforces min interval between accepted actions', () => {
  const g = createActionGate({ minIntervalMs: 700 });
  tap(g, 0);
  assert.equal(g.check(send, 200).ok, true);
  tap(g, 300);
  assert.deepEqual(g.check(send, 500), { ok: false, reason: 'too_fast' });
  assert.equal(g.check(send, 900).ok, true);
});

test('caps actions per minute', () => {
  const g = createActionGate({ maxPerMinute: 3, minIntervalMs: 0 });
  for (let i = 0; i < 3; i++) {
    tap(g, i * 1000);
    assert.equal(g.check(send, i * 1000 + 200).ok, true);
  }
  tap(g, 4000);
  assert.deepEqual(g.check(send, 4200), { ok: false, reason: 'rate_limited' });
  tap(g, 61_000);
  assert.equal(g.check(send, 61_200).ok, true);
});

// iOS Safari may not move focus into the iframe on a tap: the shell reports real taps over a private MessagePort.
test('web: a port tap from the shell allows exactly one action within the tap window', () => {
  const g = createActionGate({ minIntervalMs: 0 });
  assert.deepEqual(g.check(send, 100), { ok: false, reason: 'no_gesture' });
  g.noteFrameTap(1000);
  assert.deepEqual(g.check(send, 1100), { ok: true });
  assert.deepEqual(g.check(send, 1200), { ok: false, reason: 'no_gesture' }); // consumed
  g.noteFrameTap(5000);
  assert.equal(g.check(send, 5000 + 1500 + 1).ok, false); // too late
  g.noteFrameTap(10_000);
  assert.equal(g.check(send, 20_000).ok, false);
});

test('web: port taps share the rate limits with every other tap source', () => {
  const g = createActionGate({ minIntervalMs: 700, maxPerMinute: 2, frameTapDedupeMs: 0 });
  g.noteFrameTap(0);
  assert.equal(g.check(send, 10).ok, true);
  g.noteFrameTap(100);
  assert.deepEqual(g.check(send, 200), { ok: false, reason: 'too_fast' });
  assert.equal(g.check(send, 800).ok, true);
  g.noteFrameTap(2000);
  assert.deepEqual(g.check(send, 2010), { ok: false, reason: 'rate_limited' });
});

test('web: a port tap arriving just after the action it authorized does not re-arm the gate', () => {
  const g = createActionGate({ minIntervalMs: 0 });
  g.noteFrameTap(1000);
  assert.equal(g.check(send, 1100).ok, true);
  g.noteFrameTap(1150); // same press reported twice / overtaken by the action message
  assert.deepEqual(g.check(send, 1200), { ok: false, reason: 'no_gesture' });
  g.noteFrameTap(1700); // a new press later counts again
  assert.equal(g.check(send, 1750).ok, true);
});

