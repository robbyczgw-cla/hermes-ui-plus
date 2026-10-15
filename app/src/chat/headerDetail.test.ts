/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headerDetail } from './headerDetail.ts';

const lockedLabel = (model: string) => `${model} · fixiert`;

test('locked model: the lock is its own part (never in the truncatable text), a11y label as before', () => {
  const d = headerDetail({ modelLabel: 'claude-sonnet-5-5[1m]', locked: true, lockedLabel });
  assert.deepEqual(d, { a11y: 'claude-sonnet-5-5[1m] · fixiert', model: 'claude-sonnet-5-5[1m]', locked: true, rest: '' });
});

test('locked model with active options: options follow the lock', () => {
  const d = headerDetail({ modelLabel: 'm', locked: true, optionsLabel: 'Schnell', lockedLabel });
  assert.equal(d.a11y, 'm · fixiert · Schnell');
  assert.deepEqual([d.model, d.locked, d.rest], ['m', true, '· Schnell']);
});

test('unlocked / no model: same text as the old detail line, no lock', () => {
  assert.deepEqual(headerDetail({ modelLabel: 'm', locked: false, optionsLabel: 'Schnell', lockedLabel }), { a11y: 'm · Schnell', model: 'm', locked: false, rest: '· Schnell' });
  // no model label (server default): a lock alone means nothing -> not shown
  assert.deepEqual(headerDetail({ modelLabel: '', locked: true, optionsLabel: 'Schnell', lockedLabel }), { a11y: 'Schnell', model: '', locked: false, rest: 'Schnell' });
  assert.deepEqual(headerDetail({ lockedLabel }), { a11y: '', model: '', locked: false, rest: '' });
});
