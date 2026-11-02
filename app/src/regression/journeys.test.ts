// One test per real-user finding of the QA rounds (0.1.4 F01–F10, 0.2 round 2 R2-*, round 3 R3-*, N-01): the recorded
// answer that showed the bug, drawn by the real components (testkit/answerView.ts), with the taps a user made. What a
// test asserts is what the user sees or what the tap sends; where the QA run recorded the app's own follow-up message
// (the next user turn, e.g. "[choice:…] → Morgens"), the tap must send exactly that again.
// The broad replay of every recorded answer is transcripts-*.test.ts; this file pins the specific journeys.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { dictionaries } from '../i18n/core.ts';
import { loadAnswerView } from '../testkit/answerView.ts';
import { loadFixture, type Conversation } from './replay.ts';
import { checkClaims } from './userChecks.ts';

const CONVS = new Map<string, Conversation>(loadFixture(new URL('./fixtures/qa-transcripts.json', import.meta.url)).map((c) => [c.id, c]));
let av: Awaited<ReturnType<typeof loadAnswerView>>;
before(async () => {
  av = await loadAnswerView();
});

function turn(id: string, i: number) {
  const c = CONVS.get(id);
  assert.ok(c, `fixture ${id}`);
  const t = c.turns[i];
  assert.ok(t?.answer, `${id}#${i} has an answer`);
  // what the app sent when the QA tester tapped this answer's card: the next "[kind:id] …" user turn
  const sent = c.turns.slice(i + 1).find((x) => x.user?.startsWith('['))?.user ?? null;
  return { msg: { role: 'assistant' as const, text: t.answer, tools: t.tools ?? [] }, lang: c.uiLang, next: sent };
}

async function mount(id: string, i: number, lang?: 'de' | 'en' | 'es') {
  const t = turn(id, i);
  const v = await av.mountAnswer(t.msg, { lang: lang ?? t.lang });
  return { v, next: t.next, flat: () => v.text().replace(/\s+/g, ' ') };
}

const de = dictionaries.de.ui;
const en = dictionaries.en.ui;

test('F01 remind: an unknown "remind" block reads as text with "nothing was set up", no JSON; the false "Erledigt" is a claim finding', async () => {
  const { v, flat } = await mount('r1-de-j11-tea-timer-reminder', 2);
  assert.match(flat(), /„remind“ kann diese App nicht darstellen, dafür wurde nichts eingerichtet/);
  assert.match(flat(), /Tee kaufen/);
  assert.match(flat(), new RegExp(dictionaries.de.chat.message.showRaw));
  assert.doesNotMatch(flat(), /"type"|\{"/);
  assert.deepEqual(checkClaims(turn('r1-de-j11-tea-timer-reminder', 2).msg.text).map((f) => f.code), ['claims-reminder']);
  await v.unmount();
  // round 3: the honest answers ("kann keine Erinnerung setzen") pass the claim check
  for (const [id, i] of [['r3-de-n04-reminders', 0], ['r3-de-n04-reminders-2', 0], ['r2-de-j11-tea-timer-reminder', 2]] as const) {
    assert.deepEqual(checkClaims(turn(id, i).msg.text), [], `${id}#${i}`);
  }
});

test('F02 choice: the options of an `items` choice are visible and a tap sends the choice (after the undo window)', async () => {
  const { v, next } = await mount('r1-en-j12-picnic-en', 0);
  assert.match(v.text(), /Sandwiches/);
  assert.match(v.text(), /Pasta salad/);
  await v.tap('Pasta salad');
  await v.wait(1700);
  assert.deepEqual(v.sent.map((s) => (s.action as { text?: string }).text), ['[choice:picnic_lunch] → Pasta salad']);
  assert.ok(next, 'the QA run had a follow-up');
  await v.unmount();
  // German departure choice (round 1 rendered nothing): visible, and tapping "Morgens" sends what round 3 sent
  const de3 = await mount('r3-de-j08-train-car-weights', 2);
  assert.match(de3.flat(), /Morgens/);
  await de3.v.tap('Morgens');
  await de3.v.wait(1700);
  assert.equal((de3.v.sent[0]?.action as { text?: string })?.text, de3.next);
  await de3.v.unmount();
});

test('F02 workout: exercises (from `main`, durations as text) are drawn with sets and seconds, plus the session note', async () => {
  const r1 = await mount('r1-en-j06-workout-week', 0);
  for (const name of ['Kniebeugen', 'Plank']) assert.match(r1.flat(), new RegExp(name));
  assert.match(r1.flat(), /3 × 45 s/);
  assert.match(r1.flat(), /3 Durchgänge à 6 Minuten/, 'the session-wide note (was dropped)');
  await r1.v.unmount();
  // round 2's workout (another shape): every exercise is there
  const r2 = await mount('r2-de-j06-workout-week', 0);
  for (const name of ['Jumping Jacks', 'Kniebeugen', 'Bergsteiger', 'High Knees']) assert.match(r2.flat(), new RegExp(name));
  await r2.v.unmount();
});

test('F03 recipe (English): quantities, times and steps are on screen', async () => {
  const { v, flat } = await mount('r1-en-j12-picnic-en', 1);
  for (const q of [/400\s*g/, /250\s*g/, /150\s*g/]) assert.match(flat(), q);
  assert.match(flat(), /Cherry tomatoes/);
  await v.unmount();
});

test('F04 map: places with names, addresses and coordinates are listed (never "Keine gültigen Orte")', async () => {
  for (const i of [0, 2]) {
    const { v, flat } = await mount('r1-de-j01-salzburg-map', i);
    assert.doesNotMatch(flat(), new RegExp(de.map.noMarkers));
    assert.match(flat(), /Festung Hohensalzburg/);
    await v.unmount();
  }
});

test('F05 vocab + quiz: words visible, a card flips, the quiz shows no solution until tapped, then grades it', async () => {
  const { v, flat } = await mount('r1-en-j05-vocab-quiz', 0, 'en');
  assert.doesNotMatch(flat(), new RegExp(en.vocab.empty));
  assert.match(flat(), new RegExp(en.quiz.question.replace('{i}', '1').replace('{n}', '5')));
  assert.doesNotMatch(flat(), new RegExp(`${en.quiz.correct}|${en.quiz.wrong}`), 'no grading before a tap');
  await v.tap('passport');
  assert.match(flat(), new RegExp(en.quiz.correct.replace('!', '')));
  await v.unmount();
});

test('F06 translation: a ```translation fence is a translation card with the translated text, no JSON', async () => {
  const { v, flat } = await mount('r1-en-j10-translation', 0);
  assert.match(flat(), /Can we reschedule our appointment\?/);
  assert.doesNotMatch(flat(), /"translated"|"original"|\{/);
  await v.unmount();
});

test('F08 photos without image search: captions plus "image search is not set up", never an empty gap', async () => {
  const { v, flat } = await mount('r1-de-j03-phones-photos-table', 1);
  assert.match(flat(), /iPhone 16/);
  assert.match(flat(), /Pixel 9/);
  assert.match(flat(), /Bildersuche ist nicht eingerichtet/);
  await v.unmount();
});

test('R2-06 / R3-03 calculators: scores and the recommendation compute (no "–", no "nicht berechenbar")', async () => {
  for (const id of ['r2-de-j08-train-car-weights', 'r3-de-j08-train-car-weights']) {
    const { v, flat } = await mount(id, 1);
    assert.match(flat(), /Empfehlung (✓|→) Zug/, id);
    assert.doesNotMatch(flat(), new RegExp(de.calc.notComputable), id);
    await v.unmount();
  }
});

test('R2-07 graded choice: drawn as a one-question quiz, the "Richtig!" text only after the tap', async () => {
  const { v, flat } = await mount('r2-de-j05-vocab-quiz', 2);
  assert.doesNotMatch(flat(), /Richtig|falsch herum/);
  await v.tap('Departure = Abfahrt/Abflug, Arrival = Ankunft');
  assert.match(flat(), new RegExp(de.quiz.correct.replace('!', '')));
  await v.unmount();
});

test('R2-08 three-day plan in one agenda: split into day tabs, tapping a day shows its entries', async () => {
  const { v, flat } = await mount('r2-de-n02-trip-live-card', 0);
  for (const d of ['Freitag', 'Samstag', 'Sonntag']) assert.match(flat(), new RegExp(d));
  assert.doesNotMatch(flat(), /Salzburg Museum \(Altstadt\)/, 'Saturday is behind its tab');
  await v.tap('Samstag');
  assert.match(flat(), /Salzburg Museum \(Altstadt\)/);
  await v.unmount();
});

test('R2-09 / round 1 checklist: tick + send sends the progress of THIS list', async () => {
  // round 1 (English): exactly what the QA run sent
  const r1 = await mount('r1-en-j12-picnic-en', 2);
  await r1.v.tap('Cherry tomatoes');
  await r1.v.tap(en.checklist.sendToHermes);
  assert.equal((r1.v.sent[0]?.action as { text?: string })?.text, r1.next);
  await r1.v.unmount();
  // R2-09: the card said 1/11, the sent line "1 von 12" because "50 g Parmesan, gerieben" was split at its comma.
  // Now items with a comma of their own are separated by ";": 10 open entries, the parmesan one of them
  const r2 = await mount('r2-de-j02-recipe-shopping', 2);
  assert.match(r2.flat(), /0\/11/);
  await r2.v.tap('Penne oder Fettuccine');
  await r2.v.tap(de.checklist.sendToHermes);
  const sent = (r2.v.sent[0]?.action as { text?: string })?.text ?? '';
  const open = sent.split(' · offen: ')[1]?.split('; ') ?? [];
  assert.match(sent, /^\[checklist:pasta-einkauf\] erledigt: 400 g Penne oder Fettuccine · offen: /);
  assert.equal(open.length, 10, sent);
  assert.ok(open.includes('50 g Parmesan, gerieben'), sent);
  await r2.v.unmount();
});

test('N-01 Markdown task list ("- [ ] …") is an interactive checklist: tick + send', async () => {
  const { v, flat } = await mount('r2fix-de-bbq-shopping-table', 0);
  assert.doesNotMatch(flat(), /\[ \]/, 'no raw task-list brackets');
  await v.tap('1,2 kg Bratwurst');
  await v.tap(de.checklist.sendToHermes);
  const sent = (v.sent[0]?.action as { text?: string })?.text ?? '';
  assert.match(sent, /erledigt: 1,2 kg Bratwurst/);
  await v.unmount();
});

test('R3-01 watchlist: the target price ("trailing": "Ziel: 450€") stays on the card', async () => {
  const { v, flat } = await mount('r3-de-n03-price-watchlist', 1);
  assert.match(flat(), /Pixel 9/);
  assert.match(flat(), /Ziel: 450\s*€/);
  await v.unmount();
});

test('typo follow-ups ("Einkaufslsite", "I cant see any options") still get the requested component', async () => {
  const { v } = await mount('r1-de-j02-recipe-shopping', 2);
  assert.ok(v.segments().some((s) => s.type === 'checklist'));
  await v.unmount();
  const en1 = await mount('r1-en-j12-picnic-en', 1);
  assert.ok(en1.v.segments().some((s) => s.type === 'recipe'));
  await en1.v.unmount();
});

test('Spanish UI: the honest fallbacks are Spanish (unknown component, "nothing ran" notice, image-search note)', async () => {
  const es = dictionaries.es;
  const a = await mount('r1-de-j11-tea-timer-reminder', 2, 'es');
  assert.match(a.flat(), new RegExp(es.ui.content.unsupportedReadable.split('{type}')[1].slice(0, 25).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(a.flat(), /kann diese App nicht darstellen/);
  await a.v.unmount();
  const b = await mount('r1-de-j03-phones-photos-table', 1, 'es');
  assert.doesNotMatch(b.flat(), /Bildersuche ist nicht eingerichtet/);
  await b.v.unmount();
  const notice = await av.viewAnswer({ role: 'assistant', text: 'Ich richte es ein.\n<tool_call>{"name":"cronjob_manage","arguments":{}}</tool_call>' }, { lang: 'es' });
  assert.match(notice.text, new RegExp(es.chat.message.toolMarkupHidden.slice(0, 20)));
});
