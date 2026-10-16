/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage, HermesEvent } from '../hermes/types.ts';
import { applyEvent, createAssistantMessage } from '../hermes/chatState.ts';
import { parseMessage } from '../protocol/streamParser.ts';
import {
  buildQuickHistory, buildQuickRequest, capThread, handOffMessages, handOffTitle, nextExpiry, parseQuickConfig, parseQuickSettings,
  parseStoredThread, pruneExpired, quickBackendFor, quickProfileFor, quickChatUrl, quickConfigUrl, quickFailureOf, quickStampOf, QUICK_LIMITS, serializeThread,
  shortModel, waitParts,
} from './core.ts';
import { availabilityKey, createAvailability, DEMO_KEY, quickOffered } from './availability.ts';
import { streamQuickCore } from './stream.ts';
import { demoQuickSamples, pickDemoAnswer, runDemoQuick } from './demo.ts';

const H = 60 * 60 * 1000;
const msg = (id: string, role: 'user' | 'assistant', text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, role, text, tools: [], status: 'done', createdAt: 1000, ...extra,
});

test('urls strip /v1 and trailing slashes; backend only for bridge Hermes profiles and the demo', () => {
  assert.equal(quickConfigUrl('http://h.test:8643/v1/'), 'http://h.test:8643/bridge/quick/config');
  assert.equal(quickChatUrl('https://h.test/v1'), 'https://h.test/bridge/quick/v1/chat/completions');
  assert.deepEqual(quickBackendFor({ kind: 'hermes', baseUrl: 'http://h.test/v1', apiKey: 'k', bridge: true }), { kind: 'bridge', conn: { baseUrl: 'http://h.test/v1', apiKey: 'k' } });
  assert.equal(quickBackendFor({ kind: 'hermes', baseUrl: 'http://h.test/v1', apiKey: 'k' }), null, 'direct Hermes: no bridge, no quick');
  assert.equal(quickBackendFor({ kind: 'hermes', baseUrl: 'http://h.test/v1', apiKey: '', bridge: true }), null);
  assert.equal(quickBackendFor({ kind: 'claude', baseUrl: '', apiKey: 'k', bridge: true }), null);
  assert.deepEqual(quickBackendFor({ kind: 'demo', baseUrl: 'demo://local', apiKey: '' }), { kind: 'demo' });
  assert.equal(quickBackendFor(null), null);
});

test('parseQuickConfig: available only on an explicit true; limits and override flag', () => {
  assert.equal(parseQuickConfig({ available: false }).available, false);
  assert.equal(parseQuickConfig(null).available, false);
  assert.equal(parseQuickConfig('x').available, false);
  const c = parseQuickConfig({ available: true, model: 'fast-1', provider: 'p', limits: { perDeviceMinute: 20, perDeviceDay: 300, maxTokens: 1024 }, allowModelOverride: true });
  assert.deepEqual(c, { available: true, model: 'fast-1', provider: 'p', perMinute: 20, perDay: 300, allowModelOverride: true });
  assert.equal(parseQuickConfig({ available: true, model: '', limits: { perDeviceMinute: 0 } }).model, null);
  assert.equal(parseQuickConfig({ available: true, limits: { perDeviceMinute: 0 } }).perMinute, undefined);
});

test('buildQuickHistory: complete pairs only, ≤ 6 turns, starts with the user, clipped, too long → null', () => {
  const thread = [
    msg('u1', 'user', 'q1'), msg('a1', 'assistant', 'a1'),
    msg('u2', 'user', 'q2'), msg('a2', 'assistant', 'a2', { status: 'error' }),
    msg('u3', 'user', 'q3'), msg('a3', 'assistant', 'a3'),
    msg('u4', 'user', 'q4'), msg('a4', 'assistant', 'x'.repeat(9000)),
    msg('u5', 'user', 'q5'), msg('a5', 'assistant', 'läuft', { status: 'streaming' }),
  ];
  const h = buildQuickHistory(thread, '  neu  ')!;
  assert.ok(h.length <= QUICK_LIMITS.turns);
  assert.deepEqual(h.map((t) => t.role), ['user', 'assistant', 'user', 'assistant', 'user']);
  assert.deepEqual(h.map((t) => t.content.slice(0, 2)), ['q3', 'a3', 'q4', 'xx', 'ne']);
  assert.equal(h[4].content, 'neu');
  assert.ok(h.every((t) => t.content.length <= QUICK_LIMITS.charsPerTurn));
  assert.deepEqual(buildQuickHistory([], 'hallo'), [{ role: 'user', content: 'hallo' }]);
  assert.equal(buildQuickHistory([], '   '), null);
  assert.equal(buildQuickHistory([], 'y'.repeat(QUICK_LIMITS.charsPerTurn + 1)), null);
});

test('buildQuickRequest: bridge URL, bearer, history + optional provider/model', () => {
  const r = buildQuickRequest({ baseUrl: 'http://h.test/v1', apiKey: 'tok_test' }, [{ role: 'user', content: 'hi' }], { model: { provider: 'p1', model: 'm1' }, lang: 'de' });
  assert.equal(r.url, 'http://h.test/bridge/quick/v1/chat/completions');
  assert.equal(r.headers.Authorization, 'Bearer tok_test');
  assert.deepEqual(JSON.parse(r.body), { messages: [{ role: 'user', content: 'hi' }], stream: true, provider: 'p1', model: 'm1', lang: 'de' });
  assert.deepEqual(Object.keys(JSON.parse(buildQuickRequest({ baseUrl: 'http://h.test', apiKey: 'k' }, []).body)).sort(), ['messages', 'stream']);
});

test('pruneExpired: cuts before the first fresh question (24 h), keeps the array when nothing expired', () => {
  const now = 100 * H;
  const thread = [
    msg('u1', 'user', 'alt', { createdAt: now - 30 * H }), msg('a1', 'assistant', 'alt', { createdAt: now - 30 * H }),
    msg('u2', 'user', 'frisch', { createdAt: now - 2 * H }), msg('a2', 'assistant', 'frisch', { createdAt: now - 2 * H }),
  ];
  assert.deepEqual(pruneExpired(thread, now).map((m) => m.id), ['u2', 'a2']);
  const fresh = thread.slice(2);
  assert.equal(pruneExpired(fresh, now), fresh);
  assert.deepEqual(pruneExpired(thread, now + 30 * H), []);
  assert.deepEqual(pruneExpired([msg('a0', 'assistant', 'waise', { createdAt: now })], now), [], 'an answer without its question goes');
  assert.equal(nextExpiry(fresh), now - 2 * H + QUICK_LIMITS.ttlMs);
  assert.equal(nextExpiry([]), undefined);
});

test('capThread keeps the newest questions and cuts at a question', () => {
  const t = Array.from({ length: 10 }, (_, i) => msg(`m${i}`, i % 2 ? 'assistant' : 'user', String(i)));
  assert.deepEqual(capThread(t, 5).map((m) => m.id), ['m6', 'm7', 'm8', 'm9']);
  assert.equal(capThread(t, 20), t);
});

test('quickStampOf: time to first token (else total), reported model wins over the config model', () => {
  assert.deepEqual(quickStampOf({ createdAt: 1000, metrics: { firstTokenAt: 2600, endedAt: 4000, model: 'fast-1' } }, 'cfg'), { model: 'fast-1', ms: 1600 });
  assert.deepEqual(quickStampOf({ createdAt: 1000, metrics: { endedAt: 1800 } }, 'cfg'), { model: 'cfg', ms: 800 });
  assert.deepEqual(quickStampOf({ createdAt: 1000 }), {});
  assert.equal(shortModel('provider/deepseek-v4-flash'), 'deepseek-v4-flash');
  assert.equal(shortModel('prov::glm-5.3-flash'), 'glm-5.3-flash');
  assert.equal(shortModel(undefined), undefined);
});

test('quickFailureOf / waitParts: 429 with Retry-After, 404 feature_off (or no route), rejected model', () => {
  assert.deepEqual(quickFailureOf({ status: 429, retryAfter: 42 }), { kind: 'rate_limited', retryAfter: 42 });
  assert.deepEqual(quickFailureOf({ status: 429 }), { kind: 'rate_limited', retryAfter: undefined });
  assert.deepEqual(quickFailureOf({ status: 404, code: 'feature_off' }), { kind: 'feature_off' });
  assert.deepEqual(quickFailureOf({ status: 404 }), { kind: 'feature_off' });
  assert.deepEqual(quickFailureOf({ status: 404, code: 'other' }), { kind: 'other' });
  assert.deepEqual(quickFailureOf({ status: 400, code: 'unknown_model' }), { kind: 'model_rejected' });
  assert.deepEqual(quickFailureOf(new Error('net')), { kind: 'other' });
  assert.deepEqual(waitParts(12), { unit: 's', value: 12 });
  assert.deepEqual(waitParts(0.2), { unit: 's', value: 1 });
  assert.deepEqual(waitParts(200), { unit: 'min', value: 4 });
  assert.deepEqual(waitParts(5 * 3600 + 1), { unit: 'h', value: 6 });
});

test('handOffMessages: the question + the finished quick answer, marked; anything else → null', () => {
  const thread = [
    msg('u1', 'user', 'Wie viel sind 72 °F?'),
    msg('a1', 'assistant', '22,2 °C', { quick: { model: 'fast-1', ms: 900 }, statusNote: 'x' }),
    msg('u2', 'user', 'Und 100 °F?'),
    msg('a2', 'assistant', '', { status: 'error' }),
  ];
  const h = handOffMessages(thread, 'a1')!;
  assert.deepEqual(h.map((m) => m.id), ['u1', 'a1']);
  assert.deepEqual(h[1].quick, { model: 'fast-1', ms: 900 });
  assert.equal(h[1].statusNote, undefined);
  assert.equal(handOffMessages(thread, 'a2'), null);
  assert.equal(handOffMessages(thread, 'u1'), null);
  assert.equal(handOffMessages(thread, 'nope'), null);
  assert.equal(handOffTitle('  Wie   viel\nsind 72 °F?  '), 'Wie viel sind 72 °F?');
  assert.ok(handOffTitle('x'.repeat(80)).length <= 60);
});

test('thread storage round trip: expired / malformed entries dropped, unfinished answers stopped', () => {
  const now = 50 * H;
  const thread = [
    msg('u0', 'user', 'alt', { createdAt: now - 25 * H }), msg('a0', 'assistant', 'alt', { createdAt: now - 25 * H }),
    msg('u1', 'user', 'q', { createdAt: now - H }), msg('a1', 'assistant', 'a', { createdAt: now - H, status: 'streaming', statusNote: 'n', quick: { model: 'm', ms: 5 } }),
  ];
  const back = parseStoredThread(serializeThread(thread), now);
  assert.deepEqual(back.map((m) => m.id), ['u1', 'a1']);
  assert.equal(back[1].status, 'stopped');
  assert.equal(back[1].statusNote, undefined);
  assert.deepEqual(back[1].quick, { model: 'm', ms: 5 });
  assert.deepEqual(parseStoredThread('{"v":1,"messages":[{"id":1},null]}', now), []);
  assert.deepEqual(parseStoredThread('kaputt', now), []);
  assert.deepEqual(parseStoredThread(null, now), []);
});

test('parseQuickSettings: defaults, toggle, models validated', () => {
  assert.deepEqual(parseQuickSettings(null), { showInComposer: true, models: {} });
  assert.deepEqual(parseQuickSettings('{"showInComposer":false,"models":{"p1":{"provider":"opencode-go","model":"glm-5.3-flash"},"p2":{"provider":"bad id","model":"x"},"p3":3}}'), {
    showInComposer: false,
    models: { p1: { provider: 'opencode-go', model: 'glm-5.3-flash' } },
  });
  assert.deepEqual(parseQuickSettings('{'), { showInComposer: true, models: {} });
});

// ───────────────────────── availability ─────────────────────────

function configFetch(answers: (() => { ok: boolean; status: number; body?: unknown } | Error)[]) {
  const calls: { url: string; auth: string }[] = [];
  let i = 0;
  const fetch = async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, auth: init.headers.Authorization });
    const a = answers[Math.min(i++, answers.length - 1)]();
    if (a instanceof Error) throw a;
    return { ok: a.ok, status: a.status, json: async () => a.body };
  };
  return { fetch, calls };
}

test('availability: cached per bridge, TTL, forced refresh, network errors keep the state, markOff', async () => {
  let t = 0;
  const conn = { baseUrl: 'http://h.test/v1', apiKey: 'tok_test_000000' };
  const f = configFetch([
    () => ({ ok: true, status: 200, body: { available: true, model: 'fast-1', limits: { perDeviceMinute: 20, perDeviceDay: 300 } } }),
    () => new Error('offline'),
    () => ({ ok: true, status: 200, body: { available: false } }),
  ]);
  const a = createAvailability({ fetch: f.fetch, now: () => t, ttlMs: 1000 });
  let changes = 0;
  a.subscribe(() => changes++);
  const key = availabilityKey(conn);
  assert.equal(a.get(key), undefined, 'unknown = nothing shown');
  assert.equal((await a.refresh(conn))?.on, true);
  assert.equal(f.calls[0].url, 'http://h.test/bridge/quick/config');
  assert.equal(f.calls[0].auth, 'Bearer tok_test_000000');
  assert.equal(a.get(key)?.config?.model, 'fast-1');
  await a.refresh(conn);
  assert.equal(f.calls.length, 1, 'cached within the TTL');
  t = 2000;
  assert.equal((await a.refresh(conn))?.on, true, 'offline: keeps the known state');
  assert.equal(f.calls.length, 2);
  a.markOff(key);
  assert.equal(a.get(key)?.on, false, 'feature_off mid-session hides ⚡');
  await a.refresh(conn, true);
  assert.equal(a.get(key)?.on, false);
  assert.equal(changes, 2, 'listeners hear on → off once');
  assert.equal(a.get(DEMO_KEY)?.on, true, 'the demo always has its local quick backend');
  a.markOff(DEMO_KEY);
  assert.equal(a.get(DEMO_KEY)?.on, true);
});

test('availability: calls fetch without a `this` (web: the browser fetch throws "Illegal invocation" as a method)', async () => {
  const inner = configFetch([() => ({ ok: true, status: 200, body: { available: true, model: 'fast-1' } })]);
  // like window.fetch: only a missing or global `this` is accepted
  const browserLike = function (this: unknown, url: string, init: { headers: Record<string, string> }) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    return inner.fetch(url, init);
  };
  const a = createAvailability({ fetch: browserLike });
  assert.equal((await a.refresh({ baseUrl: 'http://h.test/v1', apiKey: 'tok_test_000000' }))?.on, true);
  assert.equal(inner.calls.length, 1);
});

test('availability: an old bridge without the route (404) or a rejected token is off', async () => {
  const f = configFetch([() => ({ ok: false, status: 404, body: {} })]);
  const a = createAvailability({ fetch: f.fetch });
  assert.equal((await a.refresh({ baseUrl: 'http://old.test/v1', apiKey: 'k' }))?.on, false);
});

test('Hermes plugin self-test failed (multi-profile Hermes): available:false + reason hides ⚡, older bodies still work', async () => {
  assert.deepEqual(parseQuickConfig({ available: false, reason: 'profile_scope_unavailable' }), { available: false, model: null, provider: null, allowModelOverride: false, reason: 'profile_scope_unavailable' });
  assert.equal(parseQuickConfig({ available: false, reason: 'Free <b>text</b>' }).reason, undefined, 'only machine-readable reasons');
  assert.equal(parseQuickConfig({ available: false }).reason, undefined, 'older bridges send no reason');
  let t = 0;
  const f = configFetch([
    () => ({ ok: true, status: 200, body: { available: true, model: 'fast-1' } }),
    () => ({ ok: true, status: 200, body: { available: false, reason: 'profile_scope_unavailable' } }),
  ]);
  const a = createAvailability({ fetch: f.fetch, now: () => t, ttlMs: 1000 });
  const conn = { baseUrl: 'http://h.test/v1', apiKey: 'tok_test_000000' };
  const key = availabilityKey(conn);
  assert.equal(quickOffered(a.get(key)), false, 'unknown: hidden');
  await a.refresh(conn);
  assert.equal(quickOffered(a.get(key)), true);
  t = 2000;
  await a.refresh(conn);
  assert.equal(quickOffered(a.get(key)), false, '⚡ hidden');
  assert.equal(a.get(key)?.reason, 'profile_scope_unavailable');
  assert.equal(a.get(key)?.config, null);
  // a request that the plugin refuses after its self-test tripped: 404 feature_off (+ reason) → markOff, like an absent plugin
  assert.deepEqual(quickFailureOf({ status: 404, code: 'feature_off', reason: 'profile_scope_unavailable' }), { kind: 'feature_off' });
});

test('plugin not installed: off, ⚡ hidden, and no request loop (one config check per TTL; none for direct connections)', async () => {
  let t = 0;
  const f = configFetch([() => ({ ok: true, status: 200, body: { available: false } })]);
  const a = createAvailability({ fetch: f.fetch, now: () => t });
  const conn = { baseUrl: 'http://h.test/v1', apiKey: 'tok_test_000000' };
  assert.equal((await a.refresh(conn))?.on, false);
  assert.equal(a.get(availabilityKey(conn))?.config, null);
  for (let i = 0; i < 20; i++) {
    t += 20_000; // every chat mount / render within the 10 min TTL
    await a.refresh(conn);
  }
  assert.equal(f.calls.length, 1, 'cached for QUICK_LIMITS.configTtlMs');
  t += QUICK_LIMITS.configTtlMs;
  await a.refresh(conn);
  assert.equal(f.calls.length, 2, 'one re-check after the TTL');
  assert.equal(quickBackendFor({ kind: 'hermes', baseUrl: 'http://h.test/v1', apiKey: 'k', bridge: false }), null, 'direct connection: never asked');
});

test('bot (profile) chats offer no ⚡: the plugin has one quick model per gateway, not per profile', () => {
  const p = { kind: 'hermes', baseUrl: 'http://h.test/v1', apiKey: 'k', bridge: true };
  assert.equal(quickProfileFor(p, undefined), p);
  assert.equal(quickProfileFor(p, 'default'), p, 'the default profile is no bot');
  assert.equal(quickProfileFor(p, 'writer'), null);
  assert.equal(quickBackendFor(quickProfileFor(p, 'writer')), null, 'nothing is fetched for it');
  assert.equal(quickProfileFor(null, undefined), null);
});

// ───────────────────────── streaming ─────────────────────────

const enc = new TextEncoder();
function sse(frames: string[], status = 200, headers: Record<string, string> = {}) {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const f of frames) c.enqueue(enc.encode(f));
      c.close();
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream', ...headers } });
}
const chunk = (delta: object, finish: string | null = null, extra: object = {}) =>
  `data: ${JSON.stringify({ id: 'chatcmpl-hq1', object: 'chat.completion.chunk', created: 1, model: 'fast-1', choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;

async function runStream(make: () => Response) {
  const calls: { url: string; body?: string }[] = [];
  const fetch = async (url: string, init: { body?: string }) => {
    calls.push({ url, body: init.body });
    return make() as never;
  };
  let m = createAssistantMessage(1000);
  const events: HermesEvent[] = [];
  let t = 1000;
  const result = await streamQuickCore(fetch, {
    conn: { baseUrl: 'http://h.test/v1', apiKey: 'tok_test' },
    history: [{ role: 'user', content: 'Wie viel sind 72 °F?' }],
    onEvent: (ev) => {
      events.push(ev);
      t += 400;
      m = applyEvent(m, ev, t);
    },
  });
  return { result, message: m, events, calls };
}

test('stream: SSE answer through the shared parser → text, model, first-token time, usage', async () => {
  const r = await runStream(() =>
    sse([chunk({ role: 'assistant', content: '' }), chunk({ content: '72 °F sind ' }), chunk({ content: '**22,2 °C**.' }), chunk({}, 'stop', { usage: { prompt_tokens: 620, completion_tokens: 12, total_tokens: 632 } }), 'data: [DONE]\n\n']),
  );
  assert.equal(r.calls[0].url, 'http://h.test/bridge/quick/v1/chat/completions');
  assert.deepEqual(JSON.parse(r.calls[0].body!).messages, [{ role: 'user', content: 'Wie viel sind 72 °F?' }]);
  assert.equal(r.message.status, 'done');
  assert.equal(r.message.text, '72 °F sind **22,2 °C**.');
  assert.equal(r.message.metrics?.model, 'fast-1');
  assert.equal(r.message.usage?.promptTokens, 620);
  assert.deepEqual(quickStampOf(r.message), { model: 'fast-1', ms: 800 });
});

test('stream: 429 → rate_limited with Retry-After, 404 feature_off → feature_off', async () => {
  const json = (status: number, code: string, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify({ error: { message: 'x', type: 'invalid_request_error', code } }), { status, headers: { 'content-type': 'application/json', ...headers } });
  await assert.rejects(runStream(() => json(429, 'rate_limited', { 'retry-after': '37' })), (e) => {
    assert.deepEqual(quickFailureOf(e), { kind: 'rate_limited', retryAfter: 37 });
    return true;
  });
  await assert.rejects(runStream(() => json(404, 'feature_off')), (e) => {
    assert.deepEqual(quickFailureOf(e), { kind: 'feature_off' });
    return true;
  });
});

// ───────────────────────── demo ─────────────────────────

test('demo: canned answers render (valid hui incl. a calc card and a table), fallback lists the samples', async () => {
  for (const lang of ['de', 'en', 'es'] as const) {
    const samples = demoQuickSamples(lang);
    const keys = samples.map((q) => pickDemoAnswer([{ role: 'user', content: q }], lang).key);
    assert.deepEqual(keys, ['temperature', 'languages', 'egg'], lang);
    for (const q of [...samples, 'Hauptstadt von Australien?', 'irgendwas']) {
      let m = createAssistantMessage(0);
      const r = await runDemoQuick({ history: [{ role: 'user', content: q }], lang, speed: 0, onEvent: (ev) => (m = applyEvent(m, ev, 1)) });
      assert.equal(r.aborted, false);
      assert.equal(m.status, 'done', q);
      assert.equal(m.metrics?.model, 'flash-mini');
      for (const seg of parseMessage(m.text)) if (seg.kind === 'hui') assert.ok(seg.complete && seg.node && !seg.error && !seg.fallback, `${lang} ${q}: ${seg.error ?? seg.raw.slice(0, 60)}`);
    }
  }
  const types = demoQuickSamples('de').flatMap((q) => parseMessage(pickDemoAnswer([{ role: 'user', content: q }], 'de').text).flatMap((s) => (s.kind === 'hui' && s.node ? [s.node.type] : [])));
  assert.deepEqual(types, ['calc', 'table']);
});

test('demo: abort stops the replay quietly', async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  const r = await runDemoQuick({ history: [{ role: 'user', content: 'Ei?' }], signal: ctrl.signal, onEvent: () => {} });
  assert.equal(r.aborted, true);
});
