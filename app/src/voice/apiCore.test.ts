/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  apiAudioFileName,
  apiHttpError,
  apiTransportError,
  buildSttApiRequest,
  buildTtsApiRequest,
  effectiveTtsApi,
  isSttApiComplete,
  isTtsApiComplete,
  normalizeApiBase,
  normalizeSttApi,
  normalizeTtsApi,
  parseApiSttResponse,
  ttsApiChunkChars,
} from './apiCore.ts';

test('normalizeApiBase', () => {
  assert.equal(normalizeApiBase(' https://api.groq.com/openai/v1/ '), 'https://api.groq.com/openai/v1');
  assert.equal(normalizeApiBase('https://api.openai.com/v1/audio/transcriptions'), 'https://api.openai.com/v1');
  assert.equal(normalizeApiBase('https://api.openai.com/v1/audio/speech/'), 'https://api.openai.com/v1');
  assert.equal(normalizeApiBase('http://192.168.1.5:8000/v1'), 'http://192.168.1.5:8000/v1');
  assert.equal(normalizeApiBase('ftp://x'), '');
  assert.equal(normalizeApiBase('api.openai.com'), '');
});

test('STT request: Groq preset (OpenAI-compatible multipart)', () => {
  const r = buildSttApiRequest(normalizeSttApi({ preset: 'groq' }), 'gsk_secret', 'de');
  assert.equal(r.url, 'https://api.groq.com/openai/v1/audio/transcriptions');
  assert.deepEqual(r.headers, { Accept: 'application/json', Authorization: 'Bearer gsk_secret' });
  assert.deepEqual(r.fields, { model: 'whisper-large-v3-turbo', response_format: 'json', language: 'de' });
  assert.equal(r.fileField, 'file');
});

test('STT request: OpenAI preset, auto language, custom endpoint', () => {
  const r = buildSttApiRequest(normalizeSttApi({ preset: 'openai' }), 'sk-x', 'auto');
  assert.equal(r.url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.deepEqual(r.fields, { model: 'gpt-4o-mini-transcribe', response_format: 'json' });
  const c = buildSttApiRequest(normalizeSttApi({ preset: 'custom', baseUrl: 'http://lan:9000/v1/', model: 'whisper-1' }), '', 'en');
  assert.equal(c.url, 'http://lan:9000/v1/audio/transcriptions');
  assert.equal(c.headers.Authorization, undefined);
  assert.equal(c.fields.model, 'whisper-1');
  assert.equal(isSttApiComplete(normalizeSttApi({ preset: 'custom' })), false);
  assert.equal(isSttApiComplete(normalizeSttApi({ preset: 'groq' })), true);
  // a preset's model can be overridden
  assert.equal(buildSttApiRequest(normalizeSttApi({ preset: 'groq', model: 'whisper-large-v3' }), 'k', 'auto').fields.model, 'whisper-large-v3');
});

test('TTS request: OpenAI /audio/speech', () => {
  const r = buildTtsApiRequest(normalizeTtsApi({ preset: 'openai' }), 'sk-x', 'Hallo Welt.', 'de');
  assert.equal(r.url, 'https://api.openai.com/v1/audio/speech');
  assert.equal(r.headers.Authorization, 'Bearer sk-x');
  assert.equal(r.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(r.body), { model: 'gpt-4o-mini-tts', input: 'Hallo Welt.', voice: 'marin', response_format: 'mp3' });
  const v = buildTtsApiRequest(normalizeTtsApi({ preset: 'openai', voice: 'coral', model: 'tts-1' }), 'k', 'x', 'en');
  assert.deepEqual(JSON.parse(v.body), { model: 'tts-1', input: 'x', voice: 'coral', response_format: 'mp3' });
});

test('TTS request: Deepgram /v1/speak (voice per language, Token auth)', () => {
  const r = buildTtsApiRequest(normalizeTtsApi({ preset: 'deepgram' }), 'dg_secret', 'Hallo.', 'de');
  assert.equal(r.url, 'https://api.deepgram.com/v1/speak?model=aura-2-elara-de&encoding=mp3');
  assert.equal(r.headers.Authorization, 'Token dg_secret');
  assert.deepEqual(JSON.parse(r.body), { text: 'Hallo.' });
  assert.equal(effectiveTtsApi(normalizeTtsApi({ preset: 'deepgram' }), 'es').voice, 'aura-2-celeste-es');
  assert.equal(effectiveTtsApi(normalizeTtsApi({ preset: 'deepgram', voice: 'aura-2-julius-de' }), 'en').voice, 'aura-2-julius-de');
  assert.deepEqual(ttsApiChunkChars(normalizeTtsApi({ preset: 'deepgram' })), { maxChars: 1800, firstMaxChars: 400 });
  assert.deepEqual(ttsApiChunkChars(normalizeTtsApi({ preset: 'openai' })), { maxChars: 3500, firstMaxChars: 400 });
});

test('TTS completeness', () => {
  assert.equal(isTtsApiComplete(normalizeTtsApi({ preset: 'openai' })), true);
  assert.equal(isTtsApiComplete(normalizeTtsApi({ preset: 'deepgram' })), true);
  assert.equal(isTtsApiComplete(normalizeTtsApi({ preset: 'custom', baseUrl: 'https://x/v1', model: 'kokoro' })), false); // no voice
  assert.equal(isTtsApiComplete(normalizeTtsApi({ preset: 'custom', baseUrl: 'https://x/v1', model: 'kokoro', voice: 'af_bella' })), true);
});

test('parseApiSttResponse', () => {
  assert.equal(parseApiSttResponse(200, '{"text":" Hallo  Welt ","x_groq":{"id":"1"}}', 'Groq', 'w').text, 'Hallo Welt');
  assert.throws(() => parseApiSttResponse(200, '{"text":""}', 'Groq', 'w'), (e: { code: string }) => e.code === 'no_speech');
  assert.throws(() => parseApiSttResponse(200, 'nope', 'Groq', 'w'), (e: { key: string }) => e.key === 'voice.errors.badSttResponse');
  assert.throws(() => parseApiSttResponse(401, '{"error":{"message":"Invalid API Key","type":"invalid_request_error","code":"invalid_api_key"}}', 'Groq', 'w'), (e: { key: string; op: string }) => e.key === 'voice.errors.apiUnauthorized' && e.op === 'stt');
});

test('API errors use provider-neutral copy (no bridge wording)', () => {
  assert.equal(apiHttpError('tts', 404, '').key, 'voice.errors.apiNotFound');
  assert.equal(apiHttpError('tts', 404, '').op, 'tts');
  assert.equal(apiHttpError('tts', 403, '').key, 'voice.errors.apiUnauthorized');
  assert.equal(apiHttpError('stt', 429, '').code, 'rate_limited');
  // Deepgram error body {err_code, err_msg}
  const dg = apiHttpError('tts', 400, '{"err_code":"INVALID_MODEL","err_msg":"No such model"}');
  assert.equal(dg.key, 'voice.errors.serverFailed');
  assert.equal(dg.vars.message, 'No such model');
  assert.equal(apiTransportError('stt', new Error('x'), false, false).key, 'voice.errors.apiNetwork');
  assert.equal(apiTransportError('stt', new Error('x'), false, true).code, 'timeout');
});

test('apiAudioFileName', () => {
  assert.equal(apiAudioFileName('audio/mp4'), 'speech.m4a');
  assert.equal(apiAudioFileName('audio/webm'), 'speech.webm');
  assert.equal(apiAudioFileName('audio/mpeg'), 'speech.mp3');
});
