// Nace Drex / shared System One client against a local fake server (no hosted calls).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createNaceBackend } from '../src/router/backends/nace.mjs';
import { createJevBackend, JEV_URL } from '../src/router/backends/jev.mjs';
import { createBackend } from '../src/router/backends/index.mjs';
import { systemOneUrl } from '../src/router/backends/systemone.mjs';
import { loadConfig } from '../src/config.mjs';
import { directProviders } from '../src/cli.mjs';

const KEY = 'nace_test_key_000000000000';
const u = (content) => ({ role: 'user', content });

/** Fake System One server; `handler(req, body)` returns {status, json, delayMs}. */
async function fakeServer(handler) {
  const seen = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : undefined;
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
    const r = handler(req, body);
    if (r.delayMs) await new Promise((ok) => setTimeout(ok, r.delayMs));
    if (res.destroyed) return;
    res.writeHead(r.status ?? 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(r.json ?? {}));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
  return { base, seen, close: () => new Promise((ok) => { server.closeAllConnections(); server.close(ok); }) };
}

const answer = (choice, extra = {}) => ({
  model: 'drex-v2.0',
  answers: { visualization: { type: 'choice', choice, confidence: 0.91, probabilities: { [choice]: 0.91 } } },
  usage: { input_tokens: 1234, output_tokens: 1 },
  ...extra,
});

test('nace backend: POST /v1/systemone with Bearer key, pinned model and only the routing turns', async () => {
  const s = await fakeServer(() => ({ json: answer('chart_line') }));
  try {
    const b = createNaceBackend({ apiKey: KEY, baseUrl: s.base });
    assert.deepEqual([b.id, b.model], ['nace', 'drex-v2.0']);
    const d = await b.decide([{ role: 'user', content: 'Umsatz pro Monat?', extra: 'not sent' }, { role: 'assistant', content: 'ok' }]);
    assert.deepEqual([d.format, d.component, d.confidence, d.reason], ['chart', 'line', 0.91, 'nace:chart_line']);
    assert.deepEqual(d.usage, { inputTokens: 1234 });
    const [r] = s.seen;
    assert.equal(r.method, 'POST');
    assert.equal(r.url, '/v1/systemone');
    assert.equal(r.auth, `Bearer ${KEY}`);
    assert.equal(r.body.model, 'drex-v2.0');
    assert.deepEqual(Object.keys(r.body).sort(), ['model', 'questions', 'state']);
    assert.deepEqual(r.body.state, { conversation: [{ role: 'user', content: 'Umsatz pro Monat?' }, { role: 'assistant', content: 'ok' }] });
    const q = r.body.questions.visualization;
    assert.equal(q.type, 'choice');
    assert.ok(q.criteria.text && q.criteria.compare && q.criteria.chart_line);
  } finally { await s.close(); }
});

test('nace backend: model override and base URL with or without /v1/systemone', async () => {
  const s = await fakeServer(() => ({ json: answer('compare') }));
  try {
    const b = createNaceBackend({ apiKey: KEY, baseUrl: `${s.base}/v1/systemone/`, model: 'drex-v1.5' });
    assert.equal((await b.decide([u('A oder B?')])).format, 'compare');
    assert.equal(s.seen[0].url, '/v1/systemone');
    assert.equal(s.seen[0].body.model, 'drex-v1.5');
  } finally { await s.close(); }
  assert.equal(systemOneUrl('https://console.nace.ai'), 'https://console.nace.ai/v1/systemone');
  assert.equal(JEV_URL, 'https://api.typesafe.ai/v1/systemone');
});

test('nace backend: HTTP errors report the status only, invalid answers are rejected', async () => {
  const s = await fakeServer((_req, body) => {
    const t = body.state.conversation[0].content;
    if (t === '429') return { status: 429, json: { error: { message: `Requests per minute exceeded ${t} secret-echo` } } };
    if (t === 'unknown') return { json: answer('pie_chart') };
    return { json: { answers: { visualization: { type: 'score', score: 1 } } } };
  });
  try {
    const b = createNaceBackend({ apiKey: KEY, baseUrl: s.base });
    await assert.rejects(b.decide([u('429')]), (err) => err.message === 'nace HTTP 429');
    await assert.rejects(b.decide([u('unknown')]), /nace returned an invalid choice/);
    await assert.rejects(b.decide([u('wrong type')]), /nace returned an invalid choice/);
  } finally { await s.close(); }
});

test('nace backend: own timeout and the router budget signal both abort a slow request', async () => {
  const s = await fakeServer(() => ({ json: answer('text'), delayMs: 500 }));
  try {
    const t0 = Date.now();
    await assert.rejects(createNaceBackend({ apiKey: KEY, baseUrl: s.base, timeoutMs: 50 }).decide([u('x')]), /abort|timeout/i);
    await assert.rejects(createNaceBackend({ apiKey: KEY, baseUrl: s.base }).decide([u('x')], { signal: AbortSignal.timeout(50) }), /abort|timeout/i);
    assert.ok(Date.now() - t0 < 450, 'both requests aborted before the server answered');
  } finally { await s.close(); }
});

test('nace backend: needs NACE_API_KEY; jev keeps its preset through the shared client', async () => {
  assert.throws(() => createNaceBackend({ apiKey: '' }), /NACE_API_KEY/);
  assert.throws(() => createJevBackend({ apiKey: '' }), /TYPESAFE_API_KEY/);
  const s = await fakeServer(() => ({ json: { answers: { visualization: { type: 'choice', choice: 'route_map', confidence: 0.6 } } } }));
  try {
    const d = await createJevBackend({ apiKey: 'jev_test_key', url: s.base }).decide([u('Plan a day in Rome')]);
    assert.deepEqual([d.format, d.component, d.reason, d.usage], ['map', 'route', 'jev:route_map', undefined]);
    assert.equal(s.seen[0].body.model, 'jev-latest');
  } finally { await s.close(); }
});

test('config: ROUTER_BACKEND=nace and nace,claude chains; failing nace falls through to the next link', async () => {
  const base = { HERMES_BASE_URL: 'http://h:8645/v1', BRIDGE_TOKEN: 't', BRIDGE_BOOTSTRAP: 'off' };
  const one = loadConfig({ ...base, ROUTER_BACKEND: 'nace', NACE_API_KEY: KEY });
  assert.deepEqual([one.router.chain, one.router.naceModel], [['nace'], 'drex-v2.0']);
  const c = loadConfig({ ...base, ROUTER_BACKEND: 'nace,claude', NACE_MODEL: 'drex-v1.5', NACE_BASE_URL: 'http://n' });
  assert.deepEqual(c.router.chain, ['nace', 'anthropic']);
  assert.deepEqual([c.router.naceModel, c.router.naceBaseUrl], ['drex-v1.5', 'http://n']);
  assert.throws(() => loadConfig({ ...base, ROUTER_BACKEND: 'nace,heuristic' }));
  // a NACE key alone never turns the model router on
  assert.equal(loadConfig({ ...base, NACE_API_KEY: KEY }).router.kind, 'heuristic');

  const down = await fakeServer(() => ({ status: 529, json: {} }));
  const up = await fakeServer(() => ({ json: answer('steps') }));
  try {
    const cfg = loadConfig({ ...base, ROUTER_BACKEND: 'nace,jev', NACE_API_KEY: KEY, NACE_BASE_URL: down.base, TYPESAFE_API_KEY: 'jev_test_key', JEV_BASE_URL: up.base });
    const chain = createBackend(cfg.router);
    assert.equal(chain.id, 'nace>jev');
    const d = await chain.decide([u('Wie wechsle ich einen Reifen?')]);
    assert.deepEqual([d.format, d._model], ['steps', 'jev-latest']);
    assert.equal(down.seen.length, 1);
  } finally { await down.close(); await up.close(); }
});

test('directProviders names nace only when it is configured with a key', () => {
  assert.deepEqual(directProviders({ NACE_API_KEY: KEY }, 'nace,anthropic').router, 'nace');
  assert.equal(directProviders({}, 'nace').router, undefined);
});

test('System One choice set reaches every route format and only allowed components', async () => {
  const { SYSTEMONE_CHOICES } = await import('../src/router/backends/systemone.mjs');
  const { ROUTE_FORMATS, COMPONENTS } = await import('../src/router/taxonomy.mjs');
  const reached = new Set(Object.values(SYSTEMONE_CHOICES).map((c) => c.format));
  assert.deepEqual(ROUTE_FORMATS.filter((f) => !reached.has(f)), []);
  for (const [id, c] of Object.entries(SYSTEMONE_CHOICES)) {
    assert.ok(ROUTE_FORMATS.includes(c.format), id);
    if (c.component) assert.ok(COMPONENTS[c.format]?.includes(c.component), `${id}: ${c.component}`);
    assert.ok(c.criterion && c.criterion.length < 600, id);
  }
});
