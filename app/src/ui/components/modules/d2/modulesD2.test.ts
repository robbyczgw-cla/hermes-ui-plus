import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adjust,
  countdown,
  elapsedMs,
  formatCountdown,
  formatElapsed,
  nextEnd,
  parseClock,
  parseUntil,
  pause,
  progress,
  remainingMs,
  reset,
  settle,
  settleMap,
  splitDuration,
  start,
  stopwatch,
  wholeMinutes,
} from './timerEngine.ts';
import { normalizeTimer, timerIsEmpty } from './timerModel.ts';
import { allDone, bodyBlocks, clampStep, doneCount, finishReply, nextOpen, normalizeGuide, stuckReply, toggleDone } from './guideModel.ts';
import { exerciseLine, normalizeWorkout, patchSet, setsOf, summaryRows, toggleSet, totals, workoutReply, type SetsState } from './workoutModel.ts';

const T0 = 1_700_000_000_000;

/* ───────── timer engine ───────── */

test('engine: countdown start → absolute end, survives "restart" (pure timestamps)', () => {
  const c = start(countdown(90), T0);
  assert.equal(c.status, 'running');
  assert.equal(c.endsAt, T0 + 90_000);
  // a "restart" = same persisted object, later now
  const restored = parseClock(JSON.parse(JSON.stringify(c)));
  assert.ok(restored);
  assert.equal(remainingMs(restored, T0 + 30_000), 60_000);
  assert.equal(progress(restored, T0 + 45_000), 0.5);
  assert.equal(settle(restored, T0 + 89_999).status, 'running');
  const done = settle(restored, T0 + 90_000);
  assert.equal(done.status, 'done');
  assert.equal(remainingMs(done, T0 + 99_000), 0);
  assert.equal(progress(done, T0), 1);
});

test('engine: pause freezes remaining, resume re-anchors, reset returns to full', () => {
  let c = start(countdown(60), T0);
  c = pause(c, T0 + 20_000);
  assert.equal(c.status, 'paused');
  assert.equal(c.endsAt, null);
  assert.equal(remainingMs(c, T0 + 999_999), 40_000);
  c = start(c, T0 + 100_000);
  assert.equal(c.endsAt, T0 + 140_000);
  c = reset(c);
  assert.equal(c.status, 'idle');
  assert.equal(remainingMs(c, T0), 60_000);
  // pausing after the end settles as done
  assert.equal(pause(start(countdown(5), T0), T0 + 6000).status, 'done');
  // restart a done timer = full duration again
  const again = start(settle(start(countdown(5), T0), T0 + 5000), T0 + 10_000);
  assert.equal(again.endsAt, T0 + 15_000);
});

test('engine: ±1 min shifts the end, never below 1 s, idle changes the duration', () => {
  let c = start(countdown(120), T0);
  c = adjust(c, 60_000, T0 + 10_000);
  assert.equal(c.endsAt, T0 + 10_000 + 170_000);
  assert.equal(c.totalMs, 180_000);
  c = adjust(c, -60_000, T0 + 10_000);
  assert.equal(remainingMs(c, T0 + 10_000), 110_000);
  // near the end: clamps at 1 s
  const late = adjust(start(countdown(30), T0), -60_000, T0 + 5000);
  assert.equal(remainingMs(late, T0 + 5000), 1000);
  // idle: new full duration (reset returns to it)
  const idle = adjust(countdown(300), 60_000, T0);
  assert.equal(idle.totalMs, 360_000);
  assert.equal(reset(idle).accMs, 360_000);
  // done + plus → runs again for the delta
  const d = adjust(settle(start(countdown(5), T0), T0 + 6000), 60_000, T0 + 7000);
  assert.equal(d.status, 'running');
  assert.equal(d.endsAt, T0 + 67_000);
  // stopwatches ignore adjust
  const sw = stopwatch();
  assert.equal(adjust(sw, 60_000, T0), sw);
});

test('engine: stopwatch accumulates across pause/resume', () => {
  let s = start(stopwatch(), T0);
  assert.equal(elapsedMs(s, T0 + 5000), 5000);
  s = pause(s, T0 + 5000);
  assert.equal(elapsedMs(s, T0 + 60_000), 5000);
  s = start(s, T0 + 60_000);
  assert.equal(elapsedMs(s, T0 + 62_500), 7500);
  assert.equal(progress(s, T0 + 62_500), 7500 / 60_000);
  assert.equal(settle(s, T0 + 10e9), s); // never "done"
  assert.equal(reset(s).accMs, 0);
});

test('engine: settleMap / nextEnd / parseClock tolerate junk', () => {
  const map = { a: start(countdown(10), T0), b: start(countdown(20), T0), c: stopwatch() };
  assert.equal(nextEnd(map), T0 + 10_000);
  const r = settleMap(map, T0 + 15_000);
  assert.deepEqual(r.done, ['a']);
  assert.equal(r.clocks.a?.status, 'done');
  assert.equal(r.clocks.b, map.b);
  assert.equal(settleMap(map, T0).clocks, map);
  assert.equal(parseClock(null), null);
  assert.equal(parseClock({ mode: 'countdown', status: 'running', totalMs: 1000 }), null); // running without end
  assert.equal(parseClock({ mode: 'x', status: 'idle' }), null);
});

test('engine: formatting and until parsing', () => {
  assert.equal(formatCountdown(61_001), '1:02'); // rounds up
  assert.equal(formatCountdown(3_600_000), '1:00:00');
  assert.equal(formatCountdown(-5), '0:00');
  assert.equal(formatElapsed(61_999), '1:01'); // rounds down
  assert.equal(wholeMinutes(0), 0);
  assert.equal(wholeMinutes(20_000), 1);
  assert.equal(wholeMinutes(42 * 60_000 + 20_000), 42);
  assert.deepEqual(splitDuration(2 * 86_400_000 + 3_723_000), { days: 2, h: 1, m: 2, s: 3 });
  const local = parseUntil('2026-12-24T18:00');
  assert.equal(local, new Date(2026, 11, 24, 18, 0).getTime());
  assert.equal(parseUntil('2026-12-24'), new Date(2026, 11, 24).getTime());
  assert.equal(parseUntil('2026-12-24T18:00:00Z'), Date.UTC(2026, 11, 24, 18));
  assert.equal(parseUntil('morgen'), null);
  assert.equal(parseUntil(42), null);
});

/* ───────── timer node ───────── */

test('timer node: v1 compat, until, stopwatch, multi', () => {
  assert.deepEqual(normalizeTimer({ type: 'timer', id: 'x', label: 'Eier', seconds: 420, autostart: true }), { kind: 'countdown', label: 'Eier', seconds: 420, autostart: true });
  assert.ok(timerIsEmpty(normalizeTimer({ type: 'timer', label: 'Teig' })));
  assert.equal(normalizeTimer({ label: '  ', seconds: 5 }).label, 'Timer');
  const u = normalizeTimer({ label: 'Silvester', until: '2026-12-31T23:59:59' });
  assert.equal(u.kind, 'until');
  assert.equal(normalizeTimer({ mode: 'stopwatch' }).kind, 'stopwatch');
  const m = normalizeTimer({ label: 'Pasta', timers: [{ label: 'Nudeln', seconds: 540 }, { label: 'Soße', seconds: 0 }, { id: 'b', label: '', seconds: 120 }, ...Array(8).fill({ label: 'x', seconds: 1 })] });
  assert.equal(m.kind, 'multi');
  if (m.kind !== 'multi') return;
  assert.equal(m.items.length, 6);
  assert.deepEqual(m.items.slice(0, 2).map((i) => [i.label, i.seconds]), [['Nudeln', 540], ['Pasta 2', 120]]);
  assert.equal(m.items[1].key, 'i:b');
  assert.equal(new Set(m.items.map((i) => i.key)).size, 6);
});

/* ───────── guide ───────── */

const GUIDE = {
  type: 'guide',
  id: 'schlauch',
  title: 'Fahrradschlauch wechseln',
  steps: [
    { title: 'Rad ausbauen', body: 'Bremse öffnen.\n\n- Schnellspanner lösen\n- Rad herausziehen' },
    { id: 'reifen', title: 'Reifen abhebeln', body: '', tip: 'Reifenheber nutzen' },
    { title: 'Kleber trocknen lassen', body: 'Warten.', seconds: 300 },
    'Aufpumpen',
    { body: 'Nur ein Text ohne Titel, der etwas länger ist als sechzig Zeichen damit er gekürzt wird.' },
    { title: '', body: '' },
  ],
};

test('guide: normalise steps (ids, string steps, body-only, timers)', () => {
  const g = normalizeGuide(GUIDE);
  assert.equal(g.steps.length, 5);
  assert.deepEqual(g.steps.map((s) => s.key), ['s0', 'reifen', 's2', 's3', 's4']);
  assert.equal(g.steps[2].seconds, 300);
  assert.equal(g.steps[3].title, 'Aufpumpen');
  assert.equal(g.steps[4].body, '');
  assert.ok(g.steps[4].title.length <= 60);
  assert.equal(g.steps[1].tip, 'Reifenheber nutzen');
  const dup = normalizeGuide({ steps: [{ id: 'a', title: 'x' }, { id: 'a', title: 'y' }] });
  assert.deepEqual(dup.steps.map((s) => s.key), ['a', 'a-2']);
});

test('guide: progress helpers', () => {
  const { steps } = normalizeGuide(GUIDE);
  let done: string[] = [];
  done = toggleDone(done, 's0');
  done = toggleDone(done, 'reifen');
  assert.equal(doneCount(steps, [...done, 'stale']), 2);
  assert.equal(nextOpen(steps, done, 0), 2);
  assert.equal(nextOpen(steps, done, 4), 4);
  assert.equal(toggleDone(done, 's0', true), done);
  assert.deepEqual(toggleDone(done, 's0'), ['reifen']);
  assert.equal(allDone(steps, done), false);
  assert.equal(allDone(steps, steps.map((s) => s.key)), true);
  assert.equal(nextOpen(steps, steps.map((s) => s.key)), -1);
  assert.equal(clampStep(99, 5), 4);
  assert.equal(clampStep(-1, 5), 0);
  assert.equal(clampStep(3, 0), 0);
});

test('guide: replies follow the spec format', () => {
  assert.equal(stuckReply('schlauch', 2, 'Kleber trocknen lassen', ' Der Flicken\nhält nicht '), '[guide:schlauch] Schritt 3 („Kleber trocknen lassen“): Ich hänge fest – Der Flicken hält nicht');
  assert.equal(stuckReply('schlauch', 0, 'Rad ausbauen'), '[guide:schlauch] Schritt 1 („Rad ausbauen“): Ich hänge fest');
  assert.equal(finishReply('schlauch'), '[guide:schlauch] Fertig');
});

test('guide: body blocks', () => {
  assert.deepEqual(bodyBlocks('Bremse öffnen.\nDann weiter.\n\n- a\n- b\n1. eins\n2) zwei\n## Kopf'), [
    { kind: 'p', text: 'Bremse öffnen. Dann weiter.' },
    { kind: 'ul', items: ['a', 'b'] },
    { kind: 'ol', items: ['eins', 'zwei'] },
    { kind: 'p', text: '**Kopf**' },
  ]);
});

/* ───────── workout ───────── */

const WORKOUT = {
  type: 'workout',
  id: 'gk30',
  title: 'Ganzkörper 30 min',
  kind: 'strength',
  warmup: '5 min locker',
  exercises: [
    { name: 'Kniebeuge', sets: 3, reps: 10, weight: '60 kg', restSeconds: 90 },
    { name: 'Liegestütze', sets: 3, reps: '12' },
    { name: 'Plank', sets: 2, seconds: 45, restSeconds: 0 },
    { name: 'Seilspringen', sets: 1 },
    { name: '' },
  ],
};

test('workout: normalise exercises', () => {
  const m = normalizeWorkout(WORKOUT);
  assert.equal(m.exercises.length, 4);
  assert.deepEqual(m.exercises.map((e) => [e.key, e.sets, e.reps ?? null, e.restSeconds]), [
    ['e0', 3, '10', 90],
    ['e1', 3, '12', 60],
    ['e2', 2, null, 0],
    ['e3', 1, null, 60],
  ]);
  assert.equal(m.kind, 'strength');
  assert.equal(normalizeWorkout({ exercises: [{ name: 'x', sets: 99 }] }).exercises[0].sets, 20);
});

test('workout: set progress, edits, totals', () => {
  const m = normalizeWorkout(WORKOUT);
  const [squat, push] = m.exercises;
  let s: SetsState = {};
  let r = toggleSet(s, squat, 0);
  assert.equal(r.done, true);
  s = r.state;
  s = toggleSet(s, squat, 1).state;
  s = patchSet(s, squat, 1, { weight: '62,5' });
  assert.deepEqual(setsOf(squat, s).map((x) => !!x.done), [true, true, false]);
  assert.deepEqual(totals(m, s), { done: 2, total: 9 });
  r = toggleSet(s, squat, 1);
  assert.equal(r.done, false);
  assert.equal(totals(m, r.state).done, 1);
  assert.equal(patchSet(s, push, 7, { reps: '1' }), s); // out of range
  assert.equal(toggleSet(s, push, 9).state, s);
});

test('workout: summary lines', () => {
  const m = normalizeWorkout(WORKOUT);
  const [squat, push, plank, rope] = m.exercises;
  let s: SetsState = {};
  for (let i = 0; i < 3; i++) s = toggleSet(s, squat, i).state;
  assert.equal(exerciseLine(squat, s), '3×10 @ 60 kg');
  s = patchSet(s, squat, 2, { weight: '62,5 kg' });
  assert.equal(exerciseLine(squat, s), '3×10 @ 60/62,5 kg');
  s = toggleSet(s, push, 0).state;
  s = toggleSet(s, push, 1).state;
  s = patchSet(s, push, 1, { reps: '8' });
  assert.equal(exerciseLine(push, s), '12/8');
  s = toggleSet(s, plank, 0).state;
  assert.equal(exerciseLine(plank, s), '1×45 s');
  assert.equal(exerciseLine(rope, s), '');
  s = toggleSet(s, rope, 0).state;
  assert.equal(exerciseLine(rope, s), '1 Satz');
  const bare = normalizeWorkout({ exercises: [{ name: 'Rudern', sets: 2, reps: 10, weight: '40' }] }).exercises[0];
  assert.equal(exerciseLine(bare, toggleSet(toggleSet({}, bare, 0).state, bare, 1).state), '2×10 @ 40 kg');
  const rows = summaryRows(m, s);
  assert.deepEqual(rows.map((x) => [x.done, x.total]), [[3, 3], [2, 3], [1, 2], [1, 1]]);
});

test('workout: reply text', () => {
  const m = normalizeWorkout(WORKOUT);
  const [squat, push] = m.exercises;
  let s: SetsState = {};
  for (let i = 0; i < 3; i++) s = toggleSet(s, squat, i).state;
  for (let i = 0; i < 3; i++) s = toggleSet(s, push, i).state;
  assert.equal(
    workoutReply('gk30', m, s, 42 * 60_000 + 10_000),
    '[workout:gk30] 6/9 Sätze · 42 min · Kniebeuge 3×10 @ 60 kg · Liegestütze 3×12 · ausgelassen: Plank, Seilspringen',
  );
  assert.equal(workoutReply('gk30', m, {}, 0), '[workout:gk30] 0/9 Sätze');
  // long workouts are capped
  const big = normalizeWorkout({ exercises: Array.from({ length: 20 }, (_, i) => ({ name: `Übung mit einem sehr langen Namen Nummer ${i}`, sets: 5, reps: 10, weight: '100 kg' })) });
  let all: SetsState = {};
  for (const ex of big.exercises) for (let i = 0; i < 5; i++) all = toggleSet(all, ex, i).state;
  const long = workoutReply('w', big, all, 3_600_000);
  assert.ok(long.length <= 705, String(long.length));
  assert.ok(long.endsWith(' …'));
});

import { timerSubtitle } from './timerModel.ts';
test('timer subtitle: no duplicate of the title, falls back to the mode', () => {
  assert.equal(timerSubtitle('1 Minute', '1 Minute', 'Countdown'), 'Countdown');
  assert.equal(timerSubtitle('Nudeln', '10 Minuten', 'Countdown'), '10 Minuten');
  assert.equal(timerSubtitle(' 1  minute ', '1 Minute', 'Countdown'), 'Countdown');
});
