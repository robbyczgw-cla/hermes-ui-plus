import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createTimer,
  KEEP_DONE_MS,
  MAX_TIMERS,
  parseTimers,
  pauseTimer,
  progress,
  pruneTimers,
  remainingMs,
  resetTimer,
  resumeTimer,
  serializeTimers,
  settleAll,
  settleTimer,
  sortTimers,
  type TimerRecord,
} from './timerModel.ts';
import { TimerStore, type TimerNotifier, type TimerStorage } from './timerStore.ts';

const T0 = 1_700_000_000_000;

test('createTimer: absolute end timestamp', () => {
  const t = createTimer({ id: 'a', label: 'Nudeln', seconds: 600, now: T0 });
  assert.equal(t.endsAt, T0 + 600_000);
  assert.equal(t.status, 'running');
  assert.equal(remainingMs(t, T0), 600_000);
  assert.equal(remainingMs(t, T0 + 599_001), 999);
  assert.equal(remainingMs(t, T0 + 700_000), 0);
  assert.equal(progress(t, T0 + 300_000), 0.5);
});

test('pause / resume keeps the remaining time exactly', () => {
  const t = createTimer({ id: 'a', label: 'x', seconds: 60, now: T0 });
  const p = pauseTimer(t, T0 + 20_000);
  assert.equal(p.status, 'paused');
  assert.equal(p.remainingMs, 40_000);
  assert.equal(p.endsAt, null);
  assert.equal(remainingMs(p, T0 + 999_999), 40_000, 'frozen while paused');
  const r = resumeTimer(p, T0 + 100_000);
  assert.equal(r.status, 'running');
  assert.equal(r.endsAt, T0 + 140_000);
  assert.equal(pauseTimer(p, T0), p, 'pausing a paused timer is a no-op');
  assert.equal(resumeTimer(t, T0), t, 'resuming a running timer is a no-op');
});

test('pausing at/after the end settles to done', () => {
  const t = createTimer({ id: 'a', label: 'x', seconds: 10, now: T0 });
  assert.equal(pauseTimer(t, T0 + 10_000).status, 'done');
});

test('reset returns to the full duration, stopped; resume restarts it', () => {
  const t = createTimer({ id: 'a', label: 'x', seconds: 60, now: T0 });
  const r = resetTimer(pauseTimer(t, T0 + 50_000));
  assert.equal(r.status, 'paused');
  assert.equal(r.remainingMs, 60_000);
  assert.equal(resumeTimer(resetTimer(settleTimer(t, T0 + 61_000)), T0 + 70_000).endsAt, T0 + 130_000);
});

test('settle marks finished timers done once', () => {
  const a = createTimer({ id: 'a', label: 'a', seconds: 10, now: T0 });
  const b = createTimer({ id: 'b', label: 'b', seconds: 100, now: T0 });
  const r1 = settleAll([a, b], T0 + 11_000);
  assert.deepEqual(r1.newlyDone.map((t) => t.id), ['a']);
  assert.equal(r1.list[0].status, 'done');
  assert.equal(r1.list[1].status, 'running');
  const r2 = settleAll(r1.list, T0 + 12_000);
  assert.equal(r2.newlyDone.length, 0);
  assert.equal(r2.list, r1.list, 'unchanged list keeps identity');
});

test('persistence round trip: a timer started before a restart finishes on time (even while the app was closed)', () => {
  const t = createTimer({ id: 'a', label: 'Pizza', seconds: 300, now: T0 });
  const raw = serializeTimers([t]);
  const afterTwo = parseTimers(raw, T0 + 120_000);
  assert.equal(afterTwo[0].status, 'running');
  assert.equal(remainingMs(afterTwo[0], T0 + 120_000), 180_000);
  const afterTen = parseTimers(raw, T0 + 600_000);
  assert.equal(afterTen[0].status, 'done');
});

test('paused timers survive restarts unchanged', () => {
  const p = pauseTimer(createTimer({ id: 'a', label: 'x', seconds: 60, now: T0 }), T0 + 15_000);
  const back = parseTimers(serializeTimers([p]), T0 + 9_999_999);
  assert.equal(back[0].status, 'paused');
  assert.equal(back[0].remainingMs, 45_000);
});

test('parseTimers tolerates garbage and drops invalid records', () => {
  assert.deepEqual(parseTimers(null, T0), []);
  assert.deepEqual(parseTimers('nope', T0), []);
  assert.deepEqual(parseTimers('{"f":2,"timers":[]}', T0), []);
  const good = createTimer({ id: 'g', label: 'g', seconds: 60, now: T0 });
  const raw = JSON.stringify({ f: 1, timers: [good, { id: 1 }, null, { ...good, id: 'x', totalMs: 5 }, { ...good, id: 'y', status: 'running', endsAt: null }, { ...good, id: 'z', status: 'weird' }] });
  assert.deepEqual(parseTimers(raw, T0).map((t) => t.id), ['g']);
});

test('prune: old done timers vanish, list is capped', () => {
  const done = (id: string, endedAgo: number): TimerRecord => ({ ...createTimer({ id, label: id, seconds: 10, now: T0 }), status: 'done', endsAt: T0 - endedAgo, remainingMs: 0 });
  const kept = pruneTimers([done('old', KEEP_DONE_MS + 1), done('recent', 1000)], T0);
  assert.deepEqual(kept.map((t) => t.id), ['recent']);
  const many = Array.from({ length: MAX_TIMERS + 5 }, (_, i) => createTimer({ id: `t${i}`, label: 'x', seconds: 60, now: T0 + i }));
  const capped = pruneTimers([...many, done('d', 5)], T0);
  assert.equal(capped.length, MAX_TIMERS);
  assert.ok(!capped.some((t) => t.id === 'd'), 'done timers go first');
  assert.ok(capped.some((t) => t.id === `t${MAX_TIMERS + 4}`), 'newest running kept');
});

test('sortTimers: running by end time, then paused, then done', () => {
  const run1 = createTimer({ id: 'r1', label: '', seconds: 100, now: T0 });
  const run2 = createTimer({ id: 'r2', label: '', seconds: 10, now: T0 });
  const paused = pauseTimer(createTimer({ id: 'p', label: '', seconds: 50, now: T0 }), T0 + 1);
  const done = settleTimer(createTimer({ id: 'd', label: '', seconds: 1, now: T0 }), T0 + 5000);
  assert.deepEqual(sortTimers([done, paused, run1, run2]).map((t) => t.id), ['r2', 'r1', 'p', 'd']);
});

// ---- TimerStore -----------------------------------------------------------------------------------

function harness(initial?: string) {
  const mem = new Map<string, string>();
  if (initial) mem.set('hui.timers', initial);
  const storage: TimerStorage = {
    getItem: async (k) => mem.get(k) ?? null,
    setItem: async (k, v) => void mem.set(k, v),
  };
  const calls: string[] = [];
  let n = 0;
  let allow = true;
  const notifier: TimerNotifier = {
    schedule: async (o) => {
      calls.push(`schedule ${o.body} @${o.at.getTime()}`);
      return allow ? `n${++n}` : null;
    },
    cancel: async (id) => void calls.push(`cancel ${id}`),
  };
  let now = T0;
  let ids = 0;
  const store = new TimerStore({ storage, notifier, now: () => now, newId: () => `id${++ids}` });
  return { store, mem, calls, setNow: (x: number) => (now = x), deny: () => (allow = false) };
}

test('store: multiple concurrent timers each get a notification', async () => {
  const h = harness();
  const a = await h.store.start({ label: 'Nudeln', seconds: 600 });
  h.setNow(T0 + 1000);
  const b = await h.store.start({ label: 'Ei', seconds: 180 });
  assert.equal(a.notified && b.notified, true);
  assert.equal(h.store.getSnapshot().length, 2);
  assert.deepEqual(h.store.getSnapshot().map((t) => t.label), ['Ei', 'Nudeln']);
  assert.deepEqual(h.calls, [`schedule Nudeln @${T0 + 600_000}`, `schedule Ei @${T0 + 181_000}`]);
});

test('store: pause cancels the notification, resume re-arms with the remaining time', async () => {
  const h = harness();
  const { timer } = await h.store.start({ label: 'x', seconds: 100 });
  h.setNow(T0 + 30_000);
  await h.store.pause(timer.id);
  assert.equal(h.store.get(timer.id)!.status, 'paused');
  assert.equal(h.store.get(timer.id)!.remainingMs, 70_000);
  assert.ok(h.calls.includes('cancel n1'));
  h.setNow(T0 + 50_000);
  assert.equal(await h.store.resume(timer.id), true);
  assert.equal(h.store.get(timer.id)!.endsAt, T0 + 120_000);
  assert.equal(h.store.get(timer.id)!.notificationId, 'n2');
});

test('store: reset and remove cancel the pending notification', async () => {
  const h = harness();
  const { timer } = await h.store.start({ label: 'x', seconds: 100 });
  await h.store.reset(timer.id);
  assert.equal(h.store.get(timer.id)!.remainingMs, 100_000);
  assert.ok(h.calls.includes('cancel n1'));
  await h.store.resume(timer.id);
  await h.store.remove(timer.id);
  assert.equal(h.store.getSnapshot().length, 0);
  assert.ok(h.calls.includes('cancel n2'));
});

test('store: denied notifications → timer still runs, notified=false', async () => {
  const h = harness();
  h.deny();
  const r = await h.store.start({ label: 'x', seconds: 60 });
  assert.equal(r.notified, false);
  assert.equal(r.timer.status, 'running');
  assert.equal(r.timer.notificationId, null);
});

test('store: persists after every change and restores after a restart', async () => {
  const h = harness();
  const { timer } = await h.store.start({ label: 'Pizza', seconds: 300 });
  await h.store.flush();
  const saved = h.mem.get('hui.timers')!;
  const h2 = harness(saved);
  h2.setNow(T0 + 100_000);
  await h2.store.load();
  const back = h2.store.get(timer.id)!;
  assert.equal(back.status, 'running');
  assert.equal(remainingMs(back, T0 + 100_000), 200_000);
  assert.equal(back.notificationId, 'n1');
  // tick after the end flips to done and reports it once
  assert.deepEqual(h2.store.tick(T0 + 301_000).map((t) => t.id), [timer.id]);
  assert.equal(h2.store.get(timer.id)!.status, 'done');
  assert.deepEqual(h2.store.tick(T0 + 302_000), []);
});

test('store: starting with the same source restarts instead of duplicating', async () => {
  const h = harness();
  await h.store.start({ label: 'Schritt 2', seconds: 60, source: 'm1:recipe' });
  h.setNow(T0 + 5000);
  await h.store.start({ label: 'Schritt 2', seconds: 60, source: 'm1:recipe' });
  assert.equal(h.store.getSnapshot().length, 1);
  assert.equal(h.store.getSnapshot()[0].endsAt, T0 + 65_000);
});

test('store: pausing while the notification is still being scheduled cancels the stale one', async () => {
  const mem = new Map<string, string>();
  const calls: string[] = [];
  let release!: (id: string) => void;
  const notifier: TimerNotifier = {
    schedule: () => new Promise((r) => (release = r)),
    cancel: async (id) => void calls.push(`cancel ${id}`),
  };
  const store = new TimerStore({ storage: { getItem: async () => null, setItem: async (k, v) => void mem.set(k, v) }, notifier, now: () => T0, newId: () => 'a' });
  const starting = store.start({ label: 'x', seconds: 60 });
  await new Promise((r) => setImmediate(r));
  await store.pause('a');
  release('late');
  const res = await starting;
  assert.equal(res.notified, false);
  assert.deepEqual(calls, ['cancel late']);
});

test('store: subscribers see every change via a fresh snapshot', async () => {
  const h = harness();
  const seen: number[] = [];
  h.store.subscribe(() => seen.push(h.store.getSnapshot().length));
  const before = h.store.getSnapshot();
  const { timer } = await h.store.start({ label: 'x', seconds: 5 });
  assert.notEqual(h.store.getSnapshot(), before);
  await h.store.remove(timer.id);
  assert.ok(seen.includes(1) && seen[seen.length - 1] === 0);
});
