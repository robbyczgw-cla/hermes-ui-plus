/// <reference types="node" />
// Runs mock-server/server.mjs (--fast) and drives it with the real streaming core.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { streamChatCore, respondApprovalCore } from './stream.ts';
import { normalizeNode } from '../protocol/validate.ts';
import type { FetchLike } from './stream.ts';
import type { HermesConn, HermesEvent } from './types';

let proc: ChildProcess;
let base = '';
let routeBase = '';
let routeProc: ChildProcess;
const fetchImpl = fetch as unknown as FetchLike;

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
}

async function start(extra: string[]): Promise<{ proc: ChildProcess; port: number }> {
  const port = await freePort();
  const script = fileURLToPath(new URL('../../../mock-server/server.mjs', import.meta.url));
  const p = spawn(process.execPath, [script, '--port', String(port), '--host', '127.0.0.1', '--fast', ...extra], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve, reject) => {
    p.once('error', reject);
    p.stdout!.on('data', (d: Buffer) => {
      if (String(d).includes('Hermes mock server')) resolve();
    });
  });
  p.stdout!.resume();
  return { proc: p, port };
}

before(async () => {
  const a = await start([]);
  proc = a.proc;
  base = `http://127.0.0.1:${a.port}/v1`;
  const b = await start(['--route']);
  routeProc = b.proc;
  routeBase = `http://127.0.0.1:${b.port}/v1`;
});
after(() => {
  proc.kill();
  routeProc.kill();
});

const conn = (baseUrl: string): HermesConn => ({ baseUrl, apiKey: 'anything', sessionKey: 'hermes-ui-dev' });

async function ask(text: string, baseUrl = base, sessionId = 's-' + Math.random().toString(16).slice(2)) {
  const events: HermesEvent[] = [];
  const result = await streamChatCore(fetchImpl, { conn: conn(baseUrl), text, sessionId, onEvent: (e) => events.push(e) });
  return { events, result };
}

function huiBlocks(text: string): unknown[] {
  return [...text.matchAll(/```hui\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1]));
}

test('health + models + 401 for key "bad"', async () => {
  const root = base.replace(/\/v1$/, '');
  assert.equal(((await (await fetch(root + '/health')).json()) as { status: string }).status, 'ok');
  assert.equal((await fetch(base + '/models', { headers: { Authorization: 'Bearer ok' } })).status, 200);
  const r = await fetch(base + '/models', { headers: { Authorization: 'Bearer bad' } });
  assert.equal(r.status, 401);
  assert.equal(((await r.json()) as { error: { code: string } }).error.code, 'gateway_auth_failed');
  const e = await ask('hi', base).catch(() => null);
  assert.ok(e);
  await assert.rejects(
    streamChatCore(fetchImpl, { conn: { baseUrl: base, apiKey: 'bad' }, text: 'x', sessionId: 's', onEvent: () => {} }),
    (x: { kind: string }) => x.kind === 'auth'
  );
});

test('CORS preflight allows the Hermes headers', async () => {
  const r = await fetch(base + '/chat/completions', { method: 'OPTIONS', headers: { Origin: 'http://localhost:8081' } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('access-control-allow-headers') ?? '', /X-Hermes-Session-Key/);
});

test('plain scenario counts turns per session (session continuation)', async () => {
  const sid = 'cont-' + Math.random().toString(16).slice(2);
  const a = await ask('Hallo', base, sid);
  const b = await ask('Nochmal', base, sid);
  assert.match(a.result.text, /Nachricht 1 /);
  assert.match(b.result.text, /Nachricht 2 /);
  assert.equal(b.result.sessionId, sid);
  assert.equal(b.result.finishReason, 'stop');
});

test('every hui scenario yields valid HuiNodes', async () => {
  const cases: [string, string][] = [
    ['zeig ein chart', 'chart'],
    ['tabelle bitte', 'table'],
    ['kennzahlen', 'stats'],
    ['vergleich der tarife', 'compare'],
    ['ein formular', 'form'],
    ['schritte zur installation', 'steps'],
    ['timeline meiner reise', 'timeline'],
    ['buttons und vorschläge', 'buttons'],
    ['gemischter bericht', 'list'],
  ];
  for (const [prompt, type] of cases) {
    const { result } = await ask(prompt);
    const nodes = huiBlocks(result.text);
    assert.ok(nodes.length > 0, `${prompt}: no hui block`);
    for (const n of nodes) assert.ok(normalizeNode(n), `${prompt}: invalid node ${JSON.stringify(n).slice(0, 80)}`);
    if (type !== 'list') assert.ok(nodes.some((n) => (n as { type: string }).type === type), `${prompt}: expected ${type}`);
  }
});

test('calculator / mixed produce hui-html blocks; long answer is long', async () => {
  const calc = await ask('öffne den rechner');
  assert.match(calc.result.text, /```hui-html\n<div class="calc">[\s\S]*<\/script>\n<\/div>\n```/);
  const mixed = await ask('gemischter bericht');
  assert.match(mixed.result.text, /```hui-html/);
  assert.ok(mixed.events.some((e) => e.type === 'tool'));
  const long = await ask('eine lange antwort');
  assert.ok(long.result.text.length > 8000);
});

test('tool scenario: running then done with same call id, reasoning, text order', async () => {
  const { events } = await ask('wie spät ist es');
  const tools = events.filter((e) => e.type === 'tool') as Extract<HermesEvent, { type: 'tool' }>[];
  assert.deepEqual(tools.map((t) => t.status), ['running', 'done']);
  assert.equal(tools[0].callId, tools[1].callId);
  assert.equal(tools[0].label, 'date');
  assert.ok(events.some((e) => e.type === 'reasoning'));
});

test('error scenario: error finish chunk after partial text, no throw', async () => {
  const { result, events } = await ask('provoziere einen fehler');
  assert.equal(result.finishReason, 'error');
  assert.match(result.error ?? '', /Mock agent error/);
  assert.ok(result.text.length > 10);
  assert.ok(events.some((e) => e.type === 'done'));
});

test('drop scenario: connection dies mid-stream -> HermesError', async () => {
  await assert.rejects(ask('abbruch bitte'), (e: { kind: string }) => ['stream', 'network'].includes(e.kind));
});

test('--route emits hermes.ui.route before the first token', async () => {
  const { events } = await ask('zeig ein chart', routeBase);
  assert.equal(events[0].type, 'route');
  assert.equal((events[0] as { route: { format: string } }).route.format, 'chart');
  assert.equal(events[1].type, 'start');
  const plain = await ask('zeig ein chart', base);
  assert.ok(!plain.events.some((e) => e.type === 'route'));
});

test('approval round trip: stream blocks until POST /runs/{id}/approval', async () => {
  const events: HermesEvent[] = [];
  let approvalResponse: Promise<void> | undefined;
  const result = await streamChatCore(fetchImpl, {
    conn: conn(base),
    text: 'brauche eine freigabe',
    sessionId: 'ap-1',
    onEvent: (e) => events.push(e),
    onApproval: (a) => {
      approvalResponse = respondApprovalCore(fetchImpl, conn(base), a, 'once');
    },
  });
  await approvalResponse;
  assert.equal(result.finishReason, 'stop');
  assert.match(result.text, /Erledigt \(Freigabe: `once`\)/);
  const ap = events.find((e) => e.type === 'approval') as Extract<HermesEvent, { type: 'approval' }>;
  assert.equal(ap.approval.runId, result.completionId);
  assert.deepEqual(ap.approval.choices, ['once', 'session', 'always', 'deny']);
  // answering again -> 409
  await assert.rejects(
    respondApprovalCore(fetchImpl, conn(base), ap.approval, 'once'),
    (e: { code?: string }) => e.code === 'approval_not_pending'
  );
});

test('client abort stops the stream (slow scenario)', async () => {
  const ctrl = new AbortController();
  let n = 0;
  const r = await streamChatCore(fetchImpl, {
    conn: conn(base),
    text: 'eine lange antwort',
    sessionId: 'ab-1',
    signal: ctrl.signal,
    onEvent: (e) => {
      if (e.type === 'text' && ++n === 5) ctrl.abort();
    },
  });
  assert.equal(r.aborted, true);
});
