/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { streamChatCore, respondApprovalCore, HermesError, isHermesError } from './stream.ts';
import { BOOTSTRAP_SYSTEM_MESSAGE } from './bootstrap.ts';
import { CAP_MARKER, MAX_MESSAGE_TEXT } from './chatState.ts';
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

test('a reattach answered without SSE cancels the rejected body and its request', async () => {
  let cancelled = false;
  let bodyRead = false;
  let finish = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      finish = () => c.close();
      c.enqueue(new TextEncoder().encode('<html>proxy response'));
      // The proxy never finishes the body. Refusing resume must not leave it reading without a deadline.
    },
    cancel() {
      cancelled = true;
    },
  });
  const res = new Response(body, { headers: { 'content-type': 'text/html' } });
  const read = res.text.bind(res);
  res.text = () => {
    bodyRead = true;
    return read();
  };
  const f = fakeFetch(() => res);
  try {
    await assert.rejects(
      streamChatCore(f.fn, { conn, text: '', sessionId: 'hui-test', idempotencyKey: 'turn-test-refusal', resumeFrom: 0, onEvent: () => assert.fail('no events from a refused resume') }),
      (e: unknown) => isHermesError(e) && e.code === 'resume_unavailable',
    );
    assert.equal(bodyRead, false, 'do not drain an untrusted response after refusing it');
    assert.equal(cancelled, true, 'the rejected response body is cancelled');
    assert.equal(f.calls[0].init.signal?.aborted, true, 'the request is closed even before a reader was acquired');
  } finally {
    // Release the fixture even when the regression fails before the transport fix.
    if (!cancelled) finish();
  }
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

// ---------------------------------------------------------------- idempotent send + resume (UI bridge, bridge/src/replay.mjs)

/** SSE response that delivers `bytes` in `size` chunks and then breaks the connection after `cutAt` bytes */
function brokenResponse(bytes: Uint8Array, cutAt: number, headers: Record<string, string> = {}, size = 64) {
  let pos = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (pos >= cutAt) return c.error(new TypeError('Software caused connection abort'));
      const n = Math.min(size, cutAt - pos);
      c.enqueue(bytes.slice(pos, pos + n));
      pos += n;
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream', 'x-hermes-session-id': 'hui-r', ...headers } });
}

const RESUMABLE = { 'x-hermes-ui-resume': '1' };

test('Idempotency-Key header only when a key is given', async () => {
  const f = fakeFetch(() => sseResponse(fixture('01-plain.sse'), [999]).res);
  await streamChatCore(f.fn, { conn, text: 'x', sessionId: 's', onEvent: () => {} });
  await streamChatCore(f.fn, { conn, text: 'x', sessionId: 's', idempotencyKey: 'turn-1', onEvent: () => {} });
  assert.equal(f.calls[0].init.headers['Idempotency-Key'], undefined);
  assert.equal(f.calls[1].init.headers['Idempotency-Key'], 'turn-1');
});

test('lost stream on a resumable bridge turn: re-attached at the byte offset, every event exactly once', async () => {
  const bytes = fixture('02-tool.sse');
  const ref: HermesEvent[] = [];
  const full = await streamChatCore(fakeFetch(() => sseResponse(bytes, [999]).res).fn, { conn, text: 'x', sessionId: 's', onEvent: (e) => ref.push(e) });
  const cutAt = 701; // mid-frame on purpose
  let n = 0;
  const f = fakeFetch(() => (n++ === 0 ? brokenResponse(bytes, cutAt, RESUMABLE) : sseResponse(bytes.slice(cutAt), [37], RESUMABLE).res));
  const events: HermesEvent[] = [];
  const r = await streamChatCore(f.fn, { conn, text: 'x', sessionId: 's', idempotencyKey: 'turn-2', resumeDelaysMs: [1, 1], onEvent: (e) => events.push(e) });
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].init.headers['X-Hermes-UI-Resume-Offset'], String(cutAt));
  assert.equal(f.calls[1].init.headers['Idempotency-Key'], 'turn-2');
  // the message never goes out again: a bridge without resume support would get a request Hermes refuses (400)
  assert.deepEqual(JSON.parse(f.calls[1].init.body!), { model: 'hermes-agent', stream: true, messages: [] });
  assert.equal(r.text, full.text);
  assert.equal(r.finishReason, 'stop');
  assert.deepEqual(events, ref);
});

test('resume refused (409 resume_unavailable) → the original transport error, marked accepted (recovery takes over)', async () => {
  const bytes = fixture('02-tool.sse');
  let n = 0;
  const f = fakeFetch(() =>
    n++ === 0
      ? brokenResponse(bytes, 300, RESUMABLE)
      : new Response('{"error":{"message":"gone","code":"resume_unavailable"}}', { status: 409, headers: { 'content-type': 'application/json' } }),
  );
  const err = await streamChatCore(f.fn, { conn, text: 'x', sessionId: 's', idempotencyKey: 'k', resumeDelaysMs: [1, 1, 1], onEvent: () => {} }).catch((e) => e);
  assert.equal(f.calls.length, 2, 'a refusal ends the attempts');
  assert.equal(err.kind, 'network');
  assert.equal(err.accepted, true);
});

test('resume while still offline: attempts until the window ran out, then the transport error (no refusal code)', async () => {
  const bytes = fixture('02-tool.sse');
  let n = 0;
  const fn = async (url: string, init: Call['init']) => {
    if (n++ === 0) return brokenResponse(bytes, 300, RESUMABLE) as never;
    void url;
    void init;
    throw new TypeError('Network request failed');
  };
  const t0 = Date.now();
  const err = await streamChatCore(fn as never, { conn, text: 'x', sessionId: 's', idempotencyKey: 'k', resumeDelaysMs: [5], resumeWindowMs: 80, onEvent: () => {} }).catch((e) => e);
  assert.ok(n > 3, `several attempts (${n})`);
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(err.kind, 'network');
  assert.equal(err.accepted, true);
  assert.equal(err.resumeCode, undefined, 'not refused: recovery may still re-attach later');
});

test('airplane mode for a while: offline attempts, then the stream continues live at its byte offset', async () => {
  const bytes = fixture('02-tool.sse');
  const ref: HermesEvent[] = [];
  await streamChatCore(fakeFetch(() => sseResponse(bytes, [999]).res).fn, { conn, text: 'x', sessionId: 's', onEvent: (e) => ref.push(e) });
  const cutAt = 450;
  let n = 0;
  const offsets: (string | undefined)[] = [];
  const fn = async (_url: string, init: Call['init']) => {
    offsets.push(init.headers['X-Hermes-UI-Resume-Offset']);
    n++;
    if (n === 1) return brokenResponse(bytes, cutAt, RESUMABLE) as never;
    if (n < 6) throw new TypeError('Network request failed'); // offline
    return sseResponse(bytes.slice(cutAt), [41], RESUMABLE).res as never;
  };
  const states: string[] = [];
  const events: HermesEvent[] = [];
  const r = await streamChatCore(fn as never, {
    conn, text: 'x', sessionId: 's', idempotencyKey: 'k', resumeDelaysMs: [1], onEvent: (e) => events.push(e), onConnection: (s) => states.push(s),
  });
  assert.equal(r.finishReason, 'stop');
  assert.deepEqual(events, ref, 'every event exactly once');
  assert.deepEqual(offsets, [undefined, ...Array(5).fill(String(cutAt))]);
  assert.deepEqual(states, ['lost', 'resumed']);
});

test('wake (foreground / network back) ends a resume pause at once', async () => {
  const bytes = fixture('02-tool.sse');
  let n = 0;
  const f = fakeFetch(() => (n++ === 0 ? brokenResponse(bytes, 300, RESUMABLE) : sseResponse(bytes.slice(300), [999], RESUMABLE).res));
  const listeners = new Set<() => void>();
  const t0 = Date.now();
  const p = streamChatCore(f.fn, {
    conn, text: 'x', sessionId: 's', idempotencyKey: 'k', resumeDelaysMs: [60_000], onEvent: () => {},
    wake: (fn) => {
      listeners.add(fn);
      setTimeout(() => fn(), 20);
      return () => listeners.delete(fn);
    },
  });
  const r = await p;
  assert.equal(r.finishReason, 'stop');
  assert.ok(Date.now() - t0 < 5000, 'did not wait for the 60 s pause');
  assert.equal(listeners.size, 0, 'unsubscribed');
});

test('bridge busy / still starting (503, 429, 409 in_progress) is retried; a final refusal carries its code', async () => {
  const bytes = fixture('02-tool.sse');
  const json = (status: number, code: string) => new Response(JSON.stringify({ error: { message: code, code } }), { status, headers: { 'content-type': 'application/json' } });
  let n = 0;
  const f = fakeFetch(() => {
    n++;
    if (n === 1) return brokenResponse(bytes, 300, RESUMABLE);
    if (n === 2) return json(503, 'upstream_unavailable');
    if (n === 3) return json(429, 'rate_limit_exceeded');
    if (n === 4) return json(409, 'idempotency_in_progress');
    return json(409, 'turn_unrecorded');
  });
  const err = await streamChatCore(f.fn, { conn, text: 'x', sessionId: 's', idempotencyKey: 'k', resumeDelaysMs: [1], onEvent: () => {} }).catch((e) => e);
  assert.equal(f.calls.length, 5);
  assert.equal(err.accepted, true);
  assert.equal(err.resumeCode, 'turn_unrecorded');
});

test('a recording that ends without the turn\'s end: two empty re-attaches, then the turn counts as lost', async () => {
  const bytes = fixture('02-tool.sse');
  let n = 0;
  const f = fakeFetch(() => (n++ === 0 ? sseResponse(bytes.slice(0, 300), [999], RESUMABLE).res : sseResponse(new Uint8Array(0), [1], RESUMABLE).res));
  const err = await streamChatCore(f.fn, { conn, text: 'x', sessionId: 's', idempotencyKey: 'k', resumeDelaysMs: [1], onEvent: () => {} }).catch((e) => e);
  assert.equal(f.calls.length, 3, 'the original request + 2 empty re-attaches');
  assert.equal(err.kind, 'stream');
  assert.equal(err.accepted, true);
});

test('resumeFrom (app restart): the first request is a re-attach at that offset, without the message', async () => {
  const bytes = fixture('02-tool.sse');
  const ref: HermesEvent[] = [];
  const full = await streamChatCore(fakeFetch(() => sseResponse(bytes, [999]).res).fn, { conn, text: 'x', sessionId: 's', onEvent: (e) => ref.push(e) });
  const f = fakeFetch(() => sseResponse(bytes, [53], { ...RESUMABLE, 'x-hermes-ui-resumed': '0' }).res);
  const events: HermesEvent[] = [];
  let info: { resumable: boolean } | undefined;
  const r = await streamChatCore(f.fn, { conn, text: '', sessionId: 's', idempotencyKey: 'turn-r', resumeFrom: 0, onEvent: (e) => events.push(e), onAccepted: (i) => (info = i) });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].init.headers['X-Hermes-UI-Resume-Offset'], '0');
  assert.equal(f.calls[0].init.headers['Idempotency-Key'], 'turn-r');
  assert.deepEqual(JSON.parse(f.calls[0].init.body!).messages, []);
  assert.deepEqual(info, { resumable: true });
  assert.equal(r.text, full.text);
  assert.deepEqual(events, ref);

  // refused: the bridge's code, never accepted (nothing was resumed)
  const gone = fakeFetch(() => new Response('{"error":{"message":"gone","code":"resume_unavailable"}}', { status: 409, headers: { 'content-type': 'application/json' } }));
  const err = await streamChatCore(gone.fn, { conn, text: '', sessionId: 's', idempotencyKey: 'turn-r', resumeFrom: 0, onEvent: () => {} }).catch((e) => e);
  assert.equal(err.code, 'resume_unavailable');
  assert.equal(err.accepted, undefined);
  // an old bridge / proxy answering JSON to a re-attach: no answer of this turn
  const old = fakeFetch(() => new Response('{"choices":[]}', { status: 200, headers: { 'content-type': 'application/json' } }));
  const err2 = await streamChatCore(old.fn, { conn, text: '', sessionId: 's', idempotencyKey: 'turn-r', resumeFrom: 0, onEvent: () => {} }).catch((e) => e);
  assert.equal(err2.code, 'resume_unavailable');
});

test('no resume without the bridge header or without a key (unchanged behaviour)', async () => {
  const bytes = fixture('02-tool.sse');
  for (const [headers, key] of [[{}, 'k'], [RESUMABLE, undefined]] as const) {
    const f = fakeFetch(() => brokenResponse(bytes, 300, headers));
    const err = await streamChatCore(f.fn, { conn, text: 'x', sessionId: 's', idempotencyKey: key, resumeDelaysMs: [1], onEvent: () => {} }).catch((e) => e);
    assert.equal(f.calls.length, 1);
    assert.equal(err.accepted, true);
  }
});

test('stop during the resume pause → aborted, no further request', async () => {
  const bytes = fixture('02-tool.sse');
  const ctrl = new AbortController();
  const f = fakeFetch(() => brokenResponse(bytes, 300, RESUMABLE));
  setTimeout(() => ctrl.abort(), 30);
  const r = await streamChatCore(f.fn, { conn, text: 'x', sessionId: 's', idempotencyKey: 'k', signal: ctrl.signal, resumeDelaysMs: [500], onEvent: () => {} });
  assert.equal(r.aborted, true);
  assert.equal(f.calls.length, 1);
});

test('JSON fallback carries message.reasoning_content as a reasoning event (Hermes v0.22)', async () => {
  const f = fakeFetch(
    () =>
      new Response(JSON.stringify({ id: 'chatcmpl-9', choices: [{ message: { role: 'assistant', content: 'Hallo', reasoning_content: 'kurz nachdenken' }, finish_reason: 'stop' }] }), {
        headers: { 'content-type': 'application/json' },
      }),
  );
  const events: HermesEvent[] = [];
  const r = await streamChatCore(f.fn, { conn, text: 'x', sessionId: 's', onEvent: (e) => events.push(e) });
  assert.equal(r.text, 'Hallo', 'reasoning never mixed into the answer');
  assert.deepEqual(events.filter((e) => e.type === 'reasoning'), [{ type: 'reasoning', text: 'kurz nachdenken' }]);
});

test('Sol F12: the transport text stops growing at the same cap as the chat message (stream, text.replace, JSON)', async () => {
  const kib = 'x'.repeat(1024);
  const chunk = (t: string) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: t }, finish_reason: null }] })}\n\n`;
  const frames: string[] = [];
  for (let i = 0; i < 1100; i++) frames.push(chunk(kib)); // ~1.1 M chars > MAX_MESSAGE_TEXT
  frames.push(`event: hermes.text.replace\ndata: ${JSON.stringify({ text: 'y'.repeat(MAX_MESSAGE_TEXT + 10) })}\n\n`);
  frames.push(chunk(kib));
  frames.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
  const result = await streamChatCore(fakeFetch(() => sseResponse(new TextEncoder().encode(frames.join('')), [65536]).res).fn, {
    conn,
    text: 'hi',
    sessionId: 'hui-1',
    onEvent: () => {},
  });
  const max = MAX_MESSAGE_TEXT + CAP_MARKER.length;
  assert.ok(result.text.length <= max, `stream: ${result.text.length} > ${max}`);
  assert.ok(result.text.startsWith('yyy'), 'text.replace still replaces');
  assert.equal(result.textCapped, true);

  const json = JSON.stringify({ id: 'c', choices: [{ message: { content: 'z'.repeat(MAX_MESSAGE_TEXT * 2) }, finish_reason: 'stop' }] });
  const one = await streamChatCore(fakeFetch(() => new Response(json, { status: 200, headers: { 'content-type': 'application/json' } })).fn, { conn, text: 'hi', sessionId: 'hui-1', onEvent: () => {} });
  assert.ok(one.text.length <= max, `json: ${one.text.length}`);

  const small = await streamChatCore(fakeFetch(() => sseResponse(new TextEncoder().encode(chunk('OK') + 'data: [DONE]\n\n'), [64]).res).fn, { conn, text: 'hi', sessionId: 'hui-1', onEvent: () => {} });
  assert.equal(small.text, 'OK');
  assert.equal(small.textCapped, undefined);
});

test('run status usage (O2): Hermes run keys and chat-completion keys, nothing without both counts', async () => {
  const { parseRunUsage, fetchRunStatusCore } = await import('./stream.ts');
  assert.deepEqual(parseRunUsage({ input_tokens: 21000, output_tokens: 850, total_tokens: 21850 }), { promptTokens: 21000, completionTokens: 850, totalTokens: 21850 });
  assert.deepEqual(parseRunUsage({ prompt_tokens: 10, completion_tokens: 2 }), { promptTokens: 10, completionTokens: 2, totalTokens: 12 });
  assert.equal(parseRunUsage({ output_tokens: 850 }), undefined, 'a footer "0 in" would be wrong');
  assert.equal(parseRunUsage({ input_tokens: 0, output_tokens: 0 }), undefined);
  assert.equal(parseRunUsage(null), undefined);
  const f = fakeFetch(() => new Response(JSON.stringify({ object: 'hermes.run', status: 'completed', usage: { input_tokens: 5, output_tokens: 7, total_tokens: 12 } }), { status: 200 }));
  const st = await fetchRunStatusCore(f.fn, conn, 'chatcmpl-1');
  assert.equal(st.status, 'completed');
  assert.deepEqual(st.usage, { promptTokens: 5, completionTokens: 7, totalTokens: 12 });
});


test('approvals delivered after an in-stream reconnect are marked as restored', async () => {
  const enc = new TextEncoder();
  const first = sseResponse(enc.encode('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n'), [1000], { 'x-hermes-ui-resume': '1' }).res;
  const rest = sseResponse(enc.encode('event: approval.request\ndata: {"run_id":"run-test","request_id":"req-test","command":"echo test","timestamp":1}\n\ndata: [DONE]\n\n'), [1000]).res;
  let calls = 0;
  const events: HermesEvent[] = [];
  await streamChatCore(async () => (++calls === 1 ? first : rest) as never, {
    conn, text: 'test', sessionId: 'hui-test', idempotencyKey: 'turn-test-reconnect-approval', resumeDelaysMs: [0], onEvent: e => events.push(e),
  });
  assert.equal(calls, 2);
  const event = events.find(e => e.type === 'approval');
  assert.ok(event?.type === 'approval');
  assert.equal(event.approval.restored, true);
});

test('a deduplicated send uses the replay clock to restore approval time even without resumeFrom', async () => {
  const now = Date.now();
  const recordedAt = now - 120_000;
  const wire = 'event: approval.request\ndata: ' + JSON.stringify({ run_id: 'run-test', request_id: 'req-test', command: 'echo test', timestamp: recordedAt / 1000 }) + '\n\ndata: [DONE]\n\n';
  const { res } = sseResponse(new TextEncoder().encode(wire), [1000], {
    'x-hermes-ui-resume': '1', 'x-hermes-ui-resumed': '0', date: new Date(recordedAt).toUTCString(), 'x-hermes-ui-server-time': String(now),
  });
  const events: HermesEvent[] = [];
  await streamChatCore(fakeFetch(() => res).fn, { conn, text: 'test', sessionId: 'hui-test', idempotencyKey: 'turn-test-deduplicated-approval', onEvent: e => events.push(e) });
  const event = events.find(e => e.type === 'approval');
  assert.ok(event?.type === 'approval');
  assert.equal(event.approval.restored, true);
  assert.ok(Math.abs(event.approval.serverNowMs! - now) < 1200, 'the replay clock is current even though the recorded Date is stale');
});

test('an in-stream reconnect retains the original live server-clock anchor on an older bridge', async () => {
  const now = Date.now();
  const skew = 300_000;
  const first = sseResponse(new TextEncoder().encode('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n'), [1000], {
    'x-hermes-ui-resume': '1', date: new Date(now + skew).toUTCString(),
  }).res;
  const rest = sseResponse(new TextEncoder().encode('event: approval.request\ndata: {"run_id":"run-test","request_id":"req-test","command":"echo test","timestamp":1}\n\ndata: [DONE]\n\n'), [1000]).res;
  let calls = 0;
  const events: HermesEvent[] = [];
  await streamChatCore(async () => (++calls === 1 ? first : rest) as never, {
    conn, text: 'test', sessionId: 'hui-test', idempotencyKey: 'turn-test-old-bridge-clock', resumeDelaysMs: [0], onEvent: e => events.push(e),
  });
  const event = events.find(e => e.type === 'approval');
  assert.ok(event?.type === 'approval');
  assert.ok(Math.abs(event.approval.serverNowMs! - (now + skew)) < 1200);
});
