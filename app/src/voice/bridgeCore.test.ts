/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  languageLabel,
  normalizeTranscript,
  parseSttResponse,
  parseVoiceConfig,
  recordingMime,
  resolveVoice,
  sortVoices,
  sttHeaders,
  sttUrl,
  ttsBody,
  ttsHeaders,
  ttsUrl,
  voiceConfigUrl,
  voiceConnFromProfile,
  voiceHttpError,
  voiceTransportError,
} from './bridgeCore.ts';
import { isVoiceError, VoiceError, voiceErrorText } from './types.ts';
import { makeT } from '../i18n/core.ts';

const de = makeT('de', 'de-DE');
const en = makeT('en', 'en-US');
const text = (e: VoiceError) => voiceErrorText(e, de);

const C = { baseUrl: 'https://hermes-host.example.ts.net:8790/v1/', apiKey: 'tok' };

test('urls strip /v1', () => {
  assert.equal(sttUrl(C.baseUrl), 'https://hermes-host.example.ts.net:8790/bridge/stt');
  assert.equal(ttsUrl('http://127.0.0.1:8790'), 'http://127.0.0.1:8790/bridge/tts');
  assert.equal(voiceConfigUrl(C.baseUrl), 'https://hermes-host.example.ts.net:8790/bridge/voice/config');
});

test('voiceConnFromProfile: only Hermes profiles with bridge', () => {
  assert.deepEqual(voiceConnFromProfile({ kind: 'hermes', baseUrl: 'http://x/v1', apiKey: 'k', bridge: true }), { baseUrl: 'http://x/v1', apiKey: 'k' });
  assert.equal(voiceConnFromProfile({ kind: 'hermes', baseUrl: 'http://x/v1', apiKey: 'k' }), null);
  assert.equal(voiceConnFromProfile({ kind: 'claude', baseUrl: 'https://api.anthropic.com', apiKey: 'k', bridge: true }), null);
  assert.equal(voiceConnFromProfile(null), null);
});

test('headers', () => {
  assert.deepEqual(sttHeaders(C, 'audio/webm;codecs=opus', 'de'), {
    Authorization: 'Bearer tok',
    'Content-Type': 'audio/webm',
    Accept: 'application/json',
    'X-Language': 'de',
  });
  assert.equal(sttHeaders(C, 'audio/mp4', 'auto')['X-Language'], undefined);
  assert.equal(sttHeaders({ baseUrl: 'x', apiKey: '' }, 'audio/mp4', 'auto').Authorization, undefined);
  assert.equal(ttsHeaders(C)['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(ttsBody('Hallo', 'nova')), { text: 'Hallo', format: 'mp3', voice: 'nova' });
  assert.deepEqual(JSON.parse(ttsBody('Hallo', null)), { text: 'Hallo', format: 'mp3' });
});

test('recordingMime', () => {
  assert.equal(recordingMime('file:///cache/Audio/recording-1.m4a'), 'audio/mp4');
  assert.equal(recordingMime('file:///x.3gp'), 'audio/3gpp');
  assert.equal(recordingMime('blob:http://localhost/abc', 'audio/webm;codecs=opus'), 'audio/webm');
  assert.equal(recordingMime('blob:x', 'video/webm'), 'audio/webm');
  assert.equal(recordingMime('file:///noext'), 'audio/mp4');
});

test('parseVoiceConfig: full contract', () => {
  const cfg = parseVoiceConfig({
    stt: { provider: 'openai', model: 'gpt-4o-mini-transcribe' },
    tts: {
      provider: 'openai',
      model: 'gpt-4o-mini-tts',
      voices: [
        { id: 'nova', name: 'Nova', lang: 'multi', provider: 'openai' },
        { id: 'de-katja', name: 'Katja', lang: 'de-DE', provider: 'azure' },
        { id: 'nova', name: 'dup', lang: '', provider: '' },
        { name: 'kein id' },
        'alloy',
      ],
      defaultVoice: 'de-katja',
    },
  });
  assert.deepEqual(cfg.stt, { provider: 'openai', model: 'gpt-4o-mini-transcribe' });
  assert.equal(cfg.tts?.voices.length, 3);
  assert.equal(cfg.tts?.defaultVoice, 'de-katja');
  assert.deepEqual(cfg.tts?.voices[2], { id: 'alloy', name: 'alloy', lang: '', provider: '' });
});

test('parseVoiceConfig: available:false (bridge has no provider key) counts as no STT / TTS (E2E round 12 F4)', () => {
  // the bridge always names its configured provider/model and flags a missing key with available:false;
  // settings showed "Recognition: groq · whisper-large-v3-turbo" while the mic said "not set up on the UI bridge"
  const cfg = parseVoiceConfig({
    stt: { provider: 'groq', model: 'whisper-large-v3-turbo', available: false, maxBytes: 1 },
    tts: { provider: 'openai', model: 'gpt-4o-mini-tts', voices: [{ id: 'nova', name: 'Nova' }], defaultVoice: 'nova', available: false },
  });
  assert.deepEqual(cfg, { stt: null, tts: null });
  // available:true and older bridges without the flag stay usable
  assert.deepEqual(parseVoiceConfig({ stt: { provider: 'groq', model: 'w', available: true } }).stt, { provider: 'groq', model: 'w' });
  assert.deepEqual(parseVoiceConfig({ stt: { provider: 'groq', model: 'w' } }).stt, { provider: 'groq', model: 'w' });
  assert.equal(parseVoiceConfig({ tts: { provider: 'openai', voices: [], available: true } }).tts?.provider, 'openai');
});

test('parseVoiceConfig: tolerant to missing parts / bad default / string input', () => {
  const cfg = parseVoiceConfig('{"tts":{"provider":"x","voices":[{"id":"a","name":"A"}],"defaultVoice":"gone"}}');
  assert.equal(cfg.stt, null);
  assert.equal(cfg.tts?.defaultVoice, 'a');
  assert.deepEqual(parseVoiceConfig({}), { stt: null, tts: null });
  assert.throws(() => parseVoiceConfig('<html>'), (e: unknown) => isVoiceError(e) && e.code === 'bad_response');
  assert.throws(() => parseVoiceConfig([]), VoiceError);
});

test('resolveVoice / sortVoices / languageLabel', () => {
  const cfg = parseVoiceConfig({ tts: { provider: 'p', voices: [{ id: 'a', name: 'Zed', lang: 'en-US' }, { id: 'b', name: 'Berta', lang: 'de-DE' }, { id: 'c', name: 'Alpha', lang: '' }], defaultVoice: 'a' } });
  assert.equal(resolveVoice(cfg, 'b'), 'b');
  assert.equal(resolveVoice(cfg, 'removed'), 'a');
  assert.equal(resolveVoice(null, 'x'), 'x');
  assert.equal(resolveVoice(null, null), null);
  assert.deepEqual(sortVoices(cfg.tts!.voices).map((v) => v.id), ['b', 'a', 'c']);
  assert.equal(languageLabel('de-DE', de), 'Deutsch (DE)');
  assert.equal(languageLabel('en', de), 'Englisch');
  assert.equal(languageLabel('multi', de), 'Mehrsprachig');
  assert.equal(languageLabel('xx-YY', de), 'xx-YY');
  assert.equal(languageLabel('en-US', en), 'English (US)');
  assert.equal(languageLabel('multi', en), 'Multilingual');
});

test('parseSttResponse', () => {
  const r = parseSttResponse(200, JSON.stringify({ text: '  Hallo   Welt ', language: 'de', durationMs: 2300, provider: 'openai', model: 'whisper-1' }));
  assert.deepEqual(r, { text: 'Hallo Welt', language: 'de', durationMs: 2300, provider: 'openai', model: 'whisper-1' });
  assert.throws(() => parseSttResponse(200, '{"text":"  "}'), (e: unknown) => isVoiceError(e) && e.code === 'no_speech');
  assert.throws(() => parseSttResponse(200, '{"text":"[Musik]"}'), (e: unknown) => isVoiceError(e) && e.code === 'no_speech');
  assert.throws(() => parseSttResponse(200, 'nope'), (e: unknown) => isVoiceError(e) && e.code === 'bad_response');
  assert.throws(
    () => parseSttResponse(413, '{"error":{"message":"too big","type":"invalid_request_error","code":"file_too_large"}}'),
    (e: unknown) => isVoiceError(e) && e.code === 'too_large' && e.status === 413
  );
});

test('normalizeTranscript', () => {
  assert.equal(normalizeTranscript('(Stille)'), '');
  assert.equal(normalizeTranscript('Musik ist toll'), 'Musik ist toll');
});

test('error mapping (German)', () => {
  const m = (op: 'stt' | 'tts' | 'config', s: number, b = '') => voiceHttpError(op, s, b);
  assert.equal(m('stt', 0).code, 'network');
  assert.equal(text(m('stt', 0)), 'Spracheingabe: keine Verbindung zur UI-Bridge.');
  assert.equal(m('tts', 401).code, 'unauthorized');
  assert.match(text(m('tts', 401)), /Bridge-Token/);
  assert.equal(m('config', 404).code, 'unavailable');
  assert.equal(m('stt', 415).code, 'unsupported_format');
  assert.equal(m('tts', 429).code, 'rate_limited');
  assert.equal(text(m('tts', 413)), 'Der Text ist zu lang zum Vorlesen.');
  assert.equal(voiceErrorText(m('tts', 413), en), 'The text is too long to read aloud.');
  assert.equal(text(m('stt', 400, '{"error":{"message":"bad audio","type":"invalid_request_error"}}')), 'Spracheingabe fehlgeschlagen: bad audio');
  assert.equal(m('stt', 503, '{"error":{"message":"STT not configured","type":"server_error","code":"stt_not_configured"}}').code, 'unavailable');
  assert.match(text(m('tts', 503, '{"error":{"message":"upstream down"}}')), /nicht erreichbar \(upstream down\)/);
  assert.equal(m('stt', 422, '{"error":{"message":"x","code":"no_speech"}}').code, 'no_speech');
  assert.equal(text(m('tts', 500)), 'Vorlesen fehlgeschlagen (HTTP 500).');
  assert.equal(voiceTransportError('stt', new Error('x'), true, true).code, 'timeout');
  assert.equal(voiceTransportError('stt', new Error('x'), true, false).code, 'aborted');
  assert.equal(voiceTransportError('tts', new Error('x'), false, false).code, 'network');
  const ve = new VoiceError('no_speech', 'voice.errors.noSpeech');
  assert.equal(voiceTransportError('stt', ve, false, false), ve);
});
