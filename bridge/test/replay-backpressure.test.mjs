// Replay subscribers vs. slow readers (src/replay.mjs): a re-attached response that reads slowly or not at all must
// never make the bridge buffer without limit. A real Node Writable that only drains on demand stands in for the response.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { createReplayStore } from '../src/replay.mjs';

const HEAD = { status: 200, headers: { 'content-type': 'text/event-stream' } };
const KB = 1024;

/** a response whose reader is stalled until `flow()`; `got` = the bytes it consumed */
function slowResponse() {
  /** @type {(() => void)[]} */ let pending = [];
  let flowing = false;
  const got = [];
  const res = new Writable({
    write(chunk, _enc, cb) {
      got.push(Buffer.from(chunk));
      if (flowing) cb();
      else pending.push(cb);
    },
  });
  return Object.assign(res, {
    status: 0,
    ended: false,
    writeHead(status) { this.status = status; return this; },
    flushHeaders() {},
    flow() {
      flowing = true;
      const cbs = pending;
      pending = [];
      for (const cb of cbs) cb();
    },
    got: () => Buffer.concat(got),
  });
}

const tick = () => new Promise((r) => setImmediate(r));
const bytes = (n, fill) => Buffer.alloc(n, fill);

test('a stalled live subscriber is cut at its queue cap; the recording stays within its budget', () => {
  const store = createReplayStore({ maxTurnBytes: 4 * KB, maxTotalBytes: 8 * KB, maxSubscriberBytes: 64 * KB });
  const t = store.begin('s\0a', 'x');
  t.start(HEAD);
  t.append(bytes(100, 1));
  const res = slowResponse();
  assert.equal(t.attach(/** @type {any} */ (res), 0), null);
  for (let i = 0; i < 64; i++) t.append(bytes(32 * KB, 2)); // 2 MiB the stalled reader never takes
  assert.ok(store.stats().bytes <= 8 * KB, 'recording bounded');
  assert.ok(res.writableLength <= 64 * KB + 32 * KB, `subscriber queue bounded (was ${res.writableLength})`);
  assert.ok(res.destroyed, 'the slow reader is disconnected (it resumes from its offset)');
});

test('a slow live subscriber of a recorded turn waits on backpressure and still gets every byte once, in order', async () => {
  const store = createReplayStore({ maxTurnBytes: 4096 * KB, maxTotalBytes: 8192 * KB, maxSubscriberBytes: 64 * KB });
  const t = store.begin('s\0a', 'x');
  t.start(HEAD);
  const sent = [];
  const push = (b) => { sent.push(b); t.append(b); };
  push(bytes(8 * KB, 1));
  const res = slowResponse();
  assert.equal(t.attach(/** @type {any} */ (res), 0), null);
  for (let i = 0; i < 64; i++) push(bytes(16 * KB, i % 250)); // 1 MiB while the reader is stalled
  assert.ok(res.writableLength <= res.writableHighWaterMark + 16 * KB, `high-water mark + one chunk while stalled (was ${res.writableLength})`);
  assert.equal(res.destroyed, false, 'a recorded turn needs no disconnect: the reader continues from the recording');
  res.flow();
  await tick();
  push(bytes(KB, 7));
  t.end();
  await tick();
  assert.equal(res.writableFinished, true, 'ended after the last byte');
  assert.ok(res.got().equals(Buffer.concat(sent)), 'every byte exactly once, in order');
});

test('replaying a finished record honours backpressure', async () => {
  const store = createReplayStore({ maxTurnBytes: 2048 * KB, maxTotalBytes: 4096 * KB });
  const t = store.begin('s\0a', 'x');
  t.start(HEAD);
  const sent = [];
  for (let i = 0; i < 64; i++) { const b = bytes(16 * KB, i); sent.push(b); t.append(b); }
  t.end();
  const res = slowResponse();
  assert.equal(t.attach(/** @type {any} */ (res), 100), null);
  assert.ok(res.writableLength <= res.writableHighWaterMark + 16 * KB, `replay does not queue the whole record (was ${res.writableLength})`);
  assert.equal(res.writableFinished, false);
  res.flow();
  await tick();
  assert.equal(res.writableFinished, true);
  assert.ok(res.got().equals(Buffer.concat(sent).subarray(100)), 'the record from the offset, exactly');
});

test('replays of a finished record count towards the subscriber limits', async () => {
  const store = createReplayStore({ maxTurnBytes: 2048 * KB, maxTotalBytes: 4096 * KB, maxSubscribersTotal: 6 });
  const t = store.begin('s\0a', 'x');
  t.start(HEAD);
  for (let i = 0; i < 16; i++) t.append(bytes(16 * KB, i));
  t.end();
  const readers = [];
  for (let i = 0; i < 4; i++) {
    const res = slowResponse();
    assert.equal(t.attach(/** @type {any} */ (res), 0), null);
    readers.push(res);
  }
  assert.equal(t.attach(/** @type {any} */ (slowResponse()), 0)?.status, 429, 'per turn');
  readers[0].destroy();
  await tick();
  assert.equal(t.attach(/** @type {any} */ (slowResponse()), 0), null, 'a closed reader frees its slot');
  // the bridge-wide limit: another turn gets 2 more, then 429
  const u = store.begin('s\0b', 'x');
  u.start(HEAD);
  u.append(bytes(64 * KB, 1));
  assert.equal(u.attach(/** @type {any} */ (slowResponse()), 0), null);
  assert.equal(u.attach(/** @type {any} */ (slowResponse()), 0), null);
  assert.equal(u.attach(/** @type {any} */ (slowResponse()), 0)?.status, 429, 'bridge-wide');
});

test('a reader still catching up is cut when the record loses its bytes or the turn breaks', () => {
  const store = createReplayStore({ maxTurnBytes: 256 * KB, maxTotalBytes: 300 * KB });
  const a = store.begin('s\0a', 'x');
  a.start(HEAD);
  for (let i = 0; i < 16; i++) a.append(bytes(16 * KB, i));
  a.end();
  const late = slowResponse();
  assert.equal(a.attach(/** @type {any} */ (late), 0), null);
  const b = store.begin('s\0b', 'x');
  b.start(HEAD);
  b.append(bytes(200 * KB, 1)); // evicts the bytes of the finished `a`
  assert.equal(a.resumable, false);
  assert.ok(late.destroyed, 'cannot catch up from a record without bytes');

  const live = slowResponse();
  assert.equal(b.attach(/** @type {any} */ (live), 0), null);
  b.end(true);
  assert.ok(live.destroyed, 'a broken turn breaks its re-attached streams');
  assert.equal(store.stats().bytes <= 300 * KB, true);
});
