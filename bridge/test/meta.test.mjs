// Meta endpoint tests: real bridge HTTP server with a fake Anthropic client / fake backend.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';
import { metaEnabled, createMetaBackend, normalizeResult, parseMetaRequest, truncate, MAX_CHARS_PER_TURN } from '../src/meta.mjs';

const TOKEN = 'bridge-token';
const servers = [];
async function start(env = {}, o = {}) {
  const { server } = createServer({ BRIDGE_TOKEN: TOKEN, HERMES_BASE_URL: 'http://127.0.0.1:9/v1', ROUTER_BACKEND: 'heuristic', ...env }, { logger: silentLogger, ...o });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  servers.push(server);
  return server.address().port;
}
after(() => servers.forEach((s) => { s.close(); s.closeAllConnections(); }));

async function post(port, body, { auth = `Bearer ${TOKEN}`, path = '/bridge/meta', method = 'POST' } = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const MSGS = [{ role: 'user', content: 'Wie backe ich Sauerteigbrot?' }, { role: 'assistant', content: 'Mehl, Wasser, Anstellgut ...' }];
function fakeBackend(fn) {
  const calls = [];
  return { model: 'fake-haiku', calls, generate: async (req, o) => { calls.push(req); return fn(req, o); } };
}

test('happy path: title + followups, limits enforced', async () => {
  const backend = fakeBackend(() => ({
    title: '"Sauerteigbrot selber backen und mehr dazu heute" 🍞',
    followups: ['Wie lange muss der Teig gehen?', 'x'.repeat(61), 'Wie lange muss der Teig gehen?', 'Welches Mehl?', 'Und glutenfrei?', 'Vierte Frage'],
  }));
  const port = await start({}, { metaBackend: backend });
  const r = await post(port, { messages: MSGS, want: ['title', 'followups'], lang: 'de' });
  assert.equal(r.status, 200);
  assert.equal(r.json.title, 'Sauerteigbrot selber backen und mehr dazu');
  assert.deepEqual(r.json.followups, ['Wie lange muss der Teig gehen?', 'Welches Mehl?', 'Und glutenfrei?']);
  assert.equal(r.json.model, 'fake-haiku');
  assert.equal(typeof r.json.ms, 'number');
});

test('want filters output; invalid bodies are 400', async () => {
  const port = await start({}, { metaBackend: fakeBackend(() => ({ title: 'Ein Titel', followups: ['a'] })) });
  const t = await post(port, { messages: MSGS, want: ['title'] });
  assert.equal(t.json.title, 'Ein Titel');
  assert.equal('followups' in t.json, false);
  for (const bad of [{}, { messages: [] }, { messages: MSGS, want: ['x'] }, { messages: MSGS, lang: 'fr' }, { messages: [{ role: 'system', content: 'a' }] }, 'not json']) {
    assert.equal((await post(port, bad)).status, 400, JSON.stringify(bad));
  }
});

test('only the last 4 turns, truncated', async () => {
  const backend = fakeBackend(() => ({ title: 'T eins zwei', followups: [] }));
  const port = await start({}, { metaBackend: backend });
  const many = Array.from({ length: 7 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i} ${'y'.repeat(5000)}` }));
  await post(port, { messages: many, want: ['title'] });
  const sent = backend.calls[0].messages;
  assert.equal(sent.length, 4);
  assert.ok(sent[0].content.startsWith('m3'));
  assert.ok(sent.every((m) => m.content.length <= MAX_CHARS_PER_TURN + 10));
  assert.equal(truncate('kurz'), 'kurz');
});

test('cache: identical request hits the backend once', async () => {
  const backend = fakeBackend(() => ({ title: 'Cache Test Titel', followups: [] }));
  const port = await start({}, { metaBackend: backend });
  const a = await post(port, { messages: MSGS, want: ['title'] });
  const b = await post(port, { messages: MSGS, want: ['title'] });
  assert.equal(backend.calls.length, 1);
  assert.equal(a.json.cached, undefined);
  assert.equal(b.json.cached, true);
  await post(port, { messages: MSGS, want: ['title'], lang: 'en' });
  assert.equal(backend.calls.length, 2);
});

test('timeout -> 504, backend failure -> 502 (not cached)', async () => {
  let n = 0;
  const backend = fakeBackend((_, o) => (n++ === 0 ? new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted')))) : Promise.reject(new Error('boom'))));
  const port = await start({ META_TIMEOUT_MS: '50' }, { metaBackend: backend });
  assert.equal((await post(port, { messages: MSGS })).status, 504);
  assert.equal((await post(port, { messages: MSGS })).status, 502);
});

test('auth: missing/wrong token -> 401, also for config', async () => {
  const port = await start({}, { metaBackend: fakeBackend(() => ({})) });
  assert.equal((await post(port, { messages: MSGS }, { auth: null })).status, 401);
  assert.equal((await post(port, { messages: MSGS }, { auth: 'Bearer nope' })).status, 401);
  assert.equal((await post(port, null, { method: 'GET', path: '/bridge/meta/config', auth: null })).status, 401);
});

test('feature off without ANTHROPIC_API_KEY: 404, config says unavailable', async () => {
  const port = await start({ ANTHROPIC_API_KEY: '' });
  const r = await post(port, { messages: MSGS });
  assert.equal(r.status, 404);
  assert.equal(r.json.error.code, 'feature_off');
  const c = await post(port, null, { method: 'GET', path: '/bridge/meta/config' });
  assert.equal(c.status, 200);
  assert.equal(c.json.available, false);
});

test('titles need an explicit BRIDGE_META=on: a key alone (e.g. exported in the shell) never enables them', async () => {
  for (const [meta, available] of [['off', false], ['OFF', false], ['0', false], ['', false], [undefined, false], ['on', true], ['ON', true], ['1', true], ['yes', true]]) {
    const port = await start({ ANTHROPIC_API_KEY: 'sk-ant-test', BRIDGE_META: meta });
    const c = await post(port, null, { method: 'GET', path: '/bridge/meta/config' });
    assert.equal(c.json.available, available, `BRIDGE_META=${meta}`);
  }
  assert.equal(metaEnabled({ BRIDGE_META: 'on' }), false); // on never works without a key
  assert.equal(metaEnabled({ ANTHROPIC_API_KEY: 'sk-ant-test' }), false); // a key alone never enables it
  const port = await start({ ANTHROPIC_API_KEY: 'sk-ant-test', BRIDGE_META: 'off' });
  assert.equal((await post(port, { messages: MSGS })).status, 404);
});

test('config with backend reports availability', async () => {
  const port = await start({}, { metaBackend: fakeBackend(() => ({})) });
  const c = await post(port, null, { method: 'GET', path: '/bridge/meta/config' });
  assert.deepEqual([c.json.available, c.json.model], [true, 'fake-haiku']);
});

test('Anthropic request shape: haiku, thinking disabled, effort low, json_schema, max_tokens 200', async () => {
  let seen;
  const client = { messages: { create: async (p) => { seen = p; return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"title":"A b c","followups":[]}' }] }; } } };
  const b = createMetaBackend({ client });
  const out = await b.generate({ messages: MSGS, want: ['title'], lang: 'de' });
  assert.equal(out.title, 'A b c');
  assert.equal(seen.model, 'claude-haiku-5-5');
  assert.deepEqual(seen.thinking, { type: 'disabled' });
  assert.equal(seen.output_config.effort, 'low');
  assert.equal(seen.output_config.format.type, 'json_schema');
  assert.equal(seen.max_tokens, 200);
  const failing = createMetaBackend({ client: { messages: { create: async () => ({ stop_reason: 'max_tokens', content: [] }) } } });
  await assert.rejects(failing.generate({ messages: MSGS, want: ['title'] }));
});

test('normalizeResult / parseMetaRequest edge cases', () => {
  assert.deepEqual(normalizeResult({ title: '   ', followups: 'x' }, ['title', 'followups']), { followups: [] });
  assert.equal(normalizeResult({ title: 'Hallo Welt.' }, ['title']).title, 'Hallo Welt');
  assert.equal(parseMetaRequest({ messages: [{ role: 'user', content: '   ' }] }).ok, false);
  assert.deepEqual(parseMetaRequest({ messages: MSGS }).value.want, ['title', 'followups']);
});
