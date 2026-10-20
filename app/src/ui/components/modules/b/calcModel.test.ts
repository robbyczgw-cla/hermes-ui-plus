import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateRounded,
  buildCalcReply,
  computeOutputs,
  computeSweep,
  formatInputValue,
  initialValues,
  normalizeCalc,
  numberToInputText,
  parseNumberInput,
  rewriteExpr,
  splitHero,
  valueOf,
} from './calcModel.ts';

const NB = ' ';

const KREDIT = {
  type: 'calc',
  id: 'kredit',
  title: 'Kreditrechner',
  inputs: [
    { name: 'kredit', label: 'Kredit', kind: 'slider', min: 1000, max: 100000, step: 500, default: 20000, unit: '€' },
    { name: 'zins', label: 'Zins', kind: 'slider', min: 0, max: 12, step: 0.1, default: 4.5, unit: '%' },
    { name: 'monate', label: 'Laufzeit', kind: 'number', min: 6, max: 120, default: 60, unit: 'Monate' },
  ],
  outputs: [
    { name: 'r', label: 'Monatszins', expr: 'zins / 100 / 12', format: 'percent', decimals: 3 },
    { name: 'rate', label: 'Rate', expr: 'r == 0 ? kredit / monate : kredit * r / (1 - (1 + r) ^ -monate)', format: 'currency', emphasis: true },
    { label: 'Zinsen gesamt', expr: 'rate * monate - kredit', format: 'currency' },
  ],
  chart: { kind: 'line', sweep: { input: 'monate', from: 12, to: 120, steps: 10 }, y: 'rate' },
};

test('normalizeCalc tolerates garbage and partial nodes', () => {
  const m = normalizeCalc({ id: 'x', inputs: [null, { name: '1bad' }, { name: 'a', kind: 'weird', default: '3' }, { name: 'a' }], outputs: [{ label: 'no expr' }, { expr: 'a * 2' }] });
  assert.equal(m.inputs.length, 1);
  assert.equal(m.inputs[0].kind, 'number');
  assert.equal(m.inputs[0].default, 3);
  assert.equal(m.outputs.length, 1);
  assert.equal(m.outputs[0].label, 'Ergebnis');
  assert.deepEqual(normalizeCalc(undefined).inputs, []);
  assert.equal(normalizeCalc({ ...KREDIT, chart: { sweep: { input: 'nope', from: 1, to: 2 }, y: 'x' } }).chart, undefined);
});

test('initial values: slider clamped + snapped, select falls back to first option, toggle', () => {
  const m = normalizeCalc({
    inputs: [
      { name: 's', kind: 'slider', min: 0, max: 10, step: 0.5, default: 99 },
      { name: 't', kind: 'slider', min: 0, max: 10, step: 0.5, default: 3.3 },
      { name: 'sel', kind: 'select', options: [{ label: 'A', value: 1 }, { label: 'B', value: 2 }], default: 7 },
      { name: 'sel2', kind: 'select', options: ['1', '2'], default: 2 },
      { name: 'tg', kind: 'toggle', default: true },
    ],
    outputs: [],
  });
  assert.deepEqual(initialValues(m.inputs), { s: 10, t: 3.5, sel: 1, sel2: 2, tg: true });
  // stored values are validated against the input kind
  assert.equal(valueOf(m.inputs[2], { sel: 99 }), 1);
  assert.equal(valueOf(m.inputs[4], { tg: 'x' as unknown as boolean }), true);
  assert.equal(valueOf(m.inputs[0], { s: null }), null);
});

test('parseNumberInput: German / English formats and field errors', () => {
  const inp = { min: 0, max: 100000, unit: '€' };
  assert.deepEqual(parseNumberInput('1234,5', inp), { ok: true, value: 1234.5 });
  assert.deepEqual(parseNumberInput('20.000', inp), { ok: true, value: 20000 });
  assert.deepEqual(parseNumberInput('1.234,56 €', inp), { ok: true, value: 1234.56 });
  assert.deepEqual(parseNumberInput('1,234.5', inp), { ok: true, value: 1234.5 });
  assert.deepEqual(parseNumberInput('12.5', inp), { ok: true, value: 12.5 });
  assert.deepEqual(parseNumberInput(' 1 000 ', inp), { ok: true, value: 1000 });
  assert.deepEqual(parseNumberInput('', inp), { ok: false, error: 'Bitte einen Wert eingeben' });
  assert.deepEqual(parseNumberInput('abc', inp), { ok: false, error: 'Keine gültige Zahl' });
  assert.deepEqual(parseNumberInput('1e400', inp), { ok: false, error: 'Keine gültige Zahl' });
  assert.deepEqual(parseNumberInput('-5', inp), { ok: false, error: `Mindestens 0${NB}€` });
  assert.deepEqual(parseNumberInput('200000', inp), { ok: false, error: `Höchstens 100.000${NB}€` });
  assert.equal(numberToInputText(4.5), '4,5');
  assert.equal(numberToInputText(0.1 + 0.2), '0,3');
  assert.equal(numberToInputText(null), '');
});

test('computeOutputs formats via calc engine; invalid input → "–" (no stale result)', () => {
  const m = normalizeCalc(KREDIT);
  const v = initialValues(m.inputs);
  const rows = computeOutputs(m, v);
  assert.equal(rows[1].text, `372,86${NB}€`);
  assert.equal(rows[0].text, `0,375${NB}%`);
  const { hero, rest } = splitHero(rows);
  assert.equal(hero?.label, 'Rate');
  assert.equal(rest.length, 2);
  const bad = computeOutputs(m, { ...v, monate: null });
  assert.equal(bad[1].text, '–');
  assert.equal(bad[2].text, '–');
  assert.equal(bad[1].value, null);
});

test('division by zero shows "–"; a model expression error shows "nicht berechenbar" with an error message', () => {
  const m = normalizeCalc({ inputs: [{ name: 'a', kind: 'number', default: 1 }, { name: 'b', kind: 'number', default: 0 }], outputs: [{ label: 'q', expr: 'a / b' }, { label: 'oops', expr: 'a + c' }] });
  const rows = computeOutputs(m, initialValues(m.inputs));
  assert.equal(rows[0].text, '–');
  assert.equal(rows[0].error, undefined);
  assert.equal(rows[1].text, 'nicht berechenbar');
  assert.match(rows[1].error ?? '', /Unbekannter Bezeichner/);
});

test('toggle and select feed the engine', () => {
  const m = normalizeCalc({
    inputs: [
      { name: 'km', kind: 'number', default: 10 },
      { name: 'meilen', kind: 'toggle', default: false },
      { name: 'f', kind: 'select', options: [{ label: 'x2', value: 2 }, { label: 'x3', value: 3 }], default: 3 },
    ],
    outputs: [{ label: 'Wert', expr: '(meilen ? km * 0.621371 : km) * f', decimals: 1 }],
  });
  assert.equal(computeOutputs(m, { km: 10, meilen: false, f: 3 })[0].text, '30,0');
  assert.equal(computeOutputs(m, { km: 10, meilen: true, f: 2 })[0].text, '12,4');
  assert.equal(formatInputValue(m.inputs[1], true), 'ja');
  assert.equal(formatInputValue(m.inputs[2], 2), 'x2');
  assert.equal(formatInputValue(normalizeCalc({ inputs: [{ name: 'b', kind: 'number', unit: '€' }], outputs: [] }).inputs[0], 86.4), `86,40${NB}€`);
});

test('sweep for the chart', () => {
  const m = normalizeCalc(KREDIT);
  const pts = computeSweep(m, initialValues(m.inputs));
  assert.ok(pts);
  assert.equal(pts!.length, 10);
  assert.equal(pts![0].x, 12);
  assert.ok(pts![0].y > pts![9].y);
});

test('buildCalcReply follows the SPEC format', () => {
  const m = normalizeCalc(KREDIT);
  const v = initialValues(m.inputs);
  const reply = buildCalcReply(m, v, computeOutputs(m, v));
  assert.equal(reply, `[calc:kredit] Kredit 20.000${NB}€ · Zins 4,5${NB}% · Laufzeit 60${NB}Monate → Rate 372,86${NB}€ · Monatszins 0,375${NB}% · Zinsen gesamt 2.371,62${NB}€`);
  assert.equal(buildCalcReply(m, { ...v, monate: null }, computeOutputs(m, { ...v, monate: null })), null);
});

test('allocateRounded: shares sum exactly to the total', () => {
  assert.deepEqual(allocateRounded(100, [1, 1, 1]), [33.34, 33.33, 33.33]);
  assert.deepEqual(allocateRounded(10, [1, 1, 1], 0), [4, 3, 3]);
  assert.deepEqual(allocateRounded(100, []), []);
  assert.deepEqual(allocateRounded(-10, [1, 1, 1], 0), [-4, -3, -3]);
  assert.deepEqual(allocateRounded(1, [0, 0]), [0.5, 0.5]);
  for (const [total, w] of [[87.35, [3, 2, 2, 1]], [0.05, [1, 1, 1]], [1234.567, [0.1, 0.7, 0.2]], [99.99, [1, 2, 3, 4, 5, 6, 7]]] as [number, number[]][]) {
    const s = allocateRounded(total, w);
    const sumCents = s.reduce((a, b) => a + Math.round(b * 100), 0);
    assert.equal(sumCents, Math.round(total * 100), `${total} ${w}`);
  }
});

test('locale consistency: currency outputs and euro-unit inputs use the same convention per locale', () => {
  const m = normalizeCalc(KREDIT);
  const rowsEn = computeOutputs(m, initialValues(m.inputs), 'en-US');
  const rowsDe = computeOutputs(m, initialValues(m.inputs), 'de-DE');
  for (const r of rowsEn.filter((x) => x.value !== null && /€/.test(x.text))) assert.match(r.text, /^-?€[\d,]+\.\d\d$/, r.text);
  for (const r of rowsDe.filter((x) => x.value !== null && /€/.test(x.text))) assert.match(r.text, /^-?[\d.]+,\d\d €$/, r.text);
  const inp = m.inputs[0];
  assert.equal(formatInputValue(inp, 1375, { locale: 'en-US' }), '€1,375');
  assert.equal(formatInputValue(inp, 1375, { locale: 'de-DE' }), `1.375${NB}€`);
  assert.equal(formatInputValue(inp, 347475.93, { locale: 'de-DE' }), `347.475,93${NB}€`);
  assert.equal(formatInputValue(inp, 347475.93, { locale: 'en-US' }), '€347,475.93');
  assert.equal(formatInputValue(m.inputs[1], 4.5, { locale: 'en-US' }), `4.5${NB}%`);
});

/* ───────────── R2-06: JS-isms from a real model answer (claude-haiku-4-5, default bridge) ───────────── */

const WEIGHTS = {
  type: 'calc',
  id: 'wien_graz_choice',
  title: 'Zug vs. Auto: Deine Gewichtung',
  inputs: [
    { name: 'cost_weight', label: 'Kosten-Gewichtung (%)', kind: 'slider', min: 0, max: 100, default: 50 },
    { name: 'time_weight', label: 'Zeit-Gewichtung (%)', kind: 'slider', min: 0, max: 100, default: 20 },
    { name: 'env_weight', label: 'Umwelt-Gewichtung (%)', kind: 'slider', min: 0, max: 100, default: 30 },
  ],
  outputs: [
    { label: 'Zug-Punktzahl', expr: '((cost_weight * 8 + time_weight * 6 + env_weight * 9) / (cost_weight + time_weight + env_weight)).toFixed(1)' },
    { label: 'Auto-Punktzahl', expr: '((cost_weight * 7 + time_weight * 9 + env_weight * 4) / (cost_weight + time_weight + env_weight)).toFixed(1)' },
    {
      label: 'Empfehlung',
      expr: "((cost_weight * 8 + time_weight * 6 + env_weight * 9) / (cost_weight + time_weight + env_weight) > (cost_weight * 7 + time_weight * 9 + env_weight * 4) / (cost_weight + time_weight + env_weight)) ? '✓ Zug' : '✓ Auto'",
    },
  ],
};

test('R2-06 real block: toFixed + string ternary compute, decimals from toFixed, reply carries the text', () => {
  const m = normalizeCalc(WEIGHTS);
  assert.deepEqual(m.outputs.map((o) => o.decimals), [1, 1, undefined]);
  assert.deepEqual(m.outputs[2].texts, ['✓ Zug', '✓ Auto']);
  assert.equal(m.outputs[0].source, WEIGHTS.outputs[0].expr); // disclosure shows what the model wrote
  const v = initialValues(m.inputs);
  const rows = computeOutputs(m, v);
  // Zug (400+120+270)/100 = 7.9, Auto (350+180+120)/100 = 6.5
  assert.deepEqual(rows.map((r) => r.text), ['7,9', '6,5', '✓ Zug']);
  assert.ok(rows.every((r) => !r.error));
  assert.deepEqual(computeOutputs(m, v, 'en-US').map((r) => r.text), ['7.9', '6.5', '✓ Zug']);
  assert.equal(
    buildCalcReply(m, v, rows),
    '[calc:wien_graz_choice] Kosten-Gewichtung (%) 50 · Zeit-Gewichtung (%) 20 · Umwelt-Gewichtung (%) 30 → Zug-Punktzahl 7,9 · Auto-Punktzahl 6,5 · Empfehlung ✓ Zug',
  );
});

test('R2-06 real block: a slider change recomputes all three outputs', () => {
  const m = normalizeCalc(WEIGHTS);
  // env 30 → 50: Zug (400+120+450)/120 = 8.083 → 8,1; Auto (350+180+200)/120 = 6.083 → 6,1
  const rows = computeOutputs(m, { ...initialValues(m.inputs), env_weight: 50 });
  assert.deepEqual(rows.map((r) => r.text), ['8,1', '6,1', '✓ Zug']);
  // time dominates: cost 0, time 100, env 0 → Zug 6, Auto 9 → Auto
  const t = computeOutputs(m, { cost_weight: 0, time_weight: 100, env_weight: 0 });
  assert.deepEqual(t.map((r) => r.text), ['6,0', '9,0', '✓ Auto']);
  // all weights 0: division by zero → "–" (an input state, not a model error)
  const z = computeOutputs(m, { cost_weight: 0, time_weight: 0, env_weight: 0 });
  assert.deepEqual(z.map((r) => r.text), ['–', '–', '–']);
  assert.ok(z.every((r) => !r.error));
});

test('R2-06 chained string ternary, quotes and ?/: inside strings and parentheses', () => {
  const m = normalizeCalc({
    inputs: [{ name: 'a', kind: 'number', default: 3 }],
    outputs: [{ label: 'Stufe', expr: `a > max(2, (a ? 1 : 0)) ? 'hoch: "sehr"' : a > 1 ? "mittel? ja: 'ok'" : 'nied\\'rig'` }],
  });
  assert.deepEqual(m.outputs[0].texts, ['hoch: "sehr"', "mittel? ja: 'ok'", "nied'rig"]);
  assert.equal(computeOutputs(m, { a: 3 })[0].text, 'hoch: "sehr"');
  assert.equal(computeOutputs(m, { a: 2 })[0].text, "mittel? ja: 'ok'");
  assert.equal(computeOutputs(m, { a: 0 })[0].text, "nied'rig");
  assert.equal(computeOutputs(m, { a: null })[0].text, '–');
});

test('R2-06 rewrites: Math.*, Number()/parseFloat(), ===, toLocaleString, toFixed inside an expression', () => {
  assert.deepEqual(rewriteExpr('Math.round(a * 100) / 100'), { expr: 'round(a * 100) / 100' });
  assert.deepEqual(rewriteExpr('Math.log(a) + Math.log10(a) + Math.PI'), { expr: 'ln(a) + log(a) + pi' });
  assert.deepEqual(rewriteExpr('Number(a.toFixed(2))'), { expr: '(round(a, 2))', decimals: 2 });
  assert.deepEqual(rewriteExpr('parseFloat(a) === 1 ? 1 : 0'), { expr: '(a) == 1 ? 1 : 0' });
  assert.deepEqual(rewriteExpr("a.toLocaleString('de-DE')"), { expr: 'a' });
  assert.deepEqual(rewriteExpr('a.toFixed(1) * 2'), { expr: 'round(a, 1) * 2' }); // not the whole result → no decimals
  assert.deepEqual(rewriteExpr('kredit * zins'), { expr: 'kredit * zins' }); // engine syntax untouched
  // explicit decimals win over toFixed
  const m = normalizeCalc({ inputs: [{ name: 'a', kind: 'number', default: 1.256 }], outputs: [{ label: 'x', expr: 'a.toFixed(1)', decimals: 3 }] });
  assert.equal(m.outputs[0].decimals, 3);
  assert.equal(computeOutputs(m, { a: 1.256 })[0].text, '1,300');
});

test('R2-06 rewrite never enables property access or strings', () => {
  const m = normalizeCalc({
    inputs: [{ name: 'a', kind: 'number', default: 1 }],
    outputs: [
      { label: 'c', expr: 'constructor.toFixed(1)' },
      { label: 'ab', expr: 'a.b' },
      { label: 'abf', expr: 'a.b.toFixed(1)' },
      { label: 'proto', expr: '__proto__.constructor' },
      { label: 'rnd', expr: 'Math.random()' },
      { label: 'concat', expr: "'Zug: ' + a.toFixed(1)" },
      { label: 'mixed', expr: "a > 1 ? 'x' : a" },
      { label: 'tpl', expr: '`${a}` ? 1 : 0' },
      { label: 'fx', expr: 'a.toFixed(a)' },
    ],
  });
  const rows = computeOutputs(m, { a: 1 });
  for (const r of rows) {
    assert.ok(r.error, `${r.label} must stay an engine error`);
    assert.equal(r.value, null, r.label);
    assert.equal(r.text, 'nicht berechenbar', r.label);
  }
  assert.equal(m.outputs.filter((o) => o.texts).length, 0);
});

test('R2-06 unrewritable output: visible error state; reply disabled only when every output failed', () => {
  const m = normalizeCalc({
    id: 'x',
    inputs: [{ name: 'a', label: 'A', kind: 'number', default: 2 }],
    outputs: [{ label: 'Gut', expr: 'a * 2' }, { label: 'Kaputt', expr: "'Wert: ' + a" }],
  });
  const v = initialValues(m.inputs);
  const rows = computeOutputs(m, v);
  assert.equal(rows[1].text, 'nicht berechenbar');
  assert.notEqual(rows[1].text, '–');
  assert.match(rows[1].error ?? '', /Zeichenketten/);
  assert.equal(computeOutputs(m, v, 'en-US', { notComputable: 'cannot be calculated' })[1].text, 'cannot be calculated');
  assert.equal(buildCalcReply(m, v, rows), '[calc:x] A 2 → Gut 4 · Kaputt nicht berechenbar');
  const allBad = normalizeCalc({ id: 'y', inputs: [{ name: 'a', label: 'A', kind: 'number', default: 2 }], outputs: [{ label: 'K', expr: 'a.b' }] });
  assert.equal(buildCalcReply(allBad, v, computeOutputs(allBad, v)), null);
});
