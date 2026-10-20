import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LiveOp } from './model.ts';
import { budgetBatch, fitTotal, splitLiveTrailer, TRAILER_OPS_BUDGET, TRAILER_TOTAL_BUDGET, withLiveTrailer } from './trailer.ts';

test('round trip: text + trailer → the typed text and the batches', () => {
  const batches = { einkauf: { v: 4, ops: [{ check: 'milch' }, { add: { id: 'u-k3f9a', text: 'Brot vom Bäcker' } }] as LiveOp[], bid: 'b-test1' } };
  const sent = withLiveTrailer('Wir grillen doch am Samstag.', batches);
  assert.equal(sent, 'Wir grillen doch am Samstag.\n\n[hui:live]{"einkauf":{"v":4,"ops":[{"check":"milch"},{"add":{"id":"u-k3f9a","text":"Brot vom Bäcker"}}],"bid":"b-test1"}}[/hui:live]');
  assert.deepEqual(splitLiveTrailer(sent), { text: 'Wir grillen doch am Samstag.', batches });
});

test('no batches: the text stays as it is', () => {
  assert.equal(withLiveTrailer('Hallo', {}), 'Hallo');
  assert.deepEqual(splitLiveTrailer('Hallo [hui:live] im Text'), { text: 'Hallo [hui:live] im Text' });
});

test('decode is defensive: bad JSON is cut but yields nothing, unknown ops and bad ids are dropped', () => {
  assert.deepEqual(splitLiveTrailer('Hi\n\n[hui:live]{nope}[/hui:live]'), { text: 'Hi' });
  const r = splitLiveTrailer('Hi\n\n[hui:live]{"einkauf":{"v":2,"ops":[{"check":"milch"},{"teleport":"x"},{"del":"../etc"},{"set":"senf","note":"süß","evil":1}]},"__proto__":{"v":1,"ops":[{"check":"a"}]}}[/hui:live]');
  assert.deepEqual(r.batches, { einkauf: { v: 2, ops: [{ check: 'milch' }, { set: 'senf', note: 'süß' }] } });
});

test('a snapshot batch decodes to a state', () => {
  const r = splitLiveTrailer('x\n\n[hui:live]{"einkauf":{"v":3,"state":{"title":"Einkauf","items":[{"id":"milch","text":"Milch","checked":true},{"id":"milch","text":"dup"}]}}}[/hui:live]');
  assert.deepEqual(r.batches?.einkauf.state, { title: 'Einkauf', items: [{ id: 'milch', text: 'Milch', checked: true }] });
});

test('budget: ops over 4 KB go as a snapshot of the view; a huge view cuts the ops', () => {
  const ops: LiveOp[] = Array.from({ length: 150 }, (_, i) => ({ add: { id: `u-${i}`, text: `Artikel Nummer ${i} mit etwas Text` } }));
  const small = { items: [{ id: 'a', text: 'A' }] };
  const snap = budgetBatch({ v: 1, ops, bid: 'b' }, small);
  assert.equal(snap.carried, 'all');
  assert.deepEqual(snap.batch.state, small);
  const big = { items: ops.map((o) => ('add' in o ? o.add : { id: 'x', text: 'x' })).concat(ops.map((o, i) => ({ id: `v-${i}`, text: 'add' in o ? o.add.text : '' }))) };
  const cut = budgetBatch({ v: 1, ops, bid: 'b' }, big);
  assert.equal(typeof cut.carried, 'number');
  assert.ok(JSON.stringify(cut.batch.ops).length <= TRAILER_OPS_BUDGET);
});

test('total budget drops unfocused cards first', () => {
  const pad = (n: number) => Array.from({ length: n }, (_, i) => ({ check: `item-${i}` })) as LiveOp[];
  const out = fitTotal({ a: { v: 1, ops: pad(250) }, b: { v: 1, ops: pad(250) }, c: { v: 1, ops: pad(250), focus: true } });
  assert.ok(JSON.stringify(out).length <= TRAILER_TOTAL_BUDGET);
  assert.ok(out.c);
});
