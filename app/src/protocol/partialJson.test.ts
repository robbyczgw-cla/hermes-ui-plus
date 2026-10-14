/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePartialJson as p } from './partialJson.ts';

test('complete JSON parses as usual', () => {
  assert.deepEqual(p('{"a":[1,2,{"b":null}],"c":"d"}'), { a: [1, 2, { b: null }], c: 'd' });
  assert.equal(p('12'), 12);
  assert.equal(p('"x"'), 'x');
});

test('empty / whitespace / garbage -> undefined, never throws', () => {
  assert.equal(p(''), undefined);
  assert.equal(p('   \n'), undefined);
  assert.equal(p('nul'), undefined);
  assert.equal(p('}'), undefined);
  assert.equal(p('[1 2]'), undefined);
  assert.equal(p(undefined as unknown as string), undefined);
  assert.equal(p(null as unknown as string), undefined);
});

test('closes open objects and arrays', () => {
  assert.deepEqual(p('{'), {});
  assert.deepEqual(p('['), []);
  assert.deepEqual(p('{"a":[1,2'), { a: [1, 2] });
  assert.deepEqual(p('{"a":{"b":{"c":1'), { a: { b: { c: 1 } } });
  assert.deepEqual(p('  {"a": 1 '), { a: 1 });
});

test('closes open string values, drops partial escapes', () => {
  assert.deepEqual(p('{"a":"he'), { a: 'he' });
  assert.deepEqual(p('{"a":"he\\'), { a: 'he' });
  assert.deepEqual(p('{"a":"x\\u00'), { a: 'x' });
  assert.deepEqual(p('{"a":"x\\u00e4'), { a: 'xä' });
  assert.deepEqual(p('{"a":"x\\n'), { a: 'x\n' });
  assert.deepEqual(p('{"a":"q\\"'), { a: 'q"' });
  assert.equal(p('"abc'), 'abc');
});

test('drops dangling keys, colons and commas', () => {
  assert.deepEqual(p('{"a":1,"b'), { a: 1 });
  assert.deepEqual(p('{"a":1,"b"'), { a: 1 });
  assert.deepEqual(p('{"a":1,"b":'), { a: 1 });
  assert.deepEqual(p('{"a":1,'), { a: 1 });
  assert.deepEqual(p('[1,2,'), [1, 2]);
  assert.deepEqual(p('[{"a":1},{"b'), [{ a: 1 }, {}]);
  assert.deepEqual(p('{"a":[1,{"b":"c'), { a: [1, { b: 'c' }] });
});

test('drops partial literals, repairs partial numbers', () => {
  assert.deepEqual(p('{"a":tru'), {});
  assert.deepEqual(p('{"a":1,"b":fals'), { a: 1 });
  assert.deepEqual(p('{"a":[nu'), { a: [] });
  assert.deepEqual(p('{"a":-'), {});
  assert.deepEqual(p('{"a":1.'), { a: 1 });
  assert.deepEqual(p('{"a":1e'), { a: 1 });
  assert.deepEqual(p('{"a":1.5e+'), { a: 1.5 });
  assert.deepEqual(p('{"a":true'), { a: true });
  assert.deepEqual(p('{"a":null'), { a: null });
  assert.deepEqual(p('{"a":12'), { a: 12 });
});

test('tolerates trailing commas and raw newlines in strings', () => {
  assert.deepEqual(p('{"a":1,}'), { a: 1 });
  assert.deepEqual(p('[1,2,]'), [1, 2]);
  assert.deepEqual(p('{"a":"line\nbreak"}'), { a: 'line\nbreak' });
  assert.deepEqual(p('{"a":"line\nbre'), { a: 'line\nbre' });
});

test('every prefix of a realistic document parses to an object/undefined and never throws', () => {
  const doc = JSON.stringify({
    type: 'card', title: 'Größe ä "q" \\ x',
    children: [{ type: 'stats', items: [{ label: 'a', value: '1', trend: 'up' }, { label: 'b', value: '-2.5e3' }] },
      { type: 'text', text: 'ok', ok: true, nope: null }],
  }, null, 2);
  let last: unknown;
  for (let i = 0; i <= doc.length; i++) {
    const r = p(doc.slice(0, i));
    if (i > 0 && doc.slice(0, i).trim() !== '') assert.ok(r === undefined || typeof r === 'object', `prefix ${i}`);
    last = r;
  }
  assert.deepEqual(last, JSON.parse(doc));
});

test('prefix results are monotonic: later prefixes never lose top-level keys', () => {
  const doc = '{"type":"chart","kind":"bar","title":"T","series":[{"name":"s","data":[{"x":"a","y":1},{"x":"b","y":2}]}]}';
  let prevKeys = 0;
  for (let i = 1; i <= doc.length; i++) {
    const r = p(doc.slice(0, i)) as Record<string, unknown> | undefined;
    const k = r ? Object.keys(r).length : 0;
    assert.ok(k >= prevKeys, `keys shrank at ${i}`);
    prevKeys = k;
  }
});
