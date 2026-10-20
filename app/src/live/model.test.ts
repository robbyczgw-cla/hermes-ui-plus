import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HuiChecklist } from '../protocol/types.ts';
import {
  applyOps,
  countChanges,
  diffFull,
  diffStates,
  fitCategory,
  foldLive,
  hashItemId,
  headOf,
  progressOf,
  stateFromNode,
  type LiveEvent,
  type LiveItem,
} from './model.ts';
import { fullFromNode } from './nodes.ts';

const node = (items: Partial<LiveItem>[], extra: Partial<HuiChecklist> = {}): HuiChecklist =>
  ({ type: 'checklist', id: 'einkauf', live: true, title: 'Einkauf Samstag', kind: 'shopping', items: items as HuiChecklist['items'], ...extra }) as HuiChecklist;
const hermes = (key: string, items: Partial<LiveItem>[], extra: Partial<HuiChecklist> = {}): LiveEvent => ({ kind: 'hermes', key, at: 1000, full: fullFromNode(node(items, extra))! });
const user = (key: string, v: number, ops: unknown[], bid?: string): LiveEvent => ({ kind: 'user', key, at: 2000, card: 'einkauf', batch: { v, ops: ops as never, ...(bid ? { bid } : {}) } });

const V1 = [
  { id: 'tomaten', text: 'Tomaten', qty: 6, category: 'Obst & Gemüse' },
  { id: 'milch', text: 'Milch', qty: 1, unit: 'l', category: 'Kühlregal' },
  { id: 'senf', text: 'Senf', note: 'mittelscharf' },
];

test('first full version creates the card as v1', () => {
  const f = foldLive([hermes('ha-1', V1)]);
  const card = f.cards.get('einkauf')!;
  assert.equal(card.versions.length, 1);
  assert.equal(headOf(card).n, 1);
  assert.deepEqual(headOf(card).state.items.map((i) => i.id), ['tomaten', 'milch', 'senf']);
  assert.deepEqual(f.marks.get('ha-1'), [{ card: 'einkauf', n: 1 }]);
});

test('a later full version is diffed against the fold before it: add, remove, change', () => {
  const v2 = [
    { id: 'milch', text: 'Milch', qty: 1, unit: 'l', category: 'Kühlregal' },
    { id: 'senf', text: 'Senf', note: 'süß' },
    { id: 'grillkohle', text: 'Grillkohle', qty: 1, unit: 'Sack' },
  ];
  const f = foldLive([hermes('ha-1', V1), hermes('ha-2', v2)]);
  const head = headOf(f.cards.get('einkauf')!);
  assert.equal(head.n, 2);
  const changes = diffStates(f.cards.get('einkauf')!.versions[0].state, head.state);
  assert.deepEqual(countChanges(changes), { added: 1, removed: 1, changed: 1, checked: 0, unchecked: 0 });
  assert.deepEqual(changes.find((c) => c.kind === 'changed')?.fields, { note: ['mittelscharf', 'süß'] });
});

test('an unchanged full version is no new version (receipt says unchanged)', () => {
  const f = foldLive([hermes('ha-1', V1), hermes('ha-2', V1)]);
  assert.equal(f.cards.get('einkauf')!.versions.length, 1);
  assert.deepEqual(f.marks.get('ha-2'), [{ card: 'einkauf', n: 1, unchanged: true }]);
});

test('ticks win: a Hermes version without `checked` keeps the user tick; explicit false unticks', () => {
  const kept = foldLive([hermes('ha-1', V1), user('hu-2', 1, [{ check: 'milch' }]), hermes('ha-3', [...V1, { id: 'brot', text: 'Brot' }])]);
  assert.equal(headOf(kept.cards.get('einkauf')!).state.items.find((i) => i.id === 'milch')?.checked, true);
  const unticked = foldLive([hermes('ha-1', V1), user('hu-2', 1, [{ check: 'milch' }]), hermes('ha-3', V1.map((i) => (i.id === 'milch' ? { ...i, checked: false } : i)))]);
  assert.equal(headOf(unticked.cards.get('einkauf')!).state.items.find((i) => i.id === 'milch')?.checked, undefined);
});

test('items without ids match the base by text, so ids stay stable', () => {
  const f = foldLive([hermes('ha-1', V1), hermes('ha-2', [{ text: 'tomaten', qty: 4 }, { text: 'Milch', qty: 1, unit: 'l', category: 'Kühlregal' }, { text: 'Senf', note: 'mittelscharf' }])]);
  const head = headOf(f.cards.get('einkauf')!);
  assert.deepEqual(head.state.items.map((i) => i.id), ['tomaten', 'milch', 'senf']);
  assert.equal(head.state.items[0].qty, 4);
});

test('item without id and no match gets h<hash>, never i<index>, stable for the same text', () => {
  const s = stateFromNode(node([{ text: 'Brot vom Bäcker' }]));
  assert.match(s.items[0].id, /^h[0-9a-z]+$/);
  assert.equal(s.items[0].id, hashItemId('Brot vom Bäcker'));
});

test('a user batch on an id Hermes deleted is skipped (delete wins)', () => {
  const f = foldLive([hermes('ha-1', V1), hermes('ha-2', V1.filter((i) => i.id !== 'tomaten')), user('hu-3', 1, [{ check: 'tomaten' }])]);
  const card = f.cards.get('einkauf')!;
  assert.equal(card.versions.length, 2);
  assert.equal(headOf(card).state.items.some((i) => i.id === 'tomaten'), false);
});

test('content edits: the later one in the transcript wins', () => {
  const f = foldLive([hermes('ha-1', V1), user('hu-2', 1, [{ set: 'milch', qty: 2 }]), hermes('ha-3', V1.map((i) => (i.id === 'milch' ? { ...i, qty: 3 } : i)))]);
  assert.equal(headOf(f.cards.get('einkauf')!).state.items.find((i) => i.id === 'milch')?.qty, 3);
});

test('Hermes never deletes an item it could not see: user adds before its turn are part of its base', () => {
  // the user's add is in the transcript before Hermes' version; Hermes left it out → that IS a delete it saw
  const seen = foldLive([hermes('ha-1', V1), user('hu-2', 1, [{ add: { id: 'u-abcde', text: 'Brot' } }]), hermes('ha-3', V1)]);
  assert.equal(headOf(seen.cards.get('einkauf')!).state.items.some((i) => i.id === 'u-abcde'), false);
  // the same add arriving after Hermes' version (sent from another device that was offline) is kept
  const later = foldLive([hermes('ha-1', V1), hermes('ha-3', V1), user('hu-4', 1, [{ add: { id: 'u-abcde', text: 'Brot' } }])]);
  assert.equal(headOf(later.cards.get('einkauf')!).state.items.some((i) => i.id === 'u-abcde'), true);
});

test('a retried batch with the same bid applies once', () => {
  const f = foldLive([hermes('ha-1', V1), user('hu-2', 1, [{ set: 'milch', qty: 2 }], 'b-1'), user('hu-3', 1, [{ set: 'milch', qty: 2 }], 'b-1')]);
  assert.equal(f.cards.get('einkauf')!.versions.length, 2);
  assert.equal(f.marks.has('hu-3'), false);
});

test('user batches for an unknown card are ignored', () => {
  const f = foldLive([{ kind: 'user', key: 'hu-1', at: 1, card: 'nope', batch: { v: 1, ops: [{ check: 'x' }] } }]);
  assert.equal(f.cards.size, 0);
});

test('closed: a version with closed:true closes, a later one without it reopens', () => {
  const f = foldLive([hermes('ha-1', V1), hermes('ha-2', V1, { closed: true })]);
  assert.equal(headOf(f.cards.get('einkauf')!).state.closed, true);
  const g = foldLive([hermes('ha-1', V1), hermes('ha-2', V1, { closed: true }), hermes('ha-3', V1)]);
  assert.equal(headOf(g.cards.get('einkauf')!).state.closed, undefined);
});

test('Hermes order of items becomes the card order', () => {
  const f = foldLive([hermes('ha-1', V1), hermes('ha-2', [V1[2], V1[0], V1[1]])]);
  assert.deepEqual(headOf(f.cards.get('einkauf')!).state.items.map((i) => i.id), ['senf', 'tomaten', 'milch']);
});

test('diffFull: title change becomes a meta op, missing title keeps the old one', () => {
  const base = stateFromNode(node(V1 as LiveItem[]));
  assert.deepEqual(diffFull(base, { title: 'Grillen', items: V1 as LiveItem[] }), [{ meta: { title: 'Grillen' } }]);
  assert.deepEqual(diffFull(base, { items: V1 as LiveItem[] }), []);
});

test('applyOps skips no-ops and reports what applied', () => {
  const s = stateFromNode(node(V1 as LiveItem[]));
  const r = applyOps(s, [{ check: 'milch' }, { check: 'milch' }, { del: 'nope' }, { set: 'senf', text: '' }]);
  assert.equal(r.applied.length, 1);
  assert.deepEqual(progressOf(r.state), { done: 1, total: 3 });
});

test('fold is deterministic: same transcript, same result', () => {
  const evs = [hermes('ha-1', V1), user('hu-2', 1, [{ check: 'milch' }, { add: { id: 'u-1', text: 'Brot' } }]), hermes('ha-3', [...V1, { id: 'kohle', text: 'Grillkohle' }])];
  assert.deepEqual(JSON.stringify([...foldLive(evs).cards]), JSON.stringify([...foldLive(evs).cards]));
});

test('fitCategory: an inferred category joins the card\'s own group', () => {
  const cats = ['Obst & Gemüse', 'Backwaren', 'Kühlregal', undefined];
  assert.equal(fitCategory('Brot & Backwaren', cats), 'Backwaren');
  assert.equal(fitCategory('Obst & Gemüse', cats), 'Obst & Gemüse');
  assert.equal(fitCategory('Getränke', cats), 'Getränke');
  assert.equal(fitCategory(undefined, cats), undefined);
});
