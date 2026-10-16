/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adoptReplay, canReattach, covers, failedReattach, replayBase, resumedStreaming, withoutResumable } from './reattach.ts';
import { applyEvent } from './chatState.ts';
import { createRecovery, REATTACH_DELAYS_MS, RECOVERY_DELAYS_MS } from './recovery.ts';
import type { ChatMessage } from './types';
import { addApproval, approvalKey, pendingOf, resolveApproval, withDeadline } from './approvals.ts';

const user: ChatMessage = { id: 'u1', role: 'user', text: 'Frage', tools: [], status: 'done', createdAt: 1000 };
const cut: ChatMessage = {
  id: 'a1', role: 'assistant', text: 'Teil', tools: [{ id: 'call-1', name: 'terminal', label: 'date', status: 'done', startedAt: 1100, endedAt: 1200, detail: { cancelled: true } }],
  status: 'stopped', createdAt: 1001, interrupted: 1300, sendKey: 'turn-test-1', resumable: true, completionId: 'chatcmpl-test', metrics: { firstTokenAt: 1050, requests: 1 },
};

test('canReattach: only the recovering, recorded last answer of its turn', () => {
  assert.equal(canReattach([user, cut], 1), true);
  assert.equal(canReattach([user, { ...cut, resumable: undefined }], 1), false, 'not recorded by the bridge');
  assert.equal(canReattach([user, { ...cut, sendKey: undefined }], 1), false);
  assert.equal(canReattach([user, { ...cut, status: 'done', interrupted: undefined }], 1), false);
  assert.equal(canReattach([user, cut, { ...user, id: 'u2' }], 1), false, 'a newer turn follows');
  assert.equal(canReattach([cut], 0), false, 'no user message before it');
});

test('failedReattach: refusals are final, offline / busy are retried', () => {
  assert.equal(failedReattach({ code: 'resume_unavailable', kind: 'bad_request' }), 'gone');
  assert.equal(failedReattach({ code: 'turn_unrecorded', kind: 'bad_request' }), 'gone');
  assert.equal(failedReattach({ kind: 'network' }), 'retry');
  assert.equal(failedReattach({ kind: 'rate_limit', status: 429 }), 'retry');
  assert.equal(failedReattach({ kind: 'server', status: 502 }), 'retry');
  assert.equal(failedReattach({ kind: 'auth', status: 401 }), 'gone');
  assert.equal(failedReattach({ kind: 'aborted' }), 'retry');
});

test('replay copy: fresh content, same identity; takes over keeping the tool times the bubble knew', () => {
  const base = replayBase(cut);
  assert.deepEqual(base, { id: 'a1', role: 'assistant', text: '', tools: [], status: 'streaming', createdAt: 1001, sendKey: 'turn-test-1', resumable: true, metrics: { firstTokenAt: 1050 } });
  const shown = resumedStreaming(cut);
  assert.equal(shown.status, 'streaming');
  assert.equal(shown.interrupted, undefined);
  const replayed: ChatMessage = { ...base, text: 'Teil und mehr', tools: [{ id: 'call-1', name: 'terminal', label: 'date', status: 'done', startedAt: 5000, endedAt: 5001 }] };
  assert.equal(covers(replayed, shown), true);
  assert.equal(covers({ ...replayed, text: 'Te' }, shown), false);
  const adopted = adoptReplay(shown, replayed);
  assert.equal(adopted.text, 'Teil und mehr');
  assert.equal(adopted.tools[0].startedAt, 1100);
  assert.equal(adopted.tools[0].endedAt, 5001, 'the stored end was only the kill (cancelled): the replay knows the real one');
  assert.equal(adopted.tools[0].detail, undefined);
  assert.equal(withoutResumable(cut).resumable, undefined);
});

function driver(reattach: () => Promise<'live' | 'gone' | 'retry'>) {
  let list: ChatMessage[] = [user, cut];
  const timers: { fn: () => void; ms: number }[] = [];
  let fetches = 0;
  let can = true;
  const r = createRecovery({
    get: () => list,
    commit: (l) => (list = l),
    fetchRemote: async () => {
      fetches++;
      return [];
    },
    inboxAvailable: () => true,
    canReattach: () => can,
    reattach: async () => {
      const o = await reattach();
      if (o === 'gone') can = false;
      if (o === 'live') list = [user, resumedStreaming(list[1])];
      return o;
    },
    now: () => 2000,
    timers: { set: (fn, ms) => timers.push({ fn, ms }), clear: () => {} },
  });
  return { r, timers, fetches: () => fetches, list: () => list };
}
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

test('recovery driver: a reattachable answer is re-attached at once; live = no session poll', async () => {
  const d = driver(async () => 'live');
  d.r.start();
  assert.equal(d.timers[0].ms, REATTACH_DELAYS_MS[0]);
  d.timers.shift()!.fn();
  await flush();
  assert.equal(d.fetches(), 0);
  assert.equal(d.list()[1].status, 'streaming');
  assert.equal(d.timers.length, 0, 'nothing scheduled while it streams');
  d.r.dispose();
});

test('recovery driver: refused → the stored session at once, then its normal delays; offline → retried soon', async () => {
  const gone = driver(async () => 'gone');
  gone.r.start();
  gone.timers.shift()!.fn();
  await flush();
  assert.equal(gone.fetches(), 1, 'the session is asked in the same check');
  assert.equal(gone.timers.at(-1)!.ms, RECOVERY_DELAYS_MS[0]);
  gone.r.dispose();

  const offline = driver(async () => 'retry');
  offline.r.start();
  offline.timers.shift()!.fn();
  await flush();
  assert.equal(offline.timers.at(-1)!.ms, REATTACH_DELAYS_MS[1], 'the next re-attach soon, not after the session poll delays');
  offline.r.dispose();
});


for (const outcome of ['once', 'deny', 'expired'] as const) {
  test(`a ${outcome} decision made while replay catches up survives adoption`, () => {
    const now = 100_000;
    const approval = withDeadline({ runId: 'run-test', requestId: 'req-test', command: 'echo test', description: '', choices: ['once', 'deny'], timestamp: 90 }, { receivedAt: now });
    const replayed = addApproval(replayBase(cut), approval, now);
    const pending = addApproval(resumedStreaming(cut), approval, now);
    const shown = resolveApproval(pending, approvalKey(approval), outcome, now + 1);
    const adopted = adoptReplay(shown, { ...replayed, text: cut.text });
    assert.deepEqual(adopted.approvalLog?.map(r => r.outcome), [outcome]);
    assert.equal(pendingOf(adopted).length, 0, 'a resolved request cannot reappear');
    assert.ok(adopted.trace?.some(s => s.kind === 'approval_answer' && s.text === outcome));
    assert.equal(pendingOf(addApproval(adopted, approval, now + 2)).length, 0, 'later replay frames also respect the decision');
  });
}

test('a restored approval keeps its known deadline and remains visible before replay reaches its frame', () => {
  const approval = withDeadline({ runId: 'run-test', requestId: 'req-test', command: 'echo test', description: '', choices: ['once', 'deny'], timestamp: 10 }, { receivedAt: 10_000 });
  const shown = addApproval(resumedStreaming(cut), approval, 10_000);
  const replayed = addApproval(replayBase(cut), { ...approval, deadlineAt: 500_000, receivedAt: 200_000 }, 200_000);
  assert.equal(pendingOf(adoptReplay(shown, replayed))[0].deadlineAt, approval.deadlineAt);
  assert.equal(pendingOf(adoptReplay(shown, replayBase(cut)))[0].requestId, approval.requestId);
  const terminal = adoptReplay(shown, { ...replayBase(cut), status: 'done' });
  assert.equal(pendingOf(terminal).length, 0, 'a completed replay does not resurrect a pending request');
});


for (const outcome of ['once', 'deny', 'expired'] as const) {
  test(`a ${outcome} decision without a request id survives replay at a later receipt time`, () => {
    const original = withDeadline({ runId: 'run-test', command: 'echo test', description: '', choices: ['once', 'deny'], timestamp: 90 }, { receivedAt: 100_000 });
    const replayedApproval = withDeadline({ ...original, receivedAt: undefined }, { receivedAt: 200_000, restored: {} });
    const replayed = addApproval(replayBase(cut), replayedApproval, 200_000);
    const shown = resolveApproval(addApproval(resumedStreaming(cut), original, 100_000), approvalKey(original), outcome, 100_001);
    const adopted = adoptReplay(shown, replayed);
    assert.equal(pendingOf(adopted).length, 0);
    assert.deepEqual(adopted.approvalLog?.map(r => r.outcome), [outcome]);
    assert.equal(pendingOf(addApproval(adopted, replayedApproval, 200_001)).length, 0);
    const next = { ...replayedApproval, timestamp: 201 };
    assert.equal(pendingOf(addApproval(adopted, next, 201_000)).length, 1, 'a later request for the same command is still offered');
  });
}


test('unidentified truncated approval records retain distinct decisions', () => {
  const command = 'x'.repeat(299) + '…';
  const records = [
    { runId: 'run-test', command, timestamp: 90, requestedAt: 100_000, at: 100_001, outcome: 'once' as const },
    { runId: 'run-test', command, timestamp: 90, requestedAt: 100_002, at: 100_003, outcome: 'deny' as const },
  ];
  const shown = { ...resumedStreaming(cut), approvalLog: records };
  const adopted = adoptReplay(shown, { ...replayBase(cut), approvalLog: records });
  assert.deepEqual(adopted.approvalLog?.map(r => r.outcome), ['once', 'deny']);
});


test('a truncated idless record never suppresses a distinct command', () => {
  const prefix = 'x'.repeat(299);
  const original = withDeadline({ runId: 'run-test', command: prefix + 'different tail', description: '', choices: ['once', 'deny'], timestamp: 90 }, { receivedAt: 100_000 });
  const shown = resolveApproval(addApproval(resumedStreaming(cut), original, 100_000), approvalKey(original), 'once', 100_001);
  const distinct = { ...original, command: prefix + '…' };
  assert.equal(pendingOf(addApproval(shown, distinct, 100_002)).length, 1, 'matching a capped log is insufficient identity evidence');
});


for (const withId of [true, false]) for (const outcome of ['once', 'deny', 'expired'] as const) {
  test(`terminal replay keeps the actual ${outcome} decision and timeline ${withId ? 'with' : 'without'} a request id`, () => {
    const approval = withDeadline({ runId: 'run-test', ...(withId ? { requestId: 'req-test' } : {}), command: 'echo test', description: '', choices: ['once', 'deny'], timestamp: 90 }, { receivedAt: 100_000 });
    const replayed = applyEvent(addApproval(replayBase(cut), approval, 100_000), { type: 'finish', reason: 'stop' }, 100_002);
    const shown = resolveApproval(addApproval(resumedStreaming(cut), approval, 100_000), approvalKey(approval), outcome, 100_001);
    const adopted = adoptReplay(shown, replayed);
    assert.deepEqual(adopted.approvalLog?.map(r => r.outcome), [outcome]);
    assert.deepEqual(adopted.trace?.filter(s => s.kind === 'approval_answer').map(s => s.text), [outcome], 'a replay-generated cancellation cannot replace the real decision');
  });
}


test('parallel idless decisions at the same millisecond keep both actual timeline outcomes', () => {
  const first = withDeadline({ runId: 'run-test', command: 'echo first', description: '', choices: ['once', 'deny'], timestamp: 90 }, { receivedAt: 100_000 });
  const second = { ...first, command: 'echo second' };
  const pending = addApproval(addApproval(resumedStreaming(cut), first, 100_000), second, 100_000);
  const shown = resolveApproval(resolveApproval(pending, approvalKey(first), 'once', 100_001), approvalKey(second), 'once', 100_001);
  const replayed = applyEvent(addApproval(addApproval(replayBase(cut), first, 100_000), second, 100_000), { type: 'finish', reason: 'stop' }, 100_002);
  const adopted = adoptReplay(shown, replayed);
  assert.deepEqual(adopted.approvalLog?.map(r => r.outcome), ['once', 'once']);
  assert.deepEqual(adopted.trace?.filter(s => s.kind === 'approval_answer').map(s => s.text), ['once', 'once']);
});
