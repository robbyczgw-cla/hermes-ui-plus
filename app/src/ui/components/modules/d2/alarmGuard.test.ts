// GPT review #13: concurrent alarm scheduling for one clock must never leave an orphaned live alarm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createArmGuard } from './alarmGuard.ts';

function deferred() {
  let resolve!: (v: string | null) => void;
  const promise = new Promise<string | null>((r) => (resolve = r));
  return { promise, resolve };
}

test('start + sound toggle while scheduling: the superseded alarm is cancelled, one id committed', async () => {
  const g = createArmGuard();
  const live = new Set<string>();
  let stored: string | null = null;
  const commit = (id: string) => (stored = id);
  const cancel = (id: string) => live.delete(id);
  const a = deferred();
  const b = deferred();
  const p1 = g.arm('k', () => a.promise.then((id) => (id && live.add(id), id)), () => true, commit, cancel); // start
  const p2 = g.arm('k', () => b.promise.then((id) => (id && live.add(id), id)), () => true, commit, cancel); // sound toggle
  b.resolve('alarm-2'); // newer finishes first …
  a.resolve('alarm-1'); // … the stale one later (both target the same endsAt)
  assert.deepEqual(await Promise.all([p1, p2]), [null, 'alarm-2']);
  assert.equal(stored, 'alarm-2');
  assert.deepEqual([...live], ['alarm-2'], 'no orphan: only the stored alarm is live');
});

test('a clock change (pause/reset) during scheduling cancels the late result', async () => {
  const g = createArmGuard();
  const cancelled: string[] = [];
  let stored: string | null = null;
  const d = deferred();
  const p = g.arm('k', () => d.promise, () => true, (id) => (stored = id), (id) => cancelled.push(id));
  g.bump('k'); // pause
  d.resolve('alarm-1');
  assert.equal(await p, null);
  assert.equal(stored, null);
  assert.deepEqual(cancelled, ['alarm-1']);
});

test('generations are per clock', async () => {
  const g = createArmGuard();
  const stored: string[] = [];
  const p1 = g.arm('a', async () => 'A', () => true, (id) => stored.push(id), () => assert.fail('A cancelled'));
  const p2 = g.arm('b', async () => 'B', () => true, (id) => stored.push(id), () => assert.fail('B cancelled'));
  await Promise.all([p1, p2]);
  assert.deepEqual(stored.sort(), ['A', 'B']);
});
