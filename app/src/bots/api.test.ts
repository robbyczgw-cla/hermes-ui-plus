/// <reference types="node" />
// Opening a bot's Bot Chat: lookup first (exact title, hidden included), then create; old bridges and missing keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOT_CHAT_LOOKUP, lookupBotChat, resolveBotChat } from './api.ts';
import { createJsonRequest } from '../hermes/sessions.ts';
import type { FetchLike } from '../hermes/stream.ts';

type Call = { method: string; url: string; body?: string; auth?: string };

/** fake server at `root` answering by route */
function server(routes: Record<string, (body?: string) => { status: number; json?: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (async (url: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) => {
    const u = new URL(String(url));
    const key = `${init.method ?? 'GET'} ${u.pathname}${u.search}`;
    calls.push({ method: init.method ?? 'GET', url: `${u.pathname}${u.search}`, body: init.body, auth: init.headers?.Authorization });
    const r = routes[key]?.(init.body) ?? { status: 404, json: { error: { message: 'Not found' } } };
    const text = r.json === undefined ? '' : JSON.stringify(r.json);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, headers: { get: () => 'application/json' }, text: async () => text, body: null };
  }) as unknown as FetchLike;
  return { calls, fetchImpl };
}

const conn = { baseUrl: 'https://bridge.example.com/p/scout/v1', apiKey: 'nca_user_test_token_000' };
const row = (id: string, title: string, last = 5) => ({ id, title, source: 'api_server', started_at: 1, last_active: last, message_count: 3 });

test('an existing (Desktop, hidden) Bot Chat is adopted, nothing is created', async () => {
  const s = server({ [`GET /p/scout${BOT_CHAT_LOOKUP}`]: () => ({ status: 200, json: { object: 'list', data: [row('desk_1', 'Bot Chat')] } }) });
  const r = await resolveBotChat(createJsonRequest(s.fetchImpl, conn));
  assert.deepEqual(r.ok && [r.via, r.session.id, r.session.messageCount], ['found', 'desk_1', 3]);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].url, '/p/scout/api/sessions?title=Bot%20Chat&include_hidden=1&limit=20');
  assert.equal(s.calls[0].auth, `Bearer ${conn.apiKey}`);
});

test('no Bot Chat yet: created with exactly {title:"Bot Chat"}', async () => {
  const s = server({
    [`GET /p/scout${BOT_CHAT_LOOKUP}`]: () => ({ status: 200, json: { data: [row('x', 'Bot Chat Ideen')] } }),
    'POST /p/scout/api/sessions': () => ({ status: 201, json: { object: 'hermes.session', session: row('api_2', 'Bot Chat'), adopted: false } }),
  });
  const r = await resolveBotChat(createJsonRequest(s.fetchImpl, conn));
  assert.deepEqual(r.ok && [r.via, r.session.id], ['created', 'api_2']);
  assert.equal(s.calls[1].body, '{"title":"Bot Chat"}');
});

test('old bridge (POST 405) → unsupported; a bot without its key (401) → auth; other failures → error', async () => {
  const old = server({ [`GET /p/scout${BOT_CHAT_LOOKUP}`]: () => ({ status: 200, json: { data: [] } }), 'POST /p/scout/api/sessions': () => ({ status: 405, json: { error: { message: 'Method not allowed', code: 'method_not_allowed' } } }) });
  assert.deepEqual(await resolveBotChat(createJsonRequest(old.fetchImpl, conn)).then((r) => !r.ok && r.reason), 'unsupported');
  const noKey = server({ [`GET /p/scout${BOT_CHAT_LOOKUP}`]: () => ({ status: 401, json: { error: { message: 'Invalid gateway API key', code: 'gateway_auth_failed' } } }) });
  assert.deepEqual(await resolveBotChat(createJsonRequest(noKey.fetchImpl, conn)).then((r) => !r.ok && r.reason), 'auth');
  assert.equal(noKey.calls.length, 1, 'no create after a refused lookup');
  const broken = server({ [`GET /p/scout${BOT_CHAT_LOOKUP}`]: () => ({ status: 500, json: { error: { message: 'boom' } } }) });
  assert.deepEqual(await resolveBotChat(createJsonRequest(broken.fetchImpl, conn)).then((r) => !r.ok && r.reason), 'error');
  const odd = server({ [`GET /p/scout${BOT_CHAT_LOOKUP}`]: () => ({ status: 200, json: { data: [] } }), 'POST /p/scout/api/sessions': () => ({ status: 200, json: { nothing: true } }) });
  assert.deepEqual(await resolveBotChat(createJsonRequest(odd.fetchImpl, conn)).then((r) => !r.ok && r.reason), 'error');
});

test('the default bot uses the plain server root', async () => {
  const s = server({ [`GET ${BOT_CHAT_LOOKUP}`]: () => ({ status: 200, json: { data: [row('api_9', 'Bot Chat', 9)] } }) });
  const found = await lookupBotChat(createJsonRequest(s.fetchImpl, { ...conn, baseUrl: 'https://bridge.example.com/v1' }));
  assert.equal(found?.id, 'api_9');
  assert.equal(found?.lastActive, 9000, 'seconds → ms');
});
