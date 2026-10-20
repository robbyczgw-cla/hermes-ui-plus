// 0.2 real-user round 3 (default bridge, claude-haiku-4-5): blocks verbatim from the saved transcripts
// (live/qaRound3.fixtures.ts). R3-01 a watchlist's target prices as checklist `trailing` (and, in round 2, as a product
// `price` with `"note":"Zielpreis"`) vanished; R3-03 a weighting calculator's recommendation `IF(…, "→ Zug", "→ Auto")`
// was "nicht berechenbar"; R3-04 the agenda showed exactly the times the model wrote (the model misread "um 9 Uhr 30
// Minuten Sport"), and a block with a duration instead of an end got a default hour.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMessage } from './streamParser.ts';
import type { Segment } from './types.ts';
import { normalizeNode } from './validate.ts';
import { QA_ROUND3 } from '../live/qaRound3.fixtures.ts';
import { computeOutputs, initialValues, normalizeCalc } from '../ui/components/modules/b/calcModel.ts';
import { normalizeProducts, targetText } from '../ui/components/modules/d1/d1Model.ts';

type Rec = Record<string, unknown>;
type Hui = Extract<Segment, { kind: 'hui' }>;

/** the hui nodes of the n-th assistant answer of a fixture transcript */
function nodes(chat: keyof typeof QA_ROUND3, answer: number): Rec[] {
  const m = QA_ROUND3[chat].filter((x) => x.role === 'assistant')[answer];
  const segs = parseMessage(m.text).filter((s): s is Hui => s.kind === 'hui');
  for (const s of segs) {
    assert.ok(s.complete && s.node, `${chat}#${answer}: a node`);
    assert.equal(s.fallback, undefined, `${chat}#${answer}: no fallback`);
  }
  return segs.map((s) => s.node as unknown as Rec);
}
/** the raw JSON of the n-th assistant answer's first hui block */
function raw(chat: keyof typeof QA_ROUND3, answer: number): Rec {
  const m = QA_ROUND3[chat].filter((x) => x.role === 'assistant')[answer];
  return JSON.parse(m.text.split('```hui')[1].split('```')[0]) as Rec;
}
const items = (n: Rec) => n.items as Rec[];

test('R3-01 real: checklist items keep their `trailing` text (the target price) as the note', () => {
  const [v1] = nodes('watchlist', 0);
  assert.deepEqual(items(v1).map((it) => [it.text, it.note]), [['iPhone 16', 'Ziel: 600€'], ['Pixel 9', 'Ziel: 500€']]);
  const [v2] = nodes('watchlist', 1);
  assert.deepEqual(items(v2).map((it) => [it.text, it.note]), [['Pixel 9', 'Ziel: 450€']]);
  // with a note of its own, both stay
  const n = normalizeNode({ type: 'checklist', id: 'w', items: [{ text: 'Pixel 9', note: 'nur 128 GB', trailing: 'Ziel: 450€' }] }) as unknown as Rec;
  assert.equal(items(n)[0].note, 'nur 128 GB · Ziel: 450€');
});

test('R3-01: a product watchlist keeps the target price: `target`, or a price the model labelled as the target', () => {
  // round 2, verbatim shape: the target written as the price with "note":"Zielpreis"
  const r2 = normalizeNode({ type: 'products', compare: true, items: [{ name: 'iPhone 16', price: 600, currency: 'EUR', note: 'Zielpreis', imageQuery: 'iPhone 16' }, { name: 'Google Pixel 9', price: 500, currency: 'EUR', note: 'Zielpreis' }] }) as unknown as Rec;
  const ps = r2.products as Rec[];
  assert.deepEqual(ps.map((p) => [p.name, p.price, p.target]), [['iPhone 16', undefined, 600], ['Google Pixel 9', undefined, 500]], 'never shown as a current price');
  // the shape the skill now asks for, and a target given in the note text
  const n = normalizeNode({ type: 'products', id: 'phones', live: true, products: [{ id: 'pixel-9', name: 'Pixel 9', target: 450, currency: 'EUR' }, { id: 'iphone-16', name: 'iPhone 16', note: 'Ziel: 600 €' }, { id: 'xm5', name: 'Sony XM5', price: 279, currency: 'EUR', note: 'Bester Akku' }] }) as unknown as Rec;
  assert.deepEqual((n.products as Rec[]).map((p) => [p.name, p.price, p.target, p.priceNote]), [['Pixel 9', undefined, 450, undefined], ['iPhone 16', undefined, 600, undefined], ['Sony XM5', 279, undefined, 'Bester Akku']]);
  // the plain products card shows it ("Wunschpreis 450 €")
  const model = normalizeProducts(n);
  const tr = (key: string, p?: Record<string, unknown>) => (key === 'ui.products.target' ? `Wunschpreis ${p?.price}` : key);
  assert.equal(targetText(model.items[0], tr as never, 'de')?.replace(/\s/g, ' '), 'Wunschpreis 450 €');
});

test('R3-03 real: the recommendation `IF(zug > auto, "→ Zug", "→ Auto")` is computed, also after moving a slider', () => {
  const m = normalizeCalc(raw('calculator', 1));
  const rows = computeOutputs(m, initialValues(m.inputs));
  assert.deepEqual(rows.map((r) => [r.label, r.text, r.error]), [['Zug-Score (0–100)', '8,5', undefined], ['Auto-Score (0–100)', '5,6', undefined], ['Empfehlung', '→ Zug', undefined]]);
  // the report's tap: Umwelt 30 → 50
  assert.equal(computeOutputs(m, { ...initialValues(m.inputs), umwelt_weight: 50 })[2].text, '→ Zug');
  // a weighting where the car wins
  const car = normalizeCalc({ ...raw('calculator', 1), outputs: [{ label: 'E', expr: 'IF(kosten_weight > 60, "→ Auto", "→ Zug")' }] });
  assert.equal(computeOutputs(car, { ...initialValues(car.inputs), kosten_weight: 90 })[0].text, '→ Auto');
  // all weights 0: no number at all, never a made-up recommendation
  const zero = computeOutputs(m, { kosten_weight: 0, zeit_weight: 0, umwelt_weight: 0 });
  assert.deepEqual(zero.map((r) => r.value), [null, null, null]);
  assert.ok(zero.every((r) => r.text !== '→ Zug' && r.text !== '→ Auto'));
});

test('R3-03: spreadsheet function names work; a real string comparison stays visibly not computable', () => {
  const m = normalizeCalc({ id: 'c', inputs: [{ name: 'a', kind: 'number', default: 3 }, { name: 'b', kind: 'number', default: 4 }], outputs: [{ label: 'x', expr: 'MAX(a, b) + ROUND(SQRT(a * a + b * b), 1)' }, { label: 'y', expr: 'IF(a > b, 1, 2)' }, { label: 'z', expr: 'IF(a > b, "A", IF(a == b, "gleich", "B"))' }] });
  assert.deepEqual(computeOutputs(m, initialValues(m.inputs)).map((r) => r.text), ['9', '2', 'B']);
  const s = normalizeCalc({ id: 's', inputs: [{ name: 'fuel', kind: 'select', options: [{ label: 'Diesel', value: 'diesel' }, { label: 'Benzin', value: 'benzin' }] }], outputs: [{ label: 'Preis', expr: 'IF(fuel == "diesel", 1.6, 1.7)' }] });
  const [row] = computeOutputs(s, initialValues(s.inputs));
  assert.equal(row.value, null);
  assert.ok(row.error, 'shown as not computable, not as a number');
});

test('R3-04 real: the agenda shows the times the model sent; a duration instead of an end is used, not a default hour', () => {
  const [a] = nodes('agenda', 0);
  // what Haiku wrote for "um 9 Uhr 30 Minuten Sport, um 10 Uhr eine Stunde einkaufen": shown as written (skill rule)
  assert.deepEqual((a.blocks as Rec[]).map((b) => `${b.start}-${b.end} ${b.title}`), ['09:30-10:30 Sport', '10:30-11:30 Einkaufen', '13:00-14:00 Mittagessen']);
  const [b] = nodes('agenda', 1);
  assert.deepEqual((b.blocks as Rec[]).map((x) => [x.title, x.note]), [['Sport', 'Workout, Joggen oder Fitness – je nach Vorliebe'], ['Einkaufen', 'Eine Stunde Zeit für Besorgungen'], ['Mittagessen', 'Essen gehen oder zu Hause kochen']]);
  // start + duration shapes
  const n = normalizeNode({ type: 'agenda', id: 'sa', blocks: [{ start: '09:00', duration: 30, title: 'Sport' }, { time: '10:00', duration: '1 h', title: 'Einkaufen' }, { start: '13:00', durationMin: 45, title: 'Mittagessen' }, { start: '15:00', duration: '90 Min.', title: 'Kino' }, { start: '18:00', end: '19:00', duration: 30, title: 'Ende gewinnt' }] }) as unknown as Rec;
  assert.deepEqual((n.blocks as Rec[]).map((x) => `${x.start}-${x.end}`), ['09:00-09:30', '10:00-11:00', '13:00-13:45', '15:00-16:30', '18:00-19:00']);
});
