// Voice settings hydration vs. a change made while the stored settings are still loading (review part 5, finding 6).
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { deferred, flush, installRnStubs } from '../testkit/rn.ts';

const rn = installRnStubs();
let n = 0;
/** a fresh module instance (own state) per test */
const fresh = () => import(`./settingsStore.ts?case=${n++}`) as Promise<typeof import('./settingsStore.ts')>;
const KEY = 'hermes.voice.settings.v1';
beforeEach(() => rn.resetAll());

test('a selection made while loading survives hydration and is what ends up on disk', async () => {
  rn.asyncStorage.data.set(KEY, JSON.stringify({ ttsEngine: 'bridge', ttsRate: 1.5, autoRead: true }));
  const gate = deferred();
  rn.asyncStorage.gate = (op) => (op === 'get' ? gate.promise : null);
  const s = await fresh();
  const loading = s.loadVoiceSettings(); // read started
  s.updateVoiceSettings({ ttsEngine: 'device' }); // user picks "Gerät" meanwhile
  gate.resolve();
  await loading;
  await flush();
  const cur = s.getVoiceSettings();
  assert.equal(cur.ttsEngine, 'device', 'user choice wins');
  assert.equal(cur.ttsRate, 1.5, 'untouched stored values are loaded');
  assert.equal(cur.autoRead, true);
  const disk = JSON.parse(rn.asyncStorage.data.get(KEY)!);
  assert.equal(disk.ttsEngine, 'device', 'memory and disk agree');
  assert.equal(disk.ttsRate, 1.5, 'stored values not overwritten by defaults');
});

test('a change before the first read does not wipe other stored fields', async () => {
  rn.asyncStorage.data.set(KEY, JSON.stringify({ ttsRate: 1.25, sttLanguage: 'en' }));
  const s = await fresh();
  s.updateVoiceSettings({ autoRead: true });
  await flush(10);
  const disk = JSON.parse(rn.asyncStorage.data.get(KEY)!);
  assert.equal(disk.ttsRate, 1.25);
  assert.equal(disk.sttLanguage, 'en');
  assert.equal(disk.autoRead, true);
  assert.equal(s.getVoiceSettings().ttsRate, 1.25);
});

test('writes stay in call order', async () => {
  const s = await fresh();
  await s.loadVoiceSettings();
  s.updateVoiceSettings({ ttsRate: 1.5 });
  s.updateVoiceSettings({ ttsRate: 2 });
  await flush(10);
  assert.equal(JSON.parse(rn.asyncStorage.data.get(KEY)!).ttsRate, 2);
});

test('unreadable storage keeps defaults and later changes still persist', async () => {
  rn.asyncStorage.failWhen = (op) => (op === 'get' ? 'boom' : null);
  const s = await fresh();
  await s.loadVoiceSettings();
  rn.asyncStorage.failWhen = null;
  s.updateVoiceSettings({ autoRead: true });
  await flush(10);
  assert.equal(JSON.parse(rn.asyncStorage.data.get(KEY)!).autoRead, true);
});
