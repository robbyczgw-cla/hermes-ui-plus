/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeT } from '../i18n/core.ts';
import type { ChatMessage } from '../hermes/types.ts';
import type { Segment } from '../protocol/types';
import {
  REFORMAT_BASE_KINDS,
  answerShape,
  parseReformatKind,
  reformatHint,
  reformatLabel,
  reformatMessage,
  reformattedSources,
  transformChips,
  translateTargets,
} from './reformat.ts';

const de = makeT('de', 'de-DE');
const en = makeT('en', 'en-US');
const es = makeT('es', 'es-ES');

test('tag text builder: spec example + translate', () => {
  assert.equal(reformatMessage('table', de), '[reformat:table] Bitte formuliere die letzte Antwort als Tabelle um.');
  assert.equal(reformatMessage('translate:en', de), '[reformat:translate:en] Bitte die letzte Antwort auf Englisch übersetzen.');
  assert.equal(reformatMessage('translate:de', es), '[reformat:translate:de] Por favor, traduce tu última respuesta al alemán.');
  assert.equal(reformatMessage('shorter', en), '[reformat:shorter] Please make your last answer shorter.');
  for (const k of REFORMAT_BASE_KINDS) assert.equal(parseReformatKind(reformatMessage(k, de)), k);
});

test('labels (chip + ReplyChip "↩ Als Tabelle")', () => {
  assert.equal(reformatLabel('table', de), 'Als Tabelle');
  assert.equal(reformatLabel('translate:es', de), 'Auf Spanisch');
  assert.equal(reformatLabel('translate:fr', en), 'In French');
  assert.equal(reformatLabel('expert', es), 'Para expertos');
});

test('parser: kinds, unknown kinds, not at the start', () => {
  assert.equal(parseReformatKind('[reformat:translate:it] x'), 'translate:it');
  assert.equal(parseReformatKind('translate:fr'), 'translate:fr');
  assert.equal(parseReformatKind('[reformat:translate:xx] x'), null);
  assert.equal(parseReformatKind('[reformat:translate] x'), null);
  assert.equal(parseReformatKind('[reformat:poem] x'), null);
  assert.equal(parseReformatKind('Bitte [reformat:table]'), null);
  assert.equal(parseReformatKind('[choice:x] A'), null);
});

test('translate menu excludes the app language', () => {
  assert.deepEqual(translateTargets('de'), ['en', 'es', 'fr', 'it']);
  assert.deepEqual(translateTargets('en'), ['es', 'de', 'fr', 'it']);
  assert.deepEqual(translateTargets('es'), ['en', 'de', 'fr', 'it']);
});

test('chip visibility: streaming, pref, short answers (Übersetzen only)', () => {
  const base = { enabled: true, streaming: false, length: 800 };
  assert.deepEqual(transformChips(base), { base: REFORMAT_BASE_KINDS, translate: true });
  const hidden = { base: [], translate: false };
  assert.deepEqual(transformChips({ ...base, streaming: true }), hidden);
  assert.deepEqual(transformChips({ ...base, enabled: false }), hidden);
  assert.deepEqual(transformChips({ ...base, failed: true }), hidden);
  assert.deepEqual(transformChips({ ...base, length: 0 }), hidden);
  assert.deepEqual(transformChips({ ...base, length: 199 }), { base: [], translate: true });
  assert.deepEqual(transformChips({ ...base, length: 200 }), { base: REFORMAT_BASE_KINDS, translate: true });
});

test('"umgeformt" marker: the most recent answer before each reformat request', () => {
  const msgs = [
    { id: 'u1', role: 'user', text: 'Frage' },
    { id: 'a1', role: 'assistant', text: 'Antwort 1' },
    { id: 'u2', role: 'user', text: 'Noch was' },
    { id: 'a2', role: 'assistant', text: 'Antwort 2' },
    { id: 'u3', role: 'user', text: '[reformat:table] Bitte formuliere die letzte Antwort als Tabelle um.' },
    { id: 'a3', role: 'assistant', text: '' }, // failed / streaming placeholder
    { id: 'u4', role: 'user', text: '[reformat:shorter] Bitte kürzer.' },
  ];
  assert.deepEqual([...reformattedSources(msgs)], ['a2']);
  assert.equal(reformattedSources([{ id: 'u', role: 'user', text: '[reformat:table] x' }]).size, 0);
});

test('direct-backend hint text', () => {
  assert.equal(reformatHint('Hallo'), null);
  assert.match(reformatHint('[reformat:table] Bitte formuliere die letzte Antwort als Tabelle um.') ?? '', /^Reformat request: reformulate your previous answer as a table \(use the hui table node\)/);
  assert.match(reformatHint('[reformat:translate:en] x') ?? '', /translation into English/);
  assert.match(reformatHint('[reformat:list] x') ?? '', /checklist node only if it is a list of to-dos/);
  // merged turns: the last tag line wins
  assert.match(reformatHint('[reformat:table] x\n\n[reformat:shorter] y') ?? '', /shorter version/);
});

let clock = Date.UTC(2026, 9, 12, 12, 35);
const msg = (role: 'user' | 'assistant', text: string): ChatMessage => ({ id: Math.random().toString(), role, text, tools: [], status: 'done', createdAt: (clock += 60_000) });
const convo = () => [msg('user', 'Erklär X'), msg('assistant', 'Lange Antwort'), msg('user', '[reformat:table] Bitte formuliere die letzte Antwort als Tabelle um.')];
const HINT = /Reformat request: reformulate your previous answer as a table/;


test('UX6: no bar under an open question, no "Als Tabelle" under a table, no "Als Liste" under a checklist', () => {
  const md = (text: string, key = 'm'): Segment => ({ key, kind: 'markdown', text });
  const hui = (type: string, key = 'h'): Segment => ({ key, kind: 'hui', complete: true, raw: '', node: { type } as never });
  const long = 'x'.repeat(400);
  const base = { enabled: true, streaming: false, length: 400 };
  // choice (+ a short closing line) at the end → the answer waits for input
  for (const segs of [[md('Wohin?'), hui('choice')], [md(long), hui('scale'), md('Sag mir Bescheid!')], [hui('form')], [hui('poll')]]) {
    const shape = answerShape(segs);
    assert.equal(shape.question, true);
    assert.deepEqual(transformChips({ ...base, shape }), { base: [], translate: false });
  }
  // a question followed by a long text is not "ending" with it; a table node is not a question
  assert.equal(answerShape([hui('choice'), md(long)]).question, false);
  assert.equal(answerShape([md(long), hui('table')]).question, false);
  const chips = (segs: Segment[]) => transformChips({ ...base, shape: answerShape(segs) }).base;
  assert.equal(chips([md('Hier die Übersicht:'), hui('table')]).includes('table'), false);
  const mdTable = '| Stadt | Einwohner |\n|---|---|\n' + Array.from({ length: 10 }, (_, i) => `| Stadt ${i} | ${i * 1000} |`).join('\n');
  assert.equal(chips([md(`Kurz:\n\n${mdTable}`)]).includes('table'), false);
  assert.equal(chips([md(`${long}\n\n| a | b |\n|---|---|\n| 1 | 2 |`)]).includes('table'), true);
  assert.equal(chips([md('Packliste'), hui('checklist')]).includes('list'), false);
  assert.equal(chips([md(`${long}\n\n- [ ] Pass\n- [x] Ladekabel`)]).includes('list'), false);
  assert.deepEqual(chips([md(long)]), REFORMAT_BASE_KINDS);
});
