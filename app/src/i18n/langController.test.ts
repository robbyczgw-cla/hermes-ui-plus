// Language hydration and lazy-dictionary recovery (review part 5, findings 7 + 8; test gap 5/6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Lang } from './core.ts';
import { createLangController, type LangDeps } from './langController.ts';

const deferred = <T = void>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const tick = () => new Promise<void>((r) => setImmediate(r));

function setup(opts: { stored?: string | null; tags?: string[]; loaded?: Lang[] } = {}) {
  const loaded = new Set<Lang>(['de', ...(opts.loaded ?? [])]);
  const disk = new Map<string, string>();
  if (opts.stored) disk.set('hui.lang', opts.stored);
  const read = deferred<void>();
  const loads: { lang: Lang; ok: (v?: void) => void; fail: (e?: unknown) => void }[] = [];
  const deps: LangDeps = {
    storage: {
      getItem: async (k) => (await read.promise, disk.get(k) ?? null),
      setItem: async (k, v) => void disk.set(k, v),
    },
    deviceTags: () => opts.tags ?? ['de-DE'],
    hasDictionary: (l) => loaded.has(l),
    loadDictionary: (l) =>
      new Promise<void>((resolve, reject) =>
        loads.push({
          lang: l,
          ok: () => (loaded.add(l), resolve()),
          fail: (e) => reject(e ?? new Error('chunk failed')),
        }),
      ),
  };
  return { ctl: createLangController(deps), disk, read, loads, loaded };
}

test('a language chosen while the stored one is still being read is not overwritten', async () => {
  const s = setup({ stored: 'es', loaded: ['en', 'es'] });
  const hydrating = s.ctl.hydrate();
  s.ctl.setSetting('en'); // user taps English before the read finished
  s.read.resolve();
  await hydrating;
  assert.equal(s.ctl.getState().setting, 'en');
  assert.equal(s.ctl.getState().shown?.lang, 'en');
  assert.equal(s.disk.get('hui.lang'), 'en', 'what is shown is what loads next launch');
});

test('hydration applies the stored setting when the user did not touch it', async () => {
  const s = setup({ stored: 'en', loaded: ['en'] });
  s.read.resolve();
  await s.ctl.hydrate();
  assert.equal(s.ctl.getState().setting, 'en');
  assert.equal(s.ctl.getState().shown?.lang, 'en');
});

test('garbage in storage is ignored', async () => {
  const s = setup({ stored: 'fr' });
  s.read.resolve();
  await s.ctl.hydrate();
  assert.equal(s.ctl.getState().setting, 'system');
});

test('a failed dictionary load keeps the previous language, is reported, and re-selecting the language retries it', async () => {
  const s = setup();
  assert.equal(s.ctl.getState().shown?.lang, 'de');
  s.ctl.setSetting('en');
  assert.equal(s.loads.length, 1);
  s.loads[0].fail(); // offline
  await tick();
  assert.deepEqual({ ...s.ctl.getState() }, { setting: 'en', shown: { lang: 'de', locale: 'de-DE' }, failed: true });

  // connectivity is back; the user taps "English" again (selected segment unchanged) → loader is called again
  s.ctl.setSetting('en');
  assert.equal(s.loads.length, 2, 'the loader is invoked again');
  s.loads[1].ok();
  await tick();
  assert.deepEqual(s.ctl.getState().shown, { lang: 'en', locale: 'en-US' });
  assert.equal(s.ctl.getState().failed, false);
});

test('retry() reloads without changing the setting', async () => {
  const s = setup();
  s.ctl.setSetting('es');
  s.loads[0].fail();
  await tick();
  assert.equal(s.ctl.getState().failed, true);
  s.ctl.retry();
  s.loads[1].ok();
  await tick();
  assert.equal(s.ctl.getState().shown?.lang, 'es');
  assert.equal(s.ctl.getState().failed, false);
});

test('a slow load of an earlier choice cannot replace a newer one', async () => {
  const s = setup({ loaded: ['en'] });
  s.ctl.setSetting('es'); // starts loading es
  s.ctl.setSetting('en'); // then English (already loaded)
  assert.equal(s.ctl.getState().shown?.lang, 'en');
  s.loads[0].ok(); // es arrives late
  await tick();
  assert.equal(s.ctl.getState().shown?.lang, 'en');
});

test('first start with an offline device language: German instead of a blank app, flagged as failed', async () => {
  const s = setup({ tags: ['en-GB'] });
  assert.equal(s.ctl.getState().shown, null, 'nothing rendered before a dictionary is ready');
  s.loads[0].fail();
  await tick();
  assert.equal(s.ctl.getState().shown?.lang, 'de');
  assert.equal(s.ctl.getState().failed, true);
});
