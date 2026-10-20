import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HuiChecklist } from '../protocol/types.ts';
import { foldLive, headOf, type LiveEvent, type LiveItem, type LiveOp } from './model.ts';
import { fullFromNode } from './nodes.ts';
import { addPendingOp, afterAccepted, compactOps, isEmptyPending, pendingCount, pruneInflight, rebasePending, viewOf, type PendingCard } from './pending.ts';

const V1: LiveItem[] = [
  { id: 'tomaten', text: 'Tomaten', qty: 6 },
  { id: 'milch', text: 'Milch', qty: 1, unit: 'l' },
  { id: 'senf', text: 'Senf' },
];
const hermes = (key: string, items: LiveItem[]): LiveEvent => ({ kind: 'hermes', key, at: 1000 + key.length, full: fullFromNode({ type: 'checklist', id: 'einkauf', live: true, items } as HuiChecklist)! });
const cardOf = (...evs: LiveEvent[]) => foldLive(evs).cards.get('einkauf')!;
const pending = (base: number, ops: LiveOp[], extra: Partial<PendingCard> = {}): PendingCard => ({ base, ops, bid: 'b-test', ...extra });

test('compact: tick + untick cancel, add + del cancel, sets merge, edits fold into an own add', () => {
  const ref = { items: V1 };
  assert.deepEqual(compactOps([{ check: 'milch' }, { uncheck: 'milch' }], ref), []);
  assert.deepEqual(compactOps([{ add: { id: 'u-1', text: 'Brot' } }, { del: 'u-1' }], ref), []);
  assert.deepEqual(compactOps([{ set: 'milch', qty: 2 }, { set: 'milch', unit: 'ml' }, { set: 'milch', qty: 1 }], ref), [{ set: 'milch', unit: 'ml' }]);
  assert.deepEqual(compactOps([{ add: { id: 'u-1', text: 'Brot' } }, { set: 'u-1', qty: 2 }, { check: 'u-1' }], ref), [{ add: { id: 'u-1', text: 'Brot', qty: 2, checked: true } }]);
  assert.deepEqual(compactOps([{ set: 'senf', text: 'Senf süß' }, { del: 'senf' }], ref), [{ del: 'senf' }]);
});

test('no movement on the other side: no conflicts, own ops applied on top', () => {
  const card = cardOf(hermes('ha-1', V1));
  const v = rebasePending(card, pending(1, [{ check: 'milch' }, { add: { id: 'u-1', text: 'Brot' } }]));
  assert.equal(v.conflicts.length, 0);
  assert.equal(pendingCount(v), 2);
  assert.equal(v.state.items.find((i) => i.id === 'milch')?.checked, true);
  assert.ok(v.ownAdded.has('u-1'));
});

test('ticks never conflict, also when Hermes changed the item meanwhile', () => {
  const card = cardOf(hermes('ha-1', V1), hermes('ha-2', V1.map((i) => (i.id === 'milch' ? { ...i, qty: 2 } : i))));
  const v = rebasePending(card, pending(1, [{ check: 'milch' }]));
  assert.equal(v.conflicts.length, 0);
  assert.equal(v.state.items.find((i) => i.id === 'milch')?.checked, true);
});

test('both changed the same field: a conflict, default = own value; choosing theirs drops the op', () => {
  const card = cardOf(hermes('ha-1', V1), hermes('ha-2', V1.map((i) => (i.id === 'milch' ? { ...i, qty: 2 } : i))));
  const v = rebasePending(card, pending(1, [{ set: 'milch', qty: 3 }]));
  assert.equal(v.conflicts.length, 1);
  const c = v.conflicts[0];
  assert.equal(c.kind, 'field');
  assert.equal(c.kind === 'field' && c.theirs, 2);
  assert.equal(c.kind === 'field' && c.mine, 3);
  assert.equal(c.choice, 'mine');
  assert.equal(v.state.items.find((i) => i.id === 'milch')?.qty, 3);
  const theirs = rebasePending(card, pending(1, [{ set: 'milch', qty: 3 }], { choices: { [c.key]: 'theirs' } }));
  assert.equal(theirs.state.items.find((i) => i.id === 'milch')?.qty, 2);
  assert.deepEqual(theirs.outgoing, []);
});

test('same new value on both sides is no conflict', () => {
  const card = cardOf(hermes('ha-1', V1), hermes('ha-2', V1.map((i) => (i.id === 'milch' ? { ...i, qty: 2 } : i))));
  assert.equal(rebasePending(card, pending(1, [{ set: 'milch', qty: 2 }])).conflicts.length, 0);
});

test('Hermes removed an item the user ticked: conflict, default leave it out, keep re-adds it ticked', () => {
  const card = cardOf(hermes('ha-1', V1), hermes('ha-2', V1.filter((i) => i.id !== 'tomaten')));
  const v = rebasePending(card, pending(1, [{ check: 'tomaten' }]));
  assert.equal(v.conflicts.length, 1);
  const c = v.conflicts[0];
  assert.equal(c.kind, 'deleted');
  assert.equal(c.choice, 'drop');
  assert.equal(v.state.items.some((i) => i.id === 'tomaten'), false);
  const keep = rebasePending(card, pending(1, [{ check: 'tomaten' }], { choices: { [c.key]: 'keep' } }));
  assert.deepEqual(keep.outgoing, [{ add: { id: 'tomaten', text: 'Tomaten', qty: 6, checked: true } }]);
});

test('user deleted, Hermes edited: the delete goes out, no conflict', () => {
  const card = cardOf(hermes('ha-1', V1), hermes('ha-2', V1.map((i) => (i.id === 'senf' ? { ...i, note: 'süß' } : i))));
  const v = rebasePending(card, pending(1, [{ del: 'senf' }]));
  assert.equal(v.conflicts.length, 0);
  assert.deepEqual(v.outgoing, [{ del: 'senf' }]);
});

test('both added the same open item: Hermes keeps its one, the own tick moves over', () => {
  const card = cardOf(hermes('ha-1', V1), hermes('ha-2', [...V1, { id: 'brot', text: 'Brot' }]));
  const v = rebasePending(card, pending(1, [{ add: { id: 'u-1', text: 'brot', checked: true } }]));
  assert.deepEqual(v.outgoing, [{ check: 'brot' }]);
  assert.equal(v.state.items.filter((i) => /brot/i.test(i.text)).length, 1);
});

test('addPendingOp starts at the head; after acceptance sent ops are in flight, later ones pending under a new bid', () => {
  let p = addPendingOp(undefined, { check: 'milch' }, 3, () => 'b-1');
  assert.deepEqual(p, { base: 3, ops: [{ check: 'milch' }], bid: 'b-1' });
  p = addPendingOp(p, { check: 'senf' }, 4);
  assert.equal(p.base, 3);
  const all = afterAccepted(p, { bid: 'b-1', count: 2 }, 4, () => 'b-2')!;
  assert.deepEqual(all, { base: 4, ops: [], bid: 'b-2', inflight: { bid: 'b-1', base: 3, ops: [{ check: 'milch' }, { check: 'senf' }] } });
  const rest = afterAccepted(p, { bid: 'b-1', count: 1 }, 4, () => 'b-2')!;
  assert.deepEqual(rest.ops, [{ check: 'senf' }]);
  assert.deepEqual(rest.inflight?.ops, [{ check: 'milch' }]);
  assert.equal(afterAccepted(p, { bid: 'other', count: 1 }, 4), p);
  // the transcript shows b-1: in-flight ops go, the rest stays
  assert.equal(pruneInflight(all, new Set(['b-1'])), undefined);
  assert.deepEqual(pruneInflight(rest, new Set(['b-1'])), { base: 4, ops: [{ check: 'senf' }], bid: 'b-2' });
  assert.equal(pruneInflight(rest, new Set(['b-9'])), rest);
  assert.ok(isEmptyPending(undefined));
  assert.ok(!isEmptyPending(all));
});

test('in-flight ops are shown but never sent again', () => {
  const card = cardOf(hermes('ha-1', V1));
  const p: PendingCard = { base: 1, ops: [{ check: 'senf' }], bid: 'b-2', inflight: { bid: 'b-1', base: 1, ops: [{ check: 'milch' }] } };
  const v = viewOf(card, p);
  assert.deepEqual(v.outgoing, [{ check: 'senf' }]);
  assert.equal(v.state.items.find((i) => i.id === 'milch')?.checked, true);
  assert.equal(v.state.items.find((i) => i.id === 'senf')?.checked, true);
});

test('a focus-only pending card sends no ops', () => {
  const card = cardOf(hermes('ha-1', V1));
  const v = rebasePending(card, pending(1, [], { focus: true }));
  assert.deepEqual(v.outgoing, []);
  assert.equal(headOf(card).state, v.state);
});
