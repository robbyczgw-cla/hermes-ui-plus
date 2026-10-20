import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HuiProducts } from '../protocol/types.ts';
import { diffStates, foldLive, headOf, type LiveEvent } from './model.ts';
import { fullFromNode } from './nodes.ts';
import { parsePriceInput, priceDelta, priceSeries, pricesAt, underTarget, watchChangeDetail, watchCounts } from './watch.ts';

const watch = (key: string, at: number, products: object[]): LiveEvent => ({ kind: 'hermes', key, at, full: fullFromNode({ type: 'products', id: 'kopfhoerer', live: true, title: 'Kopfhörer', products } as unknown as HuiProducts)! });
const fold = () =>
  foldLive([
    watch('ha-1', 1, [{ id: 'xm5', name: 'WH-1000XM5', price: 269 }, { id: 'qc', name: 'QC Ultra', price: 349 }]),
    { kind: 'user', key: 'hu-2', at: 2, card: 'kopfhoerer', batch: { v: 1, ops: [{ set: 'xm5', target: 249 }, { set: 'qc', target: 299 }], bid: 'b1' } },
    watch('ha-3', 3, [{ id: 'xm5', name: 'WH-1000XM5', price: 249 }, { id: 'qc', name: 'QC Ultra', price: 349 }, { id: 'm4', name: 'Momentum 4', price: 259 }]),
    { kind: 'patch', key: 'ha-4', at: 4, card: 'kopfhoerer', ops: [{ set: 'xm5', price: 239 }, { set: 'm4', price: 279 }] },
  ]).cards.get('kopfhoerer')!;

test('price series from the Hermes versions (user batches add no point), delta since the first price', () => {
  const card = fold();
  assert.deepEqual(priceSeries(card, 'xm5'), [269, 249, 239]);
  assert.deepEqual(priceSeries(card, 'm4'), [259, 279]);
  assert.equal(priceDelta(card, 'xm5', 239), -30);
  assert.equal(priceDelta(card, 'qc', 349), 0);
  assert.equal(priceDelta(card, 'm4', 279), 20);
  assert.equal(priceDelta(card, 'xm5', undefined), undefined);
  assert.equal(pricesAt(card), 4);
});

test('wish price: at or under counts, bought and hidden products do not', () => {
  const state = headOf(fold()).state;
  assert.equal(underTarget(state.items.find((i) => i.id === 'xm5')!), true);
  assert.equal(underTarget({ price: 250, target: 249 }), false);
  assert.equal(underTarget({ price: 250 }), false);
  assert.deepEqual(watchCounts(state), { shown: 3, hidden: 0, under: 1, bought: 0 });
  const later = { ...state, items: state.items.map((i) => (i.id === 'xm5' ? { ...i, checked: true } : i.id === 'qc' ? { ...i, hidden: true } : i)) };
  assert.deepEqual(watchCounts(later), { shown: 2, hidden: 1, under: 0, bought: 1 });
});

test('wish price input', () => {
  assert.equal(parsePriceInput('249'), 249);
  assert.equal(parsePriceInput('249,90 €'), 249.9);
  assert.equal(parsePriceInput('1.299'), 1299);
  assert.equal(parsePriceInput('1.299,50'), 1299.5);
  assert.equal(parsePriceInput('249.90'), 249.9);
  assert.equal(parsePriceInput(' '), null);
  assert.equal(parsePriceInput('billig'), undefined);
  assert.equal(parsePriceInput('0'), undefined);
});

test('receipt detail: price moves, wish price, hidden, added with its price', () => {
  const card = fold();
  const fmt = (n: number) => `${n} €`;
  const patch = diffStates(card.versions[2].state, card.versions[3].state);
  assert.deepEqual(watchChangeDetail(patch.find((c) => c.id === 'xm5')!, fmt), { before: '249 €', after: '239 €' });
  const user = diffStates(card.versions[0].state, card.versions[1].state);
  assert.deepEqual(watchChangeDetail(user[0], fmt), { before: '', after: '249 €', flag: 'target' });
  const added = diffStates(card.versions[1].state, card.versions[2].state).find((c) => c.kind === 'added')!;
  assert.deepEqual(watchChangeDetail(added, fmt), { after: '259 €' });
  const s = headOf(card).state;
  const hid = diffStates(s, { ...s, items: s.items.map((i) => (i.id === 'qc' ? { ...i, hidden: true } : i)) })[0];
  assert.deepEqual(watchChangeDetail(hid, fmt), { flag: 'hidden' });
});
