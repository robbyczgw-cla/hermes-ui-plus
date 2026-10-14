import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CRASH_MARKER_TTL_MS,
  CRASH_STORAGE_KEY,
  clearCrashMarker,
  makeCrashMarker,
  parseCrashMarker,
  readCrashMarker,
  shouldStartFresh,
  writeCrashMarker,
  type CrashStorage,
} from './crashMarker.ts';

function mem(): CrashStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  };
}

test('makeCrashMarker keeps the first error line only', () => {
  const m = makeCrashMarker('c1', 'p1', new TypeError('undefined cannot be used as a constructor.\n  at foo'), 1000);
  assert.deepEqual(m, { conversationId: 'c1', profileId: 'p1', message: 'undefined cannot be used as a constructor.', at: 1000 });
  assert.equal(makeCrashMarker('c1', undefined, {}, 5).message, undefined);
});

test('parseCrashMarker rejects garbage', () => {
  assert.equal(parseCrashMarker(null), null);
  assert.equal(parseCrashMarker('nope'), null);
  assert.equal(parseCrashMarker('{"conversationId":""}'), null);
  assert.equal(parseCrashMarker('[1]'), null);
  assert.deepEqual(parseCrashMarker('{"conversationId":"c","at":"x"}'), { conversationId: 'c', profileId: undefined, message: undefined, at: 0 });
});

test('shouldStartFresh only for the active, recently crashed chat', () => {
  const now = 10_000_000;
  const m = { conversationId: 'c1', at: now - 1000 };
  assert.equal(shouldStartFresh(m, 'c1', now), true);
  assert.equal(shouldStartFresh(m, 'c2', now), false);
  assert.equal(shouldStartFresh(m, undefined, now), false);
  assert.equal(shouldStartFresh(null, 'c1', now), false);
  assert.equal(shouldStartFresh({ conversationId: 'c1', at: now - CRASH_MARKER_TTL_MS - 1 }, 'c1', now), false);
});

test('write / read / clear round trip; clear(id) only removes the matching marker', async () => {
  const s = mem();
  await writeCrashMarker(s, { conversationId: 'c1', at: 1 });
  assert.equal((await readCrashMarker(s))?.conversationId, 'c1');
  await clearCrashMarker(s, 'other');
  assert.ok(s.data.has(CRASH_STORAGE_KEY));
  await clearCrashMarker(s, 'c1');
  assert.equal(await readCrashMarker(s), null);
  await writeCrashMarker(s, { conversationId: 'c2', at: 1 });
  await clearCrashMarker(s);
  assert.equal(s.data.size, 0);
});

test('storage failures never throw', async () => {
  const broken: CrashStorage = {
    getItem: async () => {
      throw new Error('io');
    },
    setItem: async () => {
      throw new Error('io');
    },
    removeItem: async () => {
      throw new Error('io');
    },
  };
  assert.equal(await readCrashMarker(broken), null);
  await writeCrashMarker(broken, { conversationId: 'c', at: 1 });
  await clearCrashMarker(broken, 'c');
  await clearCrashMarker(broken);
});
