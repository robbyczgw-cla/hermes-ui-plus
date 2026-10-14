import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNearRegistry, type NearView } from './nearRegistry.ts';

function harness() {
  let nextId = 1;
  const timers = new Map<number, () => void>();
  const reg = createNearRegistry({
    tickMs: 400,
    isNear: (_x, _y, w, h) => w > 0 && h > 0,
    setInterval: (fn) => {
      const id = nextId++;
      timers.set(id, fn);
      return id;
    },
    clearInterval: (id) => void timers.delete(id as number),
  });
  return { reg, timers };
}

const view = (size: { w: number; h: number }): NearView => ({ measureInWindow: (cb) => cb(0, 0, size.w, size.h) });

test('near registry: the shared ticker only runs while slots are registered', () => {
  const { reg, timers } = harness();
  assert.equal(reg.running(), false);
  const offA = reg.add({ view: () => view({ w: 0, h: 0 }), hit: () => {} });
  const offB = reg.add({ view: () => view({ w: 0, h: 0 }), hit: () => {} });
  assert.equal(reg.running(), true);
  assert.equal(timers.size, 1, 'one shared interval');
  offA();
  assert.equal(reg.running(), true);
  // last unregister stops the interval right away (no idle tick left running)
  offB();
  assert.equal(reg.running(), false);
  assert.equal(timers.size, 0);
  offB(); // idempotent
  assert.equal(reg.size(), 0);
});

test('near registry: a hit unregisters the slot and stops the ticker when none are left', () => {
  const { reg } = harness();
  const size = { w: 0, h: 0 };
  let hits = 0;
  reg.add({ view: () => view(size), hit: () => void hits++ });
  reg.tick();
  assert.equal(hits, 0);
  size.w = size.h = 10;
  reg.tick();
  reg.tick();
  assert.equal(hits, 1);
  assert.equal(reg.size(), 0);
  assert.equal(reg.running(), false);
});

test('near registry: a slot without a mounted view does not keep the ticker alive forever', () => {
  const { reg } = harness();
  const off = reg.add({ view: () => null, hit: () => {} });
  reg.tick();
  assert.equal(reg.running(), true, 'still waiting for its view');
  off();
  assert.equal(reg.running(), false);
});

// E2E round 5, N2: after a cold start the restored product cards stayed a blank grey tile forever. The slot's lookup
// (and its 3 s cap) only start on the watcher's hit, and the watcher only fired on a measurement that says "near":
// a view that cannot be measured (0×0 / no answer, e.g. not in the current shadow revision, display:none ancestor)
// stayed registered forever. Fail open like the web path (no IntersectionObserver → visible).
function failOpenHarness(failOpenAfter: number) {
  const reg = createNearRegistry({ tickMs: 400, failOpenAfter, isNear: (_x, y, w, h) => (w > 0 || h > 0) && y < 1000, setInterval: () => 1, clearInterval: () => {} });
  return reg;
}

test('near registry: a view that cannot be measured fails open after a few ticks (never stuck waiting)', () => {
  const reg = failOpenHarness(3);
  let hits = 0;
  reg.add({ view: () => view({ w: 0, h: 0 }), hit: () => void hits++ });
  reg.tick();
  reg.tick();
  assert.equal(hits, 0, 'a view that is just being laid out gets a moment');
  reg.tick();
  assert.equal(hits, 1);
  assert.equal(reg.size(), 0);
  assert.equal(reg.running(), false);
});

test('near registry: a measure call that never answers counts as unmeasurable', () => {
  const reg = failOpenHarness(3);
  let hits = 0;
  reg.add({ view: () => ({ measureInWindow: () => {} }), hit: () => void hits++ });
  for (let i = 0; i < 4; i++) reg.tick();
  assert.equal(hits, 1);
});

test('near registry: a measurable view offscreen keeps waiting (lazy) and hits once it scrolls in', () => {
  const reg = failOpenHarness(3);
  let y = 5000;
  let hits = 0;
  reg.add({ view: () => ({ measureInWindow: (cb) => cb(0, y, 200, 150) }), hit: () => void hits++ });
  for (let i = 0; i < 20; i++) reg.tick();
  assert.equal(hits, 0, 'offscreen but measurable: no fail-open');
  y = 300;
  reg.tick();
  assert.equal(hits, 1);
});

test('near registry: a single bad measurement between good ones does not fail open', () => {
  const reg = failOpenHarness(3);
  let n = 0;
  let hits = 0;
  reg.add({ view: () => ({ measureInWindow: (cb) => (n++ % 2 ? cb(0, 0, 0, 0) : cb(0, 5000, 200, 150)) }), hit: () => void hits++ });
  for (let i = 0; i < 20; i++) reg.tick();
  assert.equal(hits, 0);
});
