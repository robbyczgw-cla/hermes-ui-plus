import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { Writable } from 'node:stream';
import { createInboxHub } from '../src/push/inbox.mjs';

function stalledResponse() {
  return Object.assign(new Writable({ write(_chunk, _encoding, _done) {} }), {
    writeHead() {}, flushHeaders() {},
  });
}

test('inbox disconnects a stalled reader before its queue exceeds the byte budget', () => {
  const hub = createInboxHub({ maxBufferedBytes: 1024 });
  const slow = stalledResponse();
  hub.attach('test-user', new EventEmitter(), slow);
  for (let i = 0; i < 100; i++) hub.publish('test-user', { content: 'x'.repeat(256) });
  assert.ok(slow.writableLength <= 1024);
  assert.equal(slow.destroyed, true);
  assert.equal(hub.size, 0);
  assert.equal(hub.listeners('test-user', {}), 0);
  assert.equal(hub.publish('test-user', { content: 'test' }), 0, 'push fallback can take over');
  hub.closeAll();
});

test('keepalives also obey the inbox byte budget without any published messages', async () => {
  const hub = createInboxHub({ maxBufferedBytes: 96, keepaliveMs: 1 });
  const slow = stalledResponse();
  hub.attach('test-user', new EventEmitter(), slow);
  const timer = setTimeout(() => slow.destroy(new Error('keepalive queue was not bounded')), 2000);
  try {
    await once(slow, 'close');
    assert.ok(slow.writableLength <= 96);
    assert.equal(hub.size, 0);
  } finally { clearTimeout(timer); hub.closeAll(); }
});

test('oversized events do not enter a reader queue; other readers still receive small events', () => {
  const hub = createInboxHub({ maxBufferedBytes: 1024 });
  const slow = stalledResponse();
  hub.attach('test-user', new EventEmitter(), slow);
  assert.equal(hub.publish('test-user', { content: 'x'.repeat(4096) }), 0);
  assert.equal(slow.destroyed, true);
  const got = [];
  const fast = Object.assign(new Writable({ write(c, _e, done) { got.push(c); done(); } }), {
    writeHead() {}, flushHeaders() {},
  });
  hub.attach('test-user', new EventEmitter(), fast);
  assert.equal(hub.publish('test-user', { content: 'test' }), 1);
  assert.match(Buffer.concat(got).toString(), /"content":"test"/);
  hub.closeAll();
});
