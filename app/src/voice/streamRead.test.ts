/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveReader, createStreamReader } from './streamRead.ts';
import { lastSentenceEnd } from './chunking.ts';

const ws = (s: string) => s.replace(/\s+/g, ' ').trim();

/** feed `text` in steps of `step` chars; returns every handed-out piece with the text length at that moment */
function feed(text: string, step: number, done = true) {
  const r = createStreamReader();
  const out: { at: number; piece: string }[] = [];
  for (let i = step; i < text.length; i += step) for (const p of r.push(text.slice(0, i), false)) out.push({ at: i, piece: p });
  if (done) for (const p of r.push(text, true)) out.push({ at: text.length, piece: p });
  return out;
}

test('lastSentenceEnd: needs the next sentence to have started; German abbreviations are no boundary', () => {
  assert.equal(lastSentenceEnd('Hallo Welt.'), 0);
  assert.equal(lastSentenceEnd('Hallo Welt. '), 0);
  assert.equal(lastSentenceEnd('Hallo Welt. D'), 12);
  assert.equal(lastSentenceEnd('Das kostet ca. 3 Euro'), 0);
  assert.equal(lastSentenceEnd('Nimm z. B. Äpfel. Dann'), 18);
  assert.equal(lastSentenceEnd('Am 3. Oktober'), 0);
  assert.equal(lastSentenceEnd('Wirklich? „Ja'), 10);
});

test('pieces cover the text exactly once, in order, whatever the step size', () => {
  const text = 'Erster Satz hier. Zweiter Satz folgt! Dritter?\n\n- Punkt eins\n- Punkt zwei\n\n## Titel\n\nLetzter Absatz. Ende.';
  for (const step of [1, 3, 7, 50]) {
    const pieces = feed(text, step).map((p) => p.piece);
    // whitespace-only pieces (blank lines between blocks) are not handed out
    assert.equal(ws(pieces.join('')), ws(text), `step ${step}`);
  }
});

test('the first sentence is handed out as soon as the second one starts', () => {
  const text = 'Das ist die Antwort. Und hier geht es weiter mit mehr Text.';
  const out = feed(text, 1, false);
  assert.equal(out[0].piece, 'Das ist die Antwort. ');
  assert.equal(out[0].at, 22); // "…Antwort. U" – the "U" decides the boundary
});

test('fenced blocks are held until closed; tables until their blank line', () => {
  const text = 'Hier ist es:\n\n```hui\n{"type":"table","rows":[[1],[2]]}\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nFertig. Ja.';
  const out = feed(text, 1);
  for (const { piece, at } of out) {
    const opens = (piece.match(/```/g) ?? []).length;
    assert.equal(opens % 2, 0, `split fence at ${at}: ${JSON.stringify(piece)}`);
  }
  const tablePiece = out.find((p) => p.piece.includes('| a |'));
  assert.ok(tablePiece && tablePiece.piece.includes('| 1 | 2 |'), 'table handed out whole');
  assert.equal(ws(out.map((p) => p.piece).join('')), ws(text));
});

test('no cut inside unbalanced inline markup', () => {
  const r = createStreamReader();
  assert.deepEqual(r.push('Das ist **wichtig. Wirklich', false), []);
  assert.deepEqual(r.push('Das ist **wichtig. Wirklich** so. Und', false), ['Das ist **wichtig. Wirklich** so. ']);
});

test('live reader: a short interim note before a tool call is never read', () => {
  const r = createLiveReader({ minChars: 100 });
  const note = 'Ich schaue kurz nach. Moment bitte. ';
  assert.deepEqual(r.push({ text: note, status: 'streaming' }), []);
  // tool call starts at the end of the note
  const tools = [{ textAt: note.length }];
  const answer = 'Hier ist das Ergebnis der Suche mit vielen Details. Es gibt drei Optionen, die alle passen würden. Die erste ist am günstigsten. Die zweite';
  const out = r.push({ text: note + answer, status: 'streaming', tools });
  assert.equal(r.started, true);
  assert.equal(out.join('').includes('Ich schaue'), false);
  assert.ok(out.join('').startsWith('Hier ist das Ergebnis'));
  const rest = r.push({ text: note + answer + ' ist schneller.', status: 'done', tools });
  assert.equal(out.join('') + rest.join(''), answer + ' ist schneller.');
});

test('live reader: a short answer that never reached the threshold is left to the end-of-turn read', () => {
  const r = createLiveReader({ minChars: 100 });
  assert.deepEqual(r.push({ text: 'Kurz. Ja', status: 'streaming' }), []);
  assert.deepEqual(r.push({ text: 'Kurz. Ja.', status: 'done' }), []);
  assert.equal(r.started, false);
});

test('live reader: after a started section and a tool call, the final short section is still read', () => {
  const r = createLiveReader({ minChars: 20 });
  const a = 'Erster langer Abschnitt mit Inhalt. Weiter';
  assert.ok(r.push({ text: a, status: 'streaming' }).length);
  const tools = [{ textAt: a.length }];
  assert.deepEqual(r.push({ text: a + ' Ok.', status: 'streaming', tools }), []);
  assert.deepEqual(r.push({ text: a + ' Ok.', status: 'done', tools }), [' Ok.']);
});

test('live reader: a replaced (shorter / different) text stops live reading', () => {
  const r = createLiveReader({ minChars: 10 });
  assert.ok(r.push({ text: 'Das ist der erste Satz. Und', status: 'streaming' }).length);
  assert.deepEqual(r.push({ text: 'Anders', status: 'streaming' }), []);
  assert.deepEqual(r.push({ text: 'Anders und länger. Ganz neu. Text', status: 'done' }), []);
});
