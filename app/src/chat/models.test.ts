import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cacheIsStale,
  cacheMatches,
  effectiveModel,
  modelLabel,
  modelOptions,
  overrideFor,
  parseModelCache,
} from './models.ts';
import { makeT } from '../i18n/core.ts';

const t = makeT('de', 'de-DE');


test('effectiveModel: conversation > profile > default', () => {
  assert.equal(effectiveModel('hermes', undefined, undefined), undefined);
  assert.equal(effectiveModel('hermes', 'kimi-k2', 'x'), 'kimi-k2');
});

test('modelLabel', () => {
  assert.equal(modelLabel('hermes', undefined), '');
  assert.equal(modelLabel('hermes', 'hermes-agent'), '');
  assert.equal(modelLabel('hermes', 'kimi-k2'), 'kimi-k2');
});

test('modelOptions: hermes standard first, dedupe, keep unlisted selection', () => {
  const o = modelOptions('hermes', ['hermes-agent', 'kimi-k2', 'kimi-k2', 'kimi-k2-kilo'], 'old-model', t);
  assert.deepEqual(o.map((x) => x.id), [undefined, 'kimi-k2', 'kimi-k2-kilo', 'old-model']);
  assert.equal(modelOptions('hermes', [], undefined, t).length, 1);
  assert.equal(modelOptions('hermes', [], undefined, makeT('en', 'en-US'))[0].label, 'Default');
});

test('overrideFor stores the profile default as undefined', () => {
  assert.equal(overrideFor('hermes', undefined, undefined), undefined);
  assert.equal(overrideFor('hermes', 'hermes-agent', undefined), undefined);
  assert.equal(overrideFor('hermes', 'kimi-k2', undefined), 'kimi-k2');
  assert.equal(overrideFor('hermes', 'kimi-k2', 'kimi-k2'), undefined);
  assert.equal(overrideFor('hermes', undefined, 'kimi-k2'), 'hermes-agent');
});

test('model cache parse / match / stale', () => {
  assert.equal(parseModelCache(null), null);
  assert.equal(parseModelCache('nope'), null);
  assert.equal(parseModelCache('{"ids":[]}'), null);
  const e = parseModelCache(JSON.stringify({ baseUrl: 'http://h/v1', ids: ['a', 1, 'b'], at: 1000 }));
  assert.deepEqual(e, { baseUrl: 'http://h/v1', ids: ['a', 'b'], at: 1000 });
  assert.equal(cacheMatches(e, 'http://h/v1'), true);
  assert.equal(cacheMatches(e, 'http://other/v1'), false);
  assert.equal(cacheIsStale(e, 1000 + 60_000), false);
  assert.equal(cacheIsStale(e, 1000 + 11 * 60_000), true);
  assert.equal(cacheIsStale(null, 0), true);
});

