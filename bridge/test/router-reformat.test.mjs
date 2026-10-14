import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHeuristic } from '../src/router/backends/heuristic.mjs';
import { createRouter } from '../src/router/router.mjs';
import { parseReformatTag, reformatDecision } from '../src/router/reformat.mjs';
import { buildHint } from '../src/router/hint.mjs';

const u = (content) => ({ role: 'user', content });
const a = (content) => ({ role: 'assistant', content });
const LONG = 'Die Photosynthese ist ein Prozess, bei dem Pflanzen Licht in chemische Energie umwandeln. '.repeat(6);
const pick = (d) => d && [d.format, d.component ?? null, d.confidence, d.reason];

test('reformat: tag parser', () => {
  assert.deepEqual(parseReformatTag('[reformat:table] Bitte die letzte Antwort als Tabelle.'), { kind: 'table' });
  assert.deepEqual(parseReformatTag('[reformat:translate:en] Bitte auf Englisch.'), { kind: 'translate', lang: 'en' });
  assert.equal(parseReformatTag('Bitte als Tabelle [reformat:table]'), null);
  assert.equal(parseReformatTag('[choice:x] A'), null);
});

test('reformat: forced formats per kind', () => {
  const r = (msg, prev = LONG) => pick(reformatDecision([u('Erklär Photosynthese'), a(prev), u(msg)]));
  assert.deepEqual(r('[reformat:table] Bitte die letzte Antwort als Tabelle.'), ['table', null, 0.95, 'reformat']);
  for (const k of ['shorter', 'longer', 'simpler', 'expert']) assert.deepEqual(r(`[reformat:${k}] x`), ['text', null, 0.95, 'reformat']);
  // list → checklist only for to-do lists, else markdown lists (text)
  assert.deepEqual(r('[reformat:list] Als Liste.'), ['text', null, 0.95, 'reformat']);
  const todos = 'Deine Aufgaben für den Umzug:\n- Kartons besorgen\n- Nachsendeauftrag stellen\n- Strom ummelden';
  assert.deepEqual(r('[reformat:list] Als Liste.', todos), ['checklist', 'todo', 0.95, 'reformat']);
  assert.deepEqual(r('[reformat:list] x', '```hui\n{"type":"checklist","id":"c","items":[]}\n```'), ['checklist', 'todo', 0.95, 'reformat']);
  // translate → translation cards for short answers, text for long ones
  assert.deepEqual(r('[reformat:translate:en] Bitte auf Englisch.', 'Guten Morgen, wie geht es dir?'), ['translation', null, 0.95, 'reformat']);
  assert.deepEqual(r('[reformat:translate:en] Bitte auf Englisch.'), ['text', null, 0.95, 'reformat']);
  // unknown kind / no tag → no override
  assert.equal(r('[reformat:poem] x'), null);
  assert.equal(r('Mach eine Tabelle'), null);
});

test('reformat: heuristic returns the forced decision too (no-backend / fallback path)', () => {
  const d = classifyHeuristic([u('Q'), a(LONG), u('[reformat:table] Bitte die letzte Antwort als Tabelle.')]);
  assert.deepEqual(pick(d), ['table', null, 0.95, 'reformat']);
});

test('reformat: router skips cache and backend, reason "reformat"', async () => {
  let calls = 0;
  const backend = { id: 'x', model: 'm', decide: async () => { calls++; return { format: 'chart', confidence: 0.9, reason: 'model' }; } };
  const r = createRouter({ backend, fastPathMin: 0 });
  const d = await r.route([u('Q'), a(LONG), u('[reformat:table] Bitte die letzte Antwort als Tabelle.')]);
  assert.equal(calls, 0);
  assert.deepEqual(pick(d), ['table', null, 0.95, 'reformat']);
  assert.equal(r.cache?.size ?? 0, 0);
  // the injected hint (text decisions included: 0.95 ≥ textMin)
  assert.equal(buildHint(d), 'UI-ROUTER-HINT: format=table confidence=0.9');
  assert.equal(buildHint({ ...d, format: 'text' }), 'UI-ROUTER-HINT: format=text confidence=0.9');
  // ordinary messages still reach the backend
  await r.route([u('Wie hoch ist der Mount Everest?')]);
  assert.equal(calls, 1);
});
