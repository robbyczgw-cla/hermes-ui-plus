#!/usr/bin/env node
// Zero-dependency mock of the Hermes Agent API server (v0.21.4) – see ../docs/HERMES-API.md.
// Usage: node server.mjs [--port 8787] [--route] [--fast] [--host 0.0.0.0]
import http from 'node:http';
import crypto from 'node:crypto';
import { pickScenario } from './scenarios.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const PORT = Number(opt('port', process.env.PORT || 8787));
const HOST = opt('host', '0.0.0.0');
const WITH_ROUTE = args.includes('--route');
const FAST = args.includes('--fast'); // no delays (tests)
/** --slow-ms N: fixed per-token delay for `langsam`/`slow` requests (default random 220-420 ms) */
const SLOW_MS = Number(opt('slow-ms', 0)) || 0;
const KEEPALIVE_MS = FAST ? 200 : 10000; // Hermes: 10 s
const APPROVAL_TIMEOUT_MS = FAST ? 3000 : 300000;

const MODEL = 'hermes-agent';
const sessions = new Map(); // sessionId -> turn count
const pendingApprovals = new Map(); // runId -> { requestId, resolve }

// ---- helpers -------------------------------------------------------------------------------

/** JSON.stringify with ensure_ascii (like Python json.dumps default used by Hermes). */
function jsonAscii(v) {
  return JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}
const frame = (data, event) => `${event ? `event: ${event}\n` : ''}data: ${jsonAscii(data)}\n\n`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);

/** token-ish pieces: leading-space words, long words split, punctuation/newlines separate. */
function tokenize(text) {
  const out = [];
  for (const m of text.matchAll(/\s*[\p{L}\p{N}_]+|\s*[^\s\p{L}\p{N}_]|\s+/gu)) {
    let s = m[0];
    while (s.length > 7) {
      const n = 3 + Math.floor(Math.random() * 4);
      out.push(s.slice(0, n));
      s = s.slice(n);
    }
    if (s) out.push(s);
  }
  return out;
}

function cors(req) {
  const h = {
    'Access-Control-Allow-Origin': req.headers.origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    // Deliberately more permissive than real Hermes (which omits X-Hermes-Session-Key / expose headers)
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key, X-Hermes-Session-Id, X-Hermes-Session-Key',
    'Access-Control-Expose-Headers': 'X-Hermes-Session-Id, X-Hermes-Session-Key, X-Hermes-Completed, X-Hermes-Partial, X-Hermes-Error',
    'Access-Control-Max-Age': '600',
  };
  if (req.headers.origin) h.Vary = 'Origin';
  return h;
}

function json(req, res, status, body, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...cors(req), ...extra });
  res.end(jsonAscii(body));
}

const err = (req, res, status, message, type = 'invalid_request_error', code = null, extra = {}) =>
  json(req, res, status, { error: { message, type, param: null, code } }, extra);

function authOk(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return false;
  const token = h.slice(7).trim();
  return token !== '' && token !== 'bad';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > 10_000_000) reject(new Error('too large'));
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (p && p.type === 'text' ? p.text : '')).join('');
  return '';
}

// ---- route decision (with --route) --------------------------------------------------------

function routeFor(format, ms) {
  return {
    format,
    component: undefined,
    confidence: format === 'text' ? 0.62 : 0.93,
    reason: format === 'text' ? 'Normale Konversation' : `Mock-Scenario verlangt ${format}`,
    model: 'mock-router',
    ms,
  };
}

// ---- chat completions ----------------------------------------------------------------------

async function handleChat(req, res) {
  if (!authOk(req)) {
    return err(req, res, 401, 'Invalid gateway API key (API_SERVER_KEY)', 'gateway_auth_error', 'gateway_auth_failed');
  }
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return err(req, res, 400, 'Invalid JSON in request body');
  }
  const messages = body && body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return json(req, res, 400, { error: { message: "Missing or invalid 'messages' field", type: 'invalid_request_error' } });
  }
  const convo = messages.filter((m) => m && (m.role === 'user' || m.role === 'assistant'));
  const last = convo[convo.length - 1];
  const userText = last ? contentText(last.content) : '';
  if (!userText.trim()) {
    return json(req, res, 400, { error: { message: 'No user message found in messages', type: 'invalid_request_error' } });
  }
  const systemSeen = messages.some((m) => m && m.role === 'system');

  const key = (req.headers['x-hermes-session-key'] || '').toString().trim();
  let sessionId = (req.headers['x-hermes-session-id'] || '').toString().trim();
  if (!sessionId) {
    const first = contentText((convo.find((m) => m.role === 'user') || {}).content);
    sessionId = 'api-' + crypto.createHash('sha256').update(`\n${first}`).digest('hex').slice(0, 16);
  }
  const turn = (sessions.get(sessionId) || 0) + 1;
  sessions.set(sessionId, turn);

  const { name, scenario, slow } = pickScenario(userText);
  const steps = scenario.steps({ userText, turn, sessionId });
  const completionId = 'chatcmpl-' + crypto.randomBytes(15).toString('hex').slice(0, 29);
  const created = Math.floor(Date.now() / 1000);
  const model = body.model || MODEL;
  const log = `${new Date().toISOString().slice(11, 19)} chat session=${sessionId} turn=${turn} key=${key || '-'} scenario=${name}${slow ? '+slow' : ''} system=${systemSeen ? 'yes' : 'no'}`;
  console.log(log);

  const stream = body.stream === true || body.stream === 'true' || body.stream === 1 || body.stream === '1';
  const headers = { 'X-Hermes-Session-Id': sessionId, ...(key ? { 'X-Hermes-Session-Key': key } : {}) };
  const usage = (text) => ({ prompt_tokens: 21500 + userText.length, completion_tokens: Math.ceil(text.length / 4), total_tokens: 21500 + userText.length + Math.ceil(text.length / 4) });

  if (!stream) {
    if (steps.some((s) => s.fail === 'error')) {
      return json(req, res, 502, { error: { message: 'Mock agent failure', type: 'server_error', param: null, code: 'agent_incomplete', hermes: { completed: false, partial: true, failed: true } } }, {
        ...headers, 'X-Hermes-Completed': 'false', 'X-Hermes-Partial': 'true',
      });
    }
    const text = steps.map((s) => s.text || '').join('');
    return json(req, res, 200, {
      id: completionId, object: 'chat.completion', created, model,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage: usage(text),
    }, headers);
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no', ...cors(req), ...headers,
  });
  let closed = false;
  req.on('close', () => { if (!res.writableEnded) { closed = true; console.log(`  -> client disconnected (${completionId})`); } });
  res.on('close', () => { closed = true; });
  const write = (s) => { if (!closed) res.write(s); };
  const chunk = (delta, finish = null, extra = {}) => ({
    id: completionId, object: 'chat.completion.chunk', created, model,
    choices: [{ index: 0, delta, finish_reason: finish }], ...extra,
  });
  const wait = async (ms) => {
    // sleep in slices so a disconnect aborts quickly and keepalives are emitted like Hermes
    let left = FAST ? Math.min(ms, 30) : ms;
    let sinceKeepalive = 0;
    while (left > 0 && !closed) {
      const d = Math.min(left, 100);
      await sleep(d);
      left -= d;
      sinceKeepalive += d;
      if (sinceKeepalive >= KEEPALIVE_MS) { write(': keepalive\n\n'); sinceKeepalive = 0; }
    }
  };
  const tokenDelay = () => (FAST ? 0 : slow ? (SLOW_MS || rnd(220, 420)) : rnd(12, 38));

  if (WITH_ROUTE) {
    await wait(120);
    write(frame(routeFor(scenario.format, Math.round(rnd(380, 900))), 'hermes.ui.route'));
  }
  write(frame(chunk({ role: 'assistant' })));
  await wait(FAST ? 0 : 250);

  let all = '';
  let toolSeq = 0;
  try {
    for (const step of steps) {
      if (closed) return;
      if (step.text) {
        for (const tok of tokenize(step.text)) {
          if (closed) return;
          all += tok;
          write(frame(chunk({ content: tok })));
          await sleep(tokenDelay());
        }
      } else if (step.reasoning) {
        for (const tok of tokenize(step.reasoning)) {
          write(frame(chunk({ reasoning_content: tok })));
          await sleep(tokenDelay());
        }
      } else if (step.tool) {
        const callId = `call-${crypto.randomUUID()}-${toolSeq++}`;
        write(frame({ tool: step.tool.name, emoji: step.tool.emoji, label: step.tool.label, toolCallId: callId, status: 'running' }, 'hermes.tool.progress'));
        await wait(step.tool.ms);
        write(frame({ tool: step.tool.name, toolCallId: callId, status: 'completed' }, 'hermes.tool.progress'));
      } else if (step.status) {
        write(frame(step.status, 'hermes.status'));
      } else if (step.wait) {
        await wait(step.wait);
      } else if (step.approval) {
        const requestId = crypto.randomBytes(16).toString('hex');
        const a = step.approval;
        write(frame({
          command: a.command, pattern_key: a.pattern_key, pattern_keys: a.pattern_keys, description: a.description,
          allow_permanent: true, allow_session: true, request_id: requestId,
          event: 'approval.request', run_id: completionId, timestamp: Date.now() / 1000, session_id: sessionId,
          choices: ['once', 'session', 'always', 'deny'],
        }, 'approval.request'));
        const choice = await new Promise((resolve) => {
          const t = setTimeout(() => { pendingApprovals.delete(completionId); resolve('timeout'); }, APPROVAL_TIMEOUT_MS);
          pendingApprovals.set(completionId, { requestId, resolve: (c) => { clearTimeout(t); pendingApprovals.delete(completionId); resolve(c); } });
          const ka = setInterval(() => { if (closed || !pendingApprovals.has(completionId)) clearInterval(ka); else write(': keepalive\n\n'); }, KEEPALIVE_MS);
          res.on('close', () => { clearInterval(ka); clearTimeout(t); pendingApprovals.delete(completionId); resolve('timeout'); });
        });
        if (closed) return;
        const followUp = choice === 'deny' || choice === 'timeout'
          ? [{ text: `\n\nOkay, der Befehl wurde ${choice === 'deny' ? 'abgelehnt' : 'nicht freigegeben (Zeitüberschreitung)'}; ich lasse alles unverändert.` }]
          : [{ tool: { name: 'terminal', label: a.command, emoji: '\u{1F4BB}', ms: 800 } }, { text: `\n\nErledigt (Freigabe: \`${choice}\`).` }];
        steps.push(...followUp);
      } else if (step.fail === 'drop') {
        console.log('  -> dropping connection');
        res.socket && res.socket.destroy();
        return;
      } else if (step.fail === 'error') {
        write(frame(chunk({}, 'error', {
          usage: usage(all),
          error: { message: 'Mock agent error: Tool terminal wurde mit Exit-Code 1 beendet.', type: 'agent_error' },
          hermes: { completed: false, partial: true, failed: true, error: 'Mock agent error: Tool terminal wurde mit Exit-Code 1 beendet.', error_code: 'agent_error' },
        })));
        write('data: [DONE]\n\n');
        res.end();
        return;
      }
    }
  } finally {
    if (closed) return;
  }
  write(frame(chunk({}, 'stop', { usage: usage(all) })));
  write('data: [DONE]\n\n');
  res.end();
}

// ---- other endpoints -----------------------------------------------------------------------

async function handleApproval(req, res, runId) {
  if (!authOk(req)) return err(req, res, 401, 'Invalid gateway API key (API_SERVER_KEY)', 'gateway_auth_error', 'gateway_auth_failed');
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return err(req, res, 400, 'Invalid JSON'); }
  const raw = String(body.choice || '').trim().toLowerCase();
  const choice = { approve: 'once', approved: 'once', allow: 'once' }[raw] || raw;
  if (!['once', 'session', 'always', 'deny'].includes(choice)) {
    return err(req, res, 400, 'Invalid approval choice; expected one of: always, deny, once, session', 'invalid_request_error', 'invalid_approval_choice');
  }
  const p = pendingApprovals.get(runId);
  if (!p) return err(req, res, 409, `Run has no pending approval: ${runId}`, 'invalid_request_error', 'approval_not_pending');
  if (body.request_id && body.request_id !== p.requestId) {
    return err(req, res, 409, `Run has no pending approval: ${runId}`, 'invalid_request_error', 'approval_not_pending');
  }
  p.resolve(choice);
  json(req, res, 200, { object: 'hermes.run.approval_response', run_id: runId, choice, request_id: p.requestId, resolved: 1 });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') {
      res.writeHead(200, cors(req));
      return res.end();
    }
    if (req.method === 'GET' && (path === '/health' || path === '/v1/health')) {
      return json(req, res, 200, { status: 'ok', platform: 'hermes-agent', version: 'mock-0.21.4' });
    }
    if (req.method === 'GET' && path === '/v1/models') {
      if (!authOk(req)) return err(req, res, 401, 'Invalid gateway API key (API_SERVER_KEY)', 'gateway_auth_error', 'gateway_auth_failed');
      const now = Math.floor(Date.now() / 1000);
      const m = (id, parent) => ({ id, object: 'model', created: now, owned_by: 'hermes', permission: [], root: id, parent });
      return json(req, res, 200, { object: 'list', data: [m(MODEL, null), m('grok-4.5', MODEL)] });
    }
    if (req.method === 'POST' && path === '/v1/chat/completions') return await handleChat(req, res);
    const am = path.match(/^\/v1\/runs\/([^/]+)\/approval$/);
    if (req.method === 'POST' && am) return await handleApproval(req, res, decodeURIComponent(am[1]));
    err(req, res, 404, `Not found: ${req.method} ${path}`, 'invalid_request_error', 'not_found');
  } catch (e) {
    console.error('handler error', e);
    if (!res.headersSent) err(req, res, 500, `Internal server error: ${e.message}`, 'server_error');
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Hermes mock server on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/v1  (route events: ${WITH_ROUTE ? 'on' : 'off'}${FAST ? ', fast' : ''})`);
  console.log('Any Bearer key works except "bad" (-> 401).');
});
