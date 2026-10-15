#!/usr/bin/env node
// Deterministic Hermes mock for streaming performance A/B runs (emulator / device). Every chat turn streams the
// same long answer (headings, lists, a Markdown table, a code block and seven `hui` cards, ~6.5k chars) with a
// seeded token rhythm, so two builds see byte-identical streams at identical timing. A user text starting with
// "hi" gets a short answer instead (cheap history turns). No auth check: pair with a token link, e.g.
//   hermesuiplus://pair?u=http%3A%2F%2F10.0.2.2%3A8790%2Fv1&t=nca_perf_test_token_0000000000&n=Perf
//
//   node scripts/perf/stream-mock.mjs [--port 8790] [--seed 1] [--ms 18-34]
// --ms: per-chunk delay range (uniform, seeded per turn). Chunks are word-sized like provider tokens. The default
// gives ~135 chars/s, i.e. about 50 s per answer.
import http from 'node:http';
import { SCENARIOS } from '../demo-videos/scenarios.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const PORT = Number(opt('--port', 8790)) || 8790;
const SEED = Number(opt('--seed', 1)) || 1;
const [MS_MIN, MS_MAX] = String(opt('--ms', '18-34')).split('-').map(Number);

/** mulberry32: small seeded PRNG */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const texts = (name) => SCENARIOS[name].steps({ userText: '', turn: 1, sessionId: 'perf', now: new Date(0) }).filter((s) => 'text' in s).map((s) => s.text).join('');
const LONG = [
  '## E-bike or car for the city?\n\nShort version: for trips under 10 km the **e-bike wins** on cost and often on time. Details below.\n\n',
  '### What matters most\n\n- **Distance:** most city trips are short\n- **Parking:** an e-bike parks at the door\n- **Weather:** rain gear makes most days fine\n- **Cargo:** a trailer or box handles shopping\n\n',
  texts('ebike'),
  '\n\n| Trip | E-bike | Car | Bus |\n|---|---:|---:|---:|\n| 3 km to work | 11 min | 14 min | 19 min |\n| 7 km to the gym | 24 min | 21 min | 33 min |\n| 12 km to friends | 41 min | 27 min | 48 min |\n\n',
  texts('tripLong'),
  '\n\n',
  texts('ebikeTable'),
  '\n\nA quick cost check you can run yourself:\n\n```python\ndef yearly_cost(km_per_day, price_per_km, days=220):\n    return round(km_per_day * price_per_km * days, 2)\n\nprint(yearly_cost(14, 0.04))  # e-bike\nprint(yearly_cost(14, 0.32))  # car\n```\n\n',
  texts('blocksWifi'),
  '\n\n',
  texts('serverCheck'),
  '\n\n**Bottom line:** try the e-bike for two weeks before deciding, and keep a car-sharing account for the rare long trip.',
].join('');
const SHORT = 'Hi! This is the perf mock. Send any other text for the long scripted answer.';

/** split like a provider stream: a word with its leading whitespace, long words cut into 2–7 char pieces */
function chunks(text, rand) {
  const out = [];
  for (const piece of text.match(/\s*\S+|\s+/g) || []) {
    let i = 0;
    while (i < piece.length) {
      const n = 2 + Math.floor(rand() * 6);
      out.push(piece.slice(i, i + n));
      i += n;
    }
  }
  return out;
}

const frame = (data, event) => `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve, reject) => {
    const c = [];
    req.on('data', (d) => c.push(d));
    req.on('end', () => resolve(Buffer.concat(c).toString('utf8')));
    req.on('error', reject);
  });
const contentText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (p?.type === 'text' ? p.text : '')).join('') : '');

let turns = 0;
async function chat(req, res) {
  const body = JSON.parse(await readBody(req));
  const convo = (body.messages || []).filter((m) => m.role === 'user' || m.role === 'assistant');
  const userText = contentText(convo[convo.length - 1]?.content).trim();
  const long = !/^hi\b/i.test(userText);
  const text = long ? LONG : SHORT;
  const rand = rng(SEED);
  const parts = chunks(text, rand);
  const sessionId = String(req.headers['x-hermes-session-id'] || '') || `api-perf-${++turns}`;
  const id = `chatcmpl-perf-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const t0 = Date.now();
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Hermes-Session-Id': sessionId });
  let closed = false;
  res.on('close', () => (closed = true));
  const write = (s) => !closed && res.write(s);
  const chunk = (delta, finish = null, x = {}) => ({ id, object: 'chat.completion.chunk', created, model: 'hermes-agent', choices: [{ index: 0, delta, finish_reason: finish }], ...x });
  await sleep(800);
  write(frame({ format: 'text', confidence: 0.62, reason: 'Text answer', model: 'router', ms: 600 }, 'hermes.ui.route'));
  write(frame(chunk({ role: 'assistant' })));
  await sleep(400);
  for (const tok of parts) {
    if (closed) break;
    write(frame(chunk({ content: tok })));
    await sleep(MS_MIN + rand() * (MS_MAX - MS_MIN));
  }
  write(frame(chunk({}, 'stop', { usage: { prompt_tokens: 1200, completion_tokens: Math.ceil(text.length / 4), total_tokens: 1200 + Math.ceil(text.length / 4) } })));
  write('data: [DONE]\n\n');
  res.end();
  console.log(`${new Date().toISOString().slice(11, 23)} ${long ? 'long' : 'short'} ${text.length} chars, ${parts.length} chunks, ${((Date.now() - t0) / 1000).toFixed(1)} s${closed ? ' (client closed)' : ''}`);
}

http
  .createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://x').pathname.replace(/\/+$/, '') || '/';
      // answers like a UI bridge (header + the bridge routes the app probes), as in the E2E rounds
      if (path === '/health' || path === '/v1/health') return json(res, 200, { status: 'ok', platform: 'hermes-agent', version: 'perf-mock' }, { 'X-Hermes-UI-Bridge': '1' });
      if (path === '/v1/models') return json(res, 200, { object: 'list', data: [{ id: 'hermes-agent', object: 'model', owned_by: 'hermes' }] });
      if (req.method === 'POST' && path === '/v1/chat/completions') return await chat(req, res);
      if (path === '/v1/capabilities')
        return json(res, 200, {
          object: 'hermes.api_server.capabilities', platform: 'hermes-agent', model: 'hermes-agent',
          features: { streaming: true, tool_progress: true, session_continuity_header: 'X-Hermes-Session-Id' },
          endpoints: { chat_completions: { method: 'POST', path: '/v1/chat/completions' } },
        });
      if (path.match(/^\/v1\/runs\/[^/]+$/)) return json(res, 200, { status: 'completed' });
      if (path === '/bridge/profiles') return json(res, 200, { object: 'list', data: [{ name: 'default', default: true, model: 'hermes-agent' }] });
      if (path === '/bridge/meta' || path === '/bridge/push/config' || path === '/bridge/voice/config' || path === '/bridge/chat/stop') return json(res, 200, {});
      if (path === '/bridge/quick/config') return json(res, 200, { available: false });
      json(res, 404, { error: { message: `Not found: ${path}` } });
    } catch (e) {
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: { message: String(e) } });
      else res.end();
    }
  })
  .listen(PORT, '127.0.0.1', () => {
    const n = chunks(LONG, rng(SEED)).length;
    console.log(`perf stream mock on http://127.0.0.1:${PORT}/v1 – long answer ${LONG.length} chars / ${n} chunks, ~${((n * (MS_MIN + MS_MAX)) / 2000).toFixed(0)} s`);
  });
