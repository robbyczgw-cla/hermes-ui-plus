// Live rerun of the round-2 fixes (default bridge, claude-haiku-4-5): "Jetzt die Einkaufslsite zum Abhaken bitte"
// came as a Markdown task list; the app showed "☐" lines nobody could tick and Hermes then said the boxes may not be
// tappable "in your app". A finished task list is now the app's interactive checklist.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitTaskLists } from './taskLists.ts';
import { checklistReplyFor, stateFromNode } from '../ui/components/modules/a/checklistModel.ts';

const REAL = `Hier ist die Einkaufsliste ohne Salz und Olivenöl. Pfeffer habe ich drin gelassen, streich ihn einfach weg, falls du ihn schon hast.

- [ ] Penne, 500 g
- [ ] Zucchini, 2 Stück
- [ ] Kirschtomaten, 250 g
- [ ] Zwiebel, 1 Stück
- [ ] Knoblauch, 1 Knolle (2 Zehen werden gebraucht)
- [ ] Paprikapulver, edelsüß
- [ ] Sahne, 200 ml
- [ ] Parmesan oder veganer Hartkäse, 80 g
- [ ] Schwarzer Pfeffer
- [ ] Petersilie oder Basilikum, 1 Bund`;

type Rec = Record<string, unknown>;

test('real answer: the intro stays Markdown, the task list is a checklist with all ten items', () => {
  const parts = splitTaskLists(REAL);
  assert.deepEqual(parts.map((p) => p.kind), ['md', 'tasks']);
  assert.equal(parts[0].kind === 'md' && parts[0].text.startsWith('Hier ist die Einkaufsliste'), true);
  const node = (parts[1].kind === 'tasks' ? parts[1].node : null) as unknown as Rec;
  assert.equal(node.type, 'checklist');
  assert.match(String(node.id), /^md-tasks-0-/);
  const items = node.items as Rec[];
  assert.equal(items.length, 10);
  assert.equal(items[0].text, 'Penne, 500 g');
  // the same id on every parse (ticks are stored under it)
  assert.equal((splitTaskLists(REAL)[1] as { key: string }).key, (parts[1] as { key: string }).key);
});

test('ticked items stay ticked; sending back reports them and counts items with commas once', () => {
  const parts = splitTaskLists('Liste:\n\n- [x] Milch\n- [ ] Brot\n- [X] Käse, gerieben\n\nNoch was?');
  assert.deepEqual(parts.map((p) => p.kind), ['md', 'tasks', 'md']);
  const node = (parts[1] as { node: unknown }).node as Rec;
  const state = stateFromNode(node, 0);
  assert.deepEqual(state.items.map((i) => [i.text, i.checked]), [['Milch', true], ['Brot', false], ['Käse, gerieben', true]]);
  assert.match(checklistReplyFor(String(node.id), state.items), /^\[checklist:md-tasks-0-[a-z0-9]+\] erledigt: Milch; Käse, gerieben · offen: Brot$/);
});

test('not a task list: one box, ordinary bullets, task lines inside a code fence', () => {
  assert.deepEqual(splitTaskLists('- [ ] nur eine Sache').map((p) => p.kind), ['md']);
  assert.deepEqual(splitTaskLists('- Milch\n- Brot').map((p) => p.kind), ['md']);
  const code = 'So schreibst du es:\n\n```md\n- [ ] a\n- [ ] b\n```';
  assert.deepEqual(splitTaskLists(code), [{ kind: 'md', text: code }]);
});

test('two task lists in one answer get different ids', () => {
  const parts = splitTaskLists('Markt:\n- [ ] Tomaten\n- [ ] Basilikum\n\nDrogerie:\n- [ ] Seife\n- [ ] Zahnpasta');
  const ids = parts.filter((p) => p.kind === 'tasks').map((p) => (p as { key: string }).key);
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
});
