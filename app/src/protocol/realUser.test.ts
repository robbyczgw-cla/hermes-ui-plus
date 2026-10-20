// Regression tests from the 0.1.4 real-user journeys (default bridge, claude-haiku-4-5): the model never loaded the
// component references and wrote the blocks from memory. Every block below is verbatim from that run
// (realUser014.fixtures.ts) and used to render as nothing, "no valid places", "no vocabulary", a quiz that
// showed its answers, raw JSON, or an "unsupported component" dump. Findings F01-F07 of the QA report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStreamParser } from './streamParser.ts';
import { isEmptyCollection, parseDuration, readableFallback } from './validate.ts';
import { HUI_NODE_TYPES, type Segment } from './types.ts';
import { REAL_USER_014 } from './realUser014.fixtures.ts';
import { isEmptyNode } from './emptyNode.ts';
import { evaluateOutputs } from '../calc/index.ts';

const FIX = REAL_USER_014;

type Hui = Extract<Segment, { kind: 'hui' }>;
type Rec = Record<string, unknown>;

function parse(raw: string, fence = 'hui'): Hui {
  const p = createStreamParser();
  p.push('Intro.\n\n```' + fence + '\n' + raw + '\n```\n\nOutro.\n');
  p.end();
  const segs = p.segments().filter((s): s is Hui => s.kind === 'hui');
  assert.equal(segs.length, 1, 'one component block');
  return segs[0];
}

function node(key: string, fence = 'hui'): Rec {
  const s = parse(JSON.stringify(FIX[key], null, 2), fence);
  assert.ok(s.complete && s.node, `${key}: a node`);
  assert.equal(s.fallback, undefined, `${key}: rendered as itself, not as the fallback list`);
  assert.equal(isEmptyCollection(s.node), false, `${key}: not empty`);
  return s.node as unknown as Rec;
}

const list = (x: unknown) => x as Rec[];

// ── F02: workout, agenda, choice rendered as nothing ──

test('F02 workout: `main` exercises, text durations, `rest`, `tip`, `rounds`, structured warm-up', () => {
  const n = node('workout');
  assert.equal(n.type, 'workout');
  assert.equal(n.title, '20 Minuten · Anfänger');
  const ex = list(n.exercises);
  assert.equal(ex.length, 4);
  assert.deepEqual(
    { name: ex[0].name, sets: ex[0].sets, seconds: ex[0].seconds, restSeconds: ex[0].restSeconds, note: ex[0].note },
    { name: 'Kniebeugen', sets: 3, seconds: 45, restSeconds: 15, note: 'So viele wie möglich. Rücken gerade, Gewicht in den Fersen' },
  );
  assert.equal(ex[0].reps, undefined, 'timed set: the prose reps moved to the note');
  assert.equal(ex[3].note, 'Halten. Körper gerade wie ein Brett, Bauch anspannen');
  assert.equal(ex[3].seconds, 30);
  assert.match(String(n.warmup), /2 Min: 30 Sekunden: Locker joggen.*Armkreise/);
  assert.match(String(n.cooldown), /Dehnungen/);
});

test('F02 workout (re-run): phases in `blocks` with rounds, reps as time ("30 Sekunden"), numeric durations', () => {
  const n = node('workout-phases');
  assert.equal(n.type, 'workout');
  assert.equal(n.warmup, '3 min: Arme kreisen 30 Sekunden; Leichte Kniehebs 30 Sekunden; Marsch auf der Stelle 30 Sekunden');
  assert.match(String(n.cooldown), /^220 s: Vorbeuge \(stehend\) 30 s; /);
  const ex = list(n.exercises);
  assert.deepEqual(ex.map((e) => e.name), ['Liegestütze (auf Knien ok)', 'Kniebeugen', 'Plank', 'Ausfallschritte (pro Bein)', 'Burpees (vereinfacht: Hände runter, Beine zurück)']);
  assert.deepEqual([ex[0].sets, ex[0].reps, ex[0].restSeconds], [2, 10, 30]);
  assert.deepEqual([ex[2].seconds, ex[2].reps], [20, undefined]);
});

test('calc (re-run): inputs and formulas mixed in `expressions` → sliders and results', () => {
  const n = node('calc-expressions');
  assert.deepEqual(list(n.inputs).map((i) => [i.name, i.kind, i.min, i.max, i.default]), [
    ['cost_weight', 'slider', 0, 100, 33],
    ['time_weight', 'slider', 0, 100, 33],
    ['env_weight', 'slider', 0, 100, 34],
  ]);
  assert.deepEqual(list(n.outputs).map((o) => [o.name, o.label]), [['zug_score', 'Zug-Gesamtscore'], ['auto_score', 'Auto-Gesamtscore']]);
});

test('calc (re-run 2): label in `name`, identifier in `symbol`, read-only constants folded into the formulas', () => {
  const n = node('calc-symbols');
  const inputs = list(n.inputs);
  assert.deepEqual(inputs.map((i) => [i.name, i.label, i.kind, i.default]), [
    ['w_cost', 'Gewicht Kosten (%)', 'slider', 50],
    ['w_time', 'Gewicht Zeit (%)', 'slider', 20],
    ['w_env', 'Gewicht Umwelt (%)', 'slider', 30],
  ]);
  const scope = Object.fromEntries(inputs.map((i) => [i.name as string, i.default as number]));
  const res = evaluateOutputs(scope, list(n.outputs) as never) as { value: number | null }[];
  const byName = Object.fromEntries(list(n.outputs).map((o, i) => [o.name as string, res[i].value]));
  assert.equal(byName.total_weight, 100);
  assert.ok(Math.abs((byName.score_train as number) - 0.635) < 0.001, String(byName.score_train));
  assert.ok(Math.abs((byName.score_auto as number) - 0.55) < 0.001, String(byName.score_auto));
});

test('buttons (re-run 2): a plain-string `action` sends what the button says', () => {
  const n = node('buttons-string-actions');
  assert.deepEqual(list(n.items).map((b) => b.action), [
    { type: 'send', text: 'Morgens (07:30 Wien → 09:45 Graz)' },
    { type: 'send', text: 'Nachmittags (14:15 Wien → 16:30 Graz)' },
  ]);
});

test('F02 agenda: a week plan without clock times becomes a timeline (nothing dropped)', () => {
  const n = node('agenda-week');
  assert.equal(n.type, 'timeline');
  const items = list(n.items);
  assert.equal(items.length, 6);
  assert.deepEqual(items[0], { time: 'Montag', title: '20-Minuten Ganzkörper-Workout', detail: 'Kniebeugen • Bergsteiger • Ausfallschritte • Plank (3 Runden)' });
  const days = node('agenda-weekend-days');
  assert.equal(days.type, 'timeline');
  assert.equal(list(days.items)[0].time, 'Samstag 09:00');
  assert.ok(list(days.items).length >= 4);
});

test('F02 agenda: one day with clock ranges ("09:00–11:00") stays an agenda', () => {
  const n = node('agenda-rain-ranges');
  assert.equal(n.type, 'agenda');
  const b = list(n.blocks);
  assert.ok(b.length >= 3);
  assert.deepEqual([b[0].start, b[0].end, b[0].title], ['09:00', '11:00', 'Salzburg Museum']);
  assert.match(String(b[0].note), /Mozartplatz/);
});

test('F02 choice: options as `items` (strings, or {title, detail}) become tappable options', () => {
  const de = node('choice-de');
  assert.deepEqual(list(de.options).map((o) => o.label), ['☀️ Morgens (z.B. 8:00 Uhr)', '☀️ Nachmittags (z.B. 14:00 Uhr)']);
  const en = node('choice-en');
  assert.equal(en.id, 'picnic_lunch');
  assert.deepEqual(list(en.options).map((o) => [o.label, o.description]), [
    ['Sandwiches', 'Easy to prep, eat one-handed, works for 4 people'],
    ['Pasta salad', 'Can be made ahead, filling, travels well in a container'],
  ]);
});

// ── F03: recipe without steps/times, English quantities lost ──

test('F03 recipe (de): {title, detail, time} steps, `totalTime`', () => {
  const n = node('recipe-de');
  assert.deepEqual(n.time, { total: 25 });
  const steps = list(n.steps);
  assert.equal(steps.length, 9);
  assert.equal(steps[0].text, 'Wasser aufsetzen: Großer Topf mit Salzwasser zum Kochen bringen (ca. 2 Minuten)');
  assert.equal(steps[0].timerSeconds, 120);
  assert.equal(steps[2].timerSeconds, 600);
  assert.deepEqual(list(n.ingredients)[0], { item: 'Pasta (Penne oder Tagliatelle)', qty: 400, unit: 'g' });
});

test('F03 recipe (en): `amount` quantities, `prepTime`/`cookTime`, steps', () => {
  const n = node('recipe-en');
  assert.deepEqual(n.time, { prep: 15, cook: 10 });
  const ing = list(n.ingredients);
  assert.deepEqual(ing.map((i) => [i.qty, i.unit]), [[400, 'g'], [250, 'g'], [1, 'whole'], [1, 'whole'], [150, 'g'], [4, 'tbsp'], [2, 'tbsp'], [10, 'leaves'], [1, 'pinch']]);
  assert.equal(list(n.steps).length, 5);
  assert.equal(list(n.steps)[0].text, 'Cook the pasta: Boil pasta until al dente, drain and let cool slightly');
});

test('F03 checklist: the amount in `detail` stays visible as the note; `qty` text kept', () => {
  const en = node('checklist-en');
  assert.deepEqual(list(en.items).map((i) => [i.text, i.note]).slice(0, 2), [['Cherry tomatoes', '250g'], ['Cucumber', '1 whole']]);
  assert.deepEqual(list(node('checklist-subtitle-en').items).map((i) => i.note).slice(0, 2), ['2 cups', '1 large']);
  const de = node('checklist-de');
  assert.equal(list(de.items)[0].qty, '400 g');
});

// ── F04: map "no valid places" ──

test('F04 map: `places` with name/lat/lng/address → markers with title and address', () => {
  const n = node('map-salzburg');
  assert.equal(n.type, 'map');
  const m = list(n.markers);
  assert.equal(m.length, 3);
  assert.deepEqual([m[1].title, m[1].lat, m[1].lng], ['Festung Hohensalzburg', 47.8145, 13.0482]);
  assert.match(String(m[0].description), /Mozartplatz 1, 5020 Salzburg/);
});

test('F04 map without coordinates: a readable places list (route button = maps search), never "no valid places"', () => {
  const places = (FIX['map-salzburg'].places as Rec[]).map(({ lat: _lat, lng: _lng, ...rest }) => rest);
  const s = parse(JSON.stringify({ type: 'map', title: 'Salzburg', places }));
  const n = s.node as unknown as Rec;
  assert.equal(n.type, 'places');
  assert.equal(n.title, 'Salzburg');
  assert.deepEqual(list(n.places).map((p) => [p.name, p.address]), places.map((p) => [p.name, p.address]));
  // coordinates in another shape still draw pins
  const nested = parse(JSON.stringify({ type: 'map', locations: [{ name: 'A', coordinates: [47.8, 13.04] }, { name: 'B', position: { latitude: 47.81, longitude: 13.05 } }] }));
  assert.deepEqual(list((nested.node as unknown as Rec).markers).map((m) => [m.title, m.lat]), [['A', 47.8], ['B', 47.81]]);
});

// ── F05: vocab "no vocabulary", quiz as an accordion that shows the answers ──

test('F05 vocab: `word`/`translation` items with `language` → five cards', () => {
  const n = node('vocab');
  assert.equal(n.from, 'en');
  const items = list(n.items);
  assert.equal(items.length, 5);
  assert.deepEqual([items[0].term, items[0].translation, items[0].example], ['passport', 'Reisepass', 'I need my passport to travel abroad.']);
});

test('F05 quiz: `items` with `question` and the answer as option text → a real quiz (answers hidden until tried)', () => {
  const n = node('quiz');
  assert.equal(n.type, 'quiz');
  const q = list(n.questions);
  assert.equal(q.length, 5);
  assert.deepEqual([q[0].q, q[0].answer], ['What do you need to travel to another country?', 1]);
  assert.deepEqual(q.map((x) => x.answer), [1, 1, 0, 1, 2]);
  assert.equal(list(node('quiz-harder').questions)[0].answer, 0);
  // other answer shapes: letter, flagged option objects
  const flagged = parse(JSON.stringify({ type: 'quiz', questions: [{ question: 'Q?', options: [{ text: 'a' }, { text: 'b', correct: true }] }, { q: 'R?', options: ['x', 'y'], correctAnswer: 'B' }] }));
  assert.deepEqual(list((flagged.node as unknown as Rec).questions).map((x) => x.answer), [1, 1]);
});

test('F05 quiz that still cannot be graded: the readable fallback lists questions and options but never the solution', () => {
  const bad = { type: 'quiz', id: 'q', items: (FIX.quiz.items as Rec[]).map((it) => ({ ...it, correct: 'none of these', explanation: 'Because passport.' })) };
  const s = parse(JSON.stringify(bad));
  assert.equal(s.fallback, true);
  const json = JSON.stringify(s.node);
  assert.match(json, /What do you need to travel to another country\?/);
  assert.match(json, /luggage · passport · itinerary/);
  assert.doesNotMatch(json, /Correct|none of these|Because passport/);
});

// ── F06: translation as a code block ──

test('F06 translation: a ```translation fence with {language, original, translated} is a translation card', () => {
  const n = node('translation', 'translation');
  assert.equal(n.type, 'translation');
  assert.match(String((n.source as Rec).text), /^Hallo, leider schaffe ich es morgen/);
  assert.deepEqual(list(n.targets).map((t) => t.lang), ['en']);
  assert.match(String(list(n.targets)[0].text), /^Hi, unfortunately I can't make it until 3:30 PM tomorrow/);
});

// ── F01: unknown `remind` component ──

test('F01 unknown type (`remind`): passes through for the UnknownNode view, whose readable content has no JSON', () => {
  const s = parse(JSON.stringify(FIX.remind));
  assert.equal((s.node as unknown as Rec).type, 'remind');
  const r = readableFallback(s.node) as unknown as Rec;
  assert.equal(r.type, 'card');
  assert.equal(r.title, 'Tee kaufen');
  assert.deepEqual(list(r.children).map((c) => c.text), ['**Time:** 09:00']);
});

// ── F07: the two timer blocks ──

test('F07 timers: both follow-up blocks get the same generated id (so only an explicit id links them on its own)', () => {
  const a = node('timer-2min');
  const b = node('timer-3min');
  assert.deepEqual([a.seconds, b.seconds], [120, 180]);
  assert.match(String(a.id), /^timer-seg-\d+$/);
  assert.equal(a.id, b.id);
});

// ── every component: malformed / partial input never renders as nothing ──

test('every node type: list content under unexpected names is shown (as the node or as the readable fallback)', () => {
  for (const type of HUI_NODE_TYPES) {
    const raw = { type, id: 'x', zzz: [{ name: 'Alpha', detail: 'first entry' }, { name: 'Beta', detail: 'second entry' }] };
    const s = parse(JSON.stringify(raw));
    assert.ok(s.complete, type);
    assert.ok(s.node || s.error, `${type}: neither node nor error`);
    if (s.node && !s.fallback) assert.equal(isEmptyCollection(s.node), false, `${type}: empty node although the block had entries`);
    if (s.fallback) assert.match(JSON.stringify(s.node), /Alpha/, `${type}: fallback shows the entries`);
  }
});

test('every node type: a block with content never ends as the bare "no data" line (emptyNode.ts)', () => {
  for (const type of HUI_NODE_TYPES) {
    for (const raw of [{ type, message: 'Alpha content' }, { type, title: 'T', entries: [{ label: 'Alpha', value: 'one' }] }]) {
      const s = parse(JSON.stringify(raw));
      if (s.fallback) assert.match(JSON.stringify(s.node), /Alpha/, `${type}: fallback shows the content`);
      else assert.equal(isEmptyNode(s.node), false, `${type}: ${JSON.stringify(raw)} shown as "no data"`);
    }
  }
  // labels/settings alone are not content: the quiet line (with its label) stays
  assert.equal(parse(JSON.stringify({ type: 'poll', question: 'Wann?', options: [] })).fallback, undefined);
});

test('every node type: bare, wrong-typed and half-streamed blocks parse without throwing and end visible', () => {
  for (const type of HUI_NODE_TYPES) {
    for (const raw of [{ type }, { type, items: 'oops', options: 7, blocks: null, places: {}, markers: [1, 2] }]) {
      const s = parse(JSON.stringify(raw));
      assert.ok(s.complete && (s.node || s.error), `${type}: ${JSON.stringify(raw)}`);
    }
    // the stream cut mid-block (no closing fence): still one segment, no throw
    const p = createStreamParser();
    p.push('```hui\n{"type":"' + type + '","items":[{"name":"Al');
    assert.ok(p.segments().some((x) => x.kind === 'hui'), `${type}: streaming segment`);
    p.end();
  }
  // every real block streamed in small chunks ends as the same node as parsed at once
  for (const [key, block] of Object.entries(FIX)) {
    const raw = '```hui\n' + JSON.stringify(block, null, 2) + '\n```\n';
    const once = createStreamParser();
    once.push(raw);
    once.end();
    const p = createStreamParser();
    for (let i = 0; i < raw.length; i += 7) p.push(raw.slice(i, i + 7));
    p.end();
    const hui = (q: typeof p) => q.segments().find((x): x is Hui => x.kind === 'hui')!.node;
    assert.ok(hui(p), key);
    assert.deepEqual(hui(p), hui(once), key);
  }
});

test('parseDuration: the duration texts models write', () => {
  assert.equal(parseDuration('45 Sekunden'), 45);
  assert.equal(parseDuration('30 seconds'), 30);
  assert.equal(parseDuration('2 Min'), 120);
  assert.equal(parseDuration('1:30'), 90);
  assert.equal(parseDuration('1 h 20 min'), 4800);
  assert.equal(parseDuration(25, 60), 1500);
  assert.equal(parseDuration('So viele wie möglich'), undefined);
  assert.equal(parseDuration('25', 60), 1500);
});
