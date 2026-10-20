import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatMessage } from '../hermes/types.ts';
import type { HuiChecklist, HuiProducts, HuiTabs } from '../protocol/types.ts';
import { decodeOp, encodeOp } from './codec.ts';
import { deriveCards } from './derive.ts';
import { hermesMayHaveLost, SNAPSHOT_AFTER_MESSAGES, transcriptBids } from './extract.ts';
import { EMPTY_RECORD } from './localStore.ts';
import { applyOps, foldLive, headOf, patchesSinceFull, snapshotOps, stateAt, type LiveEvent, type LiveOp } from './model.ts';
import { fullFromNode } from './nodes.ts';
import { compactOps, pruneInflight, rebasePending } from './pending.ts';
import { budgetBatch, splitLiveTrailer, withLiveTrailer } from './trailer.ts';

const list = (items: object[], extra: object = {}): LiveEvent => ({ kind: 'hermes', key: 'ha-1', at: 1, full: fullFromNode({ type: 'checklist', id: 'einkauf', live: true, title: 'Einkauf', items, ...extra } as HuiChecklist)! });
const patch = (key: string, ops: unknown[], card = 'einkauf'): LiveEvent => ({ kind: 'patch', key, at: 2, card, ops: ops.map(decodeOp).filter((o): o is LiveOp => !!o) });
const V1 = [
  { id: 'tomaten', text: 'Tomaten', qty: 6 },
  { id: 'mozzarella', text: 'Mozzarella' },
  { id: 'senf', text: 'Senf', note: 'mittelscharf' },
];

test('a patch applies its ops as a new version: add after an item, delete, set; ticks survive', () => {
  const f = foldLive([
    list(V1),
    { kind: 'user', key: 'hu-2', at: 2, card: 'einkauf', batch: { v: 1, ops: [{ check: 'senf' }], bid: 'b1' } },
    patch('ha-3', [{ add: { id: 'halloumi', text: 'Halloumi', qty: 2, unit: 'Pck.' }, after: 'mozzarella' }, { del: 'tomaten' }, { set: 'senf', note: 'süß' }]),
  ]);
  const card = f.cards.get('einkauf')!;
  const head = headOf(card);
  assert.equal(head.n, 3);
  assert.equal(head.patch, true);
  assert.deepEqual(head.state.items.map((i) => i.id), ['mozzarella', 'halloumi', 'senf']);
  assert.equal(head.state.items[2].note, 'süß');
  assert.equal(head.state.items[2].checked, true);
  assert.deepEqual(f.marks.get('ha-3'), [{ card: 'einkauf', n: 3 }]);
  assert.equal(patchesSinceFull(card), 1);
});

test('a patch for a card the chat never had is no version (the callout stays a callout, marked not applied); ops on unknown items "failed"', () => {
  const f = foldLive([list(V1), patch('ha-2', [{ del: 'nope' }]), patch('ha-3', [{ del: 'senf' }], 'other'), patch('ha-4', [{ check: 'tomaten' }]), patch('ha-5', [{ check: 'tomaten' }])]);
  assert.equal(headOf(f.cards.get('einkauf')!).n, 2);
  // a tick that is already there is "no change", not "failed"
  assert.deepEqual(f.marks.get('ha-5'), [{ card: 'einkauf', n: 2, unchanged: true }]);
  assert.deepEqual(f.marks.get('ha-2'), [{ card: 'einkauf', n: 1, unchanged: true, failed: true }]);
  assert.deepEqual(f.marks.get('ha-3'), [{ card: 'other', n: 0, adopted: 'patch:other', unapplied: true }]);
  assert.equal(f.cards.has('other'), false);
});

test('patches count since the last full version; a full version resets the count', () => {
  const evs: LiveEvent[] = [list(V1)];
  for (let i = 0; i < 10; i++) evs.push(patch(`ha-p${i}`, [{ set: 'senf', note: `n${i}` }]));
  assert.equal(patchesSinceFull(foldLive(evs).cards.get('einkauf')!), 10);
  evs.push({ ...list([...V1, { id: 'brot', text: 'Brot' }]), key: 'ha-full' });
  assert.equal(patchesSinceFull(foldLive(evs).cards.get('einkauf')!), 0);
});

test('codec: node words (title, name, done, bought), a `set` with only `checked` is a tick, clocks normalised, junk dropped', () => {
  assert.deepEqual(decodeOp({ add: { id: 'pantheon', title: 'Pantheon', start: '9:05', end: '2026-11-14T10:30' }, to: 'sa14', after: null }), { add: { id: 'pantheon', text: 'Pantheon', start: '09:05', end: '10:30' }, after: null, to: 'sa14' });
  assert.deepEqual(decodeOp({ add: { id: 'xm5', name: 'WH-1000XM5', price: '239', currency: 'EUR', offers: [{ merchant: 'Shop', url: 'https://example.com/x', price: 239 }, { merchant: 'bad', url: 'javascript:alert(1)' }] } }), {
    add: { id: 'xm5', text: 'WH-1000XM5', price: 239, currency: 'EUR', offers: [{ merchant: 'Shop', url: 'https://example.com/x', price: 239 }] },
  });
  assert.deepEqual(decodeOp({ set: 'milch', checked: true }), { check: 'milch' });
  assert.deepEqual(decodeOp({ done: 'kolosseum' }), { check: 'kolosseum' });
  assert.deepEqual(decodeOp({ set: 'xm5', price: 229, target: null, evil: 1 }), { set: 'xm5', price: 229, target: null });
  assert.deepEqual(decodeOp({ move: 'forum', to: 'so15', after: 'pantheon' }), { move: 'forum', to: 'so15', after: 'pantheon' });
  assert.equal(decodeOp({ set: 'x', start: '25:00' }), undefined);
  assert.equal(decodeOp({ set: '__proto__', note: 'x' }), undefined);
  assert.deepEqual(encodeOp('trip', { add: { id: 'u-a', text: 'Abendessen', start: '19:30', end: '21:00' }, to: 'sa14' }), { add: { id: 'u-a', title: 'Abendessen', start: '19:30', end: '21:00' }, to: 'sa14' });
  assert.deepEqual(encodeOp('products', { set: 'xm5', text: 'Sony' }), { set: 'xm5', name: 'Sony' });
});

// ---- trip --------------------------------------------------------------------------------------------------------

const agenda = (id: string, blocks: object[]) => ({ type: 'agenda', id, blocks });
const trip = (tabs: object[], extra: object = {}): HuiTabs => ({ type: 'tabs', id: 'rom', live: true, title: 'Rom, 13.–15. November', tabs, ...extra }) as unknown as HuiTabs;
const T1 = trip([
  { id: 'sa14', label: 'Sa 14.', children: [agenda('a1', [
    { id: 'kolosseum', start: '09:00', end: '10:30', title: 'Kolosseum' },
    { id: 'forum', start: '11:00', end: '12:30', title: 'Forum Romanum' },
    { id: 'vatikan', start: '15:00', end: '17:00', title: 'Vatikanische Museen' },
  ])] },
  { id: 'so15', label: 'So 15.', children: [agenda('a2', [{ id: 'pantheon', start: '10:00', end: '11:00', title: 'Pantheon' }])] },
  { id: 'karte', label: 'Karte', children: [{ type: 'map', markers: [{ lat: 41.89, lng: 12.49, title: 'Kolosseum' }] }] },
]);

test('trip: day tabs become days, blocks carry their day, the map tab is the card map', () => {
  const full = fullFromNode(T1)!;
  assert.equal(full.type, 'trip');
  assert.deepEqual(full.meta.days, [{ id: 'sa14', label: 'Sa 14.' }, { id: 'so15', label: 'So 15.' }]);
  assert.deepEqual(full.items.map((i) => `${i.id}@${i.day}`), ['kolosseum@sa14', 'forum@sa14', 'vatikan@sa14', 'pantheon@so15']);
  assert.equal(full.meta.map?.markers.length, 1);
  const single = fullFromNode({ type: 'agenda', id: 'samstag', live: true, title: 'Samstag', blocks: [{ id: 'x', start: '09:00', end: '10:00', title: 'X' }] } as never)!;
  assert.deepEqual(single.meta.days, [{ id: 'd1', label: 'Samstag' }]);
});

test('trip: the user ticks a block and adds an own note; a later full version moves blocks and keeps both', () => {
  const T2 = trip([
    { id: 'sa14', label: 'Sa 14.', children: [agenda('a1', [
      { id: 'kolosseum', start: '09:00', end: '10:30', title: 'Kolosseum' },
      { id: 'vatikan', start: '11:00', end: '13:00', title: 'Vatikanische Museen', note: 'Regen ab Mittag' },
      { id: 'forum', start: '15:30', end: '17:00', title: 'Forum Romanum' },
    ])] },
    { id: 'so15', label: 'So 15.', children: [agenda('a2', [{ id: 'pantheon', start: '10:00', end: '11:00', title: 'Pantheon' }])] },
  ]);
  const f = foldLive([
    { kind: 'hermes', key: 'ha-1', at: 1, full: fullFromNode(T1)! },
    { kind: 'user', key: 'hu-2', at: 2, card: 'rom', batch: { v: 1, ops: [{ check: 'kolosseum' }, { set: 'vatikan', userNote: 'Tickets online' }], bid: 'b1' } },
    { kind: 'hermes', key: 'ha-3', at: 3, full: fullFromNode(T2)! },
  ]);
  const s = headOf(f.cards.get('rom')!).state;
  const by = new Map(s.items.map((i) => [i.id, i]));
  assert.equal(by.get('kolosseum')?.checked, true);
  assert.equal(by.get('vatikan')?.start, '11:00');
  assert.equal(by.get('vatikan')?.userNote, 'Tickets online');
  assert.equal(by.get('forum')?.start, '15:30');
  assert.equal(s.map, undefined); // the map tab is gone in v3
});

test('trip: move between days, a removed day takes its blocks', () => {
  const s1 = headOf(foldLive([{ kind: 'hermes', key: 'ha-1', at: 1, full: fullFromNode(T1)! }]).cards.get('rom')!).state;
  const moved = applyOps(s1, [{ move: 'forum', to: 'so15', after: 'pantheon' }]).state;
  assert.deepEqual(moved.items.filter((i) => i.day === 'so15').map((i) => i.id), ['pantheon', 'forum']);
  const gone = applyOps(s1, [{ meta: { days: [{ id: 'sa14', label: 'Sa 14.' }] } }]).state;
  assert.deepEqual(gone.items.map((i) => i.id), ['kolosseum', 'forum', 'vatikan']);
});

// ---- watchlist ---------------------------------------------------------------------------------------------------

const watch = (products: object[]): LiveEvent => ({ kind: 'hermes', key: `ha-${JSON.stringify(products).length}`, at: 1, full: fullFromNode({ type: 'products', id: 'kopfhoerer', live: true, title: 'Kopfhörer-Watchlist', products } as unknown as HuiProducts)! });

test('watchlist: the wish price is the user\'s: a price update from Hermes keeps it, versions give the price history', () => {
  const f = foldLive([
    watch([{ id: 'xm5', name: 'WH-1000XM5', price: 269 }, { id: 'qc', name: 'QC Ultra', price: 349 }]),
    { kind: 'user', key: 'hu-2', at: 2, card: 'kopfhoerer', batch: { v: 1, ops: [{ set: 'xm5', target: 249 }], bid: 'b1' } },
    watch([{ id: 'xm5', name: 'WH-1000XM5', price: 239 }, { id: 'qc', name: 'QC Ultra', price: 349 }]),
  ]);
  const card = f.cards.get('kopfhoerer')!;
  assert.equal(card.type, 'products');
  const xm5 = headOf(card).state.items.find((i) => i.id === 'xm5')!;
  assert.equal(xm5.price, 239);
  assert.equal(xm5.target, 249);
  assert.deepEqual(card.versions.map((v) => v.state.items.find((i) => i.id === 'xm5')?.price), [269, 269, 239]);
});

test('same id, other type: another card (never a mixed fold)', () => {
  const f = foldLive([list(V1), { kind: 'hermes', key: 'ha-9', at: 9, full: { ...fullFromNode(T1)!, id: 'einkauf' } }]);
  assert.deepEqual([...f.cards.keys()], ['einkauf', 'einkauf-2']);
  assert.deepEqual(f.marks.get('ha-9'), [{ card: 'einkauf-2', n: 1, node: 'einkauf' }]);
});

// ---- "Auf vN zurück" ---------------------------------------------------------------------------------------------

test('revert: ops from the current view back to vN restore items, fields and ticks', () => {
  const f = foldLive([
    list(V1),
    patch('ha-2', [{ add: { id: 'grillkohle', text: 'Grillkohle' } }, { del: 'tomaten' }, { set: 'senf', note: 'süß' }]),
    { kind: 'user', key: 'hu-3', at: 3, card: 'einkauf', batch: { v: 2, ops: [{ check: 'mozzarella' }], bid: 'b' } },
  ]);
  const card = f.cards.get('einkauf')!;
  const ops = snapshotOps(headOf(card).state, stateAt(card, 1));
  const back = applyOps(headOf(card).state, ops).state;
  assert.deepEqual(back.items.map((i) => i.id), ['tomaten', 'mozzarella', 'senf']);
  assert.equal(back.items[2].note, 'mittelscharf');
  assert.equal(back.items[1].checked, undefined);
  // as pending edits they rebase like any other
  const view = rebasePending(card, { base: 3, ops, bid: 'b2' });
  assert.deepEqual(view.state.items, back.items);
});

// ---- "Als Live-Karte weiterführen" -------------------------------------------------------------------------------

test('a user batch with create + state makes the card (v1 by the user); a second copy with the same bid is ignored', () => {
  const state = { title: 'Packliste', items: [{ id: 'pass', text: 'Pass', checked: true as const }, { id: 'adapter', text: 'Adapter' }] };
  const f = foldLive([
    { kind: 'user', key: 'hu-1', at: 1, card: 'packliste', batch: { v: 0, create: 'checklist', state, bid: 'b-c' } },
    { kind: 'user', key: 'local:packliste', at: 2, card: 'packliste', batch: { v: 0, create: 'checklist', state, bid: 'b-c' } },
    patch('ha-2', [{ add: { id: 'sonnencreme', text: 'Sonnencreme' } }], 'packliste'),
  ]);
  const card = f.cards.get('packliste')!;
  assert.deepEqual(card.versions.map((v) => [v.n, v.author, v.key]), [[1, 'user', 'hu-1'], [2, 'hermes', 'ha-2']]);
  assert.equal(headOf(card).state.items.find((i) => i.id === 'pass')?.checked, true);
  assert.deepEqual(f.marks.get('hu-1'), [{ card: 'packliste', n: 1, created: true, sent: [] }]);
  // without `create` an unknown card stays unknown
  assert.equal(foldLive([{ kind: 'user', key: 'hu-1', at: 1, card: 'x', batch: { v: 0, state } }]).cards.size, 0);
});

test('a local first version is "local" until the transcript has its bid; then the create record goes', () => {
  const state = { title: 'Packliste', items: [{ id: 'pass', text: 'Pass' }] };
  const p = { base: 1, ops: [], bid: 'b-c', create: { type: 'checklist' as const, state, at: 5, bid: 'b-c' } };
  const local = foldLive([{ kind: 'user', key: 'local:packliste', at: 5, card: 'packliste', batch: { v: 0, create: 'checklist', state, bid: 'b-c' } }]);
  assert.equal(deriveCards(local, { ...EMPTY_RECORD, pending: { packliste: p } })[0].local, true);
  assert.equal(pruneInflight(p, new Set(['b-c'])), undefined);
  assert.equal(pruneInflight(p, new Set(['other'])), p);
});

test('trailer: a created card goes as create + state in the card type\'s words, and decodes back', () => {
  const view = { title: 'Rom', days: [{ id: 'sa14', label: 'Sa 14.' }], items: [{ id: 'k', text: 'Kolosseum', day: 'sa14', start: '09:00', end: '10:30' }] };
  const { batch } = budgetBatch({ v: 0, ops: [], bid: 'b1', create: 'trip' }, view, 'trip');
  const sent = withLiveTrailer('Mach daraus eine Live-Karte', { rom: batch }, { rom: 'trip' });
  assert.match(sent, /"create":"trip","state":\{"title":"Rom","days":\[\{"id":"sa14","label":"Sa 14\."\}\],"items":\[\{"id":"k","title":"Kolosseum"/);
  assert.deepEqual(splitLiveTrailer(sent).batches?.rom, { v: 0, create: 'trip', state: view, bid: 'b1' });
});

// ---- context: Hermes may have lost the card ----------------------------------------------------------------------

const msg = (id: string, role: 'user' | 'assistant', extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, role, text: 'x', tools: [], status: 'done', createdAt: 1, ...extra });

test('snapshot trigger: more than 20 messages after the last full state, or a compaction after it', () => {
  const f = foldLive([list(V1)]);
  const card = f.cards.get('einkauf')!;
  const chat = [msg('hu-0', 'user'), msg('ha-1', 'assistant')];
  for (let i = 0; i < SNAPSHOT_AFTER_MESSAGES; i++) chat.push(msg(`m${i}`, i % 2 ? 'assistant' : 'user'));
  assert.equal(hermesMayHaveLost(chat, card), false);
  assert.equal(hermesMayHaveLost([...chat, msg('late', 'user')], card), true);
  assert.equal(hermesMayHaveLost([msg('hu-0', 'user'), msg('ha-1', 'assistant'), msg('hu-2', 'user', { contextCut: true })], card), true);
  // a patch is not a full state: it does not reset the count; a user snapshot does
  const withSnap = foldLive([list(V1), { kind: 'user', key: 'hu-s', at: 2, card: 'einkauf', batch: { v: 1, state: { items: V1.slice(1) }, bid: 'bs' } }]).cards.get('einkauf')!;
  assert.equal(hermesMayHaveLost([...chat, msg('late', 'user'), msg('hu-s', 'user')], withSnap), false);
});

test('budget: `snapshot` sends the whole card even when the ops would fit', () => {
  const view = { title: 'Einkauf', items: [{ id: 'milch', text: 'Milch', checked: true }] };
  assert.deepEqual(budgetBatch({ v: 4, ops: [{ check: 'milch' }], bid: 'b', snapshot: true }, view).batch, { v: 4, state: view, bid: 'b' });
  assert.deepEqual(budgetBatch({ v: 4, ops: [{ check: 'milch' }], bid: 'b' }, view).batch, { v: 4, ops: [{ check: 'milch' }], bid: 'b' });
});

test('compaction keeps moves (last one wins) and the place of an own new item', () => {
  const ref = { items: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] };
  assert.deepEqual(compactOps([{ move: 'a', after: 'b' }, { move: 'a', to: 'so', after: null }], ref), [{ move: 'a', to: 'so', after: null }]);
  assert.deepEqual(compactOps([{ add: { id: 'u-1', text: 'X' }, after: 'a' }, { move: 'u-1', after: null }], ref), [{ add: { id: 'u-1', text: 'X' }, after: null }]);
});

test('a local first version is never pruned by its own bid: only user messages in the transcript count', () => {
  const state = { title: 'Packliste', items: [{ id: 'pass', text: 'Pass' }] };
  const p = { base: 1, ops: [], bid: 'b-c', create: { type: 'checklist' as const, state, at: 5, bid: 'b-c' } };
  const f = foldLive([{ kind: 'user', key: 'local:packliste', at: 5, card: 'packliste', batch: { v: 0, create: 'checklist', state, bid: 'b-c' } }]);
  assert.equal(f.bids.has('b-c'), true); // the fold knows it (dedupe against the sent copy) …
  const chat = [msg('hu-1', 'user'), msg('ha-1', 'assistant')];
  assert.equal(pruneInflight(p, transcriptBids(chat)), p); // … but it is not in the transcript yet
  const sent = [...chat, msg('hu-2', 'user', { live: { packliste: { v: 0, create: 'checklist', state, bid: 'b-c' } } })];
  assert.equal(pruneInflight(p, transcriptBids(sent)), undefined);
});
