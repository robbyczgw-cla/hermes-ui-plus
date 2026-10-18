#!/usr/bin/env node
// Paired Hermes + UI-bridge mock for the store screenshots (scripts/e2e/store_shots.py, scripts/ios-sim-smoke.sh with
// HUI_TEST=store). The app connects to it like to a real bridge (one-time-code pairing), so no DEMO strip is shown.
// Answers are the app's own demo scenarios (app/src/onboarding/demo, en/de/es, fictional content), streamed in the
// framing of Hermes + the bridge (tool progress, approval requests, hermes.ui.route). Product cards get an https `image`
// URL; the bridge image proxy (GET /bridge/img) answers with the generated fictional headphone renders of
// scripts/demo-videos/media, so the app's normal photo path (proxy, no tap-to-load) fills the cards.
//
//   node scripts/e2e/store-mock.mjs [--port 18792]      binds 127.0.0.1; the Android emulator reaches it as 10.0.2.2, the
//                                                      iOS simulator as 127.0.0.1 (an ssh -R tunnel carries it to the hosts)
//   POST /__store/pair-code               → {code}   one-time code for a `hermesuiplus://pair?u=…&c=…&n=Hermes` link
//   POST /__store/config {lang}           chat language of the scripted answers (en|de|es)
//   GET  /__store/state                   counters
//
// Web search answers: a tool step with a `result` (the demo's Web Search Plus scene) is also stored as session rows
// (user → assistant tool_calls → tool → …), served at GET /api/sessions/{id}/messages like Hermes does, so the app's
// post-tool fetch fills the web result card. Favicons of the fictional example.* sources come from /bridge/img as small
// generated PNGs (one shape and colour per host).
import http from 'node:http';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import { tokenize } from '../../app/src/onboarding/demo/transport.ts';
import { pickScenario, scenarios, L } from '../../app/src/onboarding/demo/scenarios.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const MEDIA_DIR = join(HERE, '..', 'demo-videos', 'media');
const args = process.argv.slice(2);
const PORT = Number(args.includes('--port') ? args[args.indexOf('--port') + 1] : 18792) || 18792;
const BRIDGE = { 'X-Hermes-UI-Bridge': '1' };

// store prompts that must stay accent-free (adb cannot type accents) and that the demo router only knows with one
const ROUTE_OVERRIDES = [[/\bpermiso\b/i, 'approval']];
const pick = (text) => { const o = ROUTE_OVERRIDES.find(([re]) => re.test(text)); return o ? { name: o[1], scenario: scenarios[o[1]] } : pickScenario(text); };
const config = { lang: 'en' };
const codes = new Set();
const tokens = new Set();
const sessions = new Map();
const pendingApprovals = new Map();
const stats = { turns: 0, images: 0, pairs: 0, icons: 0 };
const rows = new Map(); // session id → stored rows (chronological)
let rowId = 0;
const pushRow = (sid, row) => {
  if (!rows.has(sid)) rows.set(sid, []);
  rows.get(sid).push({ id: ++rowId, timestamp: Date.now() / 1000, ...row });
};

// ---- generated favicons: 32x32 RGBA, a distinct shape and colour per host (fictional, no real site)
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const PALETTE = [[0x2f, 0x6f, 0xed], [0xe0, 0x5a, 0x2b], [0x1f, 0x9d, 0x6b], [0x8a, 0x4f, 0xd0], [0xd0, 0x3f, 0x77], [0x16, 0x8c, 0x9c]];
function faviconPng(host) {
  const h = crypto.createHash('sha256').update(host).digest();
  const [r, g, b] = PALETTE[h[0] % PALETTE.length];
  const shape = h[1] % 4;
  const N = 32, raw = Buffer.alloc((N * 4 + 1) * N);
  for (let y = 0; y < N; y++) {
    raw[y * (N * 4 + 1)] = 0;
    for (let x = 0; x < N; x++) {
      const dx = x - 15.5, dy = y - 15.5;
      const corner = Math.hypot(Math.max(Math.abs(dx) - 9.5, 0), Math.max(Math.abs(dy) - 9.5, 0)) <= 5; // rounded square
      const glyph = shape === 0 ? Math.hypot(dx, dy) <= 7 : shape === 1 ? Math.abs(dx) <= 7 && Math.abs(dy) <= 7 : shape === 2 ? Math.abs(dx) + Math.abs(dy) <= 9 : Math.abs(dy) <= 3 || Math.abs(dx) <= 3;
      const i = y * (N * 4 + 1) + 1 + x * 4;
      if (corner) {
        const c = glyph ? [255, 255, 255] : [r, g, b];
        raw[i] = c[0]; raw[i + 1] = c[1]; raw[i + 2] = c[2]; raw[i + 3] = 255;
      }
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}


// fictional product photos: demo brand → generated render (scripts/demo-videos/media/CREDITS.json: generated, CC0)
const IMAGE_MAP = [['aurel', 'hp-aurel.jpg'], ['fjord', 'hp-nordwell.jpg'], ['lumo', 'hp-kiro.jpg'], ['nordwell', 'hp-nordwell.jpg'], ['kiro', 'hp-kiro.jpg'], ['halden', 'hp-halden.jpg'], ['vela', 'hp-vela.jpg']];
const imageFor = (q) => IMAGE_MAP.find(([k]) => String(q || '').toLowerCase().includes(k))?.[1] ?? null;

/** product blocks get an `image` URL per product (https, as a shop page would give it); the app loads it through the bridge's image proxy (GET /bridge/img) */
function decorate(text) {
  return text.replace(/```hui\n([\s\S]*?)\n```/g, (whole, body) => {
    try {
      const node = JSON.parse(body);
      if (node?.type !== 'products' || !Array.isArray(node.products)) return whole;
      for (const p of node.products) {
        const f = imageFor(`${p.brand ?? ''} ${p.name ?? ''}`);
        if (f && !p.image) p.image = `https://images.example.org/store/${f}`;
      }
      return '```hui\n' + JSON.stringify(node, null, 2) + '\n```';
    } catch {
      return whole;
    }
  });
}

const frame = (data, event) => `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...BRIDGE });
  res.end(JSON.stringify(body));
};
const readBody = (req) => new Promise((resolve, reject) => {
  const c = [];
  req.on('data', (d) => c.push(d));
  req.on('end', () => resolve(Buffer.concat(c).toString('utf8')));
  req.on('error', reject);
});
const contentText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (p?.type === 'text' ? p.text : '')).join('') : '');

async function chat(req, res) {
  const body = JSON.parse(await readBody(req));
  const convo = (body.messages || []).filter((m) => m.role === 'user' || m.role === 'assistant');
  const userText = contentText((convo[convo.length - 1] || { content: '' }).content);
  const sessionId = String(req.headers['x-hermes-session-id'] || '') || 'api-' + crypto.randomBytes(8).toString('hex');
  const turn = (sessions.get(sessionId) || 0) + 1;
  sessions.set(sessionId, turn);
  stats.turns += 1;
  const lang = config.lang;
  const { name, scenario } = pick(userText);
  console.log(`${new Date().toISOString().slice(11, 19)} turn=${turn} lang=${lang} scenario=${name} text=${JSON.stringify(userText.slice(0, 60))}`);
  const steps = scenario.steps({ userText, turn, sessionId, now: new Date(), lang });
  pushRow(sessionId, { role: 'user', content: userText });
  let storedText = '';
  const id = 'chatcmpl-' + crypto.randomBytes(12).toString('hex');
  const created = Math.floor(Date.now() / 1000);
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Hermes-Session-Id': sessionId, ...BRIDGE });
  let closed = false;
  res.on('close', () => (closed = true));
  const write = (s) => !closed && res.write(s);
  const chunk = (delta, finish = null, x = {}) => ({ id, object: 'chat.completion.chunk', created, model: 'hermes-agent', choices: [{ index: 0, delta, finish_reason: finish }], ...x });
  await sleep(500);
  write(frame({ format: scenario.format, confidence: scenario.format === 'text' ? 0.62 : 0.93, reason: `Scenario ${name}`, model: 'router', ms: 640 }, 'hermes.ui.route'));
  write(frame(chunk({ role: 'assistant' })));
  await sleep(250);
  let n = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (closed) return;
    if ('text' in step) {
      for (const { tok, block } of tokenize(decorate(step.text))) {
        if (closed) return;
        n += tok.length;
        storedText += tok;
        write(frame(chunk({ content: tok })));
        await sleep(block ? rnd(4, 9) : rnd(6, 16));
      }
    } else if ('reasoning' in step) {
      for (const { tok } of tokenize(step.reasoning)) {
        write(frame(chunk({ reasoning_content: tok })));
        await sleep(rnd(6, 14));
      }
    } else if ('tool' in step) {
      const callId = `call-${crypto.randomUUID()}`;
      write(frame({ tool: step.tool.name, emoji: step.tool.emoji, label: step.tool.label, toolCallId: callId, status: 'running' }, 'hermes.tool.progress'));
      await sleep(Math.min(step.tool.ms, 900));
      write(frame({ tool: step.tool.name, toolCallId: callId, status: 'completed' }, 'hermes.tool.progress'));
      if (step.tool.result) {
        pushRow(sessionId, { role: 'assistant', content: storedText, tool_calls: [{ id: callId, type: 'function', function: { name: step.tool.name, arguments: JSON.stringify(step.tool.result.args) } }] });
        pushRow(sessionId, { role: 'tool', content: step.tool.result.output, tool_call_id: callId, tool_name: step.tool.name });
        storedText = '';
      }
    } else if ('status' in step) write(frame(step.status, 'hermes.status'));
    else if ('wait' in step) await sleep(Math.min(step.wait, 400));
    else if ('approval' in step) {
      const a = step.approval;
      const requestId = crypto.randomBytes(12).toString('hex');
      write(frame({ command: a.command, pattern_key: a.pattern_key, pattern_keys: a.pattern_keys, description: a.description, allow_permanent: false, allow_session: false, request_id: requestId, run_id: id, timestamp: Date.now() / 1000, session_id: sessionId, choices: ['once', 'deny'] }, 'approval.request'));
      const choice = await new Promise((resolve) => {
        const ka = setInterval(() => write(': keepalive\n\n'), 10000);
        const done = (c) => (clearInterval(ka), pendingApprovals.delete(id), resolve(c));
        pendingApprovals.set(id, { requestId, resolve: done });
        res.on('close', () => done('timeout'));
      });
      console.log(`  approval ${choice}`);
      if (closed) return;
      const denied = choice === 'deny' || choice === 'timeout';
      const follow = denied
        ? (a.deny ?? [{ text: L({ lang }, '\n\nOkay, der Befehl wurde abgelehnt; ich lasse alles unverändert.', '\n\nOkay, the command was denied; I am leaving everything unchanged.', '\n\nDe acuerdo, el comando fue denegado; dejo todo sin cambios.') }])
        : (a.allow ?? [{ text: L({ lang }, '\n\nErledigt.', '\n\nDone.', '\n\nHecho.') }]);
      steps.splice(i + 1, 0, ...follow);
    }
  }
  if (storedText) pushRow(sessionId, { role: 'assistant', content: storedText, finish_reason: 'stop' });
  write(frame(chunk({}, 'stop', { usage: { prompt_tokens: 1200, completion_tokens: Math.ceil(n / 4), total_tokens: 1200 + Math.ceil(n / 4) } })));
  write('data: [DONE]\n\n');
  res.end();
}

const TYPES = { '.jpg': 'image/jpeg', '.png': 'image/png' };
http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path === '/__store/state') return json(res, 200, { config, stats, codes: codes.size, tokens: tokens.size });
    if (req.method === 'POST' && path === '/__store/pair-code') {
      const code = `store-pair-test-${Date.now().toString(36)}-${codes.size}`;
      codes.add(code);
      return json(res, 200, { code });
    }
    if (req.method === 'POST' && path === '/__store/config') {
      Object.assign(config, JSON.parse((await readBody(req)) || '{}'));
      return json(res, 200, config);
    }
    if (req.method === 'POST' && path === '/bridge/pair/redeem') {
      const { code } = JSON.parse((await readBody(req)) || '{}');
      if (!codes.delete(code)) return json(res, 410, { error: { message: 'Pairing link expired or already used', code: 'pair_code_invalid' } });
      const token = `nca_store_test_token_${String(tokens.size).padStart(24, '0')}`;
      tokens.add(token);
      stats.pairs += 1;
      return json(res, 200, { token, deviceId: `store-device-${tokens.size}`, name: 'Hermes' });
    }
    if (path === '/health' || path === '/v1/health') return json(res, 200, { status: 'ok', platform: 'hermes-agent', version: 'store-mock' });
    if (path === '/v1/models') return json(res, 200, { object: 'list', data: [{ id: 'hermes-agent', object: 'model', owned_by: 'hermes' }] });
    if (req.method === 'POST' && path === '/v1/chat/completions') return await chat(req, res);
    const am = path.match(/^\/v1\/runs\/([^/]+)\/approval$/);
    if (req.method === 'POST' && am) {
      const body = JSON.parse((await readBody(req)) || '{}');
      const p = pendingApprovals.get(decodeURIComponent(am[1]));
      if (!p) return json(res, 409, { error: { message: 'Run has no pending approval', code: 'approval_not_pending' } });
      p.resolve(String(body.choice || 'once'));
      return json(res, 200, { object: 'hermes.run.approval_response', run_id: am[1], choice: body.choice, request_id: p.requestId, resolved: 1 });
    }
    if (path === '/v1/capabilities')
      return json(res, 200, {
        object: 'hermes.api_server.capabilities', platform: 'hermes-agent', model: 'hermes-agent',
        features: { streaming: true, tool_progress: true, approvals: true, model_options: true, session_model_lock: true, session_continuity_header: 'X-Hermes-Session-Id' },
        endpoints: { chat_completions: { method: 'POST', path: '/v1/chat/completions' }, model_options: { method: 'GET', path: '/api/model/options' }, run_approval: { method: 'POST', path: '/v1/runs/{run_id}/approval' } },
      });
    // the app probes the session API once per connection (a 404 turns the post-tool fetch off): an empty list, so no old chats show up
    if (path === '/api/sessions') return json(res, 200, { object: 'list', data: [], has_more: false, limit: 50, offset: 0 });
    const sm = path.match(/^\/api\/sessions\/([^/]+)\/messages$/);
    if (sm) return json(res, 200, { object: 'list', session_id: decodeURIComponent(sm[1]), data: rows.get(decodeURIComponent(sm[1])) || [] });
    if (path === '/v1/skills') return json(res, 200, { object: 'list', data: [] });
    if (path === '/bridge/profiles') return json(res, 200, { object: 'list', data: [{ name: 'default', default: true, model: 'hermes-4-405b' }] });
    if (path === '/api/model/options')
      return json(res, 200, { model: 'hermes-4-405b', provider: 'nous', providers: [{ slug: 'nous', name: 'Nous Portal', is_current: true, authenticated: true, models: ['hermes-4-405b'], capabilities: { 'hermes-4-405b': { reasoning: true, can_disable_reasoning: true, fast: false } } }] });
    if (path === '/bridge/meta' || path === '/bridge/push/config' || path === '/bridge/voice/config') return json(res, 200, {});
    if (path.match(/^\/v1\/runs\/[^/]+$/)) return json(res, 200, { status: 'completed' });
    if (path === '/bridge/images/config') return json(res, 200, { available: true, providers: ['demo'], proxy: { available: true } });
    if (path === '/bridge/img') {
      // the image proxy of the bridge: the https URL names a render of scripts/demo-videos/media (host ignored, nothing is fetched)
      const u = String(url.searchParams.get('u') || '');
      const fav = u.match(/^https?:\/\/([^/]+)\/favicon\.ico$/i);
      if (fav) {
        stats.icons += 1;
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=3600', ...BRIDGE });
        return res.end(faviconPng(fav[1].toLowerCase()));
      }
      const f = normalize(join(MEDIA_DIR, u.split('/').pop() || ''));
      if (f.startsWith(MEDIA_DIR) && existsSync(f)) {
        stats.images += 1;
        res.writeHead(200, { 'Content-Type': TYPES[f.slice(f.lastIndexOf('.'))] || 'application/octet-stream', 'Cache-Control': 'max-age=3600', ...BRIDGE });
        return res.end(readFileSync(f));
      }
      return json(res, 404, { error: { message: 'no such image' } });
    }
    if (path === '/bridge/images') {
      const q = url.searchParams.get('q');
      const f = imageFor(q);
      stats.images += 1;
      console.log(`  image "${q}" → ${f || '–'}`);
      const base = `http://${req.headers.host}`;
      return json(res, 200, { results: f ? [{ url: `${base}/media/${f}`, thumbnailUrl: `${base}/media/${f}`, width: 960, height: 720, title: q, sourcePage: 'https://example.com/', sourceDomain: 'example.com', provider: 'demo' }] : [] });
    }
    if (path.startsWith('/media/')) {
      const f = normalize(join(HERE, '..', 'demo-videos', path));
      if (f.startsWith(MEDIA_DIR) && existsSync(f)) {
        res.writeHead(200, { 'Content-Type': TYPES[f.slice(f.lastIndexOf('.'))] || 'application/octet-stream', 'Cache-Control': 'max-age=3600' });
        return res.end(readFileSync(f));
      }
    }
    console.log(`  404 ${req.method} ${path}`);
    json(res, 404, { error: { message: `Not found: ${path}` } });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: { message: String(e) } });
    else res.end();
  }
}).listen(PORT, '127.0.0.1', () => console.log(`store mock on http://127.0.0.1:${PORT}/v1`));
