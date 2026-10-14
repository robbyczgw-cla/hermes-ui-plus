import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choiceReply, checklistReply, confirmReply, quizReply, slotNoneReply, slotReply, oneLine } from './replies.ts';
import {
  addItem,
  checklistReplyFor,
  checklistShareText,
  groupChecklist,
  inferCategory,
  itemLabel,
  itemsFromNode,
  parseItemInput,
  removeItem,
  restoreItem,
  shouldGroup,
  stateFromNode,
  toggleItem,
  type ChecklistState,
} from './checklistModel.ts';
import { isChecklistState, appendItems } from '../../../../actions/lists.ts';
import {
  advanceQuiz,
  answerCard,
  answerQuestion,
  deckRounds,
  initDeck,
  initialQuizState,
  isCorrect,
  normalizeAnswer,
  readCards,
  readQuestions,
  scoreQuiz,
  shuffled,
  syncDeck,
} from './learnModel.ts';
import { groupSlotsByDay, readSlots } from './slotsModel.ts';
import {
  canSubmitSelection,
  domainOf,
  faviconUrl,
  isHttpUrl,
  moduleNodeId,
  pickChoiceLayout,
  provenanceInfo,
  readOptions,
  selectionRules,
  spokenDuration,
  toggleSelection,
} from './misc.ts';

/* ───────────── replies ───────────── */

test('choice reply format', () => {
  assert.equal(choiceReply('dinner', 'Was möchtest du essen?', ['Pizza']), '[choice:dinner] Was möchtest du essen? → Pizza');
  assert.equal(choiceReply('d', 'Welche?', ['A', 'C']), '[choice:d] Welche? → A, C');
  assert.equal(choiceReply('d', 'Welche?', ['A'], 'Sushi\nbitte'), '[choice:d] Welche? → A, Andere: Sushi bitte');
  assert.equal(choiceReply('d', undefined, [], 'Tacos'), '[choice:d] → Andere: Tacos');
  assert.equal(choiceReply('d', '  ', ['X']), '[choice:d] → X');
});

test('other reply formats', () => {
  assert.equal(checklistReply('einkauf', ['Milch', 'Eier'], ['Brot']), '[checklist:einkauf] erledigt: Milch, Eier · offen: Brot');
  assert.equal(checklistReply('l', [], ['Brot']), '[checklist:l] erledigt: – · offen: Brot');
  assert.equal(checklistReply('l', ['Brot'], []), '[checklist:l] erledigt: Brot · offen: –');
  assert.equal(quizReply('q1', 4, 5), '[quiz:q1] 4/5 richtig');
  assert.equal(slotReply('termin', 'Di 14. Okt, 10:00–11:00'), '[slot:termin] Di 14. Okt, 10:00–11:00');
  assert.equal(slotNoneReply('termin'), '[slot:termin] keiner passt');
  assert.equal(confirmReply('del', true), '[confirm:del] ja');
  assert.equal(confirmReply('del', false), '[confirm:del] nein');
  assert.equal(oneLine('  a \n b\t c '), 'a b c');
  // empty id never yields "[choice:]"
  assert.equal(confirmReply(' ', true), '[confirm:confirm] ja');
});

/* ───────────── checklist ───────────── */

const node = {
  type: 'checklist',
  id: 'einkauf',
  title: 'Einkauf Wochenende',
  kind: 'shopping',
  items: [
    { text: 'Äpfel', qty: 1, unit: 'kg' },
    { id: 'milk', text: 'Milch', qty: 2, unit: 'l', checked: true },
    'Vollkornbrot',
    { text: 'Spülmittel' },
    { text: 'Tomatenmark' },
    { text: 'Eisbergsalat' },
    { text: 'Zauberwürfel' },
    { text: '' },
    null,
  ],
};

test('itemsFromNode: fallback ids, strings, drops empty', () => {
  const items = itemsFromNode(node.items);
  assert.deepEqual(
    items.map((i) => i.id),
    ['i0', 'milk', 'i2', 'i3', 'i4', 'i5', 'i6'],
  );
  assert.equal(items[1].checked, true);
  assert.equal(items[2].text, 'Vollkornbrot');
  assert.deepEqual(itemsFromNode([{ id: 'a', text: 'x' }, { id: 'a', text: 'y' }]).map((i) => i.id), ['a', 'a_']);
  assert.deepEqual(itemsFromNode('nope'), []);
});

test('stateFromNode satisfies the add_to_list contract', () => {
  const s = stateFromNode(node, 1000);
  assert.ok(isChecklistState(s));
  assert.equal(s.title, 'Einkauf Wochenende');
  assert.equal(s.createdAt, 1000);
  // appended items from the action are rendered by the same model
  const out = appendItems(s, ['Butter', 'milch'], () => 'new1');
  assert.deepEqual(out.added, ['Butter']);
  assert.deepEqual(out.reopened, ['milch']);
  const g = groupChecklist(out.state.items, { kind: 'shopping', grouped: true });
  assert.ok(g.groups.find((x) => x.key === 'Kühlregal')!.items.some((i) => i.text === 'Butter'));
});

test('inferCategory: German compounds and longest match', () => {
  assert.equal(inferCategory('Vollkornbrot'), 'Brot & Backwaren');
  assert.equal(inferCategory('Tomatenmark'), 'Vorrat');
  assert.equal(inferCategory('Tomaten'), 'Obst & Gemüse');
  assert.equal(inferCategory('Eisbergsalat'), 'Obst & Gemüse');
  assert.equal(inferCategory('Reis'), 'Vorrat');
  assert.equal(inferCategory('Eis'), 'Tiefkühl');
  assert.equal(inferCategory('Eier'), 'Kühlregal');
  assert.equal(inferCategory('Hafermilch'), 'Getränke');
  assert.equal(inferCategory('Olivenöl'), 'Vorrat');
  assert.equal(inferCategory('Spülmittel'), 'Haushalt');
  assert.equal(inferCategory('Zauberwürfel'), undefined);
});

test('groupChecklist: supermarket order, checked at bottom, Sonstiges last', () => {
  const items = itemsFromNode(node.items);
  const g = groupChecklist(items, { kind: 'shopping', grouped: true });
  assert.deepEqual(
    g.groups.map((x) => x.title),
    ['Obst & Gemüse', 'Brot & Backwaren', 'Vorrat', 'Haushalt', 'Sonstiges'],
  );
  assert.deepEqual(g.groups[0].items.map((i) => i.text), ['Äpfel', 'Eisbergsalat']);
  assert.deepEqual(g.done.map((i) => i.text), ['Milch']);
  assert.equal(g.total, 7);
  assert.equal(g.doneCount, 1);
});

test('groupChecklist: explicit categories win; flat list for todo', () => {
  const items = itemsFromNode([{ text: 'Pass', category: 'Dokumente' }, { text: 'Zahnbürste', category: 'Bad' }, { text: 'Ladekabel' }]);
  const g = groupChecklist(items, { kind: 'packing', grouped: true });
  assert.deepEqual(g.groups.map((x) => x.title), ['Dokumente', 'Bad', 'Sonstiges']);
  const flat = groupChecklist(itemsFromNode(['a', { text: 'b', checked: true }, 'c']), { kind: 'todo', grouped: false });
  assert.equal(flat.groups.length, 1);
  assert.equal(flat.groups[0].title, '');
  assert.deepEqual(flat.groups[0].items.map((i) => i.text), ['a', 'c']);
  assert.deepEqual(flat.done.map((i) => i.text), ['b']);
  // only "Sonstiges" → no header
  const only = groupChecklist(itemsFromNode(['Zauberwürfel']), { kind: 'shopping', grouped: true });
  assert.equal(only.groups[0].title, '');
  // all checked → no open groups
  assert.equal(groupChecklist(itemsFromNode([{ text: 'x', checked: true }]), { kind: 'todo', grouped: false }).groups.length, 0);
});

test('shouldGroup', () => {
  assert.equal(shouldGroup('shopping', undefined, []), true);
  assert.equal(shouldGroup('shopping', 'none', []), false);
  assert.equal(shouldGroup('todo', undefined, itemsFromNode(['a'])), false);
  assert.equal(shouldGroup('todo', undefined, itemsFromNode([{ text: 'a', category: 'X' }])), true);
  assert.equal(shouldGroup('generic', 'category', []), true);
});

test('parseItemInput', () => {
  assert.deepEqual(parseItemInput('2 l Milch'), { qty: 2, unit: 'l', text: 'Milch' });
  assert.deepEqual(parseItemInput('1,5kg Mehl'), { qty: 1.5, unit: 'kg', text: 'Mehl' });
  assert.deepEqual(parseItemInput('6 Eier'), { qty: 6, text: 'Eier' });
  assert.deepEqual(parseItemInput('3 rote Paprika'), { qty: 3, text: 'rote Paprika' });
  assert.deepEqual(parseItemInput('½ Bund Petersilie'), { qty: 0.5, unit: 'Bund', text: 'Petersilie' });
  assert.deepEqual(parseItemInput('  Brot  '), { text: 'Brot' });
  assert.deepEqual(parseItemInput('2'), { text: '2' });
  assert.equal(parseItemInput('   '), null);
});

test('addItem / toggle / remove / restore', () => {
  let n = 0;
  const id = () => `n${n++}`;
  const s0: ChecklistState = stateFromNode(node, 1);
  const a = addItem(s0, '500 g Hackfleisch', id, 'shopping');
  assert.equal(a.outcome, 'added');
  const added = a.state.items[a.state.items.length - 1];
  assert.deepEqual(added, { id: 'n0', text: 'Hackfleisch', checked: false, qty: 500, unit: 'g', category: 'Fleisch & Fisch' });
  assert.equal(itemLabel(added), '500 g Hackfleisch');
  assert.equal(addItem(a.state, 'hackfleisch', id, 'shopping').outcome, 'duplicate');
  const r = addItem(a.state, 'milch', id, 'shopping');
  assert.equal(r.outcome, 'reopened');
  assert.equal(r.state.items.find((i) => i.id === 'milk')!.checked, false);
  assert.equal(addItem(s0, '  ', id, 'todo').outcome, 'empty');
  const t = toggleItem(s0, 'i0');
  assert.equal(t.items[0].checked, true);
  const rm = removeItem(t, 'milk');
  assert.equal(rm.index, 1);
  assert.equal(rm.state.items.length, s0.items.length - 1);
  const back = restoreItem(rm.state, rm.removed!, rm.index);
  assert.deepEqual(back.items.map((i) => i.id), t.items.map((i) => i.id));
  assert.equal(restoreItem(back, rm.removed!, 0), back);
});

test('checklist reply + share text', () => {
  const items = itemsFromNode([{ text: 'Milch', qty: 2, unit: 'l', checked: true }, 'Brot', { text: 'Butter', qty: 0.25, unit: 'kg' }]);
  assert.equal(checklistReplyFor('einkauf', items), '[checklist:einkauf] erledigt: 2 l Milch · offen: Brot, 0,25 kg Butter');
  const txt = checklistShareText('Einkauf', items, { kind: 'shopping', grouped: true });
  assert.equal(txt, ['Einkauf (1/3)', '', 'Brot & Backwaren', '☐ Brot', '', 'Kühlregal', '☐ 0,25 kg Butter', '', 'Erledigt (1)', '☑ 2 l Milch'].join('\n'));
});

/* ───────────── quiz ───────────── */

const quizRaw = [
  { q: 'Hauptstadt von Australien?', options: ['Sydney', 'Canberra', 'Melbourne'], answer: 1, explanation: 'Canberra seit 1913.' },
  { q: 'Welche sind Primzahlen?', options: ['2', '4', '7', '9'], answer: [2, 0] },
  { q: 'Kaputt', options: ['a', 'b'], answer: 5 },
  { q: '', options: ['a'], answer: 0 },
  { q: 'Ohne Optionen', options: [], answer: 0 },
];

test('readQuestions drops invalid, normalises multi answers', () => {
  const qs = readQuestions(quizRaw);
  assert.equal(qs.length, 2);
  assert.deepEqual(qs[1].answer, [0, 2]);
  assert.equal(qs[1].multi, true);
  assert.equal(qs[0].multi, false);
  assert.deepEqual(normalizeAnswer([1, 1, 3, -1, 1.5], 3), [1]);
  assert.equal(normalizeAnswer('1', 3), null);
});

test('quiz scoring', () => {
  const qs = readQuestions(quizRaw);
  assert.equal(isCorrect([1], [1]), true);
  assert.equal(isCorrect([2, 0], [0, 2]), true);
  assert.equal(isCorrect([0], [0, 2]), false);
  assert.equal(isCorrect([], [0]), false);
  assert.equal(isCorrect(null, [0]), false);
  let s = answerQuestion(initialQuizState, 0, [1]);
  s = advanceQuiz(s, qs.length);
  assert.equal(s.i, 1);
  assert.deepEqual(scoreQuiz(qs, s.answers), { correct: 1, total: 2 });
  s = answerQuestion(s, 1, [0]);
  s = advanceQuiz(s, qs.length);
  assert.equal(s.finished, true);
  assert.deepEqual(scoreQuiz(qs, s.answers), { correct: 1, total: 2 });
  assert.deepEqual(scoreQuiz(qs, [[1], [2, 0]]), { correct: 2, total: 2 });
  // skipped counts as wrong
  assert.deepEqual(scoreQuiz(qs, [[], null]), { correct: 0, total: 2 });
});

/* ───────────── flashcards ───────────── */

test('flashcard deck', () => {
  assert.deepEqual(readCards([{ front: 'Hund', back: 'dog' }, { front: '', back: 'x' }, 'x', { front: 'Katze' }]), [
    { front: 'Hund', back: 'dog' },
    { front: 'Katze', back: '' },
  ]);
  let d = initDeck(3);
  d = answerCard(d, 'again'); // 0 → end
  assert.deepEqual(d.queue, [1, 2, 0]);
  d = answerCard(d, 'known');
  d = answerCard(d, 'known');
  assert.deepEqual(d.queue, [0]);
  assert.equal(deckRounds(d), 2);
  d = answerCard(d, 'known');
  assert.deepEqual(d.queue, []);
  assert.deepEqual(d.known, [1, 2, 0]);
  assert.equal(answerCard(d, 'known'), d);
  assert.equal(deckRounds(initDeck(2)), 1);
  // streaming growth
  const g = syncDeck(initDeck(2), 4);
  assert.deepEqual(g.queue, [0, 1, 2, 3]);
  assert.equal(g.misses.length, 4);
  assert.equal(syncDeck(g, 3), g);
  // deterministic shuffle is a permutation
  let k = 0;
  const seq = [0.9, 0.1, 0.5, 0.3];
  const p = shuffled(5, () => seq[k++ % seq.length]);
  assert.deepEqual([...p].sort(), [0, 1, 2, 3, 4]);
  assert.deepEqual(initDeck(3, [2, 0, 1]).queue, [2, 0, 1]);
});

/* ───────────── slots ───────────── */

test('slots: labels, fallback ids, grouping', () => {
  const ref = new Date(2026, 9, 10);
  const slots = readSlots(
    [
      { start: '2026-10-14T10:00', end: '2026-10-14T11:00' },
      { id: 'b', start: '2026-10-14T15:30' },
      { start: '2026-10-15', label: 'Ganzer Tag' },
      { label: 'Irgendwann nächste Woche' },
      { start: 'kaputt' },
      { start: '2027-01-05T09:00', end: '2027-01-05T09:30', note: 'online' },
    ],
    ref,
  );
  assert.deepEqual(slots.map((s) => s.key), ['s0', 'b', 's2', 's3', 's5']);
  assert.equal(slots[0].label, 'Mi 14. Okt, 10:00–11:00');
  assert.equal(slots[1].label, 'Mi 14. Okt, 15:30');
  assert.equal(slots[2].label, 'Ganzer Tag (Do 15. Okt, ganztägig)');
  assert.equal(slots[3].label, 'Irgendwann nächste Woche');
  assert.equal(slots[3].day, null);
  assert.equal(slots[4].label, 'Di 5. Jan 2027, 09:00–09:30');
  assert.equal(slots[4].note, 'online');
  const groups = groupSlotsByDay(slots);
  assert.deepEqual(groups.map((g) => [g.day, g.slots.length]), [['Mi 14. Okt', 2], ['Do 15. Okt', 1], [null, 1], ['Di 5. Jan 2027', 1]]);
  assert.deepEqual(readSlots(null, ref), []);
});

/* ───────────── choice ───────────── */

test('choice options, layout, selection rules', () => {
  const opts = readOptions([{ label: 'Pizza', icon: '🍕' }, 'Pasta', { id: 'x', label: 'Salat' }, { label: '' }, { id: 'x', label: 'Dup' }]);
  assert.deepEqual(opts.map((o) => o.key), ['o0', 'o1', 'x', 'x_']);
  assert.equal(pickChoiceLayout(undefined, opts), 'chips');
  assert.equal(pickChoiceLayout('list', opts), 'list');
  assert.equal(pickChoiceLayout(undefined, [{ key: 'a', label: 'A', imageQuery: 'Rom' }]), 'grid');
  assert.equal(pickChoiceLayout(undefined, [{ key: 'a', label: 'A', description: 'lang' }]), 'list');
  assert.deepEqual(selectionRules(false, 2, 3, 5), { multiple: false, min: 1, max: 1 });
  assert.deepEqual(selectionRules(true, undefined, undefined, 5), { multiple: true, min: 1, max: 5 });
  assert.deepEqual(selectionRules(true, 4, 2, 5), { multiple: true, min: 2, max: 2 });
  assert.deepEqual(selectionRules(true, 0, 9, 3), { multiple: true, min: 1, max: 3 });
  const r = selectionRules(true, 1, 2, 4);
  assert.deepEqual(toggleSelection([], 'a', r), ['a']);
  assert.deepEqual(toggleSelection(['a', 'b'], 'a', r), ['b']);
  assert.equal(toggleSelection(['a', 'b'], 'c', r), null);
  assert.equal(canSubmitSelection(0, r), false);
  assert.equal(canSubmitSelection(2, r), true);
});

/* ───────────── misc ───────────── */

test('moduleNodeId: explicit id or stable hash', () => {
  assert.equal(moduleNodeId('choice', { id: 'abc' }), 'abc');
  const a = moduleNodeId('choice', { question: 'Q', options: ['a'] });
  assert.match(a, /^choice-[0-9a-z]+$/);
  assert.equal(moduleNodeId('choice', { question: 'Q', options: ['a'] }), a);
  assert.notEqual(moduleNodeId('choice', { question: 'Q2', options: ['a'] }), a);
  assert.match(moduleNodeId('quiz', null), /^quiz-/);
});

test('provenance labels', () => {
  assert.equal(provenanceInfo(undefined, undefined), null);
  assert.equal(provenanceInfo('bogus', ''), null);
  assert.deepEqual(provenanceInfo('illustrative', undefined), { basis: 'illustrative', label: 'Beispielwerte', tone: 'caution', url: undefined });
  assert.equal(provenanceInfo('estimate', 'Statistisches Bundesamt')!.label, 'Schätzung · Quelle: Statistisches Bundesamt');
  const s = provenanceInfo('sourced', 'https://www.destatis.de/DE/Themen')!;
  assert.equal(s.label, 'Quelle: destatis.de');
  assert.equal(s.url, 'https://www.destatis.de/DE/Themen');
  assert.equal(provenanceInfo('sourced', undefined)!.label, 'Recherchiert');
  // B7: a URL inside a free-text source collapses to its (complete) domain, the tile stays untappable text
  const mixed = provenanceInfo('sourced', 'Bericht auf https://www.example.com/news/ein-langer-titel-2026 und Herstellerangaben')!;
  assert.equal(mixed.label, 'Quelle: Bericht auf example.com und Herstellerangaben');
  assert.equal(mixed.url, undefined);
  assert.equal(provenanceInfo(undefined, 'Eigene Messung')!.label, 'Quelle: Eigene Messung');
  assert.equal(provenanceInfo('calculated', undefined)!.tone, 'info');
});

test('urls + domains', () => {
  assert.equal(domainOf('https://www.spiegel.de/wissenschaft/x?y=1'), 'spiegel.de');
  assert.equal(domainOf('http://de.wikipedia.org:8080/wiki/A'), 'de.wikipedia.org');
  assert.equal(domainOf('javascript:alert(1)'), '');
  assert.equal(domainOf('https://user@evil.example.com/'), '');
  assert.equal(isHttpUrl('https://example.com/a'), true);
  assert.equal(isHttpUrl('ftp://example.com'), false);
  assert.equal(isHttpUrl('https://localhost'), false);
  assert.equal(faviconUrl('https://www.zeit.de/x'), 'https://www.zeit.de/favicon.ico');
  assert.equal(faviconUrl('mailto:a@b.de'), undefined);
});

test('spokenDuration', () => {
  assert.equal(spokenDuration(90), '1 Minute 30 Sekunden');
  assert.equal(spokenDuration(3600), '1 Stunde');
  assert.equal(spokenDuration(7322), '2 Stunden 2 Minuten 2 Sekunden');
  assert.equal(spokenDuration(0), '0 Sekunden');
  assert.equal(spokenDuration(1), '1 Sekunde');
});
