import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateStoredProfiles, PROFILES_SCHEMA_VERSION, sanitizeStoredProfile, serializeStoredProfiles } from './migrate.ts';
import { parseDevProfiles } from './devProfiles.ts';

// Shape of a v1 store as written by the previous app version (full preset copies, no envelope).
const V1 = JSON.stringify([
  { id: 'preset-bridge', kind: 'hermes', name: 'Hermes via UI-Bridge', baseUrl: 'https://bridge.example.org:8790/v1', sessionKey: 'hermes-ui', bridge: true },
  { id: 'preset-hermes-host', kind: 'hermes', name: 'Mein Hermes', baseUrl: 'http://10.0.0.5:8645/v1', sessionKey: 'hermes-ui' },
  { id: 'preset-claude', kind: 'claude', name: 'Claude direkt', baseUrl: '', model: 'claude-opus-5-5', effort: 'high', webSearch: false },
  { id: 'preset-mock', kind: 'hermes', name: 'Mock (lokal)', baseUrl: 'http://localhost:8787/v1', sessionKey: 'hermes-ui' },
  { id: 'p-old', name: 'Alt ohne kind', baseUrl: 'http://y/v1' },
]);

test('empty storage → nothing; garbage → nothing, no write, flagged corrupt (the caller quarantines it)', () => {
  assert.deepEqual(migrateStoredProfiles(null), { profiles: [], changed: false, from: 0 });
  assert.deepEqual(migrateStoredProfiles(''), { profiles: [], changed: false, from: 0 });
  assert.deepEqual(migrateStoredProfiles('{oops'), { profiles: [], changed: false, from: 0, corrupt: true });
  assert.deepEqual(migrateStoredProfiles('"text"'), { profiles: [], changed: false, from: 0, corrupt: true });
  assert.deepEqual(migrateStoredProfiles('{"v":2}'), { profiles: [], changed: false, from: 0, corrupt: true });
});

test('v1 → v2 keeps old preset copies as normal profiles under the same id', () => {
  const m = migrateStoredProfiles(V1);
  assert.equal(m.from, 1);
  assert.equal(m.changed, true);
  assert.deepEqual(m.profiles.map((p) => p.id), ['preset-bridge', 'preset-hermes-host', 'preset-mock', 'p-old']); // no Claude backend in this build
  const [bridge, hermes, , old] = m.profiles;
  assert.equal(bridge.bridge, true);
  assert.equal(bridge.baseUrl, 'https://bridge.example.org:8790/v1');
  assert.equal(hermes.name, 'Mein Hermes');
  assert.equal(old.kind, 'hermes', 'v1 profiles without kind are Hermes profiles');
  assert.ok(m.profiles.every((p) => !('apiKey' in p)), 'keys stay in the secure store');
});

test('v1 preset copies without a usable URL are dropped, user profiles are kept', () => {
  const m = migrateStoredProfiles(JSON.stringify([
    { id: 'preset-hermes-host', kind: 'hermes', name: 'x', baseUrl: '' },
    { id: 'p-1', kind: 'hermes', name: 'kaputt', baseUrl: 'http//nope' },
    { id: 'preset-claude', name: '' },
  ]));
  assert.deepEqual(m.profiles.map((p) => p.id), ['p-1']);
});

test('v2 round trip is stable (no write-back) and keeps all kinds', () => {
  const v2 = migrateStoredProfiles(serializeStoredProfiles(migrateStoredProfiles(V1).profiles));
  assert.equal(v2.from, PROFILES_SCHEMA_VERSION);
  assert.equal(v2.changed, false);
  const all = serializeStoredProfiles([
    { id: 'h', kind: 'hermes', name: 'H', baseUrl: 'http://h/v1', syncSessions: false, bridge: true, sessionKey: 'k' },
  ]);
  const m = migrateStoredProfiles(all);
  assert.equal(m.changed, false);
  assert.deepEqual(JSON.parse(serializeStoredProfiles(m.profiles)), JSON.parse(all));
});

test('v2: unknown kinds (backends this build does not have), demo and duplicates are dropped', () => {
  const m = migrateStoredProfiles(JSON.stringify({ v: 2, profiles: [
    { id: 'a', kind: 'telepathy', name: 'A', baseUrl: '' },
    { id: 'preset-demo', kind: 'demo', name: 'Demo', baseUrl: 'demo://local' },
    { id: 'h', kind: 'hermes', name: 'H', baseUrl: 'http://h/v1', bridge: 'yes' },
    { id: 'h', kind: 'hermes', name: 'dup', baseUrl: 'http://h/v1' },
    null,
  ] }));
  assert.equal(m.changed, true);
  assert.deepEqual(m.profiles, [{ id: 'h', kind: 'hermes', name: 'H', baseUrl: 'http://h/v1' }]);
});

test('newer schema: read what is understood, never write back', () => {
  const m = migrateStoredProfiles(JSON.stringify({ v: 9, profiles: [{ id: 'h', kind: 'hermes', name: 'H', baseUrl: 'http://h/v1', future: 1 }] }));
  assert.equal(m.changed, false);
  assert.equal(m.newer, true);
  assert.equal(m.from, 9);
  assert.deepEqual(m.profiles.map((p) => p.id), ['h']);
});

test('sanitize: syncSessions only stored when switched off', () => {
  assert.equal(sanitizeStoredProfile({ id: 'h', kind: 'hermes', name: 'H', baseUrl: 'http://h/v1', syncSessions: true })!.syncSessions, undefined);
  assert.equal(sanitizeStoredProfile({ id: 'h', kind: 'hermes', name: 'H', baseUrl: 'http://h/v1', syncSessions: false })!.syncSessions, false);
});

test('dev profiles from EXPO_PUBLIC_DEV_PROFILES', () => {
  assert.deepEqual(parseDevProfiles(undefined), { profiles: [] });
  assert.ok(parseDevProfiles('nope').error);
  const d = parseDevProfiles(JSON.stringify([
    { kind: 'hermes', name: 'Mock', baseUrl: 'http://localhost:8787/v1', apiKey: 'mock ' },
    { id: 'preset-bridge', name: 'Bridge', baseUrl: 'https://b.example/v1', bridge: true, apiKey: 't', active: true },
    { id: 'x', kind: 'unknown', name: 'skip', baseUrl: '' },
  ]));
  assert.deepEqual(d.profiles.map((p) => p.id), ['dev-1', 'preset-bridge']);
  assert.equal(d.profiles[0].apiKey, 'mock');
  assert.equal(d.profiles[1].bridge, true);
  assert.equal(d.activeId, 'preset-bridge');
});
