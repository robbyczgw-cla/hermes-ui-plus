/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createThrottle, streamIntervalFor, streamIntervalForLength } from './throttle.ts';

function fake() {
  let now = 1000;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    deps: {
      now: () => now,
      setTimeout: (fn: () => void, ms: number) => {
        const id = ++seq;
        timers.set(id, { at: now + ms, fn });
        return id;
      },
      clearTimeout: (h: unknown) => void timers.delete(h as number),
    },
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
  };
}

test('leading call runs immediately, burst collapses to one trailing call', () => {
  const f = fake();
  let n = 0;
  const t = createThrottle(() => n++, 33, f.deps);
  t.call();
  assert.equal(n, 1);
  for (let i = 0; i < 100; i++) t.call();
  assert.equal(n, 1);
  f.advance(32);
  assert.equal(n, 1);
  f.advance(1);
  assert.equal(n, 2);
  f.advance(100);
  assert.equal(n, 2);
  t.call();
  assert.equal(n, 3);
});

test('flush runs pending immediately, cancel drops it', () => {
  const f = fake();
  let n = 0;
  const t = createThrottle(() => n++, 33, f.deps);
  t.call();
  t.call();
  t.flush();
  assert.equal(n, 2);
  t.call();
  t.cancel();
  f.advance(100);
  assert.equal(n, 2);
  t.flush();
  assert.equal(n, 2);
});

test('adaptive interval: function interval is read on every call', () => {
  const f = fake();
  let calls = 0;
  let interval = 33;
  const th = createThrottle(() => calls++, () => interval, f.deps);
  th.call(); // leading
  assert.equal(calls, 1);
  interval = 120;
  th.call();
  f.advance(40);
  assert.equal(calls, 1, 'longer interval applies to the next wait');
  f.advance(80);
  assert.equal(calls, 2);
});

test('streamIntervalFor: 33 / 66 / 120 ms by the streaming answer length', () => {
  assert.equal(streamIntervalForLength(0), 33);
  assert.equal(streamIntervalForLength(7_999), 33);
  assert.equal(streamIntervalForLength(8_000), 66);
  assert.equal(streamIntervalForLength(31_999), 66);
  assert.equal(streamIntervalForLength(32_000), 120);
  assert.equal(streamIntervalFor([]), 33);
  assert.equal(streamIntervalFor([{ text: 'x'.repeat(40_000) }, { text: 'kurz' }]), 33);
  assert.equal(streamIntervalFor([{ text: 'x'.repeat(5_000), reasoning: 'y'.repeat(5_000) }]), 66);
});
