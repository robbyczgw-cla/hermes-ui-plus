// Dictation start fast path: a granted permission / accepted consent is known without a native or storage round
// trip after the first time (permissions.ts, deviceStt.ts, consentGate.ts), and the Android offline-language query
// is not repeated before every start.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installRnStubs } from '../testkit/rn.ts';

const rn = installRnStubs();
rn.platform.OS = 'android';
const calls: string[] = [];
let micGranted = false;
let canAsk = true;
rn.modules['expo-audio'] = {
  ...rn.modules['expo-audio'],
  getRecordingPermissionsAsync: async () => (calls.push('mic:get'), { granted: micGranted, canAskAgain: canAsk }),
  requestRecordingPermissionsAsync: async () => (calls.push('mic:request'), { granted: micGranted, canAskAgain: canAsk }),
};
let recGranted = true;
rn.modules['expo-speech-recognition'] = {
  ExpoSpeechRecognitionModule: {
    isRecognitionAvailable: () => true,
    supportsOnDeviceRecognition: () => true,
    getSupportedLocales: async () => (calls.push('locales'), { installedLocales: ['de-DE'] }),
    getPermissionsAsync: async () => (calls.push('rec:get'), { granted: recGranted, canAskAgain: true }),
    requestPermissionsAsync: async () => (calls.push('rec:request'), { granted: recGranted, canAskAgain: true }),
    start: () => void calls.push('start'),
    stop: () => undefined,
    abort: () => undefined,
    addListener: () => ({ remove: () => undefined }),
  },
};
const perms = await import('./permissions.ts');
const stt = await import('./deviceStt.ts');
const gate = await import('./consentGate.ts');
const store = await import('../compliance/store.ts');

test('microphone: denied is asked again every time; once granted, no native call any more', async () => {
  calls.length = 0;
  assert.equal(perms.micPermissionKnown(), false);
  assert.equal((await perms.ensureMicPermission()).ok, false);
  assert.deepEqual(calls, ['mic:get', 'mic:request']);
  assert.equal(perms.micPermissionKnown(), false);
  micGranted = true;
  calls.length = 0;
  const first = await perms.ensureMicPermission();
  assert.deepEqual(first, { ok: true, blocked: false, prompted: false });
  assert.deepEqual(calls, ['mic:get']);
  calls.length = 0;
  assert.equal(perms.micPermissionKnown(), true);
  assert.deepEqual(await perms.ensureMicPermission(), { ok: true, blocked: false, prompted: false });
  assert.deepEqual(calls, [], 'second start: no native round trip');
  // a recorder that failed to start → the OS is asked again
  perms.forgetMicPermission();
  micGranted = false;
  canAsk = false;
  const again = await perms.ensureMicPermission();
  assert.equal(again.ok, false);
  assert.equal(again.blocked, true);
  assert.equal(perms.micPermissionKnown(), false);
});

test('microphone: the non-prompting warm-up check fills the cache', async () => {
  perms.forgetMicPermission();
  micGranted = true;
  calls.length = 0;
  assert.equal(await perms.micPermissionGranted(), true);
  assert.deepEqual(calls, ['mic:get']);
  assert.equal(perms.micPermissionKnown(), true);
});

test('on-device recognition: permission and installed languages are queried once (prewarm), not per start', async () => {
  calls.length = 0;
  assert.equal(stt.recognitionPermissionKnown(), false);
  await stt.prewarmRecognition('de-DE');
  assert.deepEqual(calls, ['rec:get', 'locales']);
  assert.equal(stt.recognitionPermissionKnown(), true);
  calls.length = 0;
  assert.deepEqual(await stt.ensureRecognitionPermission(), { ok: true, blocked: false, prompted: false });
  const s = await stt.startRecognition('de-DE', { onPartial: () => undefined, onLevel: () => undefined, onEnd: () => undefined });
  s.abort();
  assert.deepEqual(calls, ['start'], 'no permission query, no locale query before the recognizer starts');
  stt.forgetRecognitionPermission();
  recGranted = false;
  assert.equal((await stt.ensureRecognitionPermission()).ok, false);
  assert.equal(stt.recognitionPermissionKnown(), false);
});

test('consent: known synchronously once loaded and accepted; revoking it is seen at once', async () => {
  assert.equal(gate.voiceConsentKnown('device'), true, 'local engine never needs it');
  await store.revokeAiConsent();
  assert.equal(gate.voiceConsentKnown('bridge'), false);
  await store.acceptAiConsent();
  assert.equal(gate.voiceConsentKnown('bridge'), true);
  assert.equal(gate.voiceConsentKnown('apikey'), true);
  await store.revokeAiConsent();
  assert.equal(gate.voiceConsentKnown('bridge'), false);
  assert.equal(gate.voiceConsentKnown('bridge', () => null), false, 'not loaded yet → the async path');
});
