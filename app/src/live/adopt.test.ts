import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adoptChecklist, adoptId, titleFromId } from './adopt.ts';

test('a plain list as a first version: readable ids from the text, ticks and fields kept, empty items dropped', () => {
  const s = adoptChecklist({
    title: 'Packliste Rom',
    kind: 'packing',
    items: [
      { text: 'Reisepass', checked: true },
      { text: 'Brot vom Bäcker', qty: 1 },
      { text: 'Ladegerät', note: 'USB-C' },
      { text: 'Ladegerät' },
      { text: '  ' },
    ],
  });
  assert.deepEqual(s.items.map((i) => i.id), ['reisepass', 'brot-vom-baecker', 'ladegeraet', 'ladegeraet-2']);
  assert.equal(s.items[0].checked, true);
  assert.equal(s.items[2].note, 'USB-C');
  assert.equal(s.title, 'Packliste Rom');
  assert.equal(s.kind, 'packing');
});

test('card id: the list\'s own slug id, else from the title, never a taken one', () => {
  assert.equal(adoptId('einkauf', 'Einkauf', new Set()), 'einkauf');
  assert.equal(adoptId('checklist-0.1', 'Packliste für Rom', new Set()), 'packliste-fuer-rom');
  assert.equal(adoptId('einkauf', 'Einkauf', new Set(['einkauf', 'einkauf-2'])), 'einkauf-3');
  assert.equal(adoptId(undefined, '', new Set()), 'liste');
  // R2-01: Hermes' own id with an underscore becomes its slug (its next plain list with that id continues the card),
  // not "liste" from the default title
  assert.equal(adoptId('einkaufsliste_samstag', 'Liste', new Set()), 'einkaufsliste-samstag');
  assert.equal(adoptId('checklist-seg-3', 'Liste', new Set()), 'liste');
  assert.equal(titleFromId('einkaufsliste_samstag'), 'Einkaufsliste Samstag');
  assert.equal(titleFromId('checklist-0.1'), undefined);
  // a Markdown task list made a checklist (chat/taskLists.ts): its made-up id is no card name
  assert.equal(adoptId('md-tasks-0-1x2y3z', 'Einkaufsliste', new Set()), 'einkaufsliste');
});
