/// <reference types="node" />
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  addApproval,
  applyRunStatus,
  approvalKey,
  closePending,
  createExpiryTimer,
  dismissApproval,
  expireAll,
  expireApprovals,
  isLive,
  pendingOf,
  resolveApproval,
  resolveDeadline,
  restoreCandidates,
  withDeadline,
  DEFAULT_APPROVAL_TIMEOUT_S,
} from './approvals.ts';
import { applyEvent, createAssistantMessage, finalize } from './chatState.ts';
import { markInterrupted, recoveredMessage, resumeCutOff } from './recovery.ts';
import { answerApprovalCore, fetchRunStatusCore } from './stream.ts';
import { parseCapabilities } from './capabilities.ts';
import { stripMessage } from '../conversations/messages.ts';
import type { ApprovalRequest, ChatMessage, HermesConn } from './types';

const T0 = 1_800_000_000_000;
const conn: HermesConn = { baseUrl: 'http://bridge.test/v1', apiKey: 'tok' };

const req = (id: string, over: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  runId: 'chatcmpl-1',
  requestId: id,
  command: `rm -rf build-${id}/`,
  description: 'recursive delete',
  choices: ['once', 'session', 'always', 'deny'],
  timestamp: T0 / 1000,
  ...over,
});

const live = (a: ApprovalRequest, now = T0) => withDeadline(a, { receivedAt: now });

function streamingMsg(over: Partial<ChatMessage> = {}): ChatMessage {
  return { ...createAssistantMessage(T0), id: 'a1', completionId: 'chatcmpl-1', ...over };
}

type Call = { url: string; init: { method: string; headers: Record<string, string>; body?: string } };
function fakeFetch(make: () => Response) {
  const calls: Call[] = [];
  const fn = async (url: string, init: Call['init']) => {
    calls.push({ url, init });
    return make() as never;
  };
  return { fn, calls };
}

// ---------------------------------------------------------------- deadline

test('deadline: server expires_at > event/advertised timeout > 300 s default', () => {
  assert.equal(resolveDeadline(req('a'), { receivedAt: T0 }), T0 + DEFAULT_APPROVAL_TIMEOUT_S * 1000);
  assert.equal(resolveDeadline(req('a'), { receivedAt: T0, advertisedTimeoutS: 120 }), T0 + 120_000);
  assert.equal(resolveDeadline(req('a', { timeoutSeconds: 60 }), { receivedAt: T0, advertisedTimeoutS: 120 }), T0 + 60_000);
  assert.equal(resolveDeadline(req('a', { expiresAt: T0 + 42_000 }), { receivedAt: T0, advertisedTimeoutS: 120 }), T0 + 42_000);
  // received 2 s after the server timestamp: the server clock started the wait
  assert.equal(resolveDeadline(req('a'), { receivedAt: T0 + 2000 }), T0 + 300_000);
  // device clock 10 min off: count from receipt, not from the foreign timestamp
  assert.equal(resolveDeadline(req('a'), { receivedAt: T0 + 600_000 }), T0 + 600_000 + 300_000);
});

test('deadline of a restored request: age measured on the server clock (Date header)', () => {
  // request 200 s old on the server; device clock 1 h ahead of the server
  const deviceNow = T0 + 3_600_000 + 200_000;
  const serverNow = T0 + 200_000;
  const d = resolveDeadline(req('a'), { receivedAt: deviceNow, restored: { serverNowMs: serverNow } });
  assert.equal(d, deviceNow + 100_000); // 100 s left
  // without a Date header: the server timestamp is trusted
  assert.equal(resolveDeadline(req('a'), { receivedAt: T0 + 200_000, restored: {} }), T0 + 300_000);
});

test('capabilities: advertised approvals.timeout is read; Hermes v0.21 (none) stays undefined', () => {
  assert.equal(parseCapabilities({ features: { run_status: true }, approvals: { timeout: 180 } })?.approvalTimeoutSeconds, 180);
  assert.equal(parseCapabilities({ features: { run_status: true, approval_timeout: 90 } })?.approvalTimeoutSeconds, 90);
  assert.equal(parseCapabilities({ features: { run_status: true, approval_events: true } })?.approvalTimeoutSeconds, undefined);
});

// ---------------------------------------------------------------- queue

test('queue: parallel requests are kept separately, answered independently; duplicates ignored', () => {
  let m = streamingMsg();
  m = applyEvent(m, { type: 'approval', approval: live(req('r1')) }, T0);
  m = applyEvent(m, { type: 'approval', approval: live(req('r2')) }, T0 + 10);
  m = applyEvent(m, { type: 'approval', approval: live(req('r2')) }, T0 + 20); // replay / restore of the same request
  assert.deepEqual(pendingOf(m).map((a) => a.requestId), ['r1', 'r2']);
  assert.equal(m.approval?.requestId, 'r1', 'head mirrored for older readers');
  m = resolveApproval(m, 'r2', 'deny', T0 + 30);
  assert.deepEqual(pendingOf(m).map((a) => a.requestId), ['r1']);
  m = resolveApproval(m, 'r1', 'session', T0 + 40);
  assert.equal(pendingOf(m).length, 0);
  assert.equal(m.approval, undefined);
  assert.deepEqual(m.approvalLog?.map((r) => [r.requestId, r.outcome]), [['r2', 'deny'], ['r1', 'session']]);
  // an answered request never comes back (late GET /v1/runs with the old status)
  assert.equal(addApproval(m, live(req('r1')), T0 + 50), m);
  const answers = m.trace?.filter((s) => s.kind === 'approval_answer').map((s) => s.text);
  assert.deepEqual(answers, ['deny', 'session']);
});

test('finish closes still-open requests: expired after the deadline, else cancelled', () => {
  let m = streamingMsg();
  m = applyEvent(m, { type: 'approval', approval: live(req('r1')) }, T0);
  m = applyEvent(m, { type: 'finish', reason: 'stop' }, T0 + 400_000);
  assert.equal(pendingOf(m).length, 0);
  assert.equal(m.approvalLog?.[0].outcome, 'expired');
  let s = applyEvent(streamingMsg(), { type: 'approval', approval: live(req('r2')) }, T0);
  s = finalize(s, 'stopped', undefined, T0 + 5000); // user stop: the bridge stop cancels the run
  assert.equal(s.approvalLog?.[0].outcome, 'cancelled');
});

// ---------------------------------------------------------------- restore

test('restore after a stream drop: the interrupted turn keeps its live card', () => {
  let m = applyEvent(streamingMsg(), { type: 'approval', approval: live(req('r1')) }, T0);
  m = markInterrupted(m, T0 + 5000);
  assert.equal(m.status, 'stopped');
  assert.equal(typeof m.interrupted, 'number');
  assert.equal(pendingOf(m)[0]?.requestId, 'r1', 'recovery must not clear a pending approval');
  assert.equal(m.approvalLog, undefined);
  // the answer arrives later (stored session): the run is over, the open request gets a history row
  const done = recoveredMessage(m, { ...m, text: 'Fertig.', status: 'done', interrupted: undefined, pendingApprovals: undefined, approval: undefined });
  assert.equal(pendingOf(done).length, 0);
  assert.equal(done.approvalLog?.length, 1);
});

test('restore after app restart / chat switch: GET /v1/runs rebuilds the card as live', () => {
  // persisted mid-stream: approval stripped, message stored as stopped without endedAt
  const stored = stripMessage(applyEvent(streamingMsg(), { type: 'approval', approval: live(req('r1')) }, T0));
  assert.equal(stored.approval, undefined);
  assert.equal(stored.pendingApprovals, undefined);
  const list = resumeCutOff([{ id: 'u1', role: 'user', text: 'räum auf', tools: [], status: 'done', createdAt: T0 }, stored]);
  const now = T0 + 60_000;
  assert.deepEqual(restoreCandidates(list, now), [1]);
  const restored = applyRunStatus(list[1], { status: 'waiting_for_approval', approval: req('r1'), serverNowMs: now }, now);
  const a = pendingOf(restored)[0];
  assert.equal(a?.requestId, 'r1');
  assert.equal(a?.restored, true);
  assert.ok(isLive(a, now));
  assert.equal(a.deadlineAt, T0 + 300_000, 'deadline from the original request time, not from the restore');
  // same status polled again: no duplicate
  assert.equal(pendingOf(applyRunStatus(restored, { status: 'waiting_for_approval', approval: req('r1'), serverNowMs: now }, now)).length, 1);
  // run ended meanwhile: the queue is closed
  assert.equal(pendingOf(applyRunStatus(restored, { status: 'completed' }, now)).length, 0);
  // `running` (e.g. a parallel request was answered) keeps the queue
  assert.equal(pendingOf(applyRunStatus(restored, { status: 'running' }, now)).length, 1);
});

test('restore: a stale waiting status past the deadline is not a live card but an "expired" history row', () => {
  const m = streamingMsg({ status: 'stopped', interrupted: T0 });
  const now = T0 + 301_000;
  const r = applyRunStatus(m, { status: 'waiting_for_approval', approval: req('r1'), serverNowMs: now }, now);
  assert.equal(pendingOf(r).length, 0);
  assert.equal(r.approvalLog?.[0].outcome, 'expired');
  // polled again: still one row
  assert.equal(applyRunStatus(r, { status: 'waiting_for_approval', approval: req('r1'), serverNowMs: now }, now).approvalLog?.length, 1);
});

test('restoreCandidates: only young assistant turns with a completion id that may still run', () => {
  const now = T0 + 60_000;
  const done: ChatMessage = { ...streamingMsg({ id: 'd' }), status: 'done', metrics: { endedAt: T0 } };
  const old: ChatMessage = { ...streamingMsg({ id: 'o' }), status: 'stopped', interrupted: T0, createdAt: T0 - 3_600_000 };
  const noId: ChatMessage = { ...streamingMsg({ id: 'n' }), completionId: undefined, status: 'stopped', interrupted: T0 };
  const cut: ChatMessage = { ...streamingMsg({ id: 'c' }), status: 'stopped', interrupted: T0 };
  assert.deepEqual(restoreCandidates([done, old, noId, cut], now), [3]);
});

test('fetchRunStatusCore: GET /v1/runs/{id} via the bridge, approval mapped, Date header kept; 404 = not_found', async () => {
  const body = {
    object: 'hermes.run',
    run_id: 'chatcmpl-1',
    status: 'waiting_for_approval',
    approval: { event: 'approval.request', run_id: 'chatcmpl-1', request_id: 'r9', command: 'rm -rf build/', description: 'delete', choices: ['once', 'session', 'deny'], timestamp: T0 / 1000 },
  };
  const f = fakeFetch(() => new Response(JSON.stringify(body), { headers: { date: new Date(T0 + 5000).toUTCString() } }));
  const st = await fetchRunStatusCore(f.fn, conn, 'chatcmpl-1');
  assert.equal(f.calls[0].url, 'http://bridge.test/v1/runs/chatcmpl-1');
  assert.equal(f.calls[0].init.method, 'GET');
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer tok');
  assert.equal(st.status, 'waiting_for_approval');
  assert.equal(st.approval?.requestId, 'r9');
  assert.deepEqual(st.approval?.choices, ['once', 'session', 'deny']);
  assert.equal(st.serverNowMs, T0 + 5000);
  const g = fakeFetch(() => new Response('{"error":{"message":"not found"}}', { status: 404 }));
  assert.deepEqual(await fetchRunStatusCore(g.fn, conn, 'chatcmpl-x'), { status: 'not_found' });
});

// ---------------------------------------------------------------- expiry

test('expiry with fake timers: card marked expired at the deadline, logged once, buttons blocked', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let clock = T0;
    let list: ChatMessage[] = [applyEvent(streamingMsg(), { type: 'approval', approval: live(req('r1')) }, T0)];
    const timer = createExpiryTimer(
      (now) => {
        list = expireAll(list, now);
      },
      { now: () => clock }
    );
    timer.update(list);
    clock = T0 + 299_000;
    mock.timers.tick(299_000);
    assert.equal(pendingOf(list[0])[0].expired, undefined, 'not yet');
    clock = T0 + 300_000;
    mock.timers.tick(1000);
    const a = pendingOf(list[0])[0];
    assert.equal(a.expired, true, 'card stays, marked expired');
    assert.equal(isLive(a, clock), false);
    assert.deepEqual(list[0].approvalLog?.map((r) => r.outcome), ['expired']);
    timer.update(list); // nothing live → no new timer
    mock.timers.tick(1_000_000);
    assert.equal(list[0].approvalLog?.length, 1);
    // closing the expired card adds no second row
    const closed = dismissApproval(list[0], 'r1', clock);
    assert.equal(pendingOf(closed).length, 0);
    assert.equal(closed.approvalLog?.length, 1);
    timer.dispose();
  } finally {
    mock.timers.reset();
  }
});

test('expireApprovals: only the due request of a queue expires', () => {
  let m = applyEvent(streamingMsg(), { type: 'approval', approval: withDeadline(req('r1'), { receivedAt: T0, advertisedTimeoutS: 60 }) }, T0);
  m = applyEvent(m, { type: 'approval', approval: live(req('r2')) }, T0);
  m = expireApprovals(m, T0 + 61_000);
  assert.deepEqual(pendingOf(m).map((a) => [a.requestId, !!a.expired]), [['r1', true], ['r2', false]]);
  assert.equal(m.approval?.requestId, 'r2', 'head = first answerable request');
  assert.equal(closePending(m, T0 + 62_000).approvalLog?.map((r) => r.outcome).join(), 'expired,cancelled');
});

// ---------------------------------------------------------------- late tap

test('late-tap guard: after the deadline no request is sent and the error explains it', async () => {
  const f = fakeFetch(() => new Response('{"resolved":1}'));
  const a = live(req('r1'));
  await assert.rejects(answerApprovalCore(f.fn, conn, a, 'once', T0 + 300_000), (e: { code?: string; text?: { key: string } }) => {
    assert.equal(e.code, 'approval_expired');
    assert.equal(e.text?.key, 'approvals.error.expired');
    return true;
  });
  await assert.rejects(answerApprovalCore(f.fn, conn, { ...a, expired: true }, 'deny', T0 + 1000), { code: 'approval_expired' });
  await assert.rejects(answerApprovalCore(f.fn, conn, undefined, 'deny', T0), { code: 'approval_not_pending' });
  assert.equal(f.calls.length, 0, 'nothing may reach Hermes');
  await answerApprovalCore(f.fn, conn, a, 'once', T0 + 1000);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'http://bridge.test/v1/runs/chatcmpl-1/approval');
  assert.deepEqual(JSON.parse(f.calls[0].init.body!), { choice: 'once', request_id: 'r1' });
});

test('idempotent retry: "not pending" after a dropped attempt with the SAME choice counts as answered', async () => {
  const gone = () => new Response('{"error":{"message":"Run has no pending approval","code":"approval_not_pending"}}', { status: 409 });
  const a = live(req('r1'));
  // the first POST reached Hermes but the answer got lost; the retry finds nothing pending → success
  await answerApprovalCore(fakeFetch(gone).fn, conn, a, 'once', T0 + 1000, { retryOf: 'once' });
  // no earlier attempt, or a different choice than the one that may have gone through → still an error
  await assert.rejects(answerApprovalCore(fakeFetch(gone).fn, conn, a, 'once', T0 + 1000), { code: 'approval_not_pending' });
  await assert.rejects(answerApprovalCore(fakeFetch(gone).fn, conn, a, 'deny', T0 + 1000, { retryOf: 'once' }), { code: 'approval_not_pending' });
  // other server errors are never swallowed
  const boom = fakeFetch(() => new Response('{"error":{"message":"x"}}', { status: 500 }));
  await assert.rejects(answerApprovalCore(boom.fn, conn, a, 'once', T0 + 1000, { retryOf: 'once' }));
});

// ---------------------------------------------------------------- history

test('history: every outcome is a persisted row that survives stripMessage + JSON', () => {
  let m = applyEvent(streamingMsg(), { type: 'approval', approval: live(req('r1', { command: 'rm -rf build/' })) }, T0);
  m = applyEvent(m, { type: 'approval', approval: live(req('r2')) }, T0);
  m = resolveApproval(m, 'r1', 'once', T0 + 1000);
  m = applyEvent(m, { type: 'finish', reason: 'stop' }, T0 + 2000);
  const back = JSON.parse(JSON.stringify(stripMessage(m))) as ChatMessage;
  assert.deepEqual(
    back.approvalLog?.map((r) => [r.command, r.outcome]),
    [
      ['rm -rf build/', 'once'],
      ['rm -rf build-r2/', 'cancelled'],
    ]
  );
  assert.equal(back.pendingApprovals, undefined);
  assert.ok(back.trace?.some((s) => s.kind === 'approval_answer' && s.text === 'once'), 'timeline step kept too');
  assert.equal(approvalKey(req('x')), 'x');
});
