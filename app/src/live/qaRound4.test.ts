// 0.3 real-user round 4 on the released 0.2.0 (default bridge, skill 0.7.1): live cards from natural chat. The
// transcripts are verbatim (qaRound4.fixtures.ts). Shopping (P2): the user made Hermes' ```checklist answer a live card;
// every later version came as the same typed ```checklist fence (id `shopping-saturday`, no `hui`, no "live"). The
// chat showed the new lists, the card stayed Milch/Brot/Tomaten and each answer said "„Einkaufsliste Samstag“ wurde
// nicht geändert": the fold's cheap text check only knew ```hui fences.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatMessage } from '../hermes/types.ts';
import { parseMessage } from '../protocol/streamParser.ts';
import { liveEventsOf, mayCarryPlainNode } from './extract.ts';
import { diffStates, foldLive, headOf, progressOf, resolvePatchIds, type LiveFold, type UserBatch } from './model.ts';
import type { FixtureMessage } from './qaRound2.fixtures.ts';
import { QA_ROUND4 } from './qaRound4.fixtures.ts';

const chat = (msgs: readonly FixtureMessage[]): ChatMessage[] =>
  msgs.map((m) => ({ id: m.id, role: m.role, text: m.text, tools: [], status: 'done', createdAt: m.createdAt, ...(m.live ? { live: m.live as Record<string, UserBatch> } : {}) }));
const fold = (messages: readonly ChatMessage[]): LiveFold => foldLive(liveEventsOf(messages, (m) => parseMessage(m.text)));
const texts = (f: LiveFold, card: string) => headOf(f.cards.get(card)!).state.items.map((it) => `${it.text}${it.checked ? ' ✓' : ''}`);

const SHOP = QA_ROUND4.shopping;

test('R4 shopping: typed ```checklist fences with the card id continue the live card', () => {
  const f = fold(chat(SHOP));
  const card = f.cards.get('shopping-saturday')!;
  assert.ok(card, 'the card made from the first list');
  // v1 the user's card, v2 Hermes (+Hafermilch +Äpfel −Milch), v3 Hermes (−Tomaten), v4 the user's tick, v5 Hermes
  // (Brot moved behind the open items)
  assert.deepEqual(card.versions.map((v) => [v.n, v.author]), [[1, 'user'], [2, 'hermes'], [3, 'hermes'], [4, 'user'], [5, 'hermes']]);
  assert.deepEqual(texts(f, 'shopping-saturday'), ['Hafermilch', 'Äpfel', 'Brot ✓']);
  assert.deepEqual(progressOf(headOf(card).state), { done: 1, total: 3 });
  const v2 = diffStates(card.versions[0].state, card.versions[1].state).map((c) => `${c.kind} ${c.text}`);
  assert.deepEqual(v2.sort(), ['added Hafermilch', 'added Äpfel', 'removed Milch'].sort(), 'the receipt names what Hermes said it did');
  const v3 = diffStates(card.versions[1].state, card.versions[2].state).map((c) => `${c.kind} ${c.text}`);
  assert.deepEqual(v3, ['removed Tomaten']);
});

test('R4 shopping: no answer that carried a list is marked "nicht geändert"', () => {
  const f = fold(chat(SHOP));
  const quiet = SHOP.filter((m) => m.role === 'assistant').filter((m) => f.marks.get(m.id)?.some((k) => k.quiet));
  assert.deepEqual(quiet.map((m) => m.id), []);
  // the last answer repeats the card as it is: an unchanged version, not "not changed"
  const last = SHOP[SHOP.length - 1];
  assert.deepEqual(f.marks.get(last.id)?.map((k) => [k.card, k.unchanged === true, k.quiet === true]), [['shopping-saturday', true, false]]);
});

test('R4 shopping: the cheap check knows typed fences, not only ```hui', () => {
  for (const m of SHOP.filter((x) => x.role === 'assistant')) assert.equal(mayCarryPlainNode(m.text), true, m.id);
  assert.equal(mayCarryPlainNode('```agenda\n{"items":[]}\n```'), true);
  assert.equal(mayCarryPlainNode('```products\n{"items":[]}\n```'), true);
  // prose about a checklist, code in another language: no
  assert.equal(mayCarryPlainNode('Ich habe dir eine checklist mit items gemacht.'), false);
  assert.equal(mayCarryPlainNode('```json\n{"items":[]}\n```'), false);
});

test('R4 shopping: every device folds the same transcript to the same card', () => {
  const a = fold(chat(SHOP));
  const b = fold(chat(SHOP).map((m, i) => ({ ...m, createdAt: 1000 + i })));
  assert.deepEqual(headOf(b.cards.get('shopping-saturday')!).state, headOf(a.cards.get('shopping-saturday')!).state);
});

// Watchlist: Hermes' first version had no item ids (the app hashes them); its patch then named ids made up from the
// names. Before: "Nicht übernommen: Diese Einträge gibt es in der Karte nicht." under the patch, the card kept the
// iPhone until the next full version.
const WATCH = QA_ROUND4.watchlist;

test('R4 watchlist: a patch naming items by made-up ids applies when the name fits exactly one item', () => {
  const f = fold(chat(WATCH));
  const card = f.cards.get('phone_watchlist')!;
  assert.ok(card);
  const patch = WATCH[3];
  assert.deepEqual(f.marks.get(patch.id)?.map((k) => [k.card, k.n, k.failed === true]), [['phone_watchlist', 2, false]]);
  assert.equal(card.versions[1].patch, true);
  assert.deepEqual(card.versions[1].state.items.map((it) => `${it.text} | ${it.note}`), ['Pixel 9 | Zielpreis: 450 €']);
  // the next full version says the same: no new version
  assert.deepEqual(f.marks.get(WATCH[5].id)?.map((k) => [k.n, k.unchanged === true]), [[2, true]]);
});

test('R4 watchlist: an id that fits no item or several stays unknown (never guessed)', () => {
  const state = { items: [{ id: 'h1', text: 'Pixel 9' }, { id: 'h2', text: 'Pixel 9 Pro' }, { id: 'h3', text: 'Pixel-9' }] };
  assert.deepEqual(resolvePatchIds(state, [{ del: 'pixel9' }]), [{ del: 'pixel9' }], 'two items are called pixel9');
  assert.deepEqual(resolvePatchIds(state, [{ del: 'pixel9pro' }]), [{ del: 'h2' }]);
  assert.deepEqual(resolvePatchIds(state, [{ set: 'pixel-9-pro', note: 'x' }]), [{ set: 'h2', note: 'x' }]);
  assert.deepEqual(resolvePatchIds(state, [{ check: 'iphone' }]), [{ check: 'iphone' }]);
  assert.deepEqual(resolvePatchIds(state, [{ check: 'h1' }]), [{ check: 'h1' }], 'a known id stays');
});

// Packing (English): v1 Hermes (raincoat, charger, socks, toothbrush), v2 Hermes' patch (−raincoat +umbrella +towel),
// the user's tick on the charger with "Keep completed items on the card please.", then a full version that copied v1
// and listed the raincoat again. Its text names only umbrella, socks and toothbrush. Before: v4 "+ Raincoat".
const PACK = QA_ROUND4.packing;

test('R4 packing: a full version that lists a removed item again unasked does not bring it back, and says so', () => {
  const f = fold(chat(PACK));
  const card = f.cards.get('london-packing')!;
  assert.deepEqual(texts(f, 'london-packing'), ['Charger ✓', 'Socks', 'Toothbrush', 'Umbrella', 'Small towel']);
  const last = PACK[PACK.length - 1];
  const mark = f.marks.get(last.id)!;
  assert.deepEqual(mark.map((k) => [k.card, k.withheld]), [['london-packing', ['Raincoat']]]);
  // the tick stays, nothing else changed: the answer's version is no version
  assert.equal(mark[0].unchanged, true);
  assert.deepEqual(card.versions.map((v) => [v.n, v.author]), [[1, 'hermes'], [2, 'hermes'], [3, 'user']]);
});

test('R4 packing: a removed item comes back when the user or the answer names it', () => {
  const back = (userText: string, answerText: string) => {
    const msgs = chat(PACK).map((m, i) => (i === PACK.length - 2 ? { ...m, text: userText } : i === PACK.length - 1 ? { ...m, text: m.text.replace('Charger is done. You still need umbrella, socks, and toothbrush.', answerText) } : m));
    return texts(fold(msgs), 'london-packing');
  };
  assert.ok(back('I ticked the charger. Put the raincoat back on, it will rain.', 'Done.').includes('Raincoat'));
  assert.ok(back('I ticked the charger.', 'The raincoat is back on the list.').includes('Raincoat'));
  assert.ok(!back('I ticked the charger. Remove the raincoat for good.', 'Done.').includes('Raincoat'), 'named as a removal');
  assert.ok(!back('I ticked the charger.', 'You still need umbrella, socks, and toothbrush.').includes('Raincoat'));
});

test('R4 packing: devices fold alike; the tick is never lost', () => {
  const a = fold(chat(PACK));
  const b = fold(chat(PACK).map((m, i) => ({ ...m, createdAt: 5 + i })));
  assert.deepEqual(headOf(b.cards.get('london-packing')!).state, headOf(a.cards.get('london-packing')!).state);
  assert.equal(headOf(a.cards.get('london-packing')!).state.items.find((it) => it.id === 'charger')?.checked, true);
});
