import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLatestRun } from './latestRun.ts';

test('a newer run invalidates the older one and aborts its signal', () => {
  const l = createLatestRun();
  const a = l.begin();
  assert.equal(a.current(), true);
  const b = l.begin();
  assert.equal(a.current(), false);
  assert.equal(a.signal.aborted, true);
  assert.equal(b.current(), true);
  assert.equal(b.signal.aborted, false);
});

test('invalidate() (edit / unmount) drops the running one', () => {
  const l = createLatestRun();
  const a = l.begin();
  l.invalidate();
  assert.equal(a.current(), false);
  assert.equal(a.signal.aborted, true);
  const b = l.begin();
  assert.equal(b.current(), true);
});

test('a late completion is ignored when the inputs changed meanwhile', async () => {
  const l = createLatestRun();
  let shown: string | null = null;
  const run = async (key: string, delay: Promise<void>) => {
    const tk = l.begin();
    await delay;
    if (tk.current()) shown = `result for ${key}`;
  };
  let release!: () => void;
  const slow = run('old key', new Promise<void>((r) => (release = r)));
  l.invalidate(); // user edits the key
  release();
  await slow;
  assert.equal(shown, null);
});
