import assert from 'node:assert/strict';
import { test } from 'node:test';
import { storageKey } from '../nodestate/model.ts';
import { NodeStateStore, type KeyValueStorage } from '../nodestate/store.ts';
import { createListBus, type ListBusEvent } from './listBus.ts';
import { appendItems, appendToLatestChecklistWith, isChecklistState, pickChecklist, type ChecklistNodeState } from './lists.ts';

const mkList = (createdAt: number, title: string | undefined, texts: string[], checked: string[] = []): ChecklistNodeState => ({
  kind: 'checklist',
  title,
  createdAt,
  items: texts.map((t, i) => ({ id: `i${i}`, text: t, checked: checked.includes(t) })),
});

function mem(): { storage: KeyValueStorage; data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    storage: {
      getItem: async (k) => data.get(k) ?? null,
      setItem: async (k, v) => void data.set(k, v),
      removeItem: async (k) => void data.delete(k),
    },
  };
}

let n = 0;
const newId = () => `new${++n}`;

test('isChecklistState', () => {
  assert.ok(isChecklistState(mkList(1, 'x', [])));
  assert.ok(!isChecklistState({ kind: 'quiz', items: [], createdAt: 1 }));
  assert.ok(!isChecklistState({ kind: 'checklist', items: [] }));
  assert.ok(!isChecklistState(null));
});

test('pickChecklist: newest wins; a title match wins over newer lists', () => {
  const rec = {
    'm1:a': { v: 1, updatedAt: 1, data: mkList(100, 'Einkaufsliste', []) },
    'm2:b': { v: 1, updatedAt: 2, data: mkList(200, 'Packliste', []) },
    'm3:q': { v: 1, updatedAt: 3, data: { kind: 'quiz' } },
  };
  assert.equal(pickChecklist(rec)?.key, 'm2:b');
  assert.equal(pickChecklist(rec, ' einkaufsliste ')?.key, 'm1:a');
  assert.equal(pickChecklist(rec, 'Unbekannt')?.key, 'm2:b');
  assert.equal(pickChecklist({ 'm3:q': rec['m3:q'] }), null);
});

test('appendItems: adds, skips duplicates case-insensitively, reopens checked ones', () => {
  const s = mkList(1, 'E', ['Milch', 'Brot'], ['Brot']);
  const r = appendItems(s, ['milch', 'Brot', ' Eier ', ''], newId);
  assert.deepEqual(r.added, ['Eier']);
  assert.deepEqual(r.skipped, ['milch']);
  assert.deepEqual(r.reopened, ['Brot']);
  assert.deepEqual(r.state.items.map((i) => [i.text, i.checked]), [['Milch', false], ['Brot', false], ['Eier', false]]);
  assert.equal(s.items[1].checked, true, 'input not mutated');
});

test('appendToLatestChecklist persists through nodestate and publishes items_added', async () => {
  const { storage, data } = mem();
  const store = new NodeStateStore({ storage });
  await store.load('c1');
  store.set('c1', 'm1:old', mkList(100, 'Alt', ['x']), 2);
  store.set('c1', 'm2:list', mkList(200, 'Einkaufsliste', ['Milch']), 2);
  const bus = createListBus();
  const events: ListBusEvent[] = [];
  bus.subscribe((e) => events.push(e));
  let notified = 0;
  store.subscribe('c1', 'm2:list', () => notified++);

  const r = await appendToLatestChecklistWith({ store, bus, newId }, 'c1', ['Eier', 'Milch'], undefined);
  assert.equal(r.status, 'appended');
  if (r.status !== 'appended') return;
  assert.equal(r.key, 'm2:list');
  assert.deepEqual([r.messageId, r.nodeId], ['m2', 'list']);
  assert.deepEqual(r.added, ['Eier']);
  assert.deepEqual(r.skipped, ['Milch']);
  assert.equal(notified, 1, 'mounted checklist re-renders via its useNodeState subscription');
  assert.equal(store.peek('c1', 'm2:list')!.v, 2, 'schema version preserved');
  assert.equal((store.peek('c1', 'm2:list')!.data as ChecklistNodeState).items.length, 2);
  assert.equal((store.peek('c1', 'm1:old')!.data as ChecklistNodeState).items.length, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'items_added');

  await store.flush();
  const saved = JSON.parse(data.get(storageKey('c1'))!);
  assert.equal(saved.nodes['m2:list'].data.items.length, 2);
});

test('appendToLatestChecklist loads persisted state first', async () => {
  const a = mem();
  const s1 = new NodeStateStore({ storage: a.storage });
  s1.set('c1', 'm1:l', mkList(5, 'Einkaufsliste', ['A']));
  await s1.flush();
  const s2 = new NodeStateStore({ storage: a.storage }); // "restart"
  const r = await appendToLatestChecklistWith({ store: s2, bus: createListBus(), newId }, 'c1', ['B']);
  assert.equal(r.status, 'appended');
  assert.deepEqual((s2.peek('c1', 'm1:l')!.data as ChecklistNodeState).items.map((i) => i.text), ['A', 'B']);
});

test('no checklist in the conversation → tells the UI to create "Einkaufsliste"', async () => {
  const store = new NodeStateStore({ storage: mem().storage });
  const bus = createListBus();
  const events: ListBusEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const r = await appendToLatestChecklistWith({ store, bus }, 'empty', ['Milch', 'Eier']);
  assert.deepEqual(r, { status: 'no_checklist', listTitle: 'Einkaufsliste', items: ['Milch', 'Eier'] });
  assert.equal(events.length, 0);
  const t = await appendToLatestChecklistWith({ store, bus }, 'empty', ['x'], 'Packliste');
  assert.equal(t.status === 'no_checklist' && t.listTitle, 'Packliste');
});

test('listBus isolates throwing subscribers and supports unsubscribe', () => {
  const bus = createListBus();
  let got = 0;
  bus.subscribe(() => {
    throw new Error('boom');
  });
  const off = bus.subscribe(() => got++);
  bus.publish({ type: 'create_list', title: 'x', kind: 'shopping', items: [] });
  off();
  bus.publish({ type: 'create_list', title: 'x', kind: 'shopping', items: [] });
  assert.equal(got, 1);
});
