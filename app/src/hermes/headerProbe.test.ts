/// <reference types="node" />
// A request written into a keep-alive connection that a network loss did not reset (airplane mode while the interface
// keeps its address: a VPN tunnel, the arm64 emulator) gets no error and no headers. The reachability check on a
// fresh connection must end it as a network failure ("Answer failed" + Retry) long before the idle timeout, and must
// never cut off a server that is only slow to answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEADER_PROBE_AFTER_MS, isHermesError, probeServerCore, streamChatCore, type ReachProbe } from './stream.ts';
import { presentMessageError } from './networkFailure.ts';
import { makeT } from '../i18n/core.ts';
import type { HermesConn } from './types';

const conn: HermesConn = { baseUrl: 'https://example.com/v1', apiKey: 'dummy-test-token' };
const SSE = 'data: {"id":"c1","choices":[{"delta":{"content":"hi"}}]}\n\ndata: {"id":"c1","choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';

function sse(): Response {
  return new Response(SSE, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** a request that never gets headers; rejects only when aborted (OkHttp cancels the call) */
function stuckFetch() {
  const signals: AbortSignal[] = [];
  const fn = (_url: string, init: { signal?: AbortSignal }) => {
    if (init.signal) signals.push(init.signal);
    return new Promise<never>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('Canceled'))));
  };
  return { fn: fn as never, signals };
}

function probes(results: ReachProbe[]) {
  const seen: AbortSignal[] = [];
  let i = 0;
  const fn = async (signal: AbortSignal): Promise<ReachProbe> => {
    seen.push(signal);
    return results[Math.min(i++, results.length - 1)];
  };
  return { fn, count: () => seen.length, seen };
}

test('a send stuck on a dead keep-alive connection fails as a network error once the server is unreachable', async () => {
  const f = stuckFetch();
  const p = probes([{ ok: false, detail: 'Network request failed' }]);
  const t0 = Date.now();
  const err = await streamChatCore(f.fn, {
    conn, text: 'x', sessionId: 's', idempotencyKey: 'k', idleTimeoutMs: 5000,
    probeReachable: p.fn, headerProbeMs: { after: 20, every: 50 }, onEvent: () => {},
  }).catch((e: unknown) => e);
  assert.ok(isHermesError(err), String(err));
  assert.equal(err.kind, 'network');
  assert.equal(err.accepted, undefined, 'never taken for an accepted turn (no recovery, a failed answer with Retry)');
  assert.ok(Date.now() - t0 < 1000, 'ended by the probe, not by the idle timeout');
  assert.equal(f.signals[0].aborted, true, 'the stuck request is cancelled');
  assert.equal(p.count(), 1);
  // the failure card shows the localized offline text, the probe's detail behind "Details"
  const shown = presentMessageError({ error: err.message, errorText: err.text }, makeT('en', 'en-US'));
  assert.equal(shown.detail, 'Network request failed');
  assert.notEqual(shown.text, err.message);
});

test('a slow but reachable server is never cut off: probes repeat until the headers arrive, then stop', async () => {
  const p = probes([{ ok: true }]);
  let release!: () => void;
  const headers = new Promise<void>((r) => (release = r));
  const fn = async () => {
    await headers;
    return sse() as never;
  };
  setTimeout(() => release(), 140);
  const r = await streamChatCore(fn, {
    conn, text: 'x', sessionId: 's', idleTimeoutMs: 5000,
    probeReachable: p.fn, headerProbeMs: { after: 20, every: 30 }, onEvent: () => {},
  });
  assert.equal(r.text, 'hi');
  const n = p.count();
  assert.ok(n >= 2, `probed ${n}× while waiting`);
  await new Promise((res) => setTimeout(res, 120));
  assert.equal(p.count(), n, 'no probe after the headers came in');
  assert.equal(p.seen[p.seen.length - 1].aborted, true, 'the last probe is released');
});

test('no probe when the headers come quickly, and none for a re-attach', async () => {
  const p = probes([{ ok: false, detail: 'should not be asked' }]);
  const r = await streamChatCore(async () => sse() as never, {
    conn, text: 'x', sessionId: 's', probeReachable: p.fn, headerProbeMs: { after: 30, every: 30 }, onEvent: () => {},
  });
  assert.equal(r.text, 'hi');
  const f = stuckFetch();
  const err = await streamChatCore(f.fn, {
    conn, text: 'x', sessionId: 's', idempotencyKey: 'k', resumeFrom: 0, idleTimeoutMs: 120,
    probeReachable: p.fn, headerProbeMs: { after: 10, every: 10 }, onEvent: () => {},
  }).catch((e: unknown) => e);
  assert.ok(isHermesError(err) && err.kind === 'timeout', 'the re-attach keeps its own connect timeout');
  await new Promise((res) => setTimeout(res, 40));
  assert.equal(p.count(), 0);
});

test('Stop while the send waits for headers: aborted, the probe in flight is cancelled', async () => {
  const f = stuckFetch();
  const ctrl = new AbortController();
  let probeSignal: AbortSignal | undefined;
  const probe = (signal: AbortSignal) => {
    probeSignal = signal;
    setTimeout(() => ctrl.abort(), 5);
    return new Promise<ReachProbe>(() => {});
  };
  const r = await streamChatCore(f.fn, {
    conn, text: 'x', sessionId: 's', signal: ctrl.signal, idleTimeoutMs: 5000,
    probeReachable: probe, headerProbeMs: { after: 10, every: 10 }, onEvent: () => {},
  });
  assert.equal(r.aborted, true);
  assert.equal(probeSignal?.aborted, true);
});

test('the default first check comes after a few seconds (not on every normal send)', () => {
  assert.ok(HEADER_PROBE_AFTER_MS >= 3000 && HEADER_PROBE_AFTER_MS <= 8000);
});

test('probeServerCore: any HTTP answer is reachable; root /health first, then the base', async () => {
  const urls: string[] = [];
  const r = await probeServerCore(async (url) => {
    urls.push(url);
    return { status: 401 };
  }, conn.baseUrl, conn.apiKey, new AbortController().signal);
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(urls, ['https://example.com/health']);
  const tried: string[] = [];
  const down = await probeServerCore(async (url) => {
    tried.push(url);
    throw new Error('java.net.ConnectException: Failed to connect to example.com/192.0.2.10:443');
  }, conn.baseUrl, conn.apiKey, new AbortController().signal);
  assert.deepEqual(tried, ['https://example.com/health', 'https://example.com/v1/health']);
  assert.equal(down.ok, false);
  assert.ok(!down.ok && !/example\.com|192\.0\.2/.test(down.detail), `host scrubbed: ${!down.ok && down.detail}`);
});

test('probeServerCore: a check that hangs is bounded and counts as unreachable', async () => {
  const r = await probeServerCore(() => new Promise(() => {}), conn.baseUrl, '', new AbortController().signal, 30);
  assert.deepEqual(r, { ok: false, detail: 'health check timed out' });
});
