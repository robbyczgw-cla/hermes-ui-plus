import { test } from 'node:test';
import assert from 'node:assert/strict';
import { persistImageKey, type ImageKeyDeps } from './imageKey.ts';

function deps(overrides: Partial<ImageKeyDeps<'serper' | 'brave'>> = {}) {
  const saved: string[] = [];
  const configs: unknown[] = [];
  const d: ImageKeyDeps<'serper' | 'brave'> = {
    save: async (p, v) => void saved.push(`${p}:${v}`),
    setConfig: (c) => void configs.push(c),
    ...overrides,
  };
  return { d, saved, configs };
}

test('stores first, then publishes the key to the resolver', async () => {
  const x = deps();
  assert.equal(await persistImageKey(x.d, 'serper', ' k1 '), 'saved');
  assert.deepEqual(x.saved, ['serper:k1']);
  assert.deepEqual(x.configs, [{ provider: 'serper', key: 'k1' }]);
});

test('a rejected storage write is reported and the resolver is NOT updated', async () => {
  const x = deps({ save: async () => Promise.reject(new Error('keychain')) });
  assert.equal(await persistImageKey(x.d, 'serper', 'k1'), 'failed');
  assert.deepEqual(x.configs, []);
});

test('an empty key clears the resolver configuration', async () => {
  const x = deps();
  assert.equal(await persistImageKey(x.d, 'brave', '  '), 'cleared');
  assert.deepEqual(x.configs, [null]);
});

test('provider changed while the write ran: the global resolver is left alone', async () => {
  let selected = 'serper';
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const x = deps({ save: async () => gate });
  const p = persistImageKey(x.d, 'serper', 'k1', () => selected === 'serper');
  selected = 'brave'; // user switches provider
  release();
  assert.equal(await p, 'stale');
  assert.deepEqual(x.configs, []);
});
