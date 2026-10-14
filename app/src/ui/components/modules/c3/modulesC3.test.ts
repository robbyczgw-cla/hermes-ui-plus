import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breakdown, decisionReply, effectiveWeights, normalizeDecision, rankOptions, weightedScore } from './decisionModel.ts';
import { dragTargetIndex, moveItem, normalizeRankItems, previewTops, rankReply, reconcileOrder, stepItem } from './rankModel.ts';
import { clampScale, emojiFor, normalizeScale, scaleReply, scaleValueText, scaleValues } from './scaleModel.ts';
import { fixed1, trimNum } from './format.ts';

const FLAT = {
  type: 'decision',
  id: 'wohnung',
  criteria: [
    { id: 'preis', label: 'Preis', weight: 8 },
    { label: 'Lage', weight: 6 },
    { label: 'Größe', weight: 4 },
  ],
  options: [
    { label: 'Wohnung A', scores: { preis: 9, Lage: 5, c2: 6 } },
    { id: 'b', label: 'Wohnung B', scores: { preis: 7, lage: 9, 'Größe': 8 } },
    { label: 'Wohnung C', scores: { preis: 4, c1: 7 } },
  ],
};

/* ───────── decision ───────── */

test('decision: normalise keys by id or label (case-insensitive), clamp, fallback ids', () => {
  const m = normalizeDecision({ ...FLAT, options: [...FLAT.options, { label: 'X', scores: { preis: 14, unbekannt: 3, Lage: -2 } }] });
  assert.deepEqual(m.criteria.map((c) => c.key), ['preis', 'c1', 'c2']);
  assert.deepEqual(m.options[1].scores, { preis: 7, c1: 9, c2: 8 });
  assert.deepEqual(m.options[3].scores, { preis: 10, c1: 0 });
  assert.equal(m.options[0].key, 'o0');
  assert.equal(m.options[1].key, 'b');
});

test('decision: partial nodes never throw; incomplete entries skipped', () => {
  assert.deepEqual(normalizeDecision(null).criteria, []);
  const m = normalizeDecision({ id: 'd', criteria: [{ label: 'A', weight: 3 }, { weight: 2 }], options: [{ label: 'O', scores: {} }, { scores: {} }] });
  assert.equal(m.criteria.length, 1);
  assert.equal(m.options.length, 1);
  assert.equal(normalizeDecision({ criteria: [{ label: 'A' }] }).criteria[0].weight, 5);
});

test('decision: weighted score Σw·s/Σw, missing scores excluded, zero weights → null', () => {
  const m = normalizeDecision(FLAT);
  const w = effectiveWeights(m.criteria, undefined);
  // B: (8·7 + 6·9 + 4·8) / 18 = 142/18 = 7.888…
  assert.ok(Math.abs(weightedScore(m.options[1], m.criteria, w)! - 142 / 18) < 1e-9);
  // C has no Größe score: (8·4 + 6·7) / 14
  assert.ok(Math.abs(weightedScore(m.options[2], m.criteria, w)! - 74 / 14) < 1e-9);
  const zero = effectiveWeights(m.criteria, { preis: 0, c1: 0, c2: 0 });
  assert.equal(weightedScore(m.options[0], m.criteria, zero), null);
  // persisted weights are clamped + rounded
  assert.deepEqual(effectiveWeights(m.criteria, { preis: 12, c1: -1, c2: 3.6 }), { preis: 10, c1: 0, c2: 4 });
});

test('decision: ranking with shared ranks on (displayed) ties, stable order', () => {
  const m = normalizeDecision({
    id: 't',
    criteria: [{ label: 'K', weight: 5 }],
    options: [
      { label: 'A', scores: { K: 6 } },
      { label: 'B', scores: { K: 8 } },
      { label: 'C', scores: { K: 8.04 } }, // rounds to 8,0 → tie with B
      { label: 'D', scores: {} },
      { label: 'E', scores: { K: 6 } },
    ],
  });
  const r = rankOptions(m.options, m.criteria, effectiveWeights(m.criteria, undefined));
  assert.deepEqual(r.map((x) => x.option.label), ['B', 'C', 'A', 'E', 'D']);
  assert.deepEqual(r.map((x) => x.rank), [1, 1, 3, 3, 5]);
  assert.deepEqual(r.map((x) => x.winner), [true, true, false, false, false]);
  assert.equal(r[4].score, null);
});

test('decision: breakdown contributions sum to the total', () => {
  const m = normalizeDecision(FLAT);
  const w = effectiveWeights(m.criteria, undefined);
  for (const o of m.options) {
    const rows = breakdown(o, m.criteria, w);
    const sum = rows.reduce((a, r) => a + (r.contribution ?? 0), 0);
    assert.ok(Math.abs(sum - weightedScore(o, m.criteria, w)!) < 1e-9);
  }
  assert.equal(breakdown(m.options[2], m.criteria, w)[2].contribution, null);
});

test('decision: reply format (German decimals), tie + nothing to decide', () => {
  const m = normalizeDecision(FLAT);
  const w = effectiveWeights(m.criteria, undefined);
  assert.equal(decisionReply(m, w), '[decision:wohnung] Gewinner: Wohnung B (7,9) · Gewichte: Preis 8, Lage 6, Größe 4');
  const w2 = effectiveWeights(m.criteria, { preis: 10, c1: 0, c2: 0 });
  assert.equal(decisionReply(m, w2), '[decision:wohnung] Gewinner: Wohnung A (9,0) · Gewichte: Preis 10, Lage 0, Größe 0');
  const tie = normalizeDecision({ id: 'x', criteria: [{ label: 'K', weight: 1 }], options: [{ label: 'A', scores: { K: 5 } }, { label: 'B', scores: { K: 5 } }] });
  assert.equal(decisionReply(tie, effectiveWeights(tie.criteria, undefined)), '[decision:x] Gleichstand: A, B (5,0) · Gewichte: K 1');
  assert.equal(decisionReply(m, effectiveWeights(m.criteria, { preis: 0, c1: 0, c2: 0 })), null);
});

test('format: fixed1 / trimNum per language', () => {
  assert.equal(fixed1(7.85), '7,9');
  assert.equal(fixed1(7.85, 'en'), '7.9');
  assert.equal(fixed1(7), '7,0');
  assert.equal(trimNum(3.5), '3,5');
  assert.equal(trimNum(4, 'en'), '4');
});

/* ───────── rank ───────── */

test('rank: items get stable unique keys, ≤ 10, strings accepted', () => {
  const items = normalizeRankItems([{ label: 'A' }, { id: 'x', label: 'B' }, { id: 'x', label: 'C' }, { label: '' }, 'D']);
  assert.deepEqual(items.map((i) => i.key), ['i0', 'x', 'x~2', 'i4']);
  assert.equal(normalizeRankItems(Array.from({ length: 14 }, (_, i) => ({ label: `L${i}` }))).length, 10);
});

test('rank: reconcile saved order with current keys', () => {
  assert.deepEqual(reconcileOrder(['c', 'a', 'zz', 'a'], ['a', 'b', 'c']), ['c', 'a', 'b']);
  assert.deepEqual(reconcileOrder(undefined, ['a', 'b']), ['a', 'b']);
});

test('rank: move / step reorder logic', () => {
  assert.deepEqual(moveItem(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveItem(['a', 'b', 'c', 'd'], 3, 0), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moveItem(['a', 'b'], 1, 9), ['a', 'b']);
  assert.deepEqual(stepItem(['a', 'b', 'c'], 0, -1), ['a', 'b', 'c']);
  assert.deepEqual(stepItem(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c']);
  assert.deepEqual(stepItem(['a', 'b', 'c'], 2, -1), ['a', 'c', 'b']);
});

test('rank: drag target index crosses midpoints (variable heights)', () => {
  const h = [50, 50, 80, 50];
  const gap = 8;
  assert.equal(dragTargetIndex(h, gap, 0, 0), 0);
  assert.equal(dragTargetIndex(h, gap, 0, 30), 0); // centre 55 < midpoint of row 1 (83)
  assert.equal(dragTargetIndex(h, gap, 0, 60), 1);
  assert.equal(dragTargetIndex(h, gap, 0, 500), 3);
  assert.equal(dragTargetIndex(h, gap, 3, -500), 0);
  assert.equal(dragTargetIndex(h, gap, 2, -60), 2);
  assert.equal(dragTargetIndex(h, gap, 2, -80), 1);
  assert.deepEqual(previewTops(h, gap, 0, 1), [58, 0, 116, 204]);
  assert.deepEqual(previewTops(h, gap, 1, 1), [0, 58, 116, 204]);
});

test('rank: reply format', () => {
  assert.equal(rankReply('prio', ['A', 'B  b', 'C']), '[rank:prio] 1. A · 2. B b · 3. C');
});

/* ───────── scale ───────── */

test('scale: defaults, clamping of bad min/max/step, style fallback', () => {
  const d = normalizeScale({ id: 's', question: 'Wie?' });
  assert.deepEqual([d.min, d.max, d.step, d.style], [1, 5, 1, 'segments']);
  assert.deepEqual([normalizeScale({ min: 5, max: 2 }).max], [9]);
  assert.equal(normalizeScale({ min: 0, max: 500 }).max, 100);
  assert.equal(normalizeScale({ min: 0, max: 100 }).style, 'slider');
  assert.equal(normalizeScale({ min: 0, max: 10 }).style, 'segments');
  assert.equal(normalizeScale({ min: 0, max: 10, style: 'stars' }).style, 'segments'); // 11 values > 10 stars
  assert.equal(normalizeScale({ max: 5, emojis: ['a', 'b'] }).style, 'emoji');
  assert.equal(normalizeScale({ step: -1 }).step, 1);
  assert.equal(normalizeScale({ min: 0, max: 100, step: 0.001 }).step, 1);
});

test('scale: clampScale snaps to the step grid and the range', () => {
  const m = normalizeScale({ min: 1, max: 5 });
  assert.equal(clampScale(7, m), 5);
  assert.equal(clampScale(-3, m), 1);
  assert.equal(clampScale(3.4, m), 3);
  assert.equal(clampScale('x', m), null);
  const half = normalizeScale({ min: 0, max: 2, step: 0.5 });
  assert.deepEqual(scaleValues(half), [0, 0.5, 1, 1.5, 2]);
  assert.equal(clampScale(1.3, half), 1.5);
  const odd = normalizeScale({ min: 0, max: 10, step: 3 });
  assert.deepEqual(scaleValues(odd), [0, 3, 6, 9]);
  assert.equal(clampScale(10, odd), 9);
});

test('scale: emoji mapping + reply format with end labels', () => {
  const m = normalizeScale({ id: 'zufr', question: 'Zufrieden?', min: 1, max: 5, labels: { min: 'gar nicht', max: 'sehr' } });
  assert.equal(emojiFor(1, m), '😞');
  assert.equal(emojiFor(5, m), '😄');
  assert.equal(emojiFor(3, m), '😐');
  assert.equal(scaleReply(m, 4), '[scale:zufr] 4/5');
  assert.equal(scaleReply(m, 5), '[scale:zufr] 5/5 (sehr)');
  assert.equal(scaleReply(m, 1), '[scale:zufr] 1/5 (gar nicht)');
  const h = normalizeScale({ id: 'h', min: 0, max: 5, step: 0.5 });
  assert.equal(scaleReply(h, 3.5), '[scale:h] 3,5/5');
  assert.equal(scaleValueText(3.5, h, 'en'), '3.5/5');
});
