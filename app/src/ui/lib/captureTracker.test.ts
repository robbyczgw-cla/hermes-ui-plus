import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCaptureTracker, type CaptureTimers } from './captureTracker.ts';

/** manual clock: timers fire only on advance() */
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  const timers: CaptureTimers = {
    setTimeout(fn, ms) {
      const id = ++seq;
      due.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(id) {
      due.delete(id as number);
    },
  };
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...due.entries()].filter(([, d]) => d.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at;
      due.delete(next[0]);
      next[1].fn();
      await Promise.resolve();
    }
    now = end;
    await Promise.resolve();
  };
  return { timers, advance };
}

function track(p: Promise<string>) {
  const s: { v: string | null } = { v: null };
  void p.then((v) => (s.v = v));
  return s;
}

test('nothing loading: ready after one quiet period', async () => {
  const { timers, advance } = fakeTimers();
  const tr = createCaptureTracker({ quietMs: 100, deadlineMs: 1000, timers });
  const out = track(tr.whenSettled());
  await advance(99);
  assert.equal(out.v, null);
  await advance(1);
  assert.equal(out.v, 'ready');
  assert.equal(tr.expired(), false);
});

test('waits for every busy token, late ones included', async () => {
  const { timers, advance } = fakeTimers();
  const tr = createCaptureTracker({ quietMs: 100, deadlineMs: 5000, timers });
  const out = track(tr.whenSettled());
  await advance(50);
  const photo = tr.hold(); // registered after the clock started (image mounted late)
  await advance(400);
  assert.equal(out.v, null);
  const lookup = tr.hold();
  photo();
  photo(); // idempotent
  assert.equal(tr.pending(), 1);
  await advance(300);
  assert.equal(out.v, null);
  lookup();
  await advance(99);
  assert.equal(out.v, null);
  await advance(1);
  assert.equal(out.v, 'ready');
});

test('a token taken within the quiet period restarts it', async () => {
  const { timers, advance } = fakeTimers();
  const tr = createCaptureTracker({ quietMs: 100, deadlineMs: 5000, timers });
  const out = track(tr.whenSettled());
  await advance(80);
  const done = tr.hold();
  await advance(10);
  done();
  await advance(90);
  assert.equal(out.v, null);
  await advance(10);
  assert.equal(out.v, 'ready');
});

test('deadline: still-loading parts expire, get one quiet period for their fallback, then timeout', async () => {
  const { timers, advance } = fakeTimers();
  const tr = createCaptureTracker({ quietMs: 100, deadlineMs: 1000, timers });
  let told = 0;
  tr.onExpire(() => told++);
  const out = track(tr.whenSettled());
  tr.hold(); // never finishes (a host that never answers)
  await advance(999);
  assert.equal(out.v, null);
  assert.equal(tr.expired(), false);
  await advance(1);
  assert.equal(tr.expired(), true);
  assert.equal(told, 1);
  assert.equal(out.v, null); // the fallback gets drawn first
  await advance(100);
  assert.equal(out.v, 'timeout');
});

test('deadline: parts that release after expiring still end in a timeout outcome', async () => {
  const { timers, advance } = fakeTimers();
  const tr = createCaptureTracker({ quietMs: 100, deadlineMs: 300, timers });
  const out = track(tr.whenSettled());
  const done = tr.hold();
  await advance(300);
  done(); // draws its fallback and lets go
  await advance(100);
  assert.equal(out.v, 'timeout');
});

test('whenSettled is one promise; dispose stops the clock', async () => {
  const { timers, advance } = fakeTimers();
  const tr = createCaptureTracker({ quietMs: 100, deadlineMs: 1000, timers });
  const a = tr.whenSettled();
  assert.equal(tr.whenSettled(), a);
  const out = track(a);
  tr.dispose();
  await advance(5000);
  assert.equal(out.v, null);
});
