import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConversationMeta } from '../conversations/types.ts';
import type { FetchLike } from '../hermes/stream.ts';
import { readInbox } from './api.ts';
import {
  checkApprovalOf,
  INTENT_TTL_MS,
  openPendingApproval,
  parseApprovalNotice,
  parseApprovalResolved,
  registerApprovalOpener,
  routeApproval,
  routeApprovalResolved,
  type ApprovalNotice,
  type ApprovalRouteDeps,
} from './approvalInbox.ts';
import { parseTarget } from './model.ts';

const profile = { id: 'p-h', kind: 'hermes', model: undefined };
const conv = (id: string, sessionId: string): ConversationMeta =>
  ({ id, title: id, titleSource: 'auto', profileId: 'p-h', profileKind: 'hermes', hermesSessionId: sessionId, createdAt: 1, updatedAt: 1, preview: 'x', messageCount: 2 }) as ConversationMeta;
const wire = (o: Record<string, unknown> = {}) =>
  JSON.stringify({ kind: 'approval', id: 'a_req-1', sessionId: 'hui-a', runId: 'chatcmpl-1', completionId: 'chatcmpl-1', requestId: 'req-1', command: 'rm -rf /tmp/x', expiresAt: 400_000, timestamp: 100_000, source: 'api_server', ...o });

function setup(activeId?: string) {
  const log: string[] = [];
  const deps: ApprovalRouteDeps = {
    controller: { list: () => [conv('c-a', 'hui-a'), conv('c-b', 'hui-b')] },
    activeId: () => activeId,
    banner: (n, c) => log.push(`banner:${n.requestId}:${c}`),
    clearBanner: (id) => log.push(`clear:${id}`),
    openPending: (c, run) => log.push(`open:${c}:${run}`),
    checkPending: (c, run) => log.push(`check:${c}:${run}`),
  };
  return { deps, log };
}

test('parse approval / approval_resolved events (fields, defaults, garbage)', () => {
  const n = parseApprovalNotice(wire({ risk: 'high', description: 'delete in root path' }))!;
  assert.deepEqual([n.requestId, n.runId, n.sessionId, n.command, n.risk, n.expiresAt, n.description], ['req-1', 'chatcmpl-1', 'hui-a', 'rm -rf /tmp/x', 'high', 400_000, 'delete in root path']);
  assert.equal(parseApprovalNotice(wire({ risk: 'weird' }))!.risk, undefined);
  assert.equal(parseApprovalNotice(wire({ runId: undefined, completionId: 'chatcmpl-9' }))!.runId, 'chatcmpl-9');
  assert.equal(parseApprovalNotice(wire({ requestId: undefined })), null);
  assert.equal(parseApprovalNotice('nope'), null);
  assert.deepEqual(parseApprovalResolved(JSON.stringify({ requestId: 'req-1', runId: 'chatcmpl-1', sessionId: 'hui-a', reason: 'answered', choice: 'deny' })), {
    requestId: 'req-1', runId: 'chatcmpl-1', sessionId: 'hui-a', reason: 'answered', choice: 'deny',
  });
  assert.equal(parseApprovalResolved('{}'), null);
});

test('approval of ANOTHER chat shows the banner with the owning conversation', () => {
  const { deps, log } = setup('c-b');
  assert.equal(routeApproval(deps, profile, parseApprovalNotice(wire())!, 150_000), 'banner');
  assert.deepEqual(log, ['banner:req-1:c-a']);
});

test('approval of the OPEN chat: no banner, the card is rebuilt', () => {
  const { deps, log } = setup('c-a');
  assert.equal(routeApproval(deps, profile, parseApprovalNotice(wire())!, 150_000), 'open-chat');
  assert.deepEqual(log, ['open:c-a:chatcmpl-1']);
});

test('unknown session still gets a banner (Öffnen fetches the session); expired estimates are ignored', () => {
  const { deps, log } = setup('c-a');
  assert.equal(routeApproval(deps, profile, parseApprovalNotice(wire({ sessionId: 'hui-new' }))!, 150_000), 'banner');
  assert.equal(routeApproval(deps, profile, parseApprovalNotice(wire({ sessionId: null }))!, 150_000), 'banner');
  assert.deepEqual(log, ['banner:req-1:undefined', 'banner:req-1:undefined']);
  assert.equal(routeApproval(deps, profile, parseApprovalNotice(wire())!, 400_000 + 60_000), 'ignored');
  assert.equal(log.length, 2);
});

test('approval_resolved dismisses the banner and makes the owning chat re-check', () => {
  const { deps, log } = setup('c-b');
  routeApprovalResolved(deps, profile, parseApprovalResolved(JSON.stringify({ requestId: 'req-1', runId: 'chatcmpl-1', sessionId: 'hui-a' }))!);
  routeApprovalResolved(deps, profile, parseApprovalResolved(JSON.stringify({ requestId: 'req-2' }))!);
  assert.deepEqual(log, ['clear:req-1', 'check:c-a:chatcmpl-1', 'clear:req-2']);
});

test('openPendingApproval: delivered to the mounted chat, or kept until it mounts (notification tap on a cold start)', () => {
  const calls: string[] = [];
  const opener = { open: (r?: string) => calls.push(`open:${r}`), check: (r?: string) => void calls.push(`check:${r}`) };
  openPendingApproval('c-1', 'run-1', 1_000); // chat not mounted yet
  assert.deepEqual(calls, []);
  const off = registerApprovalOpener('c-1', opener, 2_000);
  assert.deepEqual(calls, ['open:run-1']);
  openPendingApproval('c-1', 'run-2');
  checkApprovalOf('c-1', 'run-2');
  assert.deepEqual(calls, ['open:run-1', 'open:run-2', 'check:run-2']);
  off();
  openPendingApproval('c-1', 'run-3', 3_000); // unmounted again -> remembered, not lost
  const off2 = registerApprovalOpener('c-1', opener, 3_500);
  assert.equal(calls.at(-1), 'open:run-3');
  off2();
  openPendingApproval('c-2', 'run-old', 1_000); // a stale tap is not replayed
  registerApprovalOpener('c-2', opener, 1_000 + INTENT_TTL_MS + 1)();
  assert.equal(calls.filter((c) => c === 'open:run-old').length, 0);
});

test('notification data of the bridge push parses into an approval target', () => {
  const t = parseTarget({ v: '1', kind: 'approval', profileId: 'p-h', src: 'hermes', sessionId: 'hui-a', source: 'api_server', runId: 'chatcmpl-1', requestId: 'req-1' });
  assert.deepEqual([t?.kind, t?.profileId, t?.sessionId, t?.runId, t?.requestId], ['approval', 'p-h', 'hui-a', 'chatcmpl-1', 'req-1']);
  assert.equal(parseTarget({ kind: 'message', profileId: 'p-h', src: 'hermes', sessionId: 'hui-a' })?.kind, undefined);
  // Android: expo delivers `body` as a JSON string
  assert.equal(parseTarget({ body: JSON.stringify({ kind: 'approval', profileId: 'p-h', src: 'hermes', runId: 'r' }) })?.runId, 'r');
});

test('inbox reader hands hui.approval / hui.approval_resolved to their callbacks (not to onEvent)', async () => {
  const frames = [
    `event: hui.ready\ndata: {}\n\nevent: hui.approval\ndata: ${wire()}\n\nevent: hui.appro`,
    `val_resolved\ndata: ${JSON.stringify({ requestId: 'req-1', reason: 'answered' })}\n\nevent: hui.message\ndata: {"id":"m","content":"hi","timestamp":1}\n\n`,
  ];
  const f: FetchLike = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => '', body: new ReadableStream({ start(c) { for (const x of frames) c.enqueue(new TextEncoder().encode(x)); c.close(); } }) }) as never;
  const seen: string[] = [];
  const n: ApprovalNotice[] = [];
  await readInbox(f, 'https://x/bridge/inbox/stream', 'k', {
    signal: new AbortController().signal,
    onEvent: (e) => seen.push(`msg:${e.id}`),
    onApproval: (a) => { n.push(a); seen.push(`approval:${a.requestId}`); },
    onApprovalResolved: (r) => seen.push(`resolved:${r.requestId}:${r.reason}`),
  });
  assert.deepEqual(seen, ['approval:req-1', 'resolved:req-1:answered', 'msg:m']);
  assert.equal(n[0].command, 'rm -rf /tmp/x');
});
