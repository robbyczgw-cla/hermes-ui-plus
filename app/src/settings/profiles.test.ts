import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeT } from '../i18n/core.ts';
const tt = makeT('de', 'de-DE');
import {
  PRESET_DEMO_ID,
  blankProfile,
  builtinProfiles,
  isDemoProfile,
  maskKey,
  mergeWithBuiltins,
  pickActiveId,
  profileTarget,
  serverRoot,
  validateProfile,
  type ConnectionProfile,
} from './profiles.ts';

test('shipped built-ins: only the offline demo, no hosts or keys', () => {
  const b = builtinProfiles();
  assert.deepEqual(b.map((x) => x.id), [PRESET_DEMO_ID]);
  assert.equal(b[0].kind, 'demo');
  assert.equal(b[0].baseUrl, 'demo://local');
  assert.equal(b[0].apiKey, '');
  assert.ok(isDemoProfile(b[0]));
});

test('no maintainer-specific defaults anywhere in presets/blank profiles', () => {
  const all = JSON.stringify([builtinProfiles(), ...(['hermes', 'demo'] as const).map((k) => blankProfile(k, 'x'))]);
  for (const bad of [/100\.\d+\.\d+\.\d+/, /\.ts\.net/, /hermes-host\b/, /old-build-host/, /build-host/]) assert.doesNotMatch(all, bad);
});

test('blank profiles per kind', () => {
  assert.equal(blankProfile('hermes').sessionKey, 'hermes-ui');
  assert.equal(blankProfile('demo').baseUrl, 'demo://local');
});

test('validateProfile per kind', () => {
  assert.equal(validateProfile({ name: 'a', baseUrl: 'ftp://x', kind: 'hermes' }), 'url');
  assert.equal(validateProfile({ name: ' ', baseUrl: 'http://x', kind: 'hermes' }), 'name');
  assert.equal(validateProfile({ name: 'a', baseUrl: 'http://x/v1', kind: 'hermes' }), null);
  assert.equal(validateProfile({ name: 'a', baseUrl: '', kind: 'demo' }), null);
});



test('mergeWithBuiltins: built-ins first, stored edit wins, keeps kind + key fallback', () => {
  const dev: ConnectionProfile = { id: 'dev-1', kind: 'hermes', name: 'Dev', baseUrl: 'http://a/v1', apiKey: 'devkey' };
  const builtins = [...builtinProfiles(), dev];
  const stored: ConnectionProfile[] = [
    { id: 'dev-1', kind: 'demo', name: 'Mein Dev', baseUrl: 'http://b/v1', apiKey: '' },
    { id: 'p-1', kind: 'hermes', name: 'Ollama', baseUrl: 'http://c/v1', apiKey: '', model: 'llama' },
  ];
  const m = mergeWithBuiltins(stored, builtins);
  assert.deepEqual(m.map((x) => x.id), [PRESET_DEMO_ID, 'dev-1', 'p-1']);
  assert.equal(m[1].name, 'Mein Dev');
  assert.equal(m[1].kind, 'hermes');
  assert.equal(m[1].apiKey, 'devkey');
});

test('pickActiveId: stored > preferred > first real profile > demo', () => {
  const list: ConnectionProfile[] = [...builtinProfiles(), { id: 'p-1', kind: 'hermes', name: 'H', baseUrl: 'http://h/v1', apiKey: '' }];
  assert.equal(pickActiveId(list, 'p-1'), 'p-1');
  assert.equal(pickActiveId(list, 'gone', 'p-1'), 'p-1');
  assert.equal(pickActiveId(list, null), 'p-1');
  assert.equal(pickActiveId(builtinProfiles(), null), PRESET_DEMO_ID);
});

test('helpers', () => {
  assert.equal(serverRoot('http://h:8645/v1/'), 'http://h:8645');
  assert.equal(maskKey('abcdefgh'), '••••efgh');
  assert.equal(maskKey('ab'), '••••');
  assert.equal(profileTarget({ id: 'x', kind: 'hermes', name: 'n', baseUrl: 'http://box.lan:8642/v1', apiKey: '', bridge: true }, tt), 'box.lan:8642 · Bridge');
});

test('resolveModel / modelOverride', async () => {
  const { resolveModel, modelOverride } = await import('./profiles.ts');
  assert.equal(resolveModel(undefined, undefined, 'd'), 'd');
  assert.equal(resolveModel(' ', 'p', 'd'), 'p');
  assert.equal(resolveModel('c', 'p', 'd'), 'c');
  assert.equal(modelOverride('p', 'p', 'd'), undefined);
  assert.equal(modelOverride('d', undefined, 'd'), undefined);
  assert.equal(modelOverride('x', 'p', 'd'), 'x');
  assert.equal(modelOverride(undefined, 'p', 'd'), undefined);
});

test('Hermes URLs follow the onboarding normalization in settings (review part 5, finding 9)', async () => {
  const { cleanBaseUrl, validateProfile } = await import('./profiles.ts');
  assert.equal(cleanBaseUrl('hermes', 'https://example.com'), 'https://example.com/v1');
  assert.equal(cleanBaseUrl('hermes', 'https://example.com/v1?x=1'), 'https://example.com/v1');
  assert.equal(cleanBaseUrl('hermes', ' https://example.com/v1/chat/completions '), 'https://example.com/v1');
  assert.equal(cleanBaseUrl('hermes', 'host.example:8645'), 'https://host.example:8645/v1');
  const bad = { name: 'x', kind: 'hermes' as const };
  assert.equal(validateProfile({ ...bad, baseUrl: 'https://user:pw@example.com/v1' }), 'url');
  assert.equal(validateProfile({ ...bad, baseUrl: 'https://exa mple.com' }), 'url');
  assert.equal(validateProfile({ ...bad, baseUrl: 'https://example.com' }), null);
});
