import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HuiChecklist } from '../protocol/types.ts';
import { cardLevelChange, deriveCards, trayCards } from './derive.ts';
import { EMPTY_RECORD } from './localStore.ts';
import { foldLive, type LiveEvent, type LiveItem } from './model.ts';
import { fullFromNode } from './nodes.ts';

const V1: LiveItem[] = [
  { id: 'tomaten', text: 'Tomaten' },
  { id: 'milch', text: 'Milch' },
];
const card = (id: string, items: LiveItem[], at: number, extra: Partial<HuiChecklist> = {}): LiveEvent => ({ kind: 'hermes', key: `ha-${id}-${at}`, at, full: fullFromNode({ type: 'checklist', id, live: true, title: id, items, ...extra } as HuiChecklist)! });

test('newest change first; tray takes pinned open cards, at most three', () => {
  const fold = foldLive([card('a', V1, 1), card('b', V1, 2), card('c', V1, 3), card('d', V1, 4), card('e', V1, 5, { closed: true })]);
  const cards = deriveCards(fold, { ...EMPTY_RECORD, unpinned: ['d'] });
  assert.deepEqual(cards.map((c) => c.id), ['e', 'd', 'c', 'b', 'a']);
  const tray = trayCards(cards);
  assert.deepEqual(tray.rows.map((c) => c.id), ['c', 'b', 'a']);
  assert.equal(tray.more, 0);
});

test('"neu" = what Hermes added/changed since the version last looked at; removed items offered once', () => {
  const fold = foldLive([card('a', V1, 1), card('a', [{ id: 'milch', text: 'Milch', qty: 2 }, { id: 'kohle', text: 'Grillkohle' }], 2)]);
  const [c] = deriveCards(fold, EMPTY_RECORD);
  assert.deepEqual([...c.fresh].sort(), ['kohle', 'milch']);
  assert.equal(c.unread, true);
  assert.deepEqual(c.removed.map((i) => i.id), ['tomaten']);
  assert.equal(c.removedIn, 2);
  const [seen] = deriveCards(fold, { ...EMPTY_RECORD, seen: { a: 2 } });
  assert.equal(seen.fresh.size, 0);
  assert.equal(seen.unread, false);
  // brought back (pending add): no longer offered
  const [back] = deriveCards(fold, { ...EMPTY_RECORD, pending: { a: { base: 2, ops: [{ add: { id: 'tomaten', text: 'Tomaten' } }], bid: 'b-test' } } });
  assert.equal(back.removed.length, 0);
  assert.equal(back.pendingCount, 1);
});

test('a fresh v1 card is not unread and has nothing "neu"', () => {
  const [c] = deriveCards(foldLive([card('a', V1, 1)]), EMPTY_RECORD);
  assert.equal(c.unread, false);
  assert.equal(c.fresh.size, 0);
  assert.deepEqual(c.progress, { done: 0, total: 2 });
});

test('own sent edits never raise the "new version" dot; a later Hermes version does', () => {
  const ev = (key: string, v: number, ops: unknown[], bid: string): LiveEvent => ({ kind: 'user', key, at: 9, card: 'a', batch: { v, ops: ops as never, bid } });
  const fold = foldLive([card('a', V1, 1), ev('hu-2', 1, [{ check: 'milch' }], 'b-own')]);
  assert.equal(deriveCards(fold, { ...EMPTY_RECORD, own: ['b-own'] })[0].unread, false);
  assert.equal(deriveCards(fold, EMPTY_RECORD)[0].unread, true); // the same edit seen on another device
  const later = foldLive([card('a', V1, 1), ev('hu-2', 1, [{ check: 'milch' }], 'b-own'), card('a', [...V1, { id: 'kohle', text: 'Grillkohle' }], 3)]);
  assert.equal(deriveCards(later, { ...EMPTY_RECORD, own: ['b-own'] })[0].unread, true);
});

test('a version that changed no item says what it changed (receipt never blank): order, card fields, close', () => {
  assert.equal(cardLevelChange([{ order: ['milch', 'brot'] }]), 'order');
  assert.equal(cardLevelChange([{ meta: { title: 'Einkauf (zu zweit)' } }, { order: ['a'] }]), 'meta');
  assert.equal(cardLevelChange([{ close: true }]), 'closed');
  assert.equal(cardLevelChange([{ check: 'milch' }]), undefined);
});
