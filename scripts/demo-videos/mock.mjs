#!/usr/bin/env node
// Hermes API mock for the demo videos. Streams the prepared English scenarios
// (scenarios.mjs; tokenization shared with the app) in the same SSE
// framing as Hermes + the UI bridge (`hermes.ui.route`, `hermes.tool.progress`, reasoning), so the app
// runs as a normal "Hermes" profile (no demo banner, image editing allowed). Adds two video-only
// scenarios for the image-edit clip and serves ./media/ (CC0 photo + edited version).
//
//   node scripts/demo-videos/mock.mjs [--port 8790]
import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import { tokenize } from '../../app/src/onboarding/demo/transport.ts';
import { SCENARIOS, pickV4, IMAGE_MAP } from './scenarios.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const PORT = Number(args[args.indexOf('--port') + 1] || 8790) || 8790;

/** media base as the browser sees it (record.mjs maps hermes.local → this server) */
const MEDIA = process.env.DEMO_MEDIA_BASE || 'http://hermes.local';
const hui = (node) => '```hui\n' + JSON.stringify(node, null, 2) + '\n```\n';
const extra = {
  editSource: {
    format: 'image',
    steps: () => [
      { wait: 400 },
      { text: 'Here is a CC0 harbor photo:\n\n' },
      { text: hui({ type: 'image', url: `${MEDIA}/media/hafen.jpg`, caption: 'Harbor (CC0, Wikimedia Commons)' }) },
      { text: '\nTip: Tap ✨ Edit to transform the image.' },
    ],
  },
  editResult: {
    format: 'image',
    steps: () => [
      { reasoning: 'Image editing: watercolor style, keep the subject and composition.' },
      { tool: { name: 'image_generate', label: 'Watercolor style, keep the subject', emoji: '\u{1F3A8}', ms: 2600 } },
      { text: 'Done: your photo as a watercolor:\n\n' },
      { text: hui({ type: 'image', url: `${MEDIA}/media/hafen-aquarell.jpg`, caption: 'Harbor watercolor' }) },
      { text: '\nDrag the slider to compare before and after.' },
    ],
  },
};

/** image URLs handed out by the fake image search; the recorder maps this https host to ./media (lib.mjs) */
export const IMAGE_HOST = 'images.example.org';
function imageFor(q) {
  const t = String(q || '').toLowerCase();
  const hit = IMAGE_MAP.find(([k]) => t.includes(k));
  return hit ? hit[1] : null;
}

function pick(text, hasImage) {
  const v4 = pickV4(text);
  if (v4) return { name: v4, scenario: SCENARIOS[v4] };
  const t = text.toLowerCase();
  if (hasImage || /^please edit this image/.test(t)) return { name: 'editResult', scenario: extra.editResult };
  if (/harbor photo/.test(t)) return { name: 'editSource', scenario: extra.editSource };
  return { name: 'hello', scenario: SCENARIOS.hello };
}

const REASONS = {
  text: 'Text answer', map: 'Places and routes → map', recipe: 'Cooking instructions → recipe',
  checklist: 'A list to tick off', choice: 'A question with choices', decision: 'Options and criteria',
  poll: 'Group vote', translation: 'Translation', chart: 'Numbers → chart', agenda: 'Daily plan → schedule',
  calculator: 'Interactive calculator', image: 'Image', interactive: 'Interactive answer',
  places: 'Places with details → place cards', products: 'Product comparison → ranking',
  guide: 'Instructions → step by step', workout: 'Workout plan', vocab: 'Vocabulary trainer', mindmap: 'Connections → mind map',
};
const frame = (data, event) => `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);

function cors(req) {
  return {
    'Access-Control-Allow-Origin': req.headers.origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key, X-Hermes-Session-Id, X-Hermes-Session-Key',
    'Access-Control-Expose-Headers': 'X-Hermes-Session-Id, X-Hermes-Session-Key',
    Vary: 'Origin',
  };
}
const json = (req, res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...cors(req) });
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
const contentHasImage = (c) => Array.isArray(c) && c.some((p) => p && p.type !== 'text');

const sessions = new Map();
/** run id → resolve(choice) of a pending approval */
const pendingApprovals = new Map();

async function chat(req, res) {
  const body = JSON.parse(await readBody(req));
  const convo = (body.messages || []).filter((m) => m.role === 'user' || m.role === 'assistant');
  const last = convo[convo.length - 1] || { content: '' };
  const userText = contentText(last.content);
  const sessionId = String(req.headers['x-hermes-session-id'] || '') || 'api-' + crypto.randomBytes(8).toString('hex');
  const turn = (sessions.get(sessionId) || 0) + 1;
  sessions.set(sessionId, turn);
  const { name, scenario } = pick(userText, contentHasImage(last.content));
  console.log(`${new Date().toISOString().slice(11, 19)} turn=${turn} scenario=${name} text=${JSON.stringify(userText.slice(0, 60))}`);
  const steps = scenario.steps({ userText, turn, sessionId, now: new Date() });
  const id = 'chatcmpl-' + crypto.randomBytes(12).toString('hex');
  const created = Math.floor(Date.now() / 1000);
  const model = body.model || 'hermes-agent';
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Hermes-Session-Id': sessionId, ...cors(req) });
  let closed = false;
  res.on('close', () => (closed = true));
  const write = (s) => !closed && res.write(s);
  const chunk = (delta, finish = null, x = {}) => ({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }], ...x });
  // waiting animation first, then the route decision (skeleton), then tokens
  await sleep(900);
  write(frame({ format: scenario.format, confidence: scenario.format === 'text' ? 0.62 : 0.93, reason: REASONS[scenario.format] || 'Structured answer', model: 'router', ms: 640 }, 'hermes.ui.route'));
  write(frame(chunk({ role: 'assistant' })));
  await sleep(500);
  let n = 0;
  for (const step of steps) {
    if (closed) return;
    if ('text' in step) {
      for (const { tok, block } of tokenize(step.text)) {
        if (closed) return;
        n += tok.length;
        write(frame(chunk({ content: tok })));
        await sleep((block ? rnd(14, 26) : rnd(16, 40)) / (step.fast || 1));
      }
    } else if ('reasoning' in step) {
      for (const { tok } of tokenize(step.reasoning)) {
        write(frame(chunk({ reasoning_content: tok })));
        await sleep(rnd(14, 30));
      }
    } else if ('tool' in step) {
      const callId = `call-${crypto.randomUUID()}`;
      write(frame({ tool: step.tool.name, emoji: step.tool.emoji, label: step.tool.label, toolCallId: callId, status: 'running' }, 'hermes.tool.progress'));
      await sleep(step.tool.ms);
      write(frame({ tool: step.tool.name, toolCallId: callId, status: 'completed' }, 'hermes.tool.progress'));
    } else if ('approval' in step) {
      const a = step.approval;
      const requestId = crypto.randomBytes(12).toString('hex');
      write(frame({ command: a.command, pattern_key: a.pattern_key, pattern_keys: a.pattern_keys, description: a.description, allow_permanent: true, allow_session: true, request_id: requestId, run_id: id, timestamp: Date.now() / 1000, session_id: sessionId, choices: ['once', 'session', 'always', 'deny'] }, 'approval.request'));
      const choice = await new Promise((resolve) => {
        const ka = setInterval(() => write(': keepalive\n\n'), 10000);
        const done = (c) => (clearInterval(ka), pendingApprovals.delete(id), resolve(c));
        pendingApprovals.set(id, { requestId, resolve: done });
        res.on('close', () => done('timeout'));
      });
      console.log(`  approval ${choice}`);
      if (closed) return;
      if (scenario.after) steps.splice(steps.indexOf(step) + 1, 0, ...scenario.after(choice));
    } else if ('status' in step) write(frame(step.status, 'hermes.status'));
    else if ('wait' in step) await sleep(step.wait);
  }
  write(frame(chunk({}, 'stop', { usage: { prompt_tokens: 1800, completion_tokens: Math.ceil(n / 4), total_tokens: 1800 + Math.ceil(n / 4) } })));
  write('data: [DONE]\n\n');
  res.end();
}

const TYPES = { '.jpg': 'image/jpeg', '.png': 'image/png' };
http
  .createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://x').pathname.replace(/\/+$/, '') || '/';
      if (req.method === 'OPTIONS') return res.writeHead(204, cors(req)), res.end();
      if (path === '/health' || path === '/v1/health') return json(req, res, 200, { status: 'ok', platform: 'hermes-agent', version: 'demo' });
      if (path === '/v1/models') return json(req, res, 200, { object: 'list', data: [{ id: 'hermes-agent', object: 'model', owned_by: 'hermes' }] });
      if (req.method === 'POST' && path === '/v1/chat/completions') return await chat(req, res);
      const am = path.match(/^\/v1\/runs\/([^/]+)\/approval$/);
      if (req.method === 'POST' && am) {
        const body = JSON.parse((await readBody(req)) || '{}');
        const p = pendingApprovals.get(decodeURIComponent(am[1]));
        if (!p) return json(req, res, 409, { error: { message: 'Run has no pending approval', code: 'approval_not_pending' } });
        p.resolve(String(body.choice || 'once'));
        return json(req, res, 200, { object: 'hermes.run.approval_response', run_id: am[1], choice: body.choice, request_id: p.requestId, resolved: 1 });
      }
      if (path === '/v1/capabilities')
        return json(req, res, 200, {
          object: 'hermes.api_server.capabilities', platform: 'hermes-agent', model: 'hermes-agent',
          features: { streaming: true, tool_progress: true, approvals: true, model_options: true, session_continuity_header: 'X-Hermes-Session-Id' },
          endpoints: { chat_completions: { method: 'POST', path: '/v1/chat/completions' }, model_options: { method: 'GET', path: '/api/model/options' }, run_approval: { method: 'POST', path: '/v1/runs/{run_id}/approval' } },
        });
      if (path === '/api/model/options') {
        const caps = { reasoning: true, can_disable_reasoning: true, fast: false };
        return json(req, res, 200, {
          model: 'hermes-4-405b', provider: 'nous',
          providers: [{ slug: 'nous', name: 'Nous Portal', is_current: true, authenticated: true, models: ['hermes-4-405b', 'hermes-4-70b', 'hermes-4-14b'], capabilities: { 'hermes-4-405b': caps, 'hermes-4-70b': caps, 'hermes-4-14b': caps } }],
        });
      }
      if (path === '/bridge/meta' || path === '/bridge/push/config' || path === '/bridge/voice/config') return json(req, res, 200, {});
      if (path.match(/^\/v1\/runs\/[^/]+$/)) return json(req, res, 200, { status: 'completed' });
      // the app probes this once per connection; a 404 switches the image search off and cards stay without photos
      if (path === '/bridge/images/config') return json(req, res, 200, { available: true, providers: ['demo'] });
      if (path === '/bridge/images') {
        const q = new URL(req.url, 'http://x').searchParams.get('q');
        const f = imageFor(q);
        console.log(`  image "${q}" → ${f || '–'}`);
        return json(req, res, 200, { results: f ? [{ url: `https://${IMAGE_HOST}/demo/${f}`, thumbnailUrl: `https://${IMAGE_HOST}/demo/${f}`, width: 960, height: 720, title: q, sourcePage: `https://${IMAGE_HOST}/`, sourceDomain: IMAGE_HOST, provider: 'demo' }] : [] });
      }
      if (path.startsWith('/media/')) {
        const f = normalize(join(HERE, path));
        if (f.startsWith(join(HERE, 'media')) && existsSync(f)) {
          res.writeHead(200, { 'Content-Type': TYPES[f.slice(f.lastIndexOf('.'))] || 'application/octet-stream', 'Cache-Control': 'max-age=3600', ...cors(req) });
          return res.end(readFileSync(f));
        }
      }
      console.log(`  404 ${req.method} ${path}`);
      json(req, res, 404, { error: { message: `Not found: ${path}` } });
    } catch (e) {
      console.error(e);
      if (!res.headersSent) json(req, res, 500, { error: { message: String(e) } });
      else res.end();
    }
  })
  .listen(PORT, '127.0.0.1', () => console.log(`demo-video mock on http://localhost:${PORT}/v1`));
