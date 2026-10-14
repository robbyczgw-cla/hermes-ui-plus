/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzerFallsBack, bridgeVoiceSupport, deviceSttBackend, modelProgressPercent, recognitionError, recognitionLocale, resolveSttEngine, resolveTtsEngine, volumeToLevel } from './engine.ts';
import type { SttEngineInput, TtsEngineInput } from './engine.ts';
import { VoiceError } from './types.ts';

const stt = (o: Partial<SttEngineInput>): SttEngineInput => ({ choice: 'auto', bridge: 'none', device: false, apiKey: false, ...o });
const tts = (o: Partial<TtsEngineInput>): TtsEngineInput => ({ choice: 'auto', bridge: 'none', apiKey: false, ...o });

test('bridgeVoiceSupport', () => {
  assert.equal(bridgeVoiceSupport(false, null, 'stt'), 'none');
  assert.equal(bridgeVoiceSupport(true, null, 'stt'), 'unknown');
  assert.equal(bridgeVoiceSupport(true, { stt: { provider: 'groq', model: 'w' }, tts: null }, 'stt'), 'yes');
  assert.equal(bridgeVoiceSupport(true, { stt: { provider: 'groq', model: 'w' }, tts: null }, 'tts'), 'no');
  assert.equal(bridgeVoiceSupport(true, null, 'tts', { off: true }), 'no');
  // old bridge without voice endpoints (404 → 'unavailable') vs. a network blip ('network' → still unknown)
  assert.equal(bridgeVoiceSupport(true, null, 'stt', { configError: new VoiceError('unavailable', 'voice.errors.noVoiceApi') }), 'no');
  assert.equal(bridgeVoiceSupport(true, null, 'stt', { configError: new VoiceError('network', 'voice.errors.network') }), 'unknown');
});

test('STT auto: bridge → device → own key', () => {
  assert.deepEqual(resolveSttEngine(stt({ bridge: 'yes', device: true })), { engine: 'bridge', reason: null });
  assert.deepEqual(resolveSttEngine(stt({ bridge: 'unknown', device: true })), { engine: 'bridge', reason: null });
  assert.deepEqual(resolveSttEngine(stt({ bridge: 'no', device: true })), { engine: 'device', reason: null });
  assert.deepEqual(resolveSttEngine(stt({ bridge: 'none', device: true })), { engine: 'device', reason: null });
  assert.deepEqual(resolveSttEngine(stt({ device: false, apiKey: true })), { engine: 'apikey', reason: null });
  assert.deepEqual(resolveSttEngine(stt({})), { engine: null, reason: 'none' });
});

test('STT explicit choices are strict', () => {
  assert.deepEqual(resolveSttEngine(stt({ choice: 'bridge', device: true })), { engine: null, reason: 'no_bridge' });
  assert.deepEqual(resolveSttEngine(stt({ choice: 'bridge', bridge: 'no' })), { engine: 'bridge', reason: null });
  assert.deepEqual(resolveSttEngine(stt({ choice: 'device', bridge: 'yes' })), { engine: null, reason: 'no_device' });
  assert.deepEqual(resolveSttEngine(stt({ choice: 'device', device: true, bridge: 'yes' })), { engine: 'device', reason: null });
  assert.deepEqual(resolveSttEngine(stt({ choice: 'apikey', bridge: 'yes', device: true })), { engine: null, reason: 'no_key' });
  assert.deepEqual(resolveSttEngine(stt({ choice: 'apikey', apiKey: true })), { engine: 'apikey', reason: null });
});


test('TTS auto: bridge → device', () => {
  assert.equal(resolveTtsEngine(tts({ bridge: 'yes' })).engine, 'bridge');
  assert.equal(resolveTtsEngine(tts({ bridge: 'unknown' })).engine, 'bridge');
  assert.equal(resolveTtsEngine(tts({ bridge: 'no' })).engine, 'device');
  assert.equal(resolveTtsEngine(tts({ apiKey: true })).engine, 'device');
});

test('TTS explicit', () => {
  assert.deepEqual(resolveTtsEngine(tts({ choice: 'bridge' })), { engine: null, reason: 'no_bridge' });
  assert.equal(resolveTtsEngine(tts({ choice: 'bridge', bridge: 'no' })).engine, 'bridge'); // speaker falls back to the device voice
  assert.equal(resolveTtsEngine(tts({ choice: 'device', bridge: 'yes' })).engine, 'device');
  assert.deepEqual(resolveTtsEngine(tts({ choice: 'apikey' })), { engine: null, reason: 'no_key' });
  assert.equal(resolveTtsEngine(tts({ choice: 'apikey', apiKey: true })).engine, 'apikey');
});

test('recognitionLocale', () => {
  assert.equal(recognitionLocale('auto', 'de-AT'), 'de-AT');
  assert.equal(recognitionLocale('de', 'de-CH'), 'de-CH');
  assert.equal(recognitionLocale('en', 'de-DE'), 'en-US');
  assert.equal(recognitionLocale('es', 'en-US'), 'es-ES');
  assert.equal(recognitionLocale('auto', ''), 'de-DE');
});

test('recognitionError + volumeToLevel', () => {
  assert.equal(recognitionError('aborted', false), null);
  assert.deepEqual(recognitionError('not-allowed', false), { code: 'permission', key: 'voice.errors.recognitionDenied' });
  assert.deepEqual(recognitionError('not-allowed', true), { code: 'permission', key: 'voice.errors.browserMicBlocked' });
  assert.equal(recognitionError('no-speech', false)?.key, 'voice.errors.noSpeech');
  assert.equal(recognitionError('speech-timeout', false)?.code, 'no_speech');
  assert.equal(recognitionError('network', false)?.code, 'network');
  assert.equal(recognitionError('whatever', false)?.key, 'voice.errors.deviceSttFailed');
  assert.equal(volumeToLevel(-2), 0);
  assert.equal(volumeToLevel(undefined), 0);
  assert.equal(volumeToLevel(10), 1);
  assert.equal(volumeToLevel(50), 1);
  const mid = volumeToLevel(5);
  assert.ok(mid > 0.5 && mid < 1);
});

test('device STT backend: iOS 26 SpeechAnalyzer preferred, expo-speech-recognition elsewhere', () => {
  // iOS 26+ with the module and supported hardware → SpeechAnalyzer
  assert.equal(deviceSttBackend({ platform: 'ios', analyzer: true, expo: true }), 'analyzer');
  assert.equal(deviceSttBackend({ platform: 'ios', analyzer: true, expo: false }), 'analyzer');
  assert.equal(deviceSttBackend({ platform: 'ios', analyzer: true, expo: true, analyzerLocale: 'supported' }), 'analyzer');
  // older iOS / old build without the module → SFSpeechRecognizer via expo-speech-recognition
  assert.equal(deviceSttBackend({ platform: 'ios', analyzer: false, expo: true }), 'expo');
  // language SpeechTranscriber does not know → fallback, or nothing without expo-speech-recognition
  assert.equal(deviceSttBackend({ platform: 'ios', analyzer: true, expo: true, analyzerLocale: 'unsupported' }), 'expo');
  assert.equal(deviceSttBackend({ platform: 'ios', analyzer: true, expo: false, analyzerLocale: 'unsupported' }), null);
  // Android / web never use the analyzer, even if a flag says so
  assert.equal(deviceSttBackend({ platform: 'android', analyzer: true, expo: true }), 'expo');
  assert.equal(deviceSttBackend({ platform: 'web', analyzer: true, expo: true }), 'expo');
  assert.equal(deviceSttBackend({ platform: 'android', analyzer: false, expo: false }), null);
  assert.equal(deviceSttBackend({ platform: 'ios', analyzer: false, expo: false }), null);
});

test('SpeechAnalyzer fallback + errors + model progress', () => {
  for (const c of ['language-not-supported', 'service-not-allowed', 'model-download-failed', 'model-not-installed']) assert.equal(analyzerFallsBack(c), true, c);
  for (const c of ['not-allowed', 'audio-capture', 'busy', 'unknown', undefined]) assert.equal(analyzerFallsBack(c), false, String(c));
  assert.deepEqual(recognitionError('model-download-failed', false), { code: 'unavailable', key: 'voice.errors.deviceSttModel' });
  assert.deepEqual(recognitionError('model-not-installed', false), { code: 'unavailable', key: 'voice.errors.deviceSttModel' });
  assert.equal(modelProgressPercent(0), 0);
  assert.equal(modelProgressPercent(0.426), 42);
  assert.equal(modelProgressPercent(1), 100);
  assert.equal(modelProgressPercent(1.7), 100);
  assert.equal(modelProgressPercent(-1), 0);
  assert.equal(modelProgressPercent(null), 0);
  assert.equal(modelProgressPercent(Number.NaN), 0);
});
