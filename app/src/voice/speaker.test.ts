// speak() end to end on the real speaker.ts / personalVoice.ts / consentGate.ts / settingsStore.ts with fake native
// modules (testkit/rn.ts). Official flavor (no EXPO_PUBLIC_FLAVOR): remote voice needs consent.
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { flush, installRnStubs } from '../testkit/rn.ts';

const rn = installRnStubs();
const speaker = await import('./speaker.ts');
const consent = await import('../compliance/store.ts');
const { updateVoiceSettings } = await import('./settingsStore.ts');
const { makeT } = await import('../i18n/core.ts');

const t = makeT('en', 'en-US');
const base = { text: 'Hello there', plain: true, t, locale: 'en-US' } as const;
const bridge = { baseUrl: 'https://bridge.example/v1', apiKey: 'tok' };

/** ask for a clean slate: nothing playing, consent not given */
async function reset() {
  speaker.stopSpeaking();
  consent.settleConsentPrompt(false);
  await consent.revokeAiConsent();
  rn.resetAll();
  updateVoiceSettings({ ttsEngine: 'auto' });
  await flush();
}
beforeEach(reset);

const settle = async () => {
  for (let i = 0; i < 20; i++) await flush(2);
};



test('bridge read-aloud without consent: the notice is requested and nothing is uploaded when declined', async () => {
  const p = speaker.speak({ ...base, id: 'm2', conn: bridge });
  await settle();
  assert.equal(consent.consentPromptOpen(), true);
  assert.equal(rn.net.calls.length, 0, 'no request while the notice is open');
  consent.settleConsentPrompt(false);
  await p;
  assert.equal(speaker.getSpeakerState().error?.key, 'voice.errors.consentRequired');
  assert.equal(rn.net.calls.length, 0);
});

test('bridge read-aloud after accepting the notice sends the text to /bridge/tts', async () => {
  const p = speaker.speak({ ...base, id: 'm3', conn: bridge });
  await settle();
  assert.equal(consent.consentPromptOpen(), true);
  await consent.acceptAiConsent();
  await p;
  await settle();
  assert.equal(rn.net.calls.length, 1);
  assert.match(rn.net.calls[0].url, /\/bridge\/tts$/);
});

test('with consent stored, no question is asked again', async () => {
  await consent.acceptAiConsent();
  await speaker.speak({ ...base, id: 'm4', conn: bridge });
  await settle();
  assert.equal(consent.consentPromptOpen(), false);
  assert.equal(rn.net.calls.length, 1);
});

test('own-key engine (Settings preview) also needs the consent', async () => {
  // explicit engine override, as the Settings "Probehören" button does
  const p = speaker.speak({ ...base, id: 'preview:apikey', conn: null, engine: 'apikey' });
  await settle();
  assert.equal(consent.consentPromptOpen(), true);
  consent.settleConsentPrompt(false);
  await p;
  assert.equal(speaker.getSpeakerState().error?.key, 'voice.errors.consentRequired');
  assert.equal(rn.net.calls.length, 0);
});

test('device voice never needs the consent', async () => {
  await speaker.speak({ ...base, id: 'm5', conn: null, engine: 'device' });
  await settle();
  assert.equal(consent.consentPromptOpen(), false);
  assert.deepEqual(rn.spoken, ['Hello there']);
});

test('stop while the bridge request is still loading: back to idle, nothing is played afterwards', async () => {
  await consent.acceptAiConsent();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  rn.net.handler = async () => {
    await gate;
    return { ok: true, status: 200, text: async () => '', bytes: async () => new Uint8Array([1, 2, 3]) };
  };
  void speaker.speak({ ...base, id: 'm6', conn: bridge });
  await settle();
  assert.equal(speaker.getSpeakerState().status, 'loading');
  speaker.stopSpeaking();
  assert.equal(speaker.getSpeakerState().status, 'idle');
  release();
  await settle();
  assert.equal(speaker.getSpeakerState().status, 'idle');
  assert.deepEqual(rn.played, []);
});

test('speakLive (device voice): the first sentence plays before the answer is complete, appended text follows in order', async () => {
  const live = speaker.speakLive({ id: 'live1', conn: null, t, locale: 'en-US', engine: 'device' }, 'The first sentence. ');
  await settle();
  assert.deepEqual(rn.spoken, ['The first sentence.'], 'started with what was there');
  assert.equal(speaker.getSpeakerState().messageId, 'live1');
  assert.equal(speaker.getSpeakerState().status, 'loading', 'waiting for more text');
  live.append('A second one. ');
  await settle();
  assert.deepEqual(rn.spoken, ['The first sentence.', 'A second one.']);
  live.append('## Done\n\nThe end.');
  live.end();
  await settle();
  assert.deepEqual(rn.spoken, ['The first sentence.', 'A second one.', 'Done.\nThe end.']);
  assert.equal(speaker.getSpeakerState().status, 'idle', 'finished after end()');
});

test('speakLive (bridge): pieces that arrive before a chunk is needed are fetched as one request; stop ignores later appends', async () => {
  await consent.acceptAiConsent();
  const live = speaker.speakLive({ id: 'live2', conn: bridge, t, locale: 'en-US' }, 'One. ');
  live.append('Two. ');
  live.append('Three. ');
  await settle();
  assert.equal(rn.net.calls.length, 1, 'three pieces, one chunk');
  speaker.stopSpeaking();
  live.append('Four. ');
  live.end();
  await settle();
  assert.equal(rn.net.calls.length, 1);
  assert.equal(speaker.getSpeakerState().status, 'idle');
});
