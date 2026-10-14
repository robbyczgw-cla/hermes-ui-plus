/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareStructure } from './structuralShare.ts';

test('shareStructure: unchanged value → prev identity', () => {
  const prev = { type: 'table', rows: [['a', 1], ['b', 2]], meta: { x: null } };
  const next = JSON.parse(JSON.stringify(prev));
  assert.equal(shareStructure(prev, next), prev);
});

test('shareStructure: grown array keeps old items, new tail is fresh', () => {
  const prev = { type: 'table', rows: [['a'], ['b']] };
  const next = { type: 'table', rows: [['a'], ['b'], ['c']] };
  const out = shareStructure(prev, next);
  assert.notEqual(out, prev);
  assert.deepEqual(out, next);
  assert.equal(out.rows[0], prev.rows[0]);
  assert.equal(out.rows[1], prev.rows[1]);
  assert.equal(out.rows[2], next.rows[2]);
});

test('shareStructure: changed leaf only replaces its path', () => {
  const prev = { type: 'card', children: [{ type: 'text', text: 'x' }, { type: 'text', text: 'y' }] };
  const next = { type: 'card', children: [{ type: 'text', text: 'x' }, { type: 'text', text: 'yz' }] };
  const out = shareStructure(prev, next);
  assert.deepEqual(out, next);
  assert.equal(out.children[0], prev.children[0]);
  assert.notEqual(out.children[1], prev.children[1]);
});

test('shareStructure: removed keys / type changes / NaN', () => {
  assert.deepEqual(shareStructure({ a: 1, b: 2 }, { a: 1 }), { a: 1 });
  assert.deepEqual(shareStructure([1, 2], { 0: 1 }), { 0: 1 });
  assert.deepEqual(shareStructure({ 0: 1 }, [1]), [1]);
  assert.equal(shareStructure(null, 3), 3);
  const p = { v: NaN };
  assert.equal(shareStructure(p, { v: NaN }), p);
});
