/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { streamChatCore, respondApprovalCore, HermesError, isHermesError } from './stream.ts';
import { BOOTSTRAP_SYSTEM_MESSAGE } from './bootstrap.ts';
import type { HermesEvent, HermesConn } from './types';

const conn: HermesConn = { baseUrl: 'http://h.test:8645/v1/', apiKey: 'sekrit', sessionKey: 'hermes-ui-dev' };

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../../../mock-server/fixtures/${name}`, import.meta.url)));
}

/** Response whose body arrives in chunks of the given sizes (cycled). */
function sseResponse(bytes: Uint8Array, sizes: number[], headers: Record<string, string> = {}) {
  let pos = 0;
  let i = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (pos >= bytes.length) return c.close();
      const n = sizes[i++ % sizes.length];
      c.enqueue(bytes.slice(pos, pos + n));
      pos += n;
    },
    cancel() {
      cancelled = true;
    },
  });
  const res = new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', 'x-hermes-session-id': 'sess-from-server', ...headers },
  });
  return { res, wasCancelled: () => cancelled };
}

type Call = { url: string; init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal } };

function fakeFetch(make: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = async (url: string, init: Call['init']) => {
    calls.push({ url, init });
    return (await make()) as never;
  };
  return { fn, calls };
}

test('sends only the new message with session headers; parses tool fixture across odd chunk sizes', async () => {
  const { res } = sseResponse(fixture('02-tool.sse'), [1, 5, 17, 3, 200]);
  const f = fakeFetch(() => res);
  const events: HermesEvent[] = [];
  const result = await streamChatCore(f.fn, {
    conn,
    text: 'Wie spät ist es?',
    sessionId: 'hui-123',
    onEvent: (e) => events.push(e),
  });
  const call = f.calls[0];
  assert.equal(call.url, 'http://h.test:8645/v1/chat/completions');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.Authorization, 'Bearer sekrit');
  assert.equal(call.init.headers['X-Hermes-Session-Id'], 'hui-123');
  assert.equal(call.init.headers['X-Hermes-Session-Key'], 'hermes-ui-dev');
  const body = JSON.parse(call.init.body as string);
  assert.deepEqual(body, {
    model: 'hermes-agent',
    stream: true,
    messages: [
      { role: 'system', content: BOOTSTRAP_SYSTEM_MESSAGE },
      { role: 'user', content: 'Wie spät ist es?' },
    ],
  });

  assert.equal(result.sessionId, 'sess-from-server');
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.aborted, false);
  assert.match(result.completionId ?? '', /^chatcmpl-/);
  assert.match(result.text, /Samstag, 10\. Oktober 2026/);
  const types = events.map((e) => e.type);
  assert.equal(types[0], 'start');
  assert.ok(types.indexOf('tool') > types.indexOf('text'));
  assert.equal(types[types.length - 1], 'done');
});

test('default session key and custom model', async () => {
  const { res } = sseResponse(fixture('01-plain.sse'), [1000]);
  const f = fakeFetch(() => res);
  await streamChatCore(f.fn, {
    conn: { baseUrl: 'http://x/v1', apiKey: 'k', model: 'kimi-k2' },
    text: 'hi',
    sessionId: 's',
    onEvent: () => {},
  });
  assert.equal(f.calls[0].init.headers['X-Hermes-Session-Key'], 'hermes-ui');
  assert.equal(JSON.parse(f.calls[0].init.body as string).model, 'kimi-k2');
});

test('HTTP errors map to HermesError kinds (401, 429 + Retry-After, 503, 502 json)', async () => {
  const cases: [number, string, Record<string, string>, string][] = [
    [401, '{"error":{"message":"Invalid gateway API key (API_SERVER_KEY)","type":"gateway_auth_error","code":"gateway_auth_failed"}}', {}, 'auth'],
    [429, '{"error":{"message":"Too many concurrent runs (max 10)","type":"rate_limit_error","code":"rate_limit_exceeded"}}', { 'retry-after': '1' }, 'rate_limit'],
    [503, '{"error":{"message":"draining","code":"gateway_draining"}}', {}, 'busy'],
    [500, 'oops', {}, 'server'],
    [400, '{"error":{"message":"Missing or invalid \'messages\' field"}}', {}, 'bad_request'],
  ];
  for (const [status, body, headers, kind] of cases) {
    const f = fakeFetch(() => new Response(body, { status, headers }));
    await assert.rejects(
      streamChatCore(f.fn, { conn, text: 'x', sessionId: 's', onEvent: () => {} }),
      (e: unknown) => {
        assert.ok(isHermesError(e));
        assert.equal((e as HermesError).kind, kind);
        assert.equal((e as HermesError).status, status);
        return true;
      }
    );
  }
  const f = fakeFetch(() => new Response('{"error":{"message":"m","code":"c"}}', { status: 429, headers: { 'retry-after': '3' } }));
  const err = await streamChatCore(f.fn, { conn, text: 'x', sessionId: 's', onEvent: () => {} }).catch((e) => e);
  assert.equal(err.retryAfter, 3);
  assert.equal(err.message, 'm');
  assert.equal(err.code, 'c');
});

test('network failure -> kind network', async () => {
  const fn = async () => {
    throw new TypeError('fetch failed');
  };
  const err = await streamChatCore(fn as never, { conn, text: 'x', sessionId: 's', onEvent: () => {} }).catch((e) => e);
  assert.equal(err.kind, 'network');
});

test('abort mid-stream resolves aborted:true and cancels the body (closes the connection)', async () => {
  const ctrl = new AbortController();
  const bytes = fixture('02-tool.sse');
  const { res, wasCancelled } = sseResponse(bytes, [50]);
  const f = fakeFetch(() => res);
  let n = 0;
  const result = await streamChatCore(f.fn, {
    conn,
    text: 'x',
    sessionId: 's',
    signal: ctrl.signal,
    onEvent: (e) => {
      if (e.type === 'text' && ++n === 3) ctrl.abort();
    },
  });
  assert.equal(result.aborted, true);
  assert.ok(result.text.length > 0 && result.text.length < 100);
  assert.equal(f.calls[0].init.signal?.aborted, true);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(wasCancelled(), true);
});

test('already aborted signal returns immediately without a request', async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  const f = fakeFetch(() => new Response(''));
  const r = await streamChatCore(f.fn, { conn, text: 'x', sessionId: 's', signal: ctrl.signal, onEvent: () => {} });
  assert.equal(r.aborted, true);
  assert.equal(f.calls.length, 0);
});

test('stream that ends without finish/[DONE] -> kind stream, partial events delivered', async () => {
  const text = new TextEncoder().encode(
    'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"role":"assistant"}}]}\n\n' +
      'data: {"choices":[{"index":0,"delta":{"content":"abc"}}]}\n\n'
  );
  const { res } = sseResponse(text, [10]);
  const f = fakeFetch(() => res);
  const events: HermesEvent[] = [];
  const err = await streamChatCore(f.fn, { conn, text: 'x', sessionId: 's', onEvent: (e) => events.push(e) }).catch((e) => e);
  assert.equal(err.kind, 'stream');
  assert.deepEqual(events.filter((e) => e.type === 'text'), [{ type: 'text', text: 'abc' }]);
});

test('agent error finish chunk resolves with finishReason error (not thrown)', async () => {
  const text = new TextEncoder().encode(
    'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"role":"assistant"}}]}\n\n' +
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"error"}],"error":{"message":"boom","type":"agent_error"},"hermes":{"completed":false,"failed":true,"error":"boom","error_code":"agent_error"}}\n\n' +
      'data: [DONE]\n\n'
  );
  const { res } = sseResponse(text, [64]);
  const f = fakeFetch(() => res);
  const r = await streamChatCore(f.fn, { conn, text: 'x', sessionId: 's', onEvent: () => {} });
  assert.equal(r.finishReason, 'error');
  assert.equal(r.error, 'boom');
});

test('idle timeout aborts a silent stream with kind timeout', async () => {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(': keepalive\n\n'));
    },
  });
  const f = fakeFetch(() => new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
  const err = await streamChatCore(f.fn, { conn, text: 'x', sessionId: 's', idleTimeoutMs: 40, onEvent: () => {} }).catch((e) => e);
  assert.equal(err.kind, 'timeout');
});

test('keepalive comments keep a slow stream alive past the idle window', async () => {
  const enc = new TextEncoder();
  let step = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(c) {
      await new Promise((r) => setTimeout(r, 25));
      step++;
      if (step <= 4) c.enqueue(enc.encode(': keepalive\n\n'));
      else {
        c.enqueue(enc.encode('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
        c.close();
      }
    },
  });
  const f = fakeFetch(() => new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
  const r = await streamChatCore(f.fn, { conn, text: 'x', sessionId: 's', idleTimeoutMs: 60, onEvent: () => {} });
  assert.equal(r.finishReason, 'stop');
});

test('JSON fallback when server ignores stream:true', async () => {
  const f = fakeFetch(
    () =>
      new Response(JSON.stringify({ id: 'chatcmpl-9', choices: [{ message: { role: 'assistant', content: 'Hallo' }, finish_reason: 'stop' }] }), {
        headers: { 'content-type': 'application/json' },
      })
  );
  const events: HermesEvent[] = [];
  const r = await streamChatCore(f.fn, { conn, text: 'x', sessionId: 's', onEvent: (e) => events.push(e) });
  assert.equal(r.text, 'Hallo');
  assert.equal(r.completionId, 'chatcmpl-9');
  assert.equal(r.finishReason, 'stop');
});

test('approval events reach onApproval; respondApproval posts choice + request_id', async () => {
  const text = new TextEncoder().encode(
    'data: {"id":"chatcmpl-7","choices":[{"index":0,"delta":{"role":"assistant"}}]}\n\n' +
      'event: approval.request\ndata: {"event":"approval.request","run_id":"chatcmpl-7","request_id":"rq1","command":"rm x","description":"d","choices":["once","deny"],"timestamp":1}\n\n' +
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
  );
  const { res } = sseResponse(text, [33]);
  const f = fakeFetch(() => res);
  const seen: string[] = [];
  await streamChatCore(f.fn, { conn, text: 'x', sessionId: 's', onEvent: () => {}, onApproval: (a) => seen.push(a.requestId ?? '') });
  assert.deepEqual(seen, ['rq1']);

  const g = fakeFetch(() => new Response('{"object":"hermes.run.approval_response","resolved":1}'));
  await respondApprovalCore(g.fn, conn, { runId: 'chatcmpl-7', requestId: 'rq1' }, 'once');
  assert.equal(g.calls[0].url, 'http://h.test:8645/v1/runs/chatcmpl-7/approval');
  assert.deepEqual(JSON.parse(g.calls[0].init.body as string), { choice: 'once', request_id: 'rq1' });
  assert.equal(g.calls[0].init.headers.Authorization, 'Bearer sekrit');

  const h = fakeFetch(() => new Response('{"error":{"message":"Run has no pending approval","code":"approval_not_pending"}}', { status: 409 }));
  const err = await respondApprovalCore(h.fn, conn, { runId: 'r', requestId: 'q' }, 'deny').catch((e) => e);
  assert.equal(err.code, 'approval_not_pending');
});

test('bootstrap:false (bridge) sends only the user message; system message is byte-identical across requests', async () => {
  const bridge = fakeFetch(() => sseResponse(fixture('01-plain.sse'), [100]).res);
  await streamChatCore(bridge.fn, { conn: { ...conn, bootstrap: false }, text: 'hi', sessionId: 's', onEvent: () => {} });
  assert.deepEqual(JSON.parse(bridge.calls[0].init.body as string).messages, [{ role: 'user', content: 'hi' }]);

  const direct = fakeFetch(() => sseResponse(fixture('01-plain.sse'), [100]).res);
  await streamChatCore(direct.fn, { conn, text: 'a', sessionId: 's', onEvent: () => {} });
  await streamChatCore(direct.fn, { conn, text: 'b', sessionId: 's', onEvent: () => {} });
  const sys = direct.calls.map((c) => JSON.parse(c.init.body as string).messages[0].content);
  assert.equal(sys[0], sys[1]);
  assert.equal(sys[0], BOOTSTRAP_SYSTEM_MESSAGE);
});

test('content parts (attachments) replace the text as user content', async () => {
  const f = fakeFetch(() => sseResponse(fixture('01-plain.sse'), [100]).res);
  const content = [
    { type: 'text' as const, text: 'Was ist das?' },
    { type: 'image_url' as const, image_url: { url: 'data:image/jpeg;base64,AAAA' } },
  ];
  await streamChatCore(f.fn, { conn: { ...conn, bootstrap: false }, text: 'Was ist das?', content, sessionId: 's', onEvent: () => {} });
  assert.deepEqual(JSON.parse(f.calls[0].init.body as string).messages, [{ role: 'user', content }]);
});

for (const status of [200, 401]) {
  test(`stalled HTTP ${status} body respects Stop and idle timeout`, { timeout: 1000 }, async () => {
    for (const stop of [true, false]) {
      const ctrl = new AbortController();
      let reading!: () => void;
      const started = new Promise<void>((resolve) => { reading = resolve; });
      const result = streamChatCore(async () => ({
        ok: status === 200, status,
        headers: new Headers({ 'content-type': 'application/json' }), body: null,
        text: () => { reading(); return new Promise<string>(() => {}); },
      }), { conn, text: 'test', sessionId: 'test-session', signal: ctrl.signal, idleTimeoutMs: 25, onEvent: () => {} });
      await started;
      if (stop) {
        ctrl.abort();
        assert.equal((await result).aborted, true);
      } else {
        await assert.rejects(result, (e: unknown) => isHermesError(e) && e.kind === 'timeout' && !!e.accepted === (status === 200));
      }
    }
  });
}

for (const reason of ['stop', 'error']) {
  test(`transport loss after terminal ${reason} frame preserves the agent result`, async () => {
    let sent = false;
    const frame = new TextEncoder().encode(`data: ${JSON.stringify({
      choices: [{ delta: { content: 'Final text' }, finish_reason: reason }],
      ...(reason === 'error' ? { error: { message: 'Tool execution failed' } } : {}),
    })}\n\n`);
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (!sent) { sent = true; c.enqueue(frame); }
        else c.error(new Error('Connection dropped after final frame'));
      },
    });
    const result = await streamChatCore(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }), {
      conn, text: 'test', sessionId: 'test-terminal', onEvent: () => {},
    });
    assert.equal(result.finishReason, reason);
    assert.equal(result.text, 'Final text');
    assert.equal(result.error, reason === 'error' ? 'Tool execution failed' : undefined);
    assert.equal(result.aborted, false);
  });
}
