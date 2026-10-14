import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHermesProfile, parseOnboardedFlag, serializeOnboardedFlag, shouldShowOnboarding, skillInstallCommand } from './model.ts';
import type { ConnectionProfile } from '../settings/profiles.ts';

test('onboarded flag round-trip and tolerant parsing', () => {
  const f = parseOnboardedFlag(serializeOnboardedFlag('bridge', 1234));
  assert.deepEqual(f, { v: 1, at: 1234, path: 'bridge' });
  for (const raw of [null, '', 'true', '1', '{', '[]', '{"v":2,"at":1,"path":"demo"}', '{"v":1,"at":"x","path":"demo"}', '{"v":1,"at":1,"path":"evil"}']) {
    assert.equal(parseOnboardedFlag(raw), null, String(raw));
  }
});

test('shouldShowOnboarding', () => {
  assert.equal(shouldShowOnboarding({ flag: null, hasLegacySetup: false }), true);
  assert.equal(shouldShowOnboarding({ flag: { v: 1, at: 1, path: 'demo' }, hasLegacySetup: false }), false);
  assert.equal(shouldShowOnboarding({ flag: null, hasLegacySetup: true }), false);
  assert.equal(shouldShowOnboarding({ flag: null, hasLegacySetup: false, hasDevKeys: true }), false);
});

test('buildHermesProfile: new profile', () => {
  const p = buildHermesProfile({ baseUrl: 'https://h.example.org/v1', apiKey: ' k ', name: ' Zuhause ', bridge: true }, [], () => 'id1');
  assert.deepEqual(p, { id: 'id1', kind: 'hermes', name: 'Zuhause', baseUrl: 'https://h.example.org/v1', apiKey: 'k', sessionKey: 'hermes-ui', bridge: true });
  const q = buildHermesProfile({ baseUrl: 'https://h.example.org/v1', apiKey: '', name: '', bridge: false }, [], () => 'id2');
  assert.equal(q.name, 'https://h.example.org/v1');
  assert.equal(q.bridge, undefined);
});

test('buildHermesProfile: re-pairing updates the existing profile', () => {
  const existing: ConnectionProfile[] = [
    { id: 'c', kind: 'demo', name: 'Demo', baseUrl: 'https://h.example.org/v1', apiKey: 'x' },
    { id: 'old', kind: 'hermes', name: 'Alt', baseUrl: 'https://H.example.org/v1/', apiKey: 'old', sessionKey: 'custom', model: 'm' },
  ];
  const p = buildHermesProfile({ baseUrl: 'https://h.example.org/v1', apiKey: 'new', name: '', bridge: true }, existing, () => 'never');
  assert.equal(p.id, 'old');
  assert.equal(p.name, 'Alt');
  assert.equal(p.apiKey, 'new');
  assert.equal(p.sessionKey, 'custom');
  assert.equal(p.model, 'm');
  assert.equal(p.bridge, true);
});

test('skill install command is generic (placeholder, no maintainer hosts)', () => {
  // no published repo URL: only the copy step, never a `<REPO-URL>` placeholder
  const cmd = skillInstallCommand(null);
  assert.ok(!/<|REPO|git clone/.test(cmd), cmd);
  assert.ok(cmd.includes('cp -r hermes-skill/hermes-ui ~/.hermes/skills/'));
  assert.ok(!/hermes-host|100\.114|example/.test(skillInstallCommand()));
  assert.ok(skillInstallCommand('https://git.example.org/x/hermes-ui').includes('https://git.example.org/x/hermes-ui'));
});
