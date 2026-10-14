import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecovery, markInterrupted } from './recovery.ts';
import { createSessionsClient } from './sessions.ts';
import { mapRemoteMessages } from './sessionMapping.ts';
import { streamChatCore, type FetchLike } from './stream.ts';
import type { ChatMessage } from './types.ts';

const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const conn = { baseUrl: 'https://example.com/v1', apiKey: 'dummy', bridge: true };
const response = (text: () => Promise<string>) => ({ ok: true, status: 200, headers: new Headers(), body: null, text });

for (const stall of ['headers', 'body']) {
  test(`stream drop → offline stalled ${stall} → slow online recovers without remount or foreground`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_800_000_000_000 });
    const started = Date.now();
    const dropped = await streamChatCore(async () => ({
      ...response(async () => ''),
      body: new ReadableStream<Uint8Array>({ start(c) { c.error(new Error('offline')); } }),
    }), { conn, text: 'Research', sessionId: 'test-session', onEvent: () => {} }).catch((e) => e);
    assert.equal(dropped.accepted, true);
    let list: ChatMessage[] = [
      { id: 'test-user', role: 'user', text: 'Research', tools: [], status: 'done', createdAt: started },
      markInterrupted({ id: 'test-answer', role: 'assistant', text: '', tools: [], status: 'streaming', createdAt: started }, started),
    ];
    let online = false;
    let calls = 0;
    let oldSignal: AbortSignal | undefined;
    const never = new Promise<string>(() => {});
    const fetch: FetchLike = async (_url, init) => {
      calls++;
      if (!online) {
        oldSignal = init?.signal ?? undefined;
        // Model native transport/body reads which do not settle when abort is signalled.
        if (stall === 'headers') await never;
        return response(() => never);
      }
      await new Promise((r) => setTimeout(r, 900));
      return response(async () => {
        await new Promise((r) => setTimeout(r, 900));
        return JSON.stringify({ data: [
          { id: 1, role: 'user', content: 'Research', timestamp: started / 1000 },
          { id: 2, role: 'assistant', content: 'Finished research', finish_reason: 'stop', timestamp: started / 1000 + 20 },
        ] });
      });
    };
    const sessions = createSessionsClient(fetch, conn, 12000);
    const rec = createRecovery({ get: () => list, commit: (next) => { list = next; }, inboxAvailable: () => true,
      fetchRemote: async () => mapRemoteMessages((await sessions.messages('test-session')).messages) });
    t.after(() => rec.dispose());
    rec.start();
    t.mock.timers.tick(3000); await flush();
    assert.equal(calls, 1);
    t.mock.timers.tick(27000); await flush();
    assert.equal(oldSignal?.aborted, true);
    online = true; // Android remains active: no AppState change, no inbox ready event.
    t.mock.timers.tick(6000); await flush();
    t.mock.timers.tick(900); await flush();
    t.mock.timers.tick(900); await flush();
    assert.equal(list[1].status, 'done', 'a timed-out request must release recovery and allow another poll');
    assert.equal(list[1].text, 'Finished research');
    assert.equal(list.length, 2);
    assert.equal(calls, 2);
  });
}
