import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installRnStubs } from '../testkit/rn.ts';

// An existing install updating to 0.2: the consent it accepted under 0.1.x (version 2, on Hermes) is in storage before
// the store loads it for the first time.
const rn = installRnStubs();
rn.asyncStorage.data.set('hui.aiConsent', JSON.stringify({ version: 2, at: 1700000000000 }));
const store = await import('./store.ts');

test('an existing 0.1.x acceptance: not asked again after the update, whatever the connection', async () => {
  assert.equal(await store.isAiConsentCurrent(), true);
  assert.equal(store.aiConsentCurrentNow(), true);
  // remote voice / the root sheet: resolves at once, no sheet opens
  assert.equal(await store.requestAiConsent(), true);
  assert.equal(store.consentPromptOpen(), false);
  // the stored record is left as it was
  assert.deepEqual(JSON.parse(rn.asyncStorage.data.get('hui.aiConsent')!), { version: 2, at: 1700000000000 });
});

test('after withdrawing it in the settings the next remote use asks again', async () => {
  await store.revokeAiConsent();
  assert.equal(await store.isAiConsentCurrent(), false);
  const asked = store.requestAiConsent();
  await new Promise((r) => setImmediate(r));
  assert.equal(store.consentPromptOpen(), true);
  await store.acceptAiConsent();
  assert.equal(await asked, true);
  assert.equal(JSON.parse(rn.asyncStorage.data.get('hui.aiConsent')!).version, 2);
});
