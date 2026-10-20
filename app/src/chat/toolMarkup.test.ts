/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerOutputText, hideToolMarkup } from './toolMarkup.ts';
import { plainCopyText } from './format.ts';
import { extractMedia } from './mediaTags.ts';

const N = 'Tool call not available here: nothing was run.';
const done = (t: string) => hideToolMarkup(t, { streaming: false, notice: N });
const live = (t: string) => hideToolMarkup(t, { streaming: true, notice: N });

// the answer Claude Haiku gave in the real-user QA (PC-02), shape kept
const PC02 =
  'Ich richte die Erinnerung jetzt ein und prüfe, ob sie wirklich angelegt ist.\n\n' +
  '<tool_call>\n{"name":"cronjob_manage","arguments":{"action":"create","schedule":"in 15h 19m","prompt":"Erinnerung: Milch kaufen.","deliver":"bot-chat"}}\n</tool_call>';

test('PC-02: the literal cronjob_manage call never shows; one quiet line says nothing ran', () => {
  const out = done(PC02);
  assert.doesNotMatch(out, /tool_call|cronjob_manage|"arguments"/);
  assert.match(out, /^Ich richte die Erinnerung jetzt ein/);
  assert.ok(out.includes(`_${N}_`));
});

test('other tool markup shapes: inline, several calls, function_call / tool_use / invoke, text after the block', () => {
  const out = done('Moment.\n<tool_call>{"name":"a"}</tool_call>\n<tool_call>{"name":"b"}</tool_call>\nDanach.');
  assert.equal(out.split(N).length - 1, 1, 'one line for a run of calls');
  assert.match(out, /Danach\.$/);
  for (const t of ['<function_call>{"name":"x"}</function_call>', '<tool_use>\n{"name":"x"}\n</tool_use>', '<invoke name="x">\n<parameter name="a">1</parameter>\n</invoke>', '<tool_calls>[{"name":"x"}]</tool_calls>']) {
    const o = done(`Text.\n\n${t}`);
    assert.doesNotMatch(o, /name"?[:=]"?x/, t);
    assert.ok(o.includes(N), t);
  }
  // the rest of the closing line is kept as text
  assert.match(done('<tool_call>{"name":"a"}</tool_call> Fertig.'), /Fertig\.$/);
});

test('an unclosed block of a finished answer is dropped to the end, with the line', () => {
  const out = done('Ich mache das.\n<tool_call>\n{"name":"cronjob_manage"');
  assert.doesNotMatch(out, /cronjob/);
  assert.ok(out.includes(N));
});

test('code blocks and inline mentions stay as written (a model explaining the format)', () => {
  const code = 'So sieht das Format aus:\n\n```xml\n<tool_call>\n{"name":"x"}\n</tool_call>\n```\n\nFertig.';
  assert.equal(done(code), code);
  const inline = 'Das Tag `<tool_call>` markiert einen Aufruf, und a < b gilt.';
  assert.equal(done(inline), inline);
  assert.equal(done('Kein Markup hier.'), 'Kein Markup hier.');
  // ```hui blocks are fences too
  const hui = '```hui\n{"type":"text","text":"<tool_call>x</tool_call>"}\n```';
  assert.equal(done(hui), hui);
});

test('streaming: the shown text only grows and never contains the markup, for every chunk boundary', () => {
  const full = 'Gern.\n\n' + PC02 + '\n\nAlles klar?';
  let prev = '';
  for (let n = 0; n <= full.length; n++) {
    const shown = live(full.slice(0, n));
    assert.ok(shown.startsWith(prev), `append-only at ${n}: ${JSON.stringify(prev)} -> ${JSON.stringify(shown)}`);
    assert.doesNotMatch(shown, /<tool|cronjob|"arguments"/, `at ${n}`);
    prev = shown;
  }
  assert.match(prev, /Alles klar\?$/);
  assert.ok(prev.includes(N));
});

test('streaming: a "<" that does not become tool markup shows as soon as that is clear', () => {
  assert.equal(live('Wenn a <'), 'Wenn a <');
  assert.equal(live('Text\n<'), 'Text\n');
  assert.equal(live('Text\n<b>fett</b>'), 'Text\n<b>fett</b>');
  assert.equal(live('Text\n<tool'), 'Text\n');
});

// PC-07: every output path of a finished answer uses the text the answer shows (answerOutputText)
const PC07 =
  'Ich richte die Erinnerung jetzt ein und prüfe, ob sie wirklich angelegt ist.\n' +
  '<tool_call>{"name":"cronjob_manage","arguments":{"action":"create","schedule":"in 15h"}}</tool_call>';

test('PC-07 answerOutputText: the raw call becomes the notice line, a text without markup is returned unchanged', () => {
  const out = answerOutputText(PC07, N);
  assert.doesNotMatch(out, /cronjob_manage|\{"name"|tool_call/);
  assert.equal(out, done(PC07), 'same as the shown answer');
  assert.ok(out.includes(`_${N}_`));
  assert.match(out, /^Ich richte die Erinnerung jetzt ein und prüfe, ob sie wirklich angelegt ist\.\n/);
  // notice '' (stored / search text): the block is dropped, nothing else changes
  assert.equal(answerOutputText(PC07, '').trim(), 'Ich richte die Erinnerung jetzt ein und prüfe, ob sie wirklich angelegt ist.');
  for (const plain of ['Hallo **Welt**.', 'a < b und `<tool_call>` inline', '```\n<tool_call>{"name":"x"}</tool_call>\n```', '']) {
    assert.equal(answerOutputText(plain, N), plain, plain);
  }
});

test('PC-07 copy / share of an answer (MessageItem: plainCopyText(extractMedia(shown).text)): the notice, no JSON', () => {
  const copied = plainCopyText(extractMedia(answerOutputText(PC07, N), false).text);
  assert.doesNotMatch(copied, /cronjob_manage|\{"name"|tool_call/);
  assert.ok(copied.includes(N));
  assert.match(copied, /^Ich richte die Erinnerung/);
  const plain = 'Erledigt: **3 Punkte**.\n\n- a\n- b';
  assert.equal(plainCopyText(extractMedia(answerOutputText(plain, N), false).text), plain);
});
