// The user-visible checks must fire on what a user would call broken and stay quiet on honest answers: crafted
// answers drawn through the real render path (testkit/answerView.ts), plus the pure claim checks.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAnswerView } from '../testkit/answerView.ts';
import { checkClaims, checkDrawn, checkLanguage, checkPromises, missingContent, type DrawnAnswer } from './userChecks.ts';

let av: Awaited<ReturnType<typeof loadAnswerView>>;
before(async () => {
  av = await loadAnswerView();
});
const view = (text: string, lang: 'de' | 'en' = 'de') => av.viewAnswer({ role: 'assistant', text }, { lang, explore: true });
const codes = (v: DrawnAnswer) => checkDrawn(v).map((f) => f.code);
const hui = (node: unknown) => '```hui\n' + JSON.stringify(node) + '\n```';

test('honest answers: text, a table, a checklist, the unknown-component fallback → no finding', async () => {
  for (const text of [
    'Hallo! Wie kann ich helfen?',
    'Hier: \n\n' + hui({ type: 'table', columns: ['A', 'B'], rows: [['x', '1']] }),
    hui({ type: 'checklist', title: 'Einkauf', items: [{ text: 'Milch' }] }),
    hui({ type: 'remind', time: '09:00', title: 'Tee kaufen' }),
    'Code:\n\n```js\nconst a = { type: 1 };\n```',
  ]) {
    assert.deepEqual(codes(await view(text)), [], text);
  }
});

test('raw component JSON shown as code is a finding (F06 class)', async () => {
  const v = await view('Übersetzung:\n\n```json\n{"type": "translation", "translated": "Hi"}\n```');
  assert.ok(codes(v).includes('raw-markup'), JSON.stringify(checkDrawn(v)));
});

test('a "no data" label where the block has content is a finding (F04/F05 class)', () => {
  const drawn: DrawnAnswer = {
    text: 'Keine gültigen Orte',
    announcement: '',
    segments: [{ kind: 'hui', type: 'map', fallback: false, error: null, raw: '{"type":"map","places":[{"name":"Festung","lat":47.8,"lng":13.0}]}', text: 'Keine gültigen Orte', images: 0, skeletons: 0 }],
  };
  assert.deepEqual(checkDrawn(drawn).map((f) => f.code), ['no-data-label']);
});

test('an empty component, a stuck skeleton, a quiz showing its grading, a raw announcement are findings', () => {
  const seg = { kind: 'hui' as const, type: 'gallery', fallback: false, error: null, raw: '{}', text: '', images: 0, skeletons: 0 };
  assert.deepEqual(checkDrawn({ text: 'x', announcement: '', segments: [seg] }).map((f) => f.code), ['empty-component']);
  assert.deepEqual(checkDrawn({ text: 'x', announcement: '', segments: [{ ...seg, skeletons: 2 }] }).map((f) => f.code), ['stuck-placeholder']);
  const quiz = { ...seg, type: 'quiz', text: 'Frage 1 von 1 Was? A B Richtig!' };
  assert.deepEqual(checkDrawn({ text: quiz.text, announcement: '', segments: [quiz] }).map((f) => f.code), ['answer-leak']);
  assert.deepEqual(checkDrawn({ text: 'Antwort', announcement: 'Antwort fertig: {"type":"x"}', segments: [] }).map((f) => f.code), ['announcement-raw']);
  assert.deepEqual(checkDrawn({ text: '', announcement: '', segments: [] }).map((f) => f.code), ['empty-answer']);
});

test('a block that crashes while drawing is a render-crash finding', async () => {
  // a chart whose data cannot be drawn still shows its own message, never the boundary's crash line
  const ok = await view(hui({ type: 'chart', kind: 'pie', title: 'Kosten', series: [{ name: 'S', data: [{ x: 'A', y: 1 }] }] }));
  assert.deepEqual(codes(ok), []);
  const drawn: DrawnAnswer = { text: 'Komponente konnte nicht dargestellt werden', announcement: '', segments: [{ kind: 'hui', type: 'chart', fallback: false, error: null, raw: '{}', text: 'Komponente konnte nicht dargestellt werden', images: 0, skeletons: 0 }] };
  assert.deepEqual(checkDrawn(drawn).map((f) => f.code), ['render-crash']);
});

test('claims: confirmed reminders / memory / routines without a tool are findings; refusals and conditionals are not', () => {
  const yes = [
    'Erledigt – morgen um 9 Uhr wirst du erinnert, Tee zu kaufen.',
    "Done! I'll remind you tomorrow at 9.",
    'Die Erinnerung ist eingerichtet.',
    'Gespeichert: Das behalte ich für künftige Gespräche im Gedächtnis.',
    "I've saved that to my memory for future chats.",
    'Routine angelegt: Morgenbriefing, werktags 7:00.',
  ];
  for (const s of yes) assert.equal(checkClaims(s).length, 1, s);
  const no = [
    'Ich kann leider keine Erinnerungen setzen.',
    "I can't set reminders here, nothing was scheduled.",
    'Wenn das Werkzeug aktiv ist, würde ich dich morgen erinnern.',
    "If the tool is enabled, I'd set a reminder for 9:00.",
    'Nein, die Erinnerung ist nicht eingerichtet.',
    'Hier ist deine Einkaufsliste.',
  ];
  for (const s of no) assert.deepEqual(checkClaims(s), [], s);
  // a scheduling tool that ran makes the confirmation fine
  assert.deepEqual(checkClaims('Erledigt – morgen um 9 Uhr wirst du erinnert.', [{ name: 'cronjob', status: 'done' }]), []);
});

test('promises: "hier sind die Fotos" without any picture or gallery is a finding; with a gallery it is not', async () => {
  const bare = 'Hier sind die Fotos der beiden Handys.';
  assert.deepEqual(checkPromises(bare, await view(bare)).map((f) => f.code), ['promised-photos']);
  const withGallery = 'Hier sind die Fotos:\n\n' + hui({ type: 'gallery', items: [{ query: 'iPhone 16', caption: 'iPhone 16' }] });
  assert.deepEqual(checkPromises(withGallery, await view(withGallery)), []);
});

test('missing content: a field the app drops is reported, reformatted or tap-gated content is not', () => {
  const raw = JSON.stringify({ type: 'checklist', title: 'Watchlist', items: [{ text: 'Pixel 9', trailing: 'Ziel: 450€' }] });
  assert.deepEqual(missingContent(raw, 'checklist', 'Watchlist 0/1 Pixel 9 Senden').map((m) => m.value), ['Ziel: 450€']);
  assert.deepEqual(missingContent(raw, 'checklist', 'Watchlist 0/1 Pixel 9 Ziel: 450 € Senden'), []);
  // the back of a vocab card, a quiz's explanation: behind a tap, not reported
  assert.deepEqual(missingContent(JSON.stringify({ type: 'quiz', questions: [{ q: 'Was?', options: ['a', 'b'], explanation: 'Weil' }] }), 'quiz', 'Was? a b'), []);
});

// live conversation test, skill 0.8.0 run: three false "dropped" findings on content the app shows correctly
test('missing content: recipe singular/plural, live-patch ops and decision option notes are not reported', () => {
  const recipe = JSON.stringify({ type: 'recipe', id: 'r', title: 'Pasta', servings: 4, ingredients: [{ qty: 1, item: 'Zwiebel', plural: 'Zwiebeln' }, { qty: 2, item: 'Knoblauchzehe', plural: 'Knoblauchzehen' }], steps: [{ text: 'Kochen' }] });
  assert.deepEqual(missingContent(recipe, 'recipe', 'Pasta 4 Portionen 1 Zwiebel 2 Knoblauchzehen Kochen'), []);
  assert.deepEqual(missingContent(recipe, 'recipe', 'Pasta 4 Portionen 2 Knoblauchzehen Kochen').map((m) => m.value), ['Zwiebel']);
  const patch = JSON.stringify({ type: 'callout', tone: 'info', title: 'Mengen ergänzt', text: 'Äpfel 6 Stück', livePatch: { card: 'einkauf', ops: [{ set: 'aepfel', qty: 6, unit: 'Stück' }] } });
  assert.deepEqual(missingContent(patch, 'callout', 'Mengen ergänzt Äpfel 6 Stück'), []);
  const decision = JSON.stringify({ type: 'decision', id: 'd', criteria: [{ id: 'k', label: 'Kosten', weight: 5 }], options: [{ label: 'Zug', scores: { k: 6 }, note: 'Railjet ca. 2:30 h' }] });
  assert.deepEqual(missingContent(decision, 'decision', 'Zug Kosten 5 Tippe auf eine Option'), []);
});

test('language: an English question answered in German is a soft finding; same language or too short is none', () => {
  assert.deepEqual(checkLanguage('Make a shoping list with bread and tomatoes, one I can tick off please.', 'Hier ist deine Einkaufsliste. Du kannst die Artikel abhaken, sobald du sie im Laden hast, und ich helfe dir gern.').map((f) => [f.code, f.level]), [['answer-language', 'warn']]);
  assert.deepEqual(checkLanguage('Make a list for me please, with bread and the tomatoes.', 'Here is your list. You can tick the items off when you have them, and I can add more for you.'), []);
  assert.deepEqual(checkLanguage('Fotos?', 'Here are the photos.'), []);
  // the live case: a short English question, a German answer
  assert.equal(checkLanguage('Make a shoping list with bread and tomatoes, one I can tick off.', 'Hier ist deine Einkaufsliste. Du kannst jeden Punkt abhaken. Sag einfach, wenn du mehr brauchst.').length, 1);
});

// live conversation test, skill 0.8.0 run (j01 "the three places on the map"): `layout: "list"` rows dropped each
// a model adds "note" to a table on its own ("from model knowledge, check the prices"): it was never drawn
test('a table shows its note', async () => {
  const node = { type: 'table', id: 't', caption: 'Zwei Geräte', columns: ['Merkmal', 'A', 'B'], rows: [['Preis', 'unbekannt', 'ca. 60 USD']], basis: 'estimate', note: 'Aus Modellwissen, ohne Quellenabruf. Aktuelle Preise bitte prüfen.' };
  const v = await view(hui(node));
  assert.match(v.text, /Aus Modellwissen, ohne Quellenabruf/, v.text);
  assert.deepEqual(missingContent(JSON.stringify(node), 'table', v.segments[0].text ?? v.text), []);
});

// place's note; only the carousel card and the detail sheet showed it
test('places as a list show each place note (not only the carousel)', async () => {
  const node = { type: 'places', id: 'p', title: 'Salzburg: drei Orte', layout: 'list', places: [{ name: 'Festung Hohensalzburg', category: 'Festung', note: 'Fahrt mit der Festungsbahn statt Treppen' }, { name: 'Mirabellgarten', note: 'Flach und nah an der Altstadt' }] };
  const v = await view(hui(node));
  assert.match(v.text, /Fahrt mit der Festungsbahn statt Treppen/, v.text);
  assert.match(v.text, /Flach und nah an der Altstadt/);
  assert.deepEqual(missingContent(JSON.stringify(node), 'places', v.segments[0].text ?? v.text), []);
});
