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

const NOTICE = 'Tool call not available here: nothing was run.';
const PC07 =
  'Ich richte die Erinnerung jetzt ein und prüfe, ob sie wirklich angelegt ist.\n' +
  '<tool_call>{"name":"cronjob_manage","arguments":{"action":"create","schedule":"in 15h"}}</tool_call>';

test('PC-07 live reader: streamed raw tool-call markup is never read, the notice line is (any step size)', () => {
  // the payload alone: its only sentence never becomes stable before the end, so the end-of-turn read speaks it
  // (speak → toSpeechText hides the call there, speechText.test.ts); text after the call is read live
  const after = '\n\nDanach: die Erinnerung ist für morgen um acht Uhr gesetzt. Mehr dazu gleich.';
  for (const [text, live] of [[PC07, false], [PC07 + after, true]] as const) {
    for (const step of [1, 4, 13, 1000]) {
      const r = createLiveReader({ minChars: 20, notice: NOTICE });
      const out: string[] = [];
      for (let i = step; i < text.length; i += step) {
        const got = r.push({ text: text.slice(0, i), status: 'streaming' });
        assert.doesNotMatch(got.join(''), /cronjob|\{"name"|tool_c|<tool/, `step ${step} at ${i}`);
        out.push(...got);
      }
      out.push(...r.push({ text, status: 'done' }));
      const read = out.join('');
      assert.doesNotMatch(read, /cronjob|\{"name"|tool_c|<tool/, `step ${step}`);
      if (live && step < 1000) {
        assert.equal(r.started, true, `step ${step}`);
        assert.equal(ws(read), ws(`Ich richte die Erinnerung jetzt ein und prüfe, ob sie wirklich angelegt ist. _${NOTICE}_ ${after}`), `step ${step}`);
      } else assert.equal(r.started, false, `step ${step}: left to the end-of-turn read`);
    }
  }
});

test('PC-07 live reader: tool offsets after hidden markup still start the right section; no markup = unchanged', () => {
  // notice '' keeps the note one paragraph (a notice line is a paragraph of its own and would start the section)
  const r = createLiveReader({ minChars: 30, notice: '' });
  const note = 'Kurz noch nachsehen.\n<tool_call>{"name":"cronjob_manage","arguments":{"action":"create"}}</tool_call>\n';
  assert.deepEqual(r.push({ text: note, status: 'streaming' }), []);
  const tools = [{ textAt: note.length }]; // raw offset: longer than the shown text before it
  const answer = 'Hier ist das Ergebnis der Suche mit allen Details.\n\nDie Erinnerung steht für morgen früh um acht Uhr.';
  const out = [...r.push({ text: note + answer, status: 'streaming', tools }), ...r.push({ text: `${note + answer}\n`, status: 'done', tools })];
  assert.equal(out.join('').trim(), answer, 'the note is skipped, the answer read from its start');
  // regression: same text without markup reads exactly as before
  const plain = 'Erster langer Abschnitt mit Inhalt. Weiter geht es mit dem zweiten Satz.\n\nUnd noch einer. Ende.';
  const a = createLiveReader({ minChars: 20 });
  const b = createLiveReader({ minChars: 20, notice: NOTICE });
  for (let i = 5; i <= plain.length + 4; i += 5) {
    const m = { text: plain.slice(0, i), status: i >= plain.length ? 'done' : 'streaming' };
    assert.deepEqual(b.push(m), a.push(m));
  }
});
