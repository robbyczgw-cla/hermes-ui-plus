import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeT, type Lang } from '../i18n/core.ts';
import { makeMatcher } from '../settings/searchMatch.ts';
import { voiceSearchTexts } from './searchTexts.ts';

const QUERIES: Record<Lang, string[]> = {
  de: ['vorlesen', 'Antworten automatisch vorlesen', 'Stimme', 'Diktat', 'Sprachausgabe', 'Spracheingabe', 'Mikrofon', 'Geschwindigkeit'],
  en: ['read aloud', 'Read replies aloud automatically', 'voice', 'dictation', 'speech output', 'microphone', 'speed'],
  es: ['leer en voz alta', 'voz', 'dictado', 'salida de voz', 'micrófono', 'microfono', 'velocidad'],
};

for (const lang of ['de', 'en', 'es'] as const) {
  test(`settings search finds the voice block (${lang})`, () => {
    const texts = voiceSearchTexts(makeT(lang, lang));
    for (const q of QUERIES[lang]) assert.ok(makeMatcher(q)(texts), `${lang}: "${q}"`);
    assert.ok(!makeMatcher('Haptik')(texts));
  });
}
