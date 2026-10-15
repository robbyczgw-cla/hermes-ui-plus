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

// ---------------------------------------------------------------- frame-aligned updates (requestAnimationFrame)

/** fake timers + a fake display: `frame()` runs the callbacks requested so far (one vsync) */
function fakeWithFrames() {
  const f = fake();
  let seq = 0;
  const frames = new Map<number, () => void>();
  let cancelled = 0;
  return {
    ...f,
    deps: {
      ...f.deps,
      requestFrame: (fn: () => void) => {
        const id = ++seq;
        frames.set(id, fn);
        return id;
      },
      cancelFrame: (h: unknown) => {
        if (frames.delete(h as number)) cancelled++;
      },
    },
    frame() {
      const due = [...frames.values()];
      frames.clear();
      for (const fn of due) fn();
    },
    get requested() {
      return frames.size;
    },
    get cancelled() {
      return cancelled;
    },
  };
}

test('frames: the leading update runs on the next frame, a burst in between is one update', () => {
  const f = fakeWithFrames();
  let n = 0;
  const t = createThrottle(() => n++, 33, f.deps);
  t.call();
  assert.equal(n, 0); // not in the middle of whatever the event handler runs in
  for (let i = 0; i < 50; i++) t.call();
  assert.equal(f.requested, 1);
  f.advance(10);
  f.frame();
  assert.equal(n, 1);
  f.frame();
  assert.equal(n, 1);
});

test('frames: the interval stays the minimum spacing; the trailing update waits for the first frame after it', () => {
  const f = fakeWithFrames();
  const runs: number[] = [];
  let now = 0;
  const deps = { ...f.deps, now: () => now };
  const advance = (ms: number) => {
    now += ms;
    f.advance(ms);
  };
  const t = createThrottle(() => runs.push(now), 66, deps);
  t.call();
  advance(16);
  f.frame(); // leading update at 16
  for (let ms = 0; ms < 200; ms += 16) {
    t.call(); // tokens keep coming
    advance(16);
    f.frame();
  }
  for (let i = 1; i < runs.length; i++) assert.ok(runs[i] - runs[i - 1] >= 66, `spacing ${runs.join(',')}`);
  assert.ok(runs.length >= 3, runs.join(','));
  // every update ran in a frame callback right after its interval was over (not up to a whole interval later)
  for (let i = 1; i < runs.length; i++) assert.ok(runs[i] - runs[i - 1] <= 66 + 16, `late ${runs.join(',')}`);
});

test('frames: no frame (hidden tab, app in the background) → the fallback timer runs it one interval later, once', () => {
  const f = fakeWithFrames();
  let n = 0;
  const t = createThrottle(() => n++, 33, f.deps);
  t.call();
  f.advance(32);
  assert.equal(n, 0);
  f.advance(1);
  assert.equal(n, 1);
  assert.equal(f.cancelled, 1); // the frame that never came was cancelled
  f.frame();
  assert.equal(n, 1);
});

test('frames: flush runs a pending update at once (stream end / abort) and nothing runs again later', () => {
  const f = fakeWithFrames();
  let n = 0;
  const t = createThrottle(() => n++, 33, f.deps);
  t.call();
  t.flush();
  assert.equal(n, 1);
  f.frame();
  f.advance(100);
  assert.equal(n, 1);
  // pending trailing update (timer phase) → flushed at once, its timer gone
  t.call();
  f.advance(5);
  f.frame();
  assert.equal(n, 2);
  t.call();
  t.flush();
  assert.equal(n, 3);
  f.advance(100);
  f.frame();
  assert.equal(n, 3);
  // flush with nothing pending is a no-op
  t.flush();
  assert.equal(n, 3);
});

test('frames: cancel drops the pending update in every phase, also when cancelFrame is missing', () => {
  for (const noCancelFrame of [false, true]) {
    const f = fakeWithFrames();
    const deps = noCancelFrame ? { ...f.deps, cancelFrame: undefined } : f.deps;
    let n = 0;
    const t = createThrottle(() => n++, 33, deps);
    t.call();
    t.cancel(); // waiting for its frame
    f.frame();
    f.advance(100);
    assert.equal(n, 0);
    t.call();
    f.frame(); // runs
    t.call(); // waiting for the interval
    t.cancel();
    f.advance(100);
    f.frame();
    assert.equal(n, 1);
  }
});

test('frames: the adaptive interval is read per update', () => {
  const f = fakeWithFrames();
  let interval = 33;
  const runs: number[] = [];
  let now = 0;
  const deps = { ...f.deps, now: () => now };
  const t = createThrottle(() => runs.push(now), () => interval, deps);
  const step = (ms: number) => {
    now += ms;
    f.advance(ms);
    f.frame();
  };
  t.call();
  step(1);
  interval = 120;
  t.call();
  for (let i = 0; i < 10; i++) step(16);
  assert.equal(runs.length, 2);
  assert.ok(runs[1] - runs[0] >= 120);
});

test('default deps: requestAnimationFrame is used when the platform has it (looked up per update)', () => {
  const g = globalThis as { requestAnimationFrame?: (fn: () => void) => number; cancelAnimationFrame?: (h: number) => void };
  const hadRaf = g.requestAnimationFrame;
  const hadCaf = g.cancelAnimationFrame;
  const queued: (() => void)[] = [];
  let n = 0;
  const t = createThrottle(() => n++, 33);
  try {
    // node: no frames → the leading update runs synchronously, as before
    delete g.requestAnimationFrame;
    delete g.cancelAnimationFrame;
    t.call();
    assert.equal(n, 1);
    t.cancel();
    const t2 = createThrottle(() => n++, 33);
    g.requestAnimationFrame = (fn) => queued.push(fn);
    g.cancelAnimationFrame = () => {};
    t2.call();
    assert.equal(n, 1);
    assert.equal(queued.length, 1);
    queued[0]();
    assert.equal(n, 2);
    t2.cancel();
  } finally {
    if (hadRaf) g.requestAnimationFrame = hadRaf;
    else delete g.requestAnimationFrame;
    if (hadCaf) g.cancelAnimationFrame = hadCaf;
    else delete g.cancelAnimationFrame;
  }
});
