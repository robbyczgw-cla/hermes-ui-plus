import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeT } from '../i18n/core.ts';
import { checklistReply, choiceReply, confirmReply, quizReply, slotNoneReply, slotReply } from '../ui/components/modules/a/replies.ts';
import { formMessage } from './format.ts';
import { buildAskMessage } from './ask.ts';
import { parseReplyMessage, replyCopyText } from './replyMessage.ts';

const de = makeT('de', 'de-DE');
const en = makeT('en', 'en-US');
const one = (text: string, t = de) => {
  const p = parseReplyMessage(text, t);
  assert.ok(p, text);
  assert.equal(p.replies.length, 1);
  return p.replies[0].display;
};

test('ordinary messages are not replies', () => {
  assert.equal(parseReplyMessage('Hallo, wie geht es?', de), null);
  assert.equal(parseReplyMessage('[link] nicht ein Tag', de), null);
  assert.equal(parseReplyMessage('[note:x] eigener Text', de), null);
  // tag line followed by free text: the user's own writing
  assert.equal(parseReplyMessage('[choice:x] → A\nund noch etwas', de), null);
});

test('choice: drops the question, localizes "Andere"', () => {
  const msg = choiceReply('reise-prio', 'Was zählt für dich? (mehrere möglich)', ['Reisezeit', 'Klima', 'Arbeiten unterwegs']);
  const p = parseReplyMessage(msg, de);
  assert.deepEqual(p, { head: '', replies: [{ kind: 'choice', id: 'reise-prio', display: 'Reisezeit, Klima, Arbeiten unterwegs' }] });
  assert.equal(one(choiceReply('c', undefined, ['A'], 'Zug'), en), 'A, Other: Zug');
});

test('checklist / quiz / slot / confirm summaries are localized', () => {
  assert.equal(one(checklistReply('l', ['Milch', 'Brot'], ['Eier'])), '2 von 3 erledigt');
  assert.equal(one(checklistReply('l', [], ['Eier']), en), '0 of 1 done');
  assert.equal(one(quizReply('q', 4, 5), en), '4 of 5 correct');
  assert.equal(one(slotReply('s', 'Di 14:00')), 'Di 14:00');
  assert.equal(one(slotNoneReply('s'), en), 'None of these work');
  assert.equal(one(confirmReply('k', true), en), 'yes');
  assert.equal(one(confirmReply('k', false)), 'nein');
});

// 0.2 real-user round 2, R2-09: the pasta shopping list of 11 items showed "1 von 12 erledigt" because one item
// ("Parmesan, gerieben") has a comma of its own; the sent line must count what the card counts (1/11)
test('R2-09 checklist reply: an item with a comma is one item (real J02 list)', () => {
  const done = ['400 g Penne oder Fettuccine'];
  const open = ['300 g Zucchini', '250 g Champignons', '1 Rote Paprika', '4 Zehen Knoblauch', '200 ml Sahne', '200 ml Gemüsebrühe', '150 g Getrocknete Tomaten in Öl', '1 TL Italienische Kräuter', 'Pfeffer', '50 g Parmesan, gerieben'];
  const msg = checklistReply('pasta-einkauf', done, open);
  assert.match(msg, /offen: 300 g Zucchini; 250 g Champignons; .*; 50 g Parmesan, gerieben$/);
  assert.equal(one(msg), '1 von 11 erledigt');
  assert.equal(one(checklistReply('l', [], ['Brot', 'Käse, gerieben']), en), '0 of 2 done');
  // without commas in items the protocol line is unchanged
  assert.equal(checklistReply('l', ['Milch'], ['Brot', 'Eier']), '[checklist:l] erledigt: Milch · offen: Brot, Eier');
  // a decimal comma is no separator
  assert.equal(one(checklistReply('l', ['2 l Milch'], ['Brot', '0,25 kg Butter'])), '1 von 3 erledigt');
  // the "offen:"-only form (chat/ask.ts) counts the same way
  assert.equal(one('[checklist:l] offen: Brot; Käse, gerieben'), '0 von 2 erledigt');
});

test('poll / decision / calc / rank / scale / agenda', () => {
  assert.equal(one('[poll:p] Pizza 3 · Sushi 1 (4 Stimmen) — Anna: Pizza'), 'Pizza 3 · Sushi 1');
  assert.equal(one('[poll:p] Pizza 3 · Sushi 2 (5 Stimmen · 3 Personen)'), 'Pizza 3 · Sushi 2');
  assert.equal(one('[decision:d] Gewinner: Wohnung B (7,8) · Gewichte: Preis 8, Lage 6', en), 'Favourite: Wohnung B');
  assert.equal(one('[decision:d] Gleichstand: A, B (7,0) · Gewichte: x 1'), 'Gleichstand: A, B');
  assert.equal(one('[calc:kredit] Kredit 20.000 € · Zins 4,5 % → Rate 372,86 €'), 'Rate 372,86 €');
  assert.equal(one('[rank:r] 1. A · 2. B'), '1. A · 2. B');
  assert.equal(one('[scale:s] 4/5 (sehr gut)'), '4/5 (sehr gut)');
  assert.equal(one('[agenda:a] 09:00–10:00 Fokus'), '09:00–10:00 Fokus');
  assert.equal(one('[reaction] 👍'), '👍');
});

test('form: readable summary instead of JSON', () => {
  assert.equal(one(formMessage('trip', { ziel: 'Rom', flug: true }), en), 'ziel: Rom · flug: yes');
  assert.equal(one(formMessage('trip', {})), '–');
});

test('ask: free text head + one chip per node line; copy text is the summary', () => {
  const msg = buildAskMessage('Lohnt sich das?', ['c', 'k'], [{ type: 'choice', id: 'c', question: 'Wie?', options: ['Bahn', 'Flug'] }, { type: 'confirm', id: 'k' }], {}, 'm1');
  const p = parseReplyMessage(msg, de);
  assert.ok(p);
  assert.equal(p.head, 'Lohnt sich das?');
  assert.deepEqual(p.replies.map((r) => [r.kind, r.display]), [['choice', 'noch keine Auswahl'], ['confirm', 'noch offen']]);
  assert.equal(replyCopyText(p), 'Lohnt sich das?\nnoch keine Auswahl\nnoch offen');
  const pEn = parseReplyMessage(msg, en);
  assert.deepEqual(pEn?.replies.map((r) => r.display), ['nothing selected yet', 'still open']);
});

test('v4 reformat: kind from the tag id, readable chip in de/en/es', () => {
  const es = makeT('es', 'es-ES');
  assert.equal(one('[reformat:table] Bitte die letzte Antwort als Tabelle.'), 'Als Tabelle');
  assert.equal(one('[reformat:table] Please make the last answer a table.', en), 'As a table');
  assert.equal(one('[reformat:shorter] Kürzer bitte.'), 'Kürzer');
  assert.equal(one('[reformat:longer] x'), 'Ausführlicher');
  assert.equal(one('[reformat:list] x'), 'Als Liste');
  assert.equal(one('[reformat:simpler] x'), 'Einfacher erklärt');
  assert.equal(one('[reformat:expert] x', en), 'For experts');
  assert.equal(one('[reformat:translate:en] Übersetze ins Englische.'), 'Übersetzt: Englisch');
  assert.equal(one('[reformat:translate:es] x', en), 'Translated: Spanish');
  assert.equal(one('[reformat:translate:pt-BR] x', es), 'Traducido: Portugués (Brasil)');
  assert.equal(one('[reformat:whatever] x'), 'Umformuliert');
  const p = parseReplyMessage('[reformat:table] Bitte die letzte Antwort als Tabelle.', de);
  assert.deepEqual(p, { head: '', replies: [{ kind: 'reformat', id: 'table', display: 'Als Tabelle' }] });
});

test('v4 guide: stuck step / detail / finished', () => {
  assert.equal(one('[guide:rührei] Schritt 3 („Eier verquirlen“): Ich hänge fest'), 'Schritt 3: hänge fest');
  assert.equal(one('[guide:g] Schritt 3 („Eier (frisch) verquirlen“): Ich hänge fest – Dotter ist gerissen'), 'Schritt 3: hänge fest – Dotter ist gerissen');
  assert.equal(one('[guide:g] Schritt 2: Ich hänge fest', en), 'Step 2: stuck');
  assert.equal(one('[guide:g] Fertig'), 'Anleitung fertig');
  assert.equal(one('[guide:g] Fertig', en), 'Guide finished');
  assert.equal(one('[guide:g] irgendwas'), 'irgendwas');
});

test('v4 workout / studyplan / vocab / mindmap / products', () => {
  assert.equal(one('[workout:w] 18/20 Sätze · 42 min · Kniebeuge 3×10 @ 60 kg · Bankdrücken 3×8'), '18 von 20 Sätzen · 42 min');
  assert.equal(one('[workout:w] 18/20 Sätze · Kniebeuge 3×10', en), '18 of 20 sets');
  assert.equal(one('[workout:w] 5/20 Sätze · 7 min', en), '5 of 20 sets · 7 min');
  assert.equal(one('[studyplan:s] Woche 1: 9/12 erledigt'), 'Woche 1: 9 von 12 erledigt');
  assert.equal(one('[studyplan:s] Woche 1: 9/12 erledigt · Woche 2: 0/10 erledigt', en), 'Week 1: 9 of 12 done · Week 2: 0 of 10 done');
  assert.equal(one('[vocab:v] 18/20 richtig · schwierig: casa, perro'), '18 von 20 richtig · schwierig: casa, perro');
  assert.equal(one('[vocab:v] 18/20 richtig', en), '18 of 20 correct');
  assert.equal(one('[mindmap] Erkläre „Photosynthese“ genauer'), 'Vertiefen: Photosynthese');
  assert.equal(one('[mindmap] Erkläre „Photosynthese“ genauer', en), 'Dig deeper: Photosynthese');
  assert.equal(one('[products:kopfhoerer] Favorit: Sony WH-1000XM6'), 'Favorit: Sony WH-1000XM6');
  assert.equal(one('[products:k] Favorit: Sony', en), 'Favourite: Sony');
  const p = parseReplyMessage('[mindmap] Erkläre „A“ genauer', de);
  assert.deepEqual(p?.replies[0].id, '');
});
