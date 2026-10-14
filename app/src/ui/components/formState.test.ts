/// <reference types="node" />
// bugs review 2026-10-11 P2-2: form answers persist (nodestate) and the form stays locked after reload
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_FORM_STATE, asFormState, formFieldValue, reopenedFormState, submitValues, submittedFormState, uniqueFields } from './formState.ts';

test('submit → sent + values; a reload reads the same state back (JSON round trip)', () => {
  const s = submittedFormState({ name: 'Ada', age: 36, vegan: true, date: null });
  const reloaded = asFormState(JSON.parse(JSON.stringify(s)));
  assert.equal(reloaded.sent, true);
  assert.deepEqual(reloaded.values, { name: 'Ada', age: 36, vegan: true, date: null });
  // locked view shows the sent values, not the defaults
  assert.equal(formFieldValue('name', {}, reloaded, () => ''), 'Ada');
  assert.equal(formFieldValue('date', {}, reloaded, () => '2026-01-01'), null);
});

test('field value precedence: local edit → sent value → default', () => {
  const s = submittedFormState({ a: 'sent' });
  assert.equal(formFieldValue('a', { a: 'edit' }, reopenedFormState(s), () => 'def'), 'edit');
  // locked (sent) view: a stray edit never overrides the sent value (GPT review #15)
  assert.equal(formFieldValue('a', { a: 'edit' }, s, () => 'def'), 'sent');
  assert.equal(formFieldValue('a', {}, s, () => 'def'), 'sent');
  assert.equal(formFieldValue('b', {}, s, () => 'def'), 'def');
  assert.equal(formFieldValue('a', {}, INITIAL_FORM_STATE, () => 'def'), 'def');
});

test('"Ändern" reopens with the sent values', () => {
  const r = reopenedFormState(submittedFormState({ a: 1 }));
  assert.equal(r.sent, false);
  assert.deepEqual(r.values, { a: 1 });
});

test('invalid stored data → initial state', () => {
  assert.deepEqual(asFormState(null), INITIAL_FORM_STATE);
  assert.deepEqual(asFormState({ sent: 'yes', values: [] }), { sent: false, values: {} });
});

test('#14 submit dictionary: __proto__ is an own key in the JSON; duplicates collapse to the first', () => {
  const v = submitValues([{ name: '__proto__' }, { name: 'x' }, { name: 'x' }], (i) => ['p', 'a', 'b'][i]);
  assert.equal(JSON.stringify(v), '{"__proto__":"p","x":"a"}');
  assert.equal(Object.getPrototypeOf(v), Object.prototype);
  assert.deepEqual(uniqueFields([{ name: 'a' }, { name: 'a' }, { name: 'b' }]).map((f) => f.name), ['a', 'b']);
  // survives the persisted round trip
  const st = asFormState(JSON.parse(JSON.stringify(submittedFormState(v))));
  assert.equal(formFieldValue('__proto__', {}, st, () => ''), 'p');
});
