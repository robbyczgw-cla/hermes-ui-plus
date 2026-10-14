import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasUiSkill, parseBridgeStatus, parseImagesAvailable, parsePushAvailable, parseVoiceAvailable, probeFeatures } from './features.ts';
import type { FetchLike } from './probe.ts';
import { normalizeServerUrl, type NormalizedUrl } from './url.ts';

function u(s: string): NormalizedUrl {
  const r = normalizeServerUrl(s);
  assert.ok(r.ok);
  return r;
}

type Route = { status: number; body?: unknown } | Error;
function fakeFetch(routes: Record<string, Route>, calls: { url: string; auth?: string }[] = []): FetchLike {
  return async (url, init) => {
    calls.push({ url, auth: init.headers?.Authorization });
    const r = routes[url] ?? { status: 404, body: 'not found' };
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, headers: { get: () => null }, text: async () => JSON.stringify(r.body ?? null) };
  };
}

test('parsers are tolerant', () => {
  assert.deepEqual(parseBridgeStatus({ ok: true, router: { kind: 'heuristic' } }), { router: true, skill: null });
  assert.deepEqual(parseBridgeStatus({ router: null, skill: { installed: false } }), { router: false, skill: false });
  assert.deepEqual(parseBridgeStatus('nope'), { router: null, skill: null });
  assert.equal(parseVoiceAvailable({ stt: { provider: 'groq', available: false }, tts: { provider: 'openai', available: true } }), true);
  assert.equal(parseVoiceAvailable({ stt: { provider: 'groq', available: false }, tts: { available: false } }), false);
  assert.equal(parseVoiceAvailable({ stt: { provider: 'groq' } }), true); // older bridge without flags
  assert.equal(parseImagesAvailable({ available: false, providers: [] }), false);
  assert.equal(parsePushAvailable({ platforms: { fcm: true, apns: false, webpush: null } }), true);
  assert.equal(parsePushAvailable({ platforms: { fcm: false, apns: false, webpush: null } }), false);
  assert.equal(hasUiSkill({ object: 'list', data: [{ name: 'web' }, { name: 'hermes-ui' }] }), true);
  assert.equal(hasUiSkill({ data: [{ name: 'web' }] }), false);
  assert.equal(hasUiSkill(['hermes-ui']), true);
  assert.equal(hasUiSkill({ error: 'x' }), null);
});

test('bridge: all endpoints asked with the key, results combined', async () => {
  const calls: { url: string; auth?: string }[] = [];
  const f = await probeFeatures(
    { url: u('https://bridge.example.org'), apiKey: 'tok_test_000' },
    {
      bridge: true,
      fetchImpl: fakeFetch(
        {
          'https://bridge.example.org/bridge/status': { status: 200, body: { ok: true, router: { kind: 'llm' } } },
          'https://bridge.example.org/bridge/voice/config': { status: 200, body: { stt: { provider: 'groq', available: true } } },
          'https://bridge.example.org/bridge/images/config': { status: 200, body: { available: false, providers: [] } },
          'https://bridge.example.org/bridge/push/config': { status: 200, body: { platforms: { fcm: true } } },
          'https://bridge.example.org/v1/skills': { status: 200, body: { data: [{ name: 'hermes-ui' }] } },
          'https://bridge.example.org/v1/capabilities': { status: 200, body: { object: 'hermes.capabilities' } },
        },
        calls,
      ),
    },
  );
  assert.deepEqual(f, { router: true, voice: true, images: false, push: true, skill: true, capabilities: true });
  assert.equal(calls.length, 6);
  assert.ok(calls.every((c) => c.auth === 'Bearer tok_test_000'));
});

test('direct Hermes: no bridge endpoints; 404 capabilities → false (old Hermes); errors → unknown', async () => {
  const calls: { url: string }[] = [];
  const f = await probeFeatures(
    { url: u('http://10.0.0.5:8645'), apiKey: '' },
    { bridge: false, fetchImpl: fakeFetch({ 'http://10.0.0.5:8645/v1/skills': new TypeError('Failed to fetch') }, calls) },
  );
  assert.deepEqual(f, { router: null, voice: null, images: null, push: null, skill: null, capabilities: false });
  assert.deepEqual(calls.map((c) => c.url).sort(), ['http://10.0.0.5:8645/v1/capabilities', 'http://10.0.0.5:8645/v1/skills']);
});

test('bridge status skill flag wins over the skill list; missing bridge endpoints = off', async () => {
  const f = await probeFeatures(
    { url: u('https://bridge.example.org'), apiKey: 'tok_test_000' },
    {
      bridge: true,
      fetchImpl: fakeFetch({
        'https://bridge.example.org/bridge/status': { status: 200, body: { router: null, skill: false } },
        'https://bridge.example.org/v1/skills': { status: 200, body: { data: [{ name: 'hermes-ui' }] } },
      }),
    },
  );
  assert.equal(f.skill, false);
  assert.equal(f.router, false);
  assert.equal(f.voice, false);
  assert.equal(f.push, false);
});
