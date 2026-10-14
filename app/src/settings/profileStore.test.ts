// Real persistence path: profileStore.ts + storage.ts (+ migrate/secretHeaders) on in-memory AsyncStorage /
// SecureStore fakes (testkit/rn.ts). Covers review part 5 finding 1 and test gap 1.
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { deferred, installRnStubs } from '../testkit/rn.ts';
import type { ConnectionProfile } from './profiles.ts';

const rn = installRnStubs();
const storage = await import('./storage.ts');
const { createProfileStore } = await import('./profileStore.ts');
const { partitionByFlavor } = await import('../flavor.ts');
const { mergeWithBuiltins, builtinProfiles } = await import('./profiles.ts');

const builtins = builtinProfiles();
const hermes = (id: string, apiKey = '', extra: Partial<ConnectionProfile> = {}): ConnectionProfile => ({
  id,
  kind: 'hermes',
  name: id,
  baseUrl: 'https://hermes.example/v1',
  apiKey,
  ...extra,
});

function makeStore(flavor: 'hermes' | 'personal' = 'hermes') {
  return createProfileStore({
    initial: builtins,
    builtinIds: new Set(builtins.map((b) => b.id)),
    save: storage.saveProfiles,
    clean: (p) => p,
    load: async () => {
      const { profiles, activeId } = await storage.loadProfiles();
      const { visible, hidden } = partitionByFlavor(profiles, flavor);
      return { visible: mergeWithBuiltins(visible, builtins), hidden, activeId };
    },
  });
}

const secretKey = (id: string) => `hermes.apikey.${id}`;
/** ids in the persisted metadata (the built-in demo is always written along, and dropped again on load) */
const metaIds = (): string[] => {
  const raw = rn.asyncStorage.data.get('hermes.profiles.v1');
  return raw ? (JSON.parse(raw).profiles as { id: string }[]).map((p) => p.id).filter((id) => id !== 'preset-demo') : [];
};

beforeEach(() => rn.resetAll());

test('failed key write: list unchanged, the retry of the same save writes the key', async () => {
  const store = makeStore();
  await store.init();
  rn.secureStore.failWhen = (op, key) => (op === 'set' && key === secretKey('a') ? 'keychain locked' : null);
  await assert.rejects(store.upsert(hermes('a', 'sk-new')), /keychain locked/);
  assert.deepEqual(store.get().map((p) => p.id), ['preset-demo'], 'nothing published after a failed save');
  assert.equal(rn.asyncStorage.data.has('hermes.profiles.v1'), false, 'metadata must not be written without the key');

  rn.secureStore.failWhen = null;
  await store.upsert(hermes('a', 'sk-new')); // same value again
  assert.equal(rn.secureStore.data.get(secretKey('a')), 'sk-new');
  assert.deepEqual(metaIds(), ['a']);
  assert.equal(store.get().find((p) => p.id === 'a')?.apiKey, 'sk-new');
});

test('failed key change of an existing profile: retry rewrites the key instead of comparing with the failed value', async () => {
  const store = makeStore();
  await store.init();
  await store.upsert(hermes('a', 'old'));
  rn.secureStore.failWhen = (op, key) => (op === 'set' && key === secretKey('a') ? 'boom' : null);
  await assert.rejects(store.upsert(hermes('a', 'new')));
  assert.equal(store.get().find((p) => p.id === 'a')?.apiKey, 'old');
  rn.secureStore.failWhen = null;
  await store.upsert(hermes('a', 'new'));
  assert.equal(rn.secureStore.data.get(secretKey('a')), 'new');
});

test('metadata write fails after the secret was stored: retry succeeds and the profile appears after a restart', async () => {
  const store = makeStore();
  await store.init();
  rn.asyncStorage.failWhen = (op, key) => (op === 'set' && key === 'hermes.profiles.v1' ? 'disk full' : null);
  await assert.rejects(store.upsert(hermes('a', 'k1')), /disk full/);
  assert.equal(store.get().length, 1);
  rn.asyncStorage.failWhen = null;
  await store.upsert(hermes('a', 'k1'));

  const restarted = makeStore();
  await restarted.init();
  const a = restarted.get().find((p) => p.id === 'a');
  assert.equal(a?.apiKey, 'k1');
});


test('failed delete keeps the profile listed and the retry removes key and metadata', async () => {
  const store = makeStore();
  await store.init();
  await store.upsert(hermes('a', 'k'));
  await store.upsert(hermes('b', 'k2'));
  rn.secureStore.failWhen = (op, key) => (op === 'remove' && key === secretKey('a') ? 'cannot delete' : null);
  await assert.rejects(store.remove('a'), /cannot delete/);
  assert.ok(store.get().some((p) => p.id === 'a'), 'still listed after a failed delete');
  assert.deepEqual(metaIds().sort(), ['a', 'b'], 'disk and memory agree');
  rn.secureStore.failWhen = null;
  assert.equal(await store.remove('a'), true);
  assert.equal(rn.secureStore.data.has(secretKey('a')), false, 'no orphaned key');
  assert.deepEqual(metaIds(), ['b']);
});

test('concurrent saves are serialized: both profiles end up persisted, in call order', async () => {
  const store = makeStore();
  await store.init();
  const gate = deferred();
  let first = true;
  rn.secureStore.gate = () => {
    if (!first) return null;
    first = false;
    return gate.promise; // hold the first save's key write
  };
  const p1 = store.upsert(hermes('a', 'ka'));
  const p2 = store.upsert(hermes('b', 'kb'));
  await new Promise((r) => setImmediate(r));
  assert.equal(rn.secureStore.data.has(secretKey('b')), false, 'second save waits for the first');
  gate.resolve();
  await Promise.all([p1, p2]);
  assert.deepEqual(metaIds(), ['a', 'b']);
  assert.equal(rn.secureStore.data.get(secretKey('a')), 'ka');
  assert.equal(rn.secureStore.data.get(secretKey('b')), 'kb');
});

test('a failed save does not stop later saves in the queue', async () => {
  const store = makeStore();
  await store.init();
  rn.secureStore.failWhen = (op, key) => (op === 'set' && key === secretKey('a') ? 'x' : null);
  const bad = store.upsert(hermes('a', 'k'));
  const good = store.upsert(hermes('b', 'k'));
  await assert.rejects(bad);
  await good;
  assert.deepEqual(metaIds(), ['b']);
});


test('hydration returns stored keys and the active id; builtins cannot be removed', async () => {
  rn.asyncStorage.data.set('hermes.profiles.v1', JSON.stringify({ v: 2, profiles: [{ id: 'h', kind: 'hermes', name: 'H', baseUrl: 'https://h.example/v1' }] }));
  rn.asyncStorage.data.set('hermes.activeProfile.v1', 'h');
  rn.secureStore.data.set(secretKey('h'), 'tok');
  const store = makeStore();
  assert.equal(await store.init(), 'h');
  assert.equal(store.get().find((p) => p.id === 'h')?.apiKey, 'tok');
  assert.equal(await store.remove('preset-demo'), false);
});

test('unparseable profile JSON: raw value quarantined, empty list, saving still works', async () => {
  rn.asyncStorage.data.set('hermes.profiles.v1', '{"v":2,"profiles":[{"id":"a"');
  const store = makeStore();
  await store.init();
  assert.equal(storage.profilesStorageState(), 'recovered');
  assert.equal(rn.asyncStorage.data.get(storage.PROFILES_CORRUPT_KEY), '{"v":2,"profiles":[{"id":"a"');
  assert.deepEqual(store.get().map((p) => p.id), ['preset-demo']);
  await store.upsert(hermes('b', 'sk-b'));
  assert.deepEqual(metaIds(), ['b']);
  assert.equal(rn.asyncStorage.data.get(storage.PROFILES_CORRUPT_KEY), '{"v":2,"profiles":[{"id":"a"', 'quarantine kept');
  // a second, different corrupt value never overwrites the first copy but gets its own slot
  rn.asyncStorage.data.set('hermes.profiles.v1', 'garbage');
  await makeStore().init();
  assert.equal(rn.asyncStorage.data.get(storage.PROFILES_CORRUPT_KEY), '{"v":2,"profiles":[{"id":"a"');
  assert.equal(rn.asyncStorage.data.get(`${storage.PROFILES_CORRUPT_KEY}.2`), 'garbage');
  // the same corrupt value again is not duplicated
  rn.asyncStorage.data.set('hermes.profiles.v1', 'garbage');
  await makeStore().init();
  assert.equal(rn.asyncStorage.data.get(`${storage.PROFILES_CORRUPT_KEY}.3`), undefined);
});

test('quarantine slots are bounded: once full, the newest slot holds the latest different corrupt value', async () => {
  for (let i = 0; i < storage.PROFILES_CORRUPT_SLOTS + 2; i++) {
    rn.asyncStorage.data.set('hermes.profiles.v1', `garbage-${i}`);
    await makeStore().init();
  }
  assert.equal(rn.asyncStorage.data.get(storage.PROFILES_CORRUPT_KEY), 'garbage-0', 'first copy never overwritten');
  const last = `${storage.PROFILES_CORRUPT_KEY}.${storage.PROFILES_CORRUPT_SLOTS}`;
  assert.equal(rn.asyncStorage.data.get(last), `garbage-${storage.PROFILES_CORRUPT_SLOTS + 1}`);
  assert.equal(rn.asyncStorage.data.get(`${storage.PROFILES_CORRUPT_KEY}.${storage.PROFILES_CORRUPT_SLOTS + 1}`), undefined);
});

test('newer schema: profiles readable, every save refused until the user unlocks; the newer blob is backed up', async () => {
  const newer = JSON.stringify({ v: 9, profiles: [{ id: 'h', kind: 'hermes', name: 'H', baseUrl: 'https://h.example/v1', future: 1 }] });
  rn.asyncStorage.data.set('hermes.profiles.v1', newer);
  const store = makeStore();
  await store.init();
  assert.equal(storage.profilesStorageState(), 'newer');
  assert.ok(store.get().some((p) => p.id === 'h'));
  await assert.rejects(store.upsert(hermes('x', 'sk-x')), (e) => storage.isProfilesReadOnlyError(e));
  await assert.rejects(store.remove('h'), (e) => storage.isProfilesReadOnlyError(e));
  assert.equal(rn.asyncStorage.data.get('hermes.profiles.v1'), newer, 'untouched');
  assert.equal(rn.secureStore.data.has(secretKey('x')), false, 'no secret written either');

  await storage.unlockProfiles();
  assert.equal(storage.profilesStorageState(), 'ok');
  assert.equal(rn.asyncStorage.data.get(storage.PROFILES_NEWER_KEY), newer);
  await store.upsert(hermes('x', 'sk-x'));
  assert.deepEqual(metaIds().sort(), ['h', 'x']);
});

test('storage read error: read-only (an empty list must never replace the real one)', async () => {
  rn.asyncStorage.data.set('hermes.profiles.v1', JSON.stringify({ v: 2, profiles: [{ id: 'keep', kind: 'hermes', name: 'K', baseUrl: 'https://k.example/v1' }] }));
  rn.asyncStorage.failWhen = (op, key) => (op === 'get' && key === 'hermes.profiles.v1' ? 'I/O error' : null);
  const store = makeStore();
  await store.init();
  rn.asyncStorage.failWhen = null;
  assert.equal(storage.profilesStorageState(), 'unreadable');
  await assert.rejects(store.upsert(hermes('n', 'sk-n')), (e) => storage.isProfilesReadOnlyError(e));
  assert.deepEqual(metaIds(), ['keep']);
});
