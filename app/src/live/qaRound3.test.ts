// 0.2 real-user round 3 (default bridge, claude-haiku-4-5): live cards from natural chat. The transcripts are verbatim
// (qaRound3.fixtures.ts). R3-02: the user ticked "Brot" on the live card, the tick rode along with "Ja, Tomaten
// streichen. Brot habe ich gerade abgehakt.", Hermes answered with a plain list of only the open items and the card lost
// the bread ("In v4 entfernt: Brot, Tomaten"). R3-01: the watchlist's target prices came as `trailing` and vanished.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatMessage } from '../hermes/types.ts';
import { parseMessage } from '../protocol/streamParser.ts';
import { liveEventsOf } from './extract.ts';
import { removalAsked } from './focus.ts';
import { applyOps, diffFull, diffStates, foldLive, headOf, progressOf, type LiveCardState, type LiveFold, type UserBatch } from './model.ts';
import type { FixtureMessage } from './qaRound2.fixtures.ts';
import { QA_ROUND3 } from './qaRound3.fixtures.ts';

const chat = (msgs: readonly FixtureMessage[]): ChatMessage[] =>
  msgs.map((m) => ({ id: m.id, role: m.role, text: m.text, tools: [], status: 'done', createdAt: m.createdAt, ...(m.live ? { live: m.live as Record<string, UserBatch> } : {}) }));
const fold = (messages: readonly ChatMessage[]): LiveFold => foldLive(liveEventsOf(messages, (m) => parseMessage(m.text)));
const texts = (f: LiveFold, card: string) => headOf(f.cards.get(card)!).state.items.map((it) => `${it.text}${it.checked ? ' ✓' : ''}`);
const msg = (id: string, role: 'user' | 'assistant', text: string, live?: Record<string, UserBatch>): ChatMessage => ({ id, role, text, tools: [], status: 'done', createdAt: 9e12, ...(live ? { live } : {}) });

const SHOP = QA_ROUND3.shopping;

test('R3-02 real transcript: the ticked bread stays on the card as done, only the tomatoes go', () => {
  const f = fold(chat(SHOP));
  const card = f.cards.get('shopping-saturday')!;
  assert.ok(card, 'the card made from the list');
  // v1 the user's card, v2 Hermes' list (+Hafermilch +Äpfel −Milch), v3 the user's tick, v4 Hermes' list of open items
  assert.deepEqual(card.versions.map((v) => [v.n, v.author]), [[1, 'user'], [2, 'hermes'], [3, 'user'], [4, 'hermes']]);
  assert.deepEqual(texts(f, 'shopping-saturday'), ['Hafermilch', 'Brot ✓', 'Äpfel']);
  assert.deepEqual(progressOf(headOf(card).state), { done: 1, total: 3 });
  const v4 = diffStates(card.versions[2].state, card.versions[3].state);
  assert.deepEqual(v4.map((c) => `${c.kind} ${c.text}`), ['removed Tomaten'], 'the receipt names only the tomatoes');
});

test('R3-02: every device folds the same transcript to the same card (no clock, no device in the decision)', () => {
  const a = fold(chat(SHOP));
  // another device: other local clock values, the same transcript order
  const b = fold(chat(SHOP).map((m, i) => ({ ...m, createdAt: 1000 + i })));
  assert.deepEqual(headOf(b.cards.get('shopping-saturday')!).state, headOf(a.cards.get('shopping-saturday')!).state);
});

test('R3-02: a ticked item goes when the user asks for it, or by an explicit delete', () => {
  const upToTick = chat(SHOP.slice(0, 7)); // … the user's message with the tick
  const list = (items: string[]) => '```hui\n' + JSON.stringify({ type: 'checklist', id: 'shopping_saturday', title: 'Einkaufsliste Samstag', items: items.map((text) => ({ text })) }) + '\n```';
  const withTurn = (text: string) => {
    const msgs = upToTick.slice();
    msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], text };
    return fold([...msgs, msg('a-x', 'assistant', `Erledigt.\n\n${list(['Hafermilch', 'Äpfel'])}`)]);
  };
  assert.deepEqual(texts(withTurn('Brot habe ich, kannst du streichen. Tomaten auch.'), 'shopping-saturday'), ['Hafermilch', 'Äpfel']);
  assert.deepEqual(texts(withTurn('Bitte das Erledigte von der Liste löschen und Tomaten streichen'), 'shopping-saturday'), ['Hafermilch', 'Äpfel']);
  // the report's wording: removal of the tomatoes, the bread was only ticked
  assert.deepEqual(texts(withTurn('Ja, Tomaten streichen. Brot habe ich gerade abgehakt.'), 'shopping-saturday'), ['Hafermilch', 'Brot ✓', 'Äpfel']);
  // a patch that deletes it
  const patch = '```hui\n{"type":"callout","tone":"info","text":"− Brot","livePatch":{"card":"shopping-saturday","ops":[{"del":"brot"}]}}\n```';
  assert.deepEqual(texts(fold([...upToTick, msg('a-p', 'assistant', `Brot ist weg.\n\n${patch}`)]), 'shopping-saturday'), ['Hafermilch', 'Tomaten', 'Äpfel']);
});

test('R3-02: kept ticked items keep their place; an open item left out still goes; a user snapshot is the whole truth', () => {
  const base: LiveCardState = { items: [{ id: 'a', text: 'Milch' }, { id: 'b', text: 'Brot', checked: true }, { id: 'c', text: 'Eier' }, { id: 'd', text: 'Käse', checked: true }] };
  const ops = diffFull(base, { items: [{ text: 'Butter' }, { text: 'Eier' }] });
  assert.deepEqual(ops.filter((o) => 'del' in o), [{ del: 'a' }]);
  // Brot first (nothing before it stayed), Käse right behind Eier
  assert.deepEqual(applyOps(base, ops).state.items.map((it) => it.text), ['Brot', 'Butter', 'Eier', 'Käse']);
  // the user's own snapshot (authoritative) may drop ticked items
  assert.deepEqual(diffFull(base, { items: [{ id: 'c', text: 'Eier' }] }, { authoritative: true }).filter((o) => 'del' in o), [{ del: 'a' }, { del: 'b' }, { del: 'd' }]);
});

test('R3-02: removal phrases name the right ticked items', () => {
  const items = [{ id: 'milch', text: 'Milch' }, { id: 'brot', text: 'Brot' }, { id: 'tomate', text: 'Tomaten (6)' }];
  const ids = (t: string) => [...removalAsked(t, items)].sort();
  assert.deepEqual(ids('Ja, Tomaten streichen. Brot habe ich gerade abgehakt.'), ['tomate']);
  assert.deepEqual(ids('Hafermilch statt Milch, die normale Milch raus'), ['milch']);
  assert.deepEqual(ids('Noch Hafermilch dazu bitte'), []);
  assert.deepEqual(ids('Brot abgehakt, Tomate löschen'), ['tomate']);
  assert.deepEqual(ids('Brot habe ich, kannst du streichen'), ['brot']);
  assert.deepEqual(ids('Alles Erledigte streichen bitte'), ['brot', 'milch', 'tomate']);
  assert.deepEqual(ids('Clear the checked items'), ['brot', 'milch', 'tomate']);
  assert.deepEqual(ids('I bought the bread, what is missing?'), []);
  assert.deepEqual(ids('Quita el pan y la leche'), [], 'Spanish nouns are not the German item names');
  assert.deepEqual([...removalAsked('Remove the bread and the eggs', [{ id: 'bread', text: 'Bread' }, { id: 'milk', text: 'Milk' }])], ['bread']);
  assert.deepEqual([...removalAsked('Quita el pan, por favor', [{ id: 'pan', text: 'Pan integral' }])], ['pan']);
});

test('R3-02: a list of only the open items still continues a card whose other items are ticked', () => {
  const create = { 'packing': { v: 0, create: 'checklist', state: { title: 'Packliste', items: [{ id: 'charger', text: 'Charger' }, { id: 'socks', text: 'Socks' }, { id: 'passport', text: 'Passport' }, { id: 'brush', text: 'Toothbrush' }] }, bid: 'b-1' } } as unknown as Record<string, UserBatch>;
  const f = fold([
    msg('u1', 'user', 'Make it a live card', create),
    msg('a1', 'assistant', 'Ok.'),
    msg('u2', 'user', 'I packed most of it. What is still missing?', { packing: { v: 1, ops: [{ check: 'charger' }, { check: 'passport' }, { check: 'socks' }], bid: 'b-2' } }),
    msg('a2', 'assistant', 'Only the toothbrush, plus a rain jacket:\n\n```hui\n{"type":"checklist","id":"trip_packing","items":[{"text":"Toothbrush"},{"text":"Rain jacket"}]}\n```'),
  ]);
  assert.deepEqual(texts(f, 'packing'), ['Charger ✓', 'Socks ✓', 'Passport ✓', 'Toothbrush', 'Rain jacket']);
});

test('R3-01 real transcript: the watchlist keeps its target prices (`trailing`) in every version', () => {
  const f = fold(chat(QA_ROUND3.watchlist));
  const card = f.cards.get('phone-watchlist')!;
  assert.equal(card.type, 'checklist');
  assert.deepEqual(card.versions[0].state.items.map((it) => [it.text, it.note]), [['iPhone 16', 'Ziel: 600€'], ['Pixel 9', 'Ziel: 500€']]);
  assert.deepEqual(headOf(card).state.items.map((it) => [it.text, it.note]), [['Pixel 9', 'Ziel: 450€']]);
  // the receipt shows the change of the target, not only the removal
  const v2 = diffStates(card.versions[0].state, headOf(card).state);
  assert.deepEqual(v2.map((c) => c.kind), ['changed', 'removed']);
  assert.deepEqual(v2[0].fields?.note, ['Ziel: 500€', 'Ziel: 450€']);
});

test('R3-01: a live product watchlist takes the target price the user named; a version without it keeps it', () => {
  const block = (products: unknown[]) => '```hui\n' + JSON.stringify({ type: 'products', id: 'phones', live: true, title: 'Watchlist', products }) + '\n```';
  const f = fold([
    msg('u1', 'user', 'iPhone 16 und Pixel 9 auf die Watchlist, Ziel 600 und 500 Euro'),
    msg('a1', 'assistant', `Beide sind drauf.\n\n${block([{ id: 'iphone-16', name: 'iPhone 16', target: 600, currency: 'EUR' }, { id: 'pixel-9', name: 'Pixel 9', target: 500, currency: 'EUR' }])}`),
    msg('u2', 'user', 'Beim Pixel ist mein Ziel jetzt 450 Euro. iPhone streichen.'),
    msg('a2', 'assistant', `Pixel-Ziel 450 €, iPhone weg.\n\n${block([{ id: 'pixel-9', name: 'Pixel 9', target: 450, currency: 'EUR' }])}`),
    msg('u3', 'user', 'Preise prüfen bitte'),
    msg('a3', 'assistant', `Das Pixel kostet 479 €.\n\n${block([{ id: 'pixel-9', name: 'Pixel 9', price: 479, currency: 'EUR' }])}`),
  ]);
  const card = f.cards.get('phones')!;
  assert.deepEqual(card.versions.map((v) => v.state.items.map((it) => `${it.text} ${it.price ?? '-'}/${it.target ?? '-'}`)), [['iPhone 16 -/600', 'Pixel 9 -/500'], ['Pixel 9 -/450'], ['Pixel 9 479/450']]);
});
