import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsLocalCopy } from './captureTracker.ts';

test('needsLocalCopy: only http(s) photos inside a web capture frame', () => {
  assert.equal(needsLocalCopy('web', true, 'https://upload.wikimedia.org/a.png'), true);
  assert.equal(needsLocalCopy('web', true, 'http://192.0.2.10:8642/bridge/images/proxy?u=x'), true);
  // outside a capture frame, on native, or already local: drawn as is
  assert.equal(needsLocalCopy('web', false, 'https://example.com/a.png'), false);
  assert.equal(needsLocalCopy('android', true, 'https://example.com/a.png'), false);
  assert.equal(needsLocalCopy('ios', true, 'https://example.com/a.png'), false);
  assert.equal(needsLocalCopy('web', true, 'data:image/png;base64,AAAA'), false);
  assert.equal(needsLocalCopy('web', true, 'blob:http://127.0.0.1/abc'), false);
  assert.equal(needsLocalCopy('web', true, null), false);
  assert.equal(needsLocalCopy('web', true, ''), false);
});
