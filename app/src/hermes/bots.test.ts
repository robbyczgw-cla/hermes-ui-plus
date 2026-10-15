/// <reference types="node" />
// Hermes profiles ("bots"): URL building, editor parsing, bridge list, picker data, cache, flavors, requests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_BOTS,
  botBadge,
  botBaseUrl,
  botDisplayName,
  botEntries,
  botFromBaseUrl,
  botNames,
  botOf,
  botsForProfile,
  formatBotList,
  invalidBotNames,
  isBotName,
  parseBotList,
  parseBridgeProfiles,
  serverRootOf,
  withBot,
} from './bots.ts';
import { createBotStore, botServerKey } from './botStore.ts';
import { apiRoot, createJsonRequest } from './sessions.ts';
import { buildRequest, respondApprovalCore, stopBridgeTurnCore, type FetchLike } from './stream.ts';
import { serverKey } from './support.ts';
import { FLAVORS, isKindAllowed } from '../flavor.ts';
import { uploadUrl } from '../attachments/uploadCore.ts';

test('bot names follow Hermes profile rules; default/invalid → undefined', () => {
  for (const n of ['writer', 'work-bot', 'r2_d2', '9']) assert.equal(isBotName(n), true, n);
  for (const n of ['', 'Writer', '-x', 'a.b', '../x', 'a/b', 'x'.repeat(65), 7, null]) assert.equal(isBotName(n), false, String(n));
  assert.equal(botOf('writer'), 'writer');
  assert.equal(botOf('default'), undefined);
  assert.equal(botOf('Writer'), undefined);
  assert.equal(botOf(undefined), undefined);
});

test('botBaseUrl inserts /p/<bot> before /v1; default keeps the plain base', () => {
  assert.equal(botBaseUrl('https://example.com/v1', 'writer'), 'https://example.com/p/writer/v1');
  assert.equal(botBaseUrl('https://example.com/v1/', 'writer'), 'https://example.com/p/writer/v1');
  assert.equal(botBaseUrl('http://192.0.2.10:8642/v1', undefined), 'http://192.0.2.10:8642/v1');
  assert.equal(botBaseUrl('https://example.com/hermes/v1', 'work'), 'https://example.com/hermes/p/work/v1');
  assert.equal(botBaseUrl('https://example.com', 'work'), 'https://example.com/p/work');
  // switching bots never stacks prefixes
  assert.equal(botBaseUrl('https://example.com/p/writer/v1', 'work'), 'https://example.com/p/work/v1');
  assert.equal(botBaseUrl('https://example.com/p/writer/v1', 'default'), 'https://example.com/v1');
  // invalid names never reach a URL
  assert.equal(botBaseUrl('https://example.com/v1', '../admin'), 'https://example.com/v1');
  assert.equal(botBaseUrl('https://example.com/v1', 'a%2fb'), 'https://example.com/v1');
});

test('serverRootOf strips /v1 and /p/<bot>; botFromBaseUrl reads it back', () => {
  assert.equal(serverRootOf('https://example.com/p/writer/v1'), 'https://example.com');
  assert.equal(serverRootOf('https://example.com/v1/'), 'https://example.com');
  assert.equal(serverRootOf('https://example.com/hermes/p/x/v1'), 'https://example.com/hermes');
  assert.equal(botFromBaseUrl('https://example.com/p/writer/v1'), 'writer');
  assert.equal(botFromBaseUrl('https://example.com/v1'), undefined);
});

test('withBot: same object for the default profile, rewritten copy for a bot', () => {
  const conn = { baseUrl: 'https://example.com/v1', apiKey: 'k', model: 'm' };
  assert.equal(withBot(conn, undefined), conn);
  assert.equal(withBot(conn, 'default'), conn);
  const b = withBot(conn, 'writer');
  assert.notEqual(b, conn);
  assert.deepEqual(b, { baseUrl: 'https://example.com/p/writer/v1', apiKey: 'k', model: 'm' });
});

test('every Hermes request of a bot chat goes under /p/<bot>/, bridge routes stay at the root', async () => {
  const conn = withBot({ baseUrl: 'https://example.com/v1', apiKey: 'tok' }, 'writer');
  assert.equal(buildRequest(conn, 'hi', 'hui-1').url, 'https://example.com/p/writer/v1/chat/completions');
  assert.equal(apiRoot(conn.baseUrl), 'https://example.com/p/writer');
  const urls: string[] = [];
  const bodies: unknown[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    urls.push(String(url));
    bodies.push(init?.body);
    return { ok: true, status: 200, headers: { get: () => null }, body: null, text: async () => '{}' } as unknown as Awaited<ReturnType<FetchLike>>;
  };
  await createJsonRequest(fetchImpl, conn)('GET', '/api/sessions?source=api_server');
  await respondApprovalCore(fetchImpl, conn, { runId: 'run1', requestId: 'r1' }, 'once');
  await stopBridgeTurnCore(fetchImpl, conn, 'hui-1');
  assert.deepEqual(urls, [
    'https://example.com/p/writer/api/sessions?source=api_server',
    'https://example.com/p/writer/v1/runs/run1/approval',
    'https://example.com/bridge/chat/stop',
  ]);
  // session ids are per profile: the stop names the bot (the root route alone would stop every bot's session)
  assert.deepEqual(JSON.parse(String(bodies.at(-1))), { sessionId: 'hui-1', profile: 'writer' });
  await stopBridgeTurnCore(fetchImpl, { baseUrl: 'https://example.com/v1', apiKey: 'tok' }, 'hui-1');
  assert.deepEqual(JSON.parse(String(bodies.at(-1))), { sessionId: 'hui-1', profile: null });
  // session-API support is remembered per bot (an unknown bot's 404 does not switch the server off)
  assert.notEqual(serverKey(conn), serverKey({ baseUrl: 'https://example.com/v1', apiKey: 'tok' }));
});

test('connection editor list: lower-cased, valid, unique, without default', () => {
  assert.deepEqual(parseBotList('Research, work\nwork;  default  bad.name x/y ok_2'), ['research', 'work', 'ok_2']);
  assert.deepEqual(parseBotList(''), []);
  assert.deepEqual(parseBotList(undefined), []);
  assert.equal(formatBotList(['a', 'b']), 'a, b');
  assert.deepEqual(invalidBotNames('ok, bad.name, x/y, -no'), ['bad.name', 'x/y', '-no']);
});

test('GET /bridge/profiles parsing: default first, junk dropped, no extra fields', () => {
  const bots = parseBridgeProfiles({
    object: 'list',
    data: [
      { name: 'writer', default: false, label: 'Writer', model: 'writer-4.5', api_key: 'sk-test-secret' },
      { name: 'default', default: true, model: 'hermes-agent' },
      { name: '../x', default: false },
      { name: 'writer', default: false },
      'nope',
    ],
  });
  assert.deepEqual(bots, [
    { name: 'default', default: true, model: 'hermes-agent' },
    { name: 'writer', default: false, label: 'Writer', model: 'writer-4.5' },
  ]);
  assert.equal(parseBridgeProfiles({ error: 'x' }), null);
  assert.equal(parseBridgeProfiles(null), null);
});

test('picker data: default first, bridge bots, manual bots, the chat bot kept', () => {
  const server = parseBridgeProfiles({ data: [{ name: 'default', default: true }, { name: 'writer', default: false, label: 'Writer' }] });
  const e = botEntries({ server, manual: ['writer', 'work'], current: 'old' });
  assert.deepEqual(e.map((b) => b.name), ['default', 'writer', 'work', 'old']);
  assert.equal(e[1].label, 'Writer', 'the bridge entry wins over the manual one');
  assert.deepEqual(botNames(e), ['writer', 'work', 'old']);
  assert.deepEqual(botEntries({}).map((b) => b.name), ['default'], 'only the default → no Bot section');
  assert.equal(botDisplayName(e[0], 'Standard'), 'Standard');
  assert.equal(botDisplayName(e[1], 'Standard'), 'Writer');
  assert.equal(botBadge('writer', e), 'Writer');
  assert.equal(botBadge('work', e), 'work');
  assert.equal(botBadge(undefined, e), undefined);
});

test('botsForProfile: bridge list only for bridge connections, manual list always, demo has a fake second bot', () => {
  const server = [{ name: 'default', default: true }, { name: 'writer', default: false }];
  assert.deepEqual(botsForProfile({ kind: 'hermes', bridge: true, hermesBots: ['work'] }, server).map((b) => b.name), ['default', 'writer', 'work']);
  assert.deepEqual(botsForProfile({ kind: 'hermes', hermesBots: ['work'] }, server).map((b) => b.name), ['default', 'work'], 'direct: no bridge list');
  assert.deepEqual(botsForProfile({ kind: 'demo' }, null), DEMO_BOTS);
  assert.deepEqual(botsForProfile({ kind: 'openai' }, server), []);
  assert.deepEqual(botsForProfile(undefined, server), []);
});

test('flavors: bots work in BOTH builds (hermes + demo kinds are allowed everywhere)', () => {
  for (const f of FLAVORS) {
    assert.ok(isKindAllowed('hermes', f) && isKindAllowed('demo', f), f);
    assert.ok(botsForProfile({ kind: 'demo' }, null).length > 1, `${f}: demo picker shows the Bot section`);
    assert.ok(botsForProfile({ kind: 'hermes', hermesBots: ['work'] }, null).length > 1, `${f}: hermes bots`);
  }
});

test('bot store: one request per server, cached, a failed refresh keeps the last list', async () => {
  let t = 0;
  let calls = 0;
  let fail = false;
  const store = createBotStore({
    now: () => t,
    load: async () => {
      calls++;
      if (fail) throw new Error('offline');
      return [{ name: 'default', default: true }, { name: 'writer', default: false }];
    },
  });
  const conn = { baseUrl: 'https://example.com/p/writer/v1', apiKey: 'tok_test_0000' };
  assert.equal(store.get(conn), undefined);
  let emitted = 0;
  store.subscribe(() => emitted++);
  const [a, b] = await Promise.all([store.ensure(conn), store.ensure({ baseUrl: 'https://example.com/v1', apiKey: 'tok_test_0000' })]);
  assert.equal(calls, 1, 'same server (bot prefix ignored) → one request');
  assert.deepEqual(a, b);
  assert.equal(emitted, 1);
  await store.ensure(conn);
  assert.equal(calls, 1, 'cached');
  t += 6 * 60_000;
  fail = true;
  const kept = await store.ensure(conn);
  assert.equal(calls, 2);
  assert.deepEqual(kept?.map((x) => x.name), ['default', 'writer']);
  assert.equal(botServerKey(conn), 'https://example.com#t_0000');
});

test('no profiles: an older bridge (404 → []) means default only, cached like a list (no 30 s retries)', async () => {
  let t = 0;
  let calls = 0;
  const store = createBotStore({ now: () => t, load: async () => (calls++, []) });
  const conn = { baseUrl: 'https://example.com/v1', apiKey: 'tok_test_0000' };
  assert.deepEqual(await store.ensure(conn), []);
  t += 60_000;
  await store.ensure(conn);
  assert.equal(calls, 1, 'not refetched after the 30 s failure retry window');
  const p = { kind: 'hermes' as const, bridge: true };
  assert.deepEqual(botsForProfile(p, store.get(conn)).map((b) => b.name), ['default'], 'no "Bot" section');
  assert.deepEqual(botsForProfile({ kind: 'hermes' }, null).map((b) => b.name), ['default'], 'direct connection without a manual list');
});

test('uploads of a bot chat go to the bridge at the server root, never under /p/<bot>/', () => {
  const conn = withBot({ baseUrl: 'https://example.com/v1', apiKey: 'tok' }, 'writer');
  assert.equal(uploadUrl(serverRootOf(conn.baseUrl)), 'https://example.com/bridge/uploads');
});
