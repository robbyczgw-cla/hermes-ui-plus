/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText, overallProgress, splitLong, splitSentences } from './chunking.ts';

test('basic sentence split', () => {
  assert.deepEqual(splitSentences('Hallo Welt. Wie geht es dir? Gut! Danke…'), ['Hallo Welt.', 'Wie geht es dir?', 'Gut!', 'Danke…']);
});

test('German abbreviations do not split', () => {
  assert.deepEqual(splitSentences('Nimm z. B. Äpfel, d. h. frische. Das kostet ca. 3,5 Euro bzw. etwas mehr. Ende.'), [
    'Nimm z. B. Äpfel, d. h. frische.',
    'Das kostet ca. 3,5 Euro bzw. etwas mehr.',
    'Ende.',
  ]);
  assert.deepEqual(splitSentences('Laut Dr. Müller und Prof. Schmidt gilt z.B. Folgendes. Ja.'), [
    'Laut Dr. Müller und Prof. Schmidt gilt z.B. Folgendes.',
    'Ja.',
  ]);
  assert.deepEqual(splitSentences('Siehe S. 12 und Nr. 4 im Anhang. Danach weiter.'), ['Siehe S. 12 und Nr. 4 im Anhang.', 'Danach weiter.']);
  // accepted false negative: a 1–2 digit number before "." is read as an ordinal
  assert.deepEqual(splitSentences('Es waren 4. Danach kam nichts.'), ['Es waren 4. Danach kam nichts.']);
});

test('numbers, ordinals and dates do not split', () => {
  assert.deepEqual(splitSentences('Am 3. Oktober ist Feiertag. Der Wert liegt bei 3.5 Prozent. Termin 10.10. 2026 passt.'), [
    'Am 3. Oktober ist Feiertag.',
    'Der Wert liegt bei 3.5 Prozent.',
    'Termin 10.10. 2026 passt.',
  ]);
  assert.deepEqual(splitSentences('Das war 2024. Jetzt ist 2026.'), ['Das war 2024.', 'Jetzt ist 2026.']);
});

test('lowercase continuation and quotes', () => {
  assert.deepEqual(splitSentences('Er sagte „Hallo.“ Dann ging er. usw. geht weiter'), ['Er sagte „Hallo.“', 'Dann ging er. usw. geht weiter']);
  assert.deepEqual(splitSentences('Warte... dann los. Und... Fertig.'), ['Warte... dann los.', 'Und...', 'Fertig.']);
});

test('newlines always split', () => {
  assert.deepEqual(splitSentences('Titel\nText ohne Punkt\n\nNeu'), ['Titel', 'Text ohne Punkt', 'Neu']);
});

test('splitLong prefers clause marks, then spaces', () => {
  const s = 'Erstens etwas längerer Teil; zweitens noch ein Teil, drittens der Rest des Satzes';
  const parts = splitLong(s, 40);
  assert.ok(parts.every((p) => p.length <= 40), JSON.stringify(parts));
  assert.equal(parts[0], 'Erstens etwas längerer Teil;');
  assert.equal(parts.join(' '), s);
  assert.deepEqual(splitLong('x'.repeat(25), 10), ['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)]);
});

test('chunkText packs sentences ≤ max and keeps everything', () => {
  const sentences = Array.from({ length: 300 }, (_, i) => `Das ist Satz Nummer ${i + 1} mit z. B. etwas Text.`);
  const text = sentences.join(' ');
  const chunks = chunkText(text, { maxChars: 3500 });
  assert.ok(chunks.length >= 4);
  assert.ok(chunks.every((c) => c.length <= 3500));
  assert.equal(chunks.join(' '), text);
  // chunk boundaries fall on sentence ends
  assert.ok(chunks.every((c) => c.endsWith('Text.')));
});

test('first chunk is small for quick start, but never cuts the first sentence', () => {
  const text = 'Kurz. ' + 'Ein mittellanger Satz ohne Ende in Sicht. '.repeat(30);
  const chunks = chunkText(text.trim(), { maxChars: 3500, firstMaxChars: 100 });
  assert.ok(chunks[0].length <= 100);
  assert.ok(chunks[0].startsWith('Kurz.'));
  const long = 'A'.repeat(50) + ' ' + 'b'.repeat(80) + '. Zweiter Satz.';
  assert.equal(chunkText(long, { maxChars: 3500, firstMaxChars: 40 })[0], 'A'.repeat(50) + ' ' + 'b'.repeat(80) + '.');
});

test('paragraphs become newlines inside a chunk', () => {
  assert.deepEqual(chunkText('Absatz eins.\n\nAbsatz zwei.'), ['Absatz eins.\nAbsatz zwei.']);
  assert.deepEqual(chunkText(''), []);
  assert.deepEqual(chunkText('   \n\n  '), []);
});

test('overallProgress weights by chunk length', () => {
  assert.equal(overallProgress([100, 300], 0, 0.5), 50 / 400);
  assert.equal(overallProgress([100, 300], 1, 0), 0.25);
  assert.equal(overallProgress([100, 300], 1, 1), 1);
  assert.equal(overallProgress([100, 300], 2, 0), 1);
  assert.equal(overallProgress([], 0, 0.5), 0);
  assert.equal(overallProgress([100], 0, Number.NaN), 0);
});
