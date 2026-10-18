/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiRoot, createSessionsClient, isNotFoundError, isUnsupportedError, parseMessages, parseSessionList } from './sessions.ts';
import { HermesError, type FetchLike, type FetchResponseLike } from './stream.ts';
import { LIST_FIXTURE, MESSAGES_FIXTURE } from './sessions.fixtures.ts';


test('parseSessionList maps fields, seconds → ms, drops rows without id', () => {
  const p = parseSessionList(LIST_FIXTURE);
  assert.equal(p.hasMore, true);
  assert.equal(p.sessions.length, 3);
  const s = p.sessions[0];
  assert.equal(s.id, 'hermes-ui-dev-1791659144');
  assert.equal(s.source, 'api_server');
  assert.equal(s.title, 'Nur mit OK antworten');
  assert.equal(s.messageCount, 6);
  assert.equal(s.startedAt, 1791659146346);
  assert.equal(s.lastActive, 1791659157642);
  assert.equal(s.pinned, undefined);
  assert.equal(p.sessions[1].parentSessionId, 'x');
  assert.equal(p.sessions[2].source, 'unknown');
  assert.equal(parseSessionList(null).sessions.length, 0);
});

test('parseMessages parses tool_calls (JSON arguments) and reasoning', () => {
  const p = parseMessages(MESSAGES_FIXTURE, 'fallback');
  assert.equal(p.sessionId, 'hermes-ui-dev-1791659144');
  assert.equal(p.messages.length, 6);
  const a = p.messages[3];
  assert.equal(a.id, '339196');
  assert.deepEqual(a.toolCalls, [{ id: 'call-f29c2b49-f3b3-4e0c-a08c-7a64aed091ee-0', name: 'terminal', arguments: { command: 'date' } }]);
  assert.equal(p.messages[4].toolCallId, 'call-f29c2b49-f3b3-4e0c-a08c-7a64aed091ee-0');
  assert.equal(p.messages[5].reasoning, 'Der Nutzer fragt nach der aktuellen Uhrzeit.');
  assert.equal(p.messages[0].timestamp, 1791659146217);
  // tool_calls stored as a JSON string (import/export path) are parsed too
  const s = parseMessages({ data: [{ id: 1, role: 'assistant', content: '', tool_calls: '[{"id":"c1","function":{"name":"x","arguments":"not json"}}]' }] }, 'f');
  assert.deepEqual(s.messages[0].toolCalls, [{ id: 'c1', name: 'x', arguments: 'not json' }]);
});

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };

function fakeFetch(responses: { status: number; body: unknown }[]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    const r = responses.shift() ?? { status: 200, body: {} };
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    const res: FetchResponseLike = {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: () => null },
      body: null,
      text: async () => text,
    };
    return res;
  };
  return { fetch, calls };
}

const conn = { baseUrl: 'http://h:8645/v1/', apiKey: 'k' };

test('apiRoot strips /v1 and slashes', () => {
  assert.equal(apiRoot('http://h:8645/v1/'), 'http://h:8645');
  assert.equal(apiRoot('http://h:8645'), 'http://h:8645');
});

test('client builds the verified routes, auth and bodies', async () => {
  const { fetch, calls } = fakeFetch([
    { status: 200, body: LIST_FIXTURE },
    { status: 200, body: MESSAGES_FIXTURE },
    { status: 200, body: { object: 'hermes.session', session: { id: 'a b', source: 'api_server', title: 'Neu', message_count: 0, started_at: 1 } } },
    { status: 200, body: { object: 'hermes.session.deleted', id: 'a b', deleted: true } },
  ]);
  const c = createSessionsClient(fetch, conn);
  const list = await c.list({ source: 'telegram' });
  assert.equal(list.sessions.length, 3);
  assert.equal(calls[0].url, 'http://h:8645/api/sessions?limit=50&source=telegram');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].headers.Authorization, 'Bearer k');
  await c.messages('hermes-ui-dev-1791659144', { limit: 80 });
  assert.equal(calls[1].url, 'http://h:8645/api/sessions/hermes-ui-dev-1791659144/messages?order=latest&limit=80');
  const renamed = await c.rename('a b', 'Neu');
  assert.equal(renamed?.title, 'Neu');
  assert.equal(calls[2].method, 'PATCH');
  assert.equal(calls[2].url, 'http://h:8645/api/sessions/a%20b');
  assert.equal(calls[2].body, '{"title":"Neu"}');
  assert.equal(calls[2].headers['Content-Type'], 'application/json');
  assert.equal(await c.remove('a b'), true);
  assert.equal(calls[3].method, 'DELETE');
});

test('404 without session_not_found = unsupported server; session_not_found = gone', async () => {
  const { fetch } = fakeFetch([
    { status: 404, body: '404: Not Found' },
    { status: 404, body: { error: { message: 'Session not found: x', type: 'invalid_request_error', code: 'session_not_found' } } },
    { status: 404, body: { error: { message: 'Session not found: x', code: 'session_not_found' } } },
    { status: 409, body: { error: { message: 'busy', code: 'session_active_turn' } } },
  ]);
  const c = createSessionsClient(fetch, conn);
  await assert.rejects(c.list(), (e: unknown) => isUnsupportedError(e) && !isNotFoundError(e));
  await assert.rejects(c.messages('x'), (e: unknown) => isNotFoundError(e) && !isUnsupportedError(e));
  assert.equal(await c.remove('x'), true); // already gone counts as deleted
  await assert.rejects(c.remove('y'), (e: unknown) => e instanceof HermesError && e.code === 'session_active_turn');
});

test('Hermes 0.22 lazy tool discovery: a single `tool_call` is the tool it wraps (name, arguments, parsed result)', async () => {
  const { HERMES_LAZY_TOOL_ROWS } = await import('./webResults.fixtures.ts');
  const { mapRemoteMessages } = await import('./sessionMapping.ts');
  const rows = parseMessages({ data: HERMES_LAZY_TOOL_ROWS }, 'f').messages;
  const call = rows.find((r) => r.id === '6')?.toolCalls?.[0];
  assert.deepEqual(call, { id: 'toolu_test03', name: 'web_search_plus', arguments: { query: 'free threading guide', count: 3 } });
  const [, answer] = mapRemoteMessages(rows);
  assert.deepEqual(answer.tools.map((t) => t.name), ['tool_search', 'tool_describe', 'web_search_plus']);
  const web = answer.tools[2];
  assert.equal(web.detail?.web?.provider, 'keenable');
  assert.equal(web.detail?.links?.length, 1);
  // several wrapped calls or a malformed wrapper stay as they are
  const many = parseMessages({ data: [{ id: 9, role: 'assistant', content: '', tool_calls: [{ id: 'm', function: { name: 'tool_call', arguments: '{"calls":[{"name":"a"},{"name":"b"}]}' } }] }] }, 'f');
  assert.equal(many.messages[0].toolCalls?.[0].name, 'tool_call');
});
