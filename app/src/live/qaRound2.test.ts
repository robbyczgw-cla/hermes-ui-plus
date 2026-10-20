// 0.2 real-user round 2 (default bridge, claude-haiku-4-5): live cards from natural chat. The transcripts are verbatim
// (qaRound2.fixtures.ts). R2-01: the user made the shopping list a live card ("Als Live-Karte weiterführen"), Hermes
// kept answering with plain checklists under its own id (no `"live":true`) and said "Liste aktualisiert" while the
// pinned card stayed at v1 "Milch". R2-02: a trip plan and a movie watchlist came as `{"type":"live",…}`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatMessage } from '../hermes/types.ts';
import { parseMessage } from '../protocol/streamParser.ts';
import { liveEventsOf } from './extract.ts';
import { foldLive, headOf, type LiveFold, type UserBatch } from './model.ts';
import { QA_ROUND2, type FixtureMessage } from './qaRound2.fixtures.ts';

const chat = (msgs: readonly FixtureMessage[], rename: Record<string, string> = {}): ChatMessage[] =>
  msgs.map((m) => {
    const live = m.live ? Object.fromEntries(Object.entries(m.live).map(([k, v]) => [rename[k] ?? k, v as UserBatch])) : undefined;
    return { id: m.id, role: m.role, text: m.text, tools: [], status: 'done', createdAt: m.createdAt, ...(live ? { live } : {}) };
  });
const fold = (messages: readonly ChatMessage[]): LiveFold => foldLive(liveEventsOf(messages, (m) => parseMessage(m.text)));
const texts = (f: LiveFold, card: string) => headOf(f.cards.get(card)!).state.items.map((it) => `${it.text}${it.checked ? ' ✓' : ''}`);

const SHOP = QA_ROUND2.shopping;
const idOf = (text: string) => SHOP.find((m) => m.text.startsWith(text))!.id;
const answerAfter = (text: string) => SHOP[SHOP.findIndex((m) => m.text.startsWith(text)) + 1].id;

test('R2-01 real transcript: the plain lists after "Als Live-Karte weiterführen" update the pinned card', () => {
  const f = fold(chat(SHOP));
  const card = f.cards.get('liste')!;
  assert.ok(card, 'the card made from the list');
  // v1 the user's card (Milch), v2 Hermes' list with Brot, Eier, Tomaten, v3 "Eier hab ich schon", v4 the user's tick
  assert.deepEqual(card.versions.map((v) => [v.n, v.author]), [[1, 'user'], [2, 'hermes'], [3, 'hermes'], [4, 'user']]);
  assert.deepEqual(texts(f, 'liste'), ['Milch ✓', 'Brot', 'Tomaten']);
  assert.deepEqual(f.marks.get(answerAfter('Wir sind zu zweit')), [{ card: 'liste', n: 2, adopted: 'einkaufsliste_samstag' }]);
  // the next list has no trailer: its id now names the card (continued under it before)
  assert.deepEqual(f.marks.get(SHOP[SHOP.findIndex((m) => m.id === answerAfter('Wir sind zu zweit')) + 2].id), [{ card: 'liste', n: 3, adopted: 'einkaufsliste_samstag' }]);
  // "Hermes fragen": the same three items again = no change, said so on the receipt
  assert.deepEqual(f.marks.get(answerAfter('Aktualisiere bitte diese Live-Karte')), [{ card: 'liste', n: 3, unchanged: true, adopted: 'einkaufsliste_samstag' }]);
  // the user's tick (v4) and Hermes' list with Milch checked agree
  assert.deepEqual(f.marks.get(answerAfter('Was muss ich für Samstag')), [{ card: 'liste', n: 4, unchanged: true, adopted: 'einkaufsliste_samstag' }]);
  // answers without a list after turns that were not about the card: no marks at all
  for (const q of ['Was kann ich daraus', 'mehr Details', 'was fehlt noch?']) assert.equal(f.marks.get(answerAfter(q)), undefined, q);
});

test('R2-01 with the fixed adopt id: the card is `einkaufsliste-samstag`, Hermes\' plain lists continue it by id', () => {
  // the same chat if the card had been made with the list's own id (live/adopt.ts adoptId)
  const f = fold(chat(SHOP, { liste: 'einkaufsliste-samstag' }));
  assert.deepEqual(texts(f, 'einkaufsliste-samstag'), ['Milch ✓', 'Brot', 'Tomaten']);
  // without the later trailers (focus, ticks): every plain list still continues the card through its id
  const noTrailer = chat(SHOP, { liste: 'einkaufsliste-samstag' }).map((m) => (m.role === 'user' && m.live && m.id !== idOf('Wir sind zu zweit') ? { ...m, live: undefined } : m));
  const g = fold(noTrailer);
  assert.deepEqual(g.cards.get('einkaufsliste-samstag')!.versions.map((v) => v.author), ['user', 'hermes', 'hermes', 'hermes']);
  assert.deepEqual(texts(g, 'einkaufsliste-samstag'), ['Milch ✓', 'Brot', 'Tomaten']);
});

test('R2-01: a plain list that is NOT the card in a turn about the card is marked not applied, never applied', () => {
  const base = chat(SHOP.slice(0, 7)); // up to the user's create batch ("Wir sind zu zweit …")
  const pancakes = '```hui\n{"type":"checklist","id":"pfannkuchen","items":[{"text":"Mehl"},{"text":"Zucker"},{"text":"Eier"}]}\n```';
  const f = fold([...base, { id: 'a-x', role: 'assistant', text: `Für Pfannkuchen brauchst du:\n\n${pancakes}`, tools: [], status: 'done', createdAt: 9e12 }]);
  assert.deepEqual(texts(f, 'liste'), ['Milch']);
  assert.deepEqual(f.marks.get('a-x'), [{ card: 'liste', n: 1, adopted: 'pfannkuchen', unapplied: true }]);
});

test('R2-01: ticks that rode along with "Danke" ask for nothing: a text answer gets no "not changed" line', () => {
  const f = fold([
    ...chat(SHOP.slice(0, 8)),
    { id: 'u-t', role: 'user', text: 'Danke!', tools: [], status: 'done', createdAt: 9e12, live: { liste: { v: 2, ops: [{ check: 'brot' }], bid: 'b-t' } } },
    { id: 'a-t', role: 'assistant', text: 'Gern geschehen.', tools: [], status: 'done', createdAt: 9e12 },
    { id: 'u-p', role: 'user', text: 'Und für Pfannkuchen?', tools: [], status: 'done', createdAt: 9e12, live: { liste: { v: 3, ops: [{ check: 'milch' }], bid: 'b-p' } } },
    { id: 'a-p', role: 'assistant', text: '```hui\n{"type":"checklist","id":"pfannkuchen","items":[{"text":"Mehl"},{"text":"Zucker"}]}\n```', tools: [], status: 'done', createdAt: 9e12 },
  ]);
  assert.equal(f.marks.get('a-t'), undefined);
  assert.equal(f.marks.get('a-p'), undefined, 'another list, not marked as a failed update');
});

test('R2-01: an unrelated plain list in a turn not about the card stays a plain list (no mark)', () => {
  const f = fold([
    ...chat(SHOP.slice(0, 8)),
    { id: 'u-y', role: 'user', text: 'Was brauche ich für Pfannkuchen?', tools: [], status: 'done', createdAt: 9e12 },
    { id: 'a-y', role: 'assistant', text: '```hui\n{"type":"checklist","id":"pfannkuchen","items":[{"text":"Mehl"},{"text":"Milch"}]}\n```', tools: [], status: 'done', createdAt: 9e12 },
  ]);
  assert.equal(f.marks.get('a-y'), undefined);
  assert.equal(headOf(f.cards.get('liste')!).n, 2);
});

test('R2-01: "Hermes fragen" answered without any list: the answer says the card was not changed', () => {
  const asked = SHOP.slice(0, SHOP.findIndex((m) => m.text.startsWith('Aktualisiere bitte')) + 1);
  const f = fold([...chat(asked), { id: 'a-q', role: 'assistant', text: 'Liste aktualisiert – Eier raus, die drei Basics bleiben.', tools: [], status: 'done', createdAt: 9e12 }]);
  assert.deepEqual(f.marks.get('a-q'), [{ card: 'liste', n: 3, unchanged: true, quiet: true }]);
  // an edit phrase about the one open card counts too ("Füg noch Butter dazu")
  const g = fold([...chat(SHOP.slice(0, 10)), { id: 'u-z', role: 'user', text: 'Füg noch Butter hinzu', tools: [], status: 'done', createdAt: 9e12 }, { id: 'a-z', role: 'assistant', text: 'Butter ist drauf.', tools: [], status: 'done', createdAt: 9e12 }]);
  assert.deepEqual(g.marks.get('a-z'), [{ card: 'liste', n: 3, unchanged: true, quiet: true }]);
});

test('R2-02 real transcript: the `{"type":"live"}` trip plan becomes a live trip card by day, the next one updates it', () => {
  const f = fold(chat(QA_ROUND2.trip));
  const card = f.cards.get('salzburg_plan')!;
  assert.ok(card, 'live trip card');
  assert.equal(card.type, 'trip');
  assert.deepEqual(headOf(card).state.days?.map((d) => d.label), ['Freitag', 'Samstag', 'Sonntag']);
  assert.equal(card.versions.length, 2);
  const fri = headOf(card).state.items.filter((it) => it.day === headOf(card).state.days![0].id);
  assert.deepEqual(fri.map((it) => `${it.start} ${it.text}`), ['18:00 Anreise & Hotel-Check-in', '19:00 Abendessen (Altstadt)']);
});

test('R2-02 real transcript: the `{"type":"live","style":"checklist"}` movie watchlist is a live checklist; "Arrival gesehen, Dune dazu" updates it', () => {
  const f = fold(chat(QA_ROUND2.watchlist));
  const card = f.cards.get('filmabend-watchlist')!;
  assert.equal(card.type, 'checklist');
  assert.equal(card.versions.length, 2);
  assert.deepEqual(texts(f, 'filmabend-watchlist'), ['Arrival ✓', 'Interstellar', 'Die fabelhafte Welt der Amélie', 'Dune']);
  assert.equal(headOf(card).state.items[1].note, 'Sci-Fi Epos · 169 min');
});
