/// <reference types="node" />
// bugs review 2026-10-11 P3-9: custom request headers go to the secure store, not the profile metadata
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headersSlot, legacyHeaders, parseHeaders, restoreHeaders, serializeHeaders, withoutHeaders } from './secretHeaders.ts';
import type { StoredProfile } from './migrate';

const secret = { Authorization: 'Bearer s3cret', 'CF-Access-Client-Secret': 'cf' };

test('metadata written to AsyncStorage carries no headers', () => {
  const meta = withoutHeaders({ id: 'p1', name: 'OR', headers: secret });
  assert.equal('headers' in meta, false);
  assert.doesNotMatch(JSON.stringify(meta), /s3cret/);
});

test('serialize / parse round trip; empty → no slot', () => {
  assert.deepEqual(parseHeaders(serializeHeaders(secret)), secret);
  assert.equal(serializeHeaders(undefined), '');
  assert.equal(serializeHeaders({}), '');
  assert.equal(parseHeaders('not json'), undefined);
  assert.equal(parseHeaders('[1]'), undefined);
});

test('legacy metadata headers are found for migration; restore prefers the secure store', () => {
  const stored = [
    { id: 'a', headers: secret },
    { id: 'b' },
  ] as unknown as StoredProfile[];
  assert.deepEqual(legacyHeaders(stored), [{ id: 'a', value: serializeHeaders(secret) }]);
  assert.deepEqual(restoreHeaders(serializeHeaders({ X: '1' }), secret), { X: '1' });
  assert.deepEqual(restoreHeaders('', secret), secret);
  assert.equal(restoreHeaders('', undefined), undefined);
});

test('headers slot is separate from the API key slot', () => {
  assert.notEqual(headersSlot('p1'), 'p1');
});
