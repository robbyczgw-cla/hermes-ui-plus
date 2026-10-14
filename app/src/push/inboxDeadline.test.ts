import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchPushConfig, readInbox } from './api.ts';
import { runInbox } from './inboxRunner.ts';
import type { FetchLike } from '../hermes/stream.ts';

const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
const profile = { id: 'test-profile', kind: 'hermes', baseUrl: 'https://example.com/v1', apiKey: 'dummy', bridge: true };
const response = (body: ReadableStream<Uint8Array> | null = null, text = async () => '{}') => ({ ok: true, status: 200, headers: new Headers(), body, text });
const bytes = (s: string) => new TextEncoder().encode(s);

for (const stall of ['config headers', 'config body', 'stream headers', 'stream read']) {
  test(`inbox retries stalled ${stall} after offline → slow online without AppState change`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const ctrl = new AbortController();
    t.after(() => ctrl.abort());
    let online = false;
    let ready = 0;
    const fetch: FetchLike = async (url) => {
      const config = String(url).endsWith('/config');
      if (!online) {
        if ((config && stall === 'config headers') || (!config && stall === 'stream headers')) return new Promise(() => {});
        if (config && stall === 'config body') return response(null, () => new Promise(() => {}));
        if (!config) return response(new ReadableStream());
      }
      await new Promise((r) => setTimeout(r, 900));
      return config ? response(null, async () => '{"platforms":{},"inbox":true}') : response(new ReadableStream({
        start(c) { c.enqueue(bytes('event: hui.ready\ndata: {}\n\n')); },
      }));
    };
    const running = runInbox({ signal: ctrl.signal, loadConfig: () => fetchPushConfig(fetch, profile),
      connect: () => readInbox(fetch, 'https://example.com/bridge/inbox/stream', 'dummy', {
        signal: ctrl.signal, onEvent: () => {}, onReady: () => { ready++; },
      }).then(() => {}), isFatal: () => false, backoff: () => 1000 });
    await flush();
    t.mock.timers.tick(900); await flush();
    online = true;
    // Generous bound covers config/connect and three missing 15-second keepalives.
    for (let i = 0; i < 70 && !ready; i++) { t.mock.timers.tick(1000); await flush(); }
    assert.equal(ready, 1, 'the stale connection must relinquish the runner');
    ctrl.abort(); await running;
  });
}

test('inbox keepalive bytes reset the idle deadline; abort settles a stuck read', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ctrl = new AbortController();
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let ended = false;
  const running = readInbox(async () => response(new ReadableStream({ start(c) { stream = c; } })),
    'https://example.com/bridge/inbox/stream', 'dummy', { signal: ctrl.signal, onEvent: () => {} }).then(() => { ended = true; });
  await flush();
  for (let i = 0; i < 12; i++) {
    t.mock.timers.tick(15000);
    stream.enqueue(bytes(': keepalive\n\n'));
    await flush();
    assert.equal(ended, false);
  }
  ctrl.abort(); await flush();
  assert.equal(ended, true);
  await running;
});
