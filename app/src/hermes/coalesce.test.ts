/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCoalescedCheck } from './coalesce.ts';

test('M3: a check requested while another runs is queued and runs afterwards (never dropped)', async () => {
  const calls: (string | undefined)[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const check = createCoalescedCheck(async (t) => {
    calls.push(t);
    if (calls.length === 1) await gate;
  });
  const first = check(); // mount/foreground check (slow)
  const tap = check('run-2'); // notification tap meanwhile
  const again = check('run-2'); // duplicate merges
  release();
  await Promise.all([first, tap, again]);
  assert.deepEqual(calls, [undefined, 'run-2']);
});

test('M3: a full check queued behind a targeted one covers the targeted requests', async () => {
  const calls: (string | undefined)[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const check = createCoalescedCheck(async (t) => {
    calls.push(t);
    if (calls.length === 1) await gate;
  });
  const a = check('run-1');
  const b = check('run-2');
  const c = check();
  release();
  await Promise.all([a, b, c]);
  assert.deepEqual(calls, ['run-1', undefined]);
});
