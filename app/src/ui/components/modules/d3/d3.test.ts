import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_STUDY_STATE,
  formatMinutes,
  labelMatchesDate,
  planTasks,
  progressOf,
  readStudyPlan,
  studyReply,
  todayTarget,
  toggleDay,
  toggleTask,
  weekTasks,
  weekdayOfLabel,
} from './studyplanModel.ts';
import {
  INITIAL_VOCAB_STATE,
  advanceRun,
  answerCurrent,
  answerVariants,
  boxCounts,
  boxInterval,
  choiceOptions,
  compareAnswer,
  editDistance,
  foldAnswer,
  foldText,
  nextBox,
  pickSession,
  readVocab,
  startRun,
  summarize,
  syncRun,
  vocabReply,
  type VocabState,
} from './vocabModel.ts';
import {
  MAX_NODES,
  countNodes,
  deepenReply,
  fitView,
  isCollapsed,
  layoutMindmap,
  measureLabel,
  outlineRows,
  pickLayout,
  readMindmap,
  viewportHeight,
  wrapLabel,
  zoomAt,
  type BoxMetrics,
  type LayoutOptions,
  type MindNode,
} from './mindmapModel.ts';
import { STUDYPLAN_SAMPLE, VOCAB_SAMPLE, MINDMAP_SAMPLE } from './samples.ts';

/* ───────────── studyplan ───────────── */

const plan = readStudyPlan({
  id: 'sp',
  title: 'Plan',
  weeks: [
    { label: 'Woche 1: Grundlagen', days: [{ label: 'Mo', tasks: [{ text: 'A', minutes: 20, kind: 'learn' }, 'B'] }, { label: 'Mi', tasks: [{ text: 'C', minutes: 10, kind: 'nope' }] }] },
    { label: 'Woche 2', days: [{ label: 'Mo', tasks: [{ id: 'x', text: 'D' }, { text: '' }] }] },
    { label: '', days: [] },
  ],
});

test('studyplan: reader keeps normalizeNode ids, drops empty tasks/weeks and bad kinds', () => {
  assert.equal(plan.weeks.length, 2);
  assert.deepEqual(planTasks(plan).map((t) => t.id), ['t0-0-0', 't0-0-1', 't0-1-0', 'x']);
  assert.equal(plan.weeks[0].days[1].tasks[0].kind, undefined);
  assert.equal(plan.weeks[0].days[0].tasks[0].kind, 'learn');
  assert.equal(plan.weeks[1].id, 'w1');
  assert.deepEqual(readStudyPlan({ title: 'x' }).weeks, []);
});

test('studyplan: progress per week / overall + toggles', () => {
  let s = toggleTask(INITIAL_STUDY_STATE, 't0-0-0');
  let p = progressOf(weekTasks(plan.weeks[0]), s.done);
  assert.deepEqual(p, { done: 1, total: 3, ratio: 1 / 3, minutes: 30, minutesDone: 20 });
  s = toggleTask(s, 't0-0-0');
  assert.equal(progressOf(planTasks(plan), s.done).done, 0);
  s = toggleDay(s, plan.weeks[0].days[0]);
  assert.equal(progressOf(planTasks(plan), s.done).done, 2);
  s = toggleDay(s, plan.weeks[0].days[0]); // all done → undo all
  assert.equal(progressOf(planTasks(plan), s.done).done, 0);
  assert.equal(progressOf([], {}).ratio, 0);
});

test('studyplan: weekday + date labels', () => {
  assert.equal(weekdayOfLabel('Mo'), 1);
  assert.equal(weekdayOfLabel('Montag · Vokabeln'), 1);
  assert.equal(weekdayOfLabel('Miércoles'), 3);
  assert.equal(weekdayOfLabel('Sábado'), 6);
  assert.equal(weekdayOfLabel('Do'), 4);
  assert.equal(weekdayOfLabel('Tag 3'), -1);
  const d = new Date(2026, 9, 12); // Mon 12 Oct 2026
  assert.ok(labelMatchesDate('Mo 12.10.', d));
  assert.ok(labelMatchesDate('2026-10-12', d));
  assert.ok(!labelMatchesDate('13.10.', d));
  assert.ok(!labelMatchesDate('Tag 12', d));
});

test('studyplan: "Heute" target', () => {
  const mon = new Date(2026, 9, 12);
  const wed = new Date(2026, 9, 14);
  const sun = new Date(2026, 9, 18);
  assert.deepEqual(todayTarget(plan, {}, mon), { week: 0, day: 0 });
  assert.deepEqual(todayTarget(plan, {}, wed), { week: 0, day: 1 });
  // no weekday match → first open day of the current week
  assert.deepEqual(todayTarget(plan, { 't0-0-0': 1, 't0-0-1': 1 }, sun), { week: 0, day: 1 });
  // week 1 done → week 2
  assert.deepEqual(todayTarget(plan, { 't0-0-0': 1, 't0-0-1': 1, 't0-1-0': 1 }, wed), { week: 1, day: 0 });
  // all done → last day
  assert.deepEqual(todayTarget(plan, { 't0-0-0': 1, 't0-0-1': 1, 't0-1-0': 1, x: 1 }, wed), { week: 1, day: 0 });
  // explicit date wins
  const dated = readStudyPlan({ weeks: [{ label: 'W', days: [{ label: 'Mo', tasks: ['a'] }, { label: 'Fr 16.10.', tasks: ['b'] }] }] });
  assert.deepEqual(todayTarget(dated, {}, new Date(2026, 9, 16)), { week: 0, day: 1 });
  assert.equal(todayTarget(readStudyPlan({}), {}, mon), null);
});

test('studyplan: reply', () => {
  assert.equal(studyReply('sp', plan, {}), '[studyplan:sp] Woche 1: 0/3 erledigt · Gesamt: 0/4');
  assert.equal(studyReply('sp', plan, { 't0-0-0': 1, 't0-0-1': 1, 't0-1-0': 1, x: 1 }), '[studyplan:sp] Woche 1: 3/3 erledigt · Woche 2: 1/1 erledigt · Gesamt: 4/4');
  const one = readStudyPlan({ weeks: [{ label: 'Lernwoche', days: [{ label: 'Mo', tasks: ['a', 'b'] }] }] });
  assert.equal(studyReply('x', one, { 't0-0-0': 1 }), '[studyplan:x] Lernwoche: 1/2 erledigt');
  assert.equal(formatMinutes(45), '45 min');
  assert.equal(formatMinutes(90), '1 h 30 min');
  assert.equal(formatMinutes(120), '2 h');
});

test('studyplan: gallery sample', () => {
  const p = readStudyPlan(STUDYPLAN_SAMPLE as Record<string, unknown>);
  assert.equal(p.weeks.length, 4);
  assert.equal(planTasks(p).length, 28);
});

/* ───────────── vocab ───────────── */

test('vocab: reader', () => {
  const v = readVocab({ from: 'es', to: 'de', items: [{ term: 'el perro', translation: 'der Hund' }, { term: '', translation: 'x' }, { id: 'g', term: 'el gato', translation: 'die Katze', example: 'Mi gato duerme.' }], mode: 'type' });
  assert.deepEqual(v.items.map((i) => i.id), ['v0', 'g']);
  assert.equal(v.mode, 'type');
  assert.equal(readVocab({ mode: 'zzz' }).mode, 'cards');
  assert.equal(readVocab({}).from, 'und');
});

test('vocab: tolerant compare', () => {
  assert.equal(compareAnswer('el perro', 'el perro', 'es'), 'exact');
  assert.equal(compareAnswer(' El Perro ', 'el perro', 'es'), 'exact');
  assert.equal(compareAnswer('perro', 'el perro', 'es'), 'close');
  assert.equal(compareAnswer('la manzana', 'manzana', 'es'), 'close');
  assert.equal(compareAnswer('cancion', 'la canción', 'es'), 'close');
  assert.equal(compareAnswer('¿Qué tal?', 'que tal', 'es'), 'close');
  assert.equal(compareAnswer('ano', 'el año', 'es'), 'close');
  assert.equal(compareAnswer('Hund', 'der Hund', 'de'), 'close');
  assert.equal(compareAnswer('strasse', 'die Straße', 'de'), 'close');
  assert.equal(compareAnswer('manzanna', 'la manzana', 'es'), 'typo');
  assert.equal(compareAnswer('gato', 'el pato', 'es'), 'wrong'); // short words: no typo tolerance
  assert.equal(compareAnswer('', 'el perro', 'es'), 'wrong');
  assert.equal(compareAnswer('el', 'el perro', 'es'), 'wrong');
  assert.equal(compareAnswer('carro', 'el coche / el carro', 'es'), 'close');
  assert.equal(compareAnswer('car', 'car (vehicle)', 'en'), 'exact');
  assert.equal(compareAnswer("l'eau", "l'eau", 'fr'), 'exact');
  assert.equal(compareAnswer('eau', "l'eau", 'fr'), 'close');
  assert.equal(foldText('¡Hola, señor!'), 'hola senor');
  assert.equal(foldAnswer('Der Hund', 'de'), 'hund');
  assert.equal(foldAnswer('Die', 'de'), 'die'); // a lone article stays
  assert.deepEqual(answerVariants('a / b; c'), ['a', 'b', 'c']);
  assert.equal(editDistance('kitten', 'sitting', 5), 3);
  assert.equal(editDistance('abc', 'abcdef', 1), 2);
});

test('vocab: Leitner boxes', () => {
  assert.equal(nextBox(1, true), 2);
  assert.equal(nextBox(5, true), 5);
  assert.equal(nextBox(4, false), 1);
  assert.deepEqual([1, 2, 3, 4, 5].map(boxInterval), [1, 2, 4, 8, 16]);
});

const v = readVocab(VOCAB_SAMPLE as Record<string, unknown>);

test('vocab: session picks due items, lowest box first, tops up', () => {
  assert.equal(v.items.length, 12);
  const all = pickSession(v.items, INITIAL_VOCAB_STATE, 1);
  assert.equal(all.length, 12);
  // everything in box 2 seen last session, except one in box 1 → only that is due; topped up to 5
  const s: VocabState = { boxes: {}, seen: {}, session: 1, run: null };
  for (const it of v.items) {
    s.boxes[it.id] = 2;
    s.seen[it.id] = 1;
  }
  s.boxes.v3 = 1;
  const next = pickSession(v.items, s, 2);
  assert.equal(next[0], 'v3');
  assert.equal(next.length, 5);
  // a session later, box 2 items are due again
  assert.equal(pickSession(v.items, s, 3).length, 12);
  assert.equal(pickSession(v.items, INITIAL_VOCAB_STATE, 1, 4).length, 4);
});

test('vocab: run → answers move boxes, summary + reply', () => {
  let s = startRun(v.items, INITIAL_VOCAB_STATE, 'quiz', 7);
  assert.equal(s.session, 1);
  assert.equal(s.run!.queue.length, 12);
  assert.deepEqual([...s.run!.queue].sort(), v.items.map((i) => i.id).sort());
  const first = s.run!.queue[0];
  s = answerCurrent(s, false);
  s = answerCurrent(s, true); // second answer for the same item is ignored
  assert.equal(s.boxes[first], 1);
  assert.equal(s.run!.results[first], false);
  for (let k = 1; k < 12; k++) {
    s = advanceRun(s);
    s = answerCurrent(s, true);
  }
  assert.equal(s.run!.finished, false);
  s = advanceRun(s);
  assert.equal(s.run!.finished, true);
  assert.deepEqual(boxCounts(v.items, s), [1, 11, 0, 0, 0]);
  const sum = summarize(v.items, s.run!);
  assert.equal(sum.correct, 11);
  assert.equal(sum.total, 12);
  const hard = v.items.find((i) => i.id === first)!;
  assert.equal(vocabReply('es-a1', sum), `[vocab:es-a1] 11/12 richtig · schwierig: ${hard.term}`);
  assert.equal(vocabReply('x', { correct: 2, total: 2, hard: [] }), '[vocab:x] 2/2 richtig');
  // items removed later → run stays usable
  const fewer = v.items.slice(0, 3);
  const synced = syncRun(s, fewer);
  assert.ok(synced.run!.queue.every((id) => fewer.some((f) => f.id === id)));
  assert.equal(syncRun(s, []).run, null);
});

test('vocab: multiple choice options are stable and distinct', () => {
  const it = v.items[0];
  const a = choiceOptions(v.items, it, 42);
  const b = choiceOptions(v.items, it, 42);
  assert.deepEqual(a, b);
  assert.equal(a.options.length, 4);
  assert.equal(a.options[a.answer], it.translation);
  assert.equal(new Set(a.options).size, 4);
  const two = choiceOptions(v.items.slice(0, 2), it, 1);
  assert.equal(two.options.length, 2);
});

/* ───────────── mindmap ───────────── */

const metrics = (depth: number): BoxMetrics => ({ fontSize: depth === 0 ? 16 : 13, lineHeight: depth === 0 ? 22 : 18, maxChars: depth === 0 ? 18 : 16, maxLines: 2, padX: 10, padY: 6, minW: 48 });
const opts = (over: Partial<LayoutOptions> = {}): LayoutOptions => ({ mode: 'balanced', metrics, hGap: 28, vGap: 10, margin: 12, collapsed: () => false, ...over });

test('mindmap: reader applies depth/node limits and path ids', () => {
  const deep = { root: { label: 'r', children: [{ label: 'a', children: [{ label: 'b', children: [{ label: 'c', children: [{ label: 'd', children: [{ label: 'e' }] }] }] }] }, { label: '' }, { label: 'f' }] } };
  const m = readMindmap(deep);
  assert.equal(m.count, 6);
  assert.equal(m.root!.children[1].id, 'm-2');
  assert.equal(m.root!.children[1].branch, 1);
  const kids = Array.from({ length: 80 }, (_, i) => ({ label: `n${i}` }));
  assert.equal(readMindmap({ root: { label: 'r', children: kids } }).count, MAX_NODES);
  assert.equal(readMindmap({ root: {} }).root, null);
  assert.equal(readMindmap({ root: { id: 'x', label: 'R', children: [{ id: 'x', label: 'dup' }] } }).root!.children[0].id, 'x~');
});

test('mindmap: label wrap', () => {
  assert.deepEqual(wrapLabel('Wärmepumpe', 16, 2), ['Wärmepumpe']);
  assert.deepEqual(wrapLabel('Jahresarbeitszahl und Effizienz', 16, 2), ['Jahresarbeitsza…', 'und Effizienz']);
  assert.deepEqual(wrapLabel('one two three four five six', 9, 2), ['one two', 'three…']);
  assert.deepEqual(wrapLabel('a b', 9, 1), ['a b']);
  const box = measureLabel('Heizung', metrics(1));
  assert.equal(box.lines.length, 1);
  assert.ok(box.w >= 48 && box.h === 30);
});

function overlaps(nodes: { x: number; y: number; w: number; h: number }[]): boolean {
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return true;
    }
  return false;
}

test('mindmap: balanced + right layouts – no overlaps, inside bounds, edges per child', () => {
  const m = readMindmap(MINDMAP_SAMPLE as Record<string, unknown>);
  const root = m.root!;
  for (const mode of ['balanced', 'right'] as const) {
    const l = layoutMindmap(root, opts({ mode }));
    assert.equal(l.nodes.length, countNodes(root));
    assert.equal(l.edges.length, l.nodes.length - 1);
    assert.ok(!overlaps(l.nodes), `${mode}: overlap`);
    for (const n of l.nodes) {
      assert.ok(n.x >= 0 && n.y >= 0 && n.x + n.w <= l.width + 0.01 && n.y + n.h <= l.height + 0.01, `${mode}: ${n.id} out of bounds`);
      if (n.parent) {
        const p = l.nodes.find((q) => q.id === n.parent)!;
        // children sit on their side of the parent
        assert.ok(n.side === 1 ? n.x > p.x + p.w - 0.01 : n.x + n.w < p.x + 0.01, `${mode}: ${n.id} side`);
      }
    }
    if (mode === 'balanced') {
      assert.ok(l.nodes.some((n) => n.side === -1) && l.nodes.some((n) => n.side === 1 && n.depth === 1));
      assert.ok(l.edges.every((e) => /^M[\d.]+ [\d.]+ C/.test(e.d)));
    } else assert.ok(l.nodes.every((n) => n.side === 1));
  }
});

test('mindmap: collapse hides subtrees, default collapse for big maps', () => {
  const m = readMindmap(MINDMAP_SAMPLE as Record<string, unknown>);
  const root = m.root!;
  const first = root.children[0];
  const l = layoutMindmap(root, opts({ collapsed: (n) => n.id === first.id }));
  const laid = l.nodes.find((n) => n.id === first.id)!;
  assert.ok(laid.collapsed && laid.hidden === countNodes(first) - 1);
  assert.equal(l.nodes.length, countNodes(root) - laid.hidden);
  const big: MindNode = { id: 'r', label: 'r', depth: 0, branch: -1, children: [] };
  const mid: MindNode = { id: 'a', label: 'a', depth: 1, branch: 0, children: [] };
  const lvl2: MindNode = { id: 'b', label: 'b', depth: 2, branch: 0, children: [{ id: 'c', label: 'c', depth: 3, branch: 0, children: [] }] };
  mid.children.push(lvl2);
  big.children.push(mid);
  assert.equal(isCollapsed(lvl2, {}, 30), true);
  assert.equal(isCollapsed(lvl2, {}, 10), false);
  assert.equal(isCollapsed(lvl2, { b: false }, 30), false);
  assert.equal(isCollapsed(mid, {}, 30), false);
  const rows = outlineRows(big, (n) => n.id === 'b');
  assert.deepEqual(rows.map((r) => [r.id, r.path, r.collapsed]), [['r', '', false], ['a', '1', false], ['b', '1.1', true]]);
});

test('mindmap: fit, zoom, layout choice, viewport height', () => {
  const f = fitView(800, 400, 400, 400, 0);
  assert.equal(f.s, 0.5);
  assert.equal(f.tx, 0);
  assert.equal(f.ty, 100);
  assert.deepEqual(fitView(100, 50, 400, 300, 0), { s: 1, tx: 150, ty: 125 }); // never upscales
  const z = zoomAt({ s: 1, tx: 0, ty: 0 }, 2, 100, 100);
  assert.deepEqual(z, { s: 2, tx: -100, ty: -100 });
  assert.equal(zoomAt({ s: 2, tx: 0, ty: 0 }, 10, 0, 0).s, 2.5);
  const m = readMindmap(MINDMAP_SAMPLE as Record<string, unknown>);
  const a = layoutMindmap(m.root!, opts({ mode: 'balanced' }));
  const b = layoutMindmap(m.root!, opts({ mode: 'right' }));
  const best = pickLayout([a, b], 340, 440);
  assert.ok(best === a || best === b);
  const h = viewportHeight(best, 340, 220, 440);
  assert.ok(h >= 220 && h <= 440);
  assert.equal(deepenReply('Kältemittel  R290'), '[mindmap] Erkläre „Kältemittel R290“ genauer');
});
