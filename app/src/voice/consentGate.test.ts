import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { installRnStubs } from '../testkit/rn.ts';

const rn = installRnStubs();
const { ensureVoiceConsent, voiceEngineNeedsConsent } = await import('./consentGate.ts');
const store = await import('../compliance/store.ts');

beforeEach(async () => {
  store.settleConsentPrompt(false);
  await store.revokeAiConsent();
  rn.resetAll();
});

test('which engines leave the device', () => {
  assert.deepEqual((['bridge', 'apikey', 'device'] as const).map(voiceEngineNeedsConsent), [true, true, false]);
});

test('device engine: no question, no state access', async () => {
  assert.deepEqual(await ensureVoiceConsent('device', { isCurrent: async () => assert.fail('asked'), request: async () => assert.fail('asked') }), { ok: true, prompted: false });
});

test('remote engine without consent: asks; accepted → ok+prompted; declined → consentRequired error', async () => {
  const yes = await ensureVoiceConsent('apikey', { isCurrent: async () => false, request: async () => true });
  assert.deepEqual(yes, { ok: true, prompted: true });
  const no = await ensureVoiceConsent('bridge', { isCurrent: async () => false, request: async () => false });
  assert.equal(no.ok, false);
  assert.equal(!no.ok && no.error.key, 'voice.errors.consentRequired');
  const current = await ensureVoiceConsent('bridge', { isCurrent: async () => true, request: async () => assert.fail('asked') });
  assert.deepEqual(current, { ok: true, prompted: false });
});

test('a failing consent lookup counts as "not given"', async () => {
  const r = await ensureVoiceConsent('bridge', { isCurrent: async () => Promise.reject(new Error('storage')), request: async () => true });
  assert.equal(r.ok, false);
});

test('real store: the prompt opens, accepting resolves every waiter and persists, declining resolves false', async () => {
  const a = ensureVoiceConsent('bridge');
  const b = ensureVoiceConsent('apikey');
  await new Promise((r) => setImmediate(r));
  assert.equal(store.consentPromptOpen(), true);
  await store.acceptAiConsent();
  assert.deepEqual(await Promise.all([a, b]), [{ ok: true, prompted: true }, { ok: true, prompted: true }]);
  assert.equal(store.consentPromptOpen(), false);
  assert.ok(rn.asyncStorage.data.has('hui.aiConsent'));
  assert.deepEqual(await ensureVoiceConsent('bridge'), { ok: true, prompted: false });

  await store.revokeAiConsent();
  assert.equal(rn.asyncStorage.data.has('hui.aiConsent'), false);
  const c = ensureVoiceConsent('bridge');
  await new Promise((r) => setImmediate(r));
  store.settleConsentPrompt(false);
  assert.equal((await c).ok, false);
});
