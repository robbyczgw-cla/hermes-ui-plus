/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestDeviceVoice, DEFAULT_VOICE_SETTINGS, formatElapsed, formatRate, insertDictation, meteringToLevel, normalizeVoiceSettings, pushLevel, rankDeviceVoices } from './format.ts';

test('formatElapsed', () => {
  assert.equal(formatElapsed(0), '0:00');
  assert.equal(formatElapsed(7_400), '0:07');
  assert.equal(formatElapsed(65_000), '1:05');
  assert.equal(formatElapsed(120_000), '2:00');
  assert.equal(formatElapsed(-5), '0:00');
  assert.equal(formatElapsed(Number.NaN), '0:00');
});

test('meteringToLevel maps dBFS to 0..1', () => {
  assert.equal(meteringToLevel(-160), 0);
  assert.equal(meteringToLevel(undefined), 0);
  assert.equal(meteringToLevel(0), 1);
  const quiet = meteringToLevel(-45);
  const loud = meteringToLevel(-15);
  assert.ok(quiet > 0 && quiet < loud && loud < 1, `${quiet} ${loud}`);
});

test('pushLevel keeps a fixed window', () => {
  let l: number[] = [];
  for (let i = 0; i < 5; i++) l = pushLevel(l, i / 10, 3);
  assert.deepEqual(l, [0.2, 0.3, 0.4]);
  assert.deepEqual(pushLevel([], 7, 3), [1]);
});

test('insertDictation', () => {
  assert.deepEqual(insertDictation('', ' Hallo Welt '), { text: 'Hallo Welt', caret: 10 });
  assert.deepEqual(insertDictation('Erst', 'dann'), { text: 'Erst dann', caret: 9 });
  assert.deepEqual(insertDictation('Erst ', 'dann'), { text: 'Erst dann', caret: 9 });
  assert.deepEqual(insertDictation('AB', 'x', { start: 1, end: 1 }), { text: 'A x B', caret: 4 });
  assert.deepEqual(insertDictation('A.', 'x', { start: 1, end: 1 }), { text: 'A x.', caret: 3 });
  assert.deepEqual(insertDictation('Hallo ALT Welt', 'neu', { start: 6, end: 9 }), { text: 'Hallo neu Welt', caret: 9 });
  assert.deepEqual(insertDictation('abc', '   '), { text: 'abc', caret: 3 });
});

test('normalizeVoiceSettings', () => {
  assert.deepEqual(normalizeVoiceSettings(null), DEFAULT_VOICE_SETTINGS);
  assert.deepEqual(normalizeVoiceSettings({ ttsVoice: ' nova ', ttsRate: 9, autoRead: true, sttLanguage: 'fr', autoSend: 'yes' }), {
    ttsVoice: 'nova',
    ttsRate: 2,
    autoRead: true,
    sttLanguage: 'auto',
    autoSend: false,
    sttEngine: 'auto',
    ttsEngine: 'auto',
    deviceVoice: null,
    sttApi: { preset: 'groq', baseUrl: '', model: '' },
    ttsApi: { preset: 'openai', baseUrl: '', model: '', voice: '' },
  });
  const n = normalizeVoiceSettings({ sttEngine: 'device', ttsEngine: 'nope', deviceVoice: ' com.apple.voice.de ', sttApi: { preset: 'openai', baseUrl: ' https://x/v1 ' }, ttsApi: { preset: 'x' } });
  assert.equal(n.sttEngine, 'device');
  assert.equal(n.ttsEngine, 'auto');
  assert.equal(n.deviceVoice, 'com.apple.voice.de');
  assert.deepEqual(n.sttApi, { preset: 'openai', baseUrl: 'https://x/v1', model: '' });
  assert.equal(n.ttsApi.preset, 'openai');
  assert.equal(normalizeVoiceSettings({ ttsRate: 1.25, sttLanguage: 'de' }).sttLanguage, 'de');
  assert.equal(normalizeVoiceSettings({ ttsRate: 1.25 }).ttsRate, 1.25);
});

test('formatRate', () => {
  assert.equal(formatRate(1), '1×');
  assert.equal(formatRate(1.25), '1,25×');
  assert.equal(formatRate(1.25, 'en-US'), '1.25×');
});

test('rankDeviceVoices: premium/enhanced first, exact region first, novelty dropped', () => {
  const raw = [
    { identifier: 'a', name: 'Anna', language: 'de-DE', quality: 'default' as const },
    { identifier: 'b', name: 'Bubbles', language: 'de-DE', quality: 'default' as const, novelty: true },
    { identifier: 'h', name: 'Helena', language: 'de-DE', quality: 'enhanced' as const },
    { identifier: 'p', name: 'Petra', language: 'de-DE', quality: 'premium' as const },
    { identifier: 'y', name: 'Yannick', language: 'de-CH', quality: 'premium' as const },
    { identifier: 'm', name: 'Markus', language: 'de_AT', quality: 'default' as const },
    { identifier: 'e', name: 'Ava', language: 'en-US', quality: 'premium' as const },
    { identifier: 'a', name: 'Anna dup', language: 'de-DE', quality: 'default' as const },
  ];
  const ranked = rankDeviceVoices(raw, 'de-DE');
  assert.deepEqual(ranked.map((v) => v.id), ['p', 'h', 'y', 'a', 'm']);
  assert.equal(ranked[0].enhanced, true);
  assert.equal(ranked[3].enhanced, false);
  assert.equal(bestDeviceVoice(ranked, 'de-DE')?.id, 'p');
  // no exact-region voice → best of the language
  assert.equal(bestDeviceVoice(rankDeviceVoices(raw, 'de-LU'), 'de-LU')?.id, 'p');
  assert.equal(bestDeviceVoice(rankDeviceVoices(raw, 'de-CH'), 'de-CH')?.id, 'y');
  assert.equal(bestDeviceVoice([], 'de-DE'), undefined);
  assert.deepEqual(rankDeviceVoices(raw, 'fr-FR'), []);
});
