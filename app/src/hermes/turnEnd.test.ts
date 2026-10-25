/// <reference types="node" />
// HUI+ 0.2.2: every way a Hermes turn ends shows something visible, on Hermes v0.22.2 AND v0.22.5 (turnEnd.fixtures.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeT, type TFn } from '../i18n/core.ts';
import { applyEvent, createAssistantMessage, createUserMessage, finalize, messageErrorText, errorTextOf } from './chatState.ts';
import { mapFrame, mapApproval } from './events.ts';
import { answerApprovalCore, fetchRunStatusCore, isHermesError, respondApprovalCore, streamChatCore, type FetchLike } from './stream.ts';
import { applyRunStatus, pendingOf, resolveApproval, approvalKey, isTerminalRunStatus, type RunStatus } from './approvals.ts';
import { retryAfterErrorText } from './retryPolicy.ts';
import { createRecovery, markInterrupted, RECOVERY_WINDOW_MS, RUN_OVER_CONFIRMATIONS, type RecoveryTimers } from './recovery.ts';
import { mapRemoteMessages } from './sessionMapping.ts';
import { presentMessageError } from './networkFailure.ts';
import {
  botChatFailureKey,
  emptyAnswerNotice,
  FOREIGN_BOT_CHAT_KEY,
  FOREIGN_CHAT_KEY,
  reasonErrorText,
  RUN_LOST_KEY,
  SERVER_ERROR_MAX,
  truncatedKey,
  UNKNOWN_EXECUTION_KEY,
} from './turnEnd.ts';
import { branchPoint } from '../chat/answerMenu.ts';
import { FAKE_COMPLETION_ID, FAKE_REQUEST_ID, REASON_CODES, sseBody, V0222, V0225 } from './turnEnd.fixtures.ts';
import type { ChatMessage, HermesConn, HermesEvent } from './types';
import type { RemoteMessage } from './sessions';

const en = makeT('en', 'en-US');
const de = makeT('de', 'de-DE');
const es = makeT('es', 'es-ES');
const conn: HermesConn = { baseUrl: 'http://hermes.test/v1', apiKey: 'nca_user_test_token_0000000000' };

type Init = Parameters<FetchLike>[1];

function fetchOf(make: (url: string, init: Init) => Response): { fn: FetchLike; calls: { url: string; init: Init }[] } {
  const calls: { url: string; init: Init }[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return make(url, init) as never;
  };
  return { fn, calls };
}

const sse = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
const json = (o: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...headers } });

/** stream `body` through the real client and fold it into one assistant message, like useHermesChat does */
async function turn(body: string): Promise<{ msg: ChatMessage; events: HermesEvent[] }> {
  let msg = createAssistantMessage(1000);
  const events: HermesEvent[] = [];
  const f = fetchOf(() => sse(body));
  const result = await streamChatCore(f.fn, {
    conn,
    text: 'hi',
    sessionId: 'hui-test',
    onEvent: (e) => {
      events.push(e);
      msg = applyEvent(msg, e, 2000);
    },
  });
  assert.equal(result.aborted, false);
  // settleTurn: the finish event normally set done / error / stopped already
  if (msg.status === 'streaming') msg = finalize(msg, 'done', undefined, 3000);
  return { msg, events };
}

/** what the answer shows under its text (MessageItem: truncated line, failure card, stopped marker, empty notice) */
function visible(m: ChatMessage, t: TFn = en, botChat = false): string[] {
  const out: string[] = [];
  if (m.text.trim()) out.push(`text:${m.text}`);
  if (m.truncated) out.push(t(truncatedKey(m)));
  if (m.status === 'error') {
    const k = botChatFailureKey(m, botChat);
    out.push(t('chat.message.failed'), k ? t(k) : presentMessageError(m, t).text, t('chat.message.retry'));
  }
  if (m.status === 'stopped') out.push(t('chat.message.stopped'));
  const empty = emptyAnswerNotice(m);
  if (m.status === 'done' && empty) out.push(t(empty));
  return out;
}

// ------------------------------------------------------------------ v0.22.2: unchanged behaviour

test('v0.22.2: an interrupt ends with `stop` → a normal finished answer with its text, no marker', async () => {
  const { msg } = await turn(V0222.interruptedStop);
  assert.equal(msg.status, 'done');
  assert.equal(msg.finishReason, 'stop');
  assert.equal(msg.finishCode, undefined);
  assert.deepEqual(visible(msg), ['text:Ich fange an']);
});

test('v0.22.2: approval event without execution_generation → body {choice, request_id} as before', async () => {
  const a = mapApproval(V0222.approvalEvent);
  assert.equal(a.executionGeneration, undefined);
  assert.equal(a.patternKey, 'rm_recursive');
  assert.equal(a.timeoutSeconds, undefined);
  const f = fetchOf(() => json({ ok: true }));
  await respondApprovalCore(f.fn, conn, a, 'once');
  assert.equal(f.calls[0].url, `http://hermes.test/v1/runs/${FAKE_COMPLETION_ID}/approval`);
  assert.deepEqual(JSON.parse(f.calls[0].init.body as string), { choice: 'once', request_id: FAKE_REQUEST_ID });
});

test('v0.22.2: run status with the legacy `approval` field restores the card', async () => {
  const f = fetchOf(() => json(V0222.runWaiting(), 200, { date: new Date(1_800_000_010_000).toUTCString() }));
  const st = await fetchRunStatusCore(f.fn, conn, FAKE_COMPLETION_ID);
  assert.equal(st.status, 'waiting_for_approval');
  assert.equal(st.approval?.requestId, FAKE_REQUEST_ID);
  assert.equal(st.approvals, undefined);
  const m = applyRunStatus({ ...createAssistantMessage(1_800_000_000_000), completionId: FAKE_COMPLETION_ID }, st, 1_800_000_010_000);
  assert.equal(pendingOf(m).length, 1);
});

// ------------------------------------------------------------------ v0.22.5: new endings

test('v0.22.5 `cancelled`: like a stop in the app (partial text + "Stopped"), never an error or an empty bubble', async () => {
  const { msg } = await turn(V0225.cancelled);
  assert.equal(msg.status, 'stopped');
  assert.equal(msg.finishCode, undefined, '`agent_error` of a cancelled turn is not kept');
  assert.equal(msg.error, undefined);
  assert.equal(msg.errorText, undefined);
  assert.equal(msg.metrics?.endedAt, 2000, 'ended: not taken for a cut-off answer by recovery');
  assert.deepEqual(visible(msg), ['text:Ich fange an', 'Stopped']);
  assert.deepEqual(visible(msg, de), ['text:Ich fange an', 'Gestoppt']);
  const empty = await turn(V0225.cancelledEmpty);
  assert.deepEqual(visible(empty.msg), ['Stopped'], 'no text: the marker is still there');
});

test('v0.22.5 `length`: truncated marker; iteration budget → step-limit line', async () => {
  const cut = await turn(V0225.truncated);
  assert.equal(cut.msg.status, 'done');
  assert.equal(cut.msg.finishCode, 'output_truncated');
  assert.deepEqual(visible(cut.msg), ['text:Lange Liste: 1, 2, 3', 'The answer was cut off because of the length limit.']);
  const step = await turn(V0225.stepLimit);
  assert.equal(step.msg.status, 'done');
  assert.equal(step.msg.truncated, true);
  assert.equal(step.msg.finishCode, 'iteration_budget_exhausted');
  assert.deepEqual(visible(step.msg), ['text:Ich habe drei Dateien geprüft.', 'Hermes stopped: step limit reached for this answer.']);
  assert.deepEqual(visible(step.msg, de).slice(1), ['Hermes hat aufgehört: Schrittlimit für diese Antwort erreicht.']);
});

test('v0.22.5 `error` + reason code: localized explanation + retry, never the bare code', async () => {
  for (const code of REASON_CODES) {
    const { msg } = await turn(V0225.refused(code));
    assert.equal(msg.status, 'error', code);
    assert.ok(msg.errorText, `${code}: keyed`);
    for (const t of [en, de, es]) {
      const shown = messageErrorText(msg, t);
      assert.notEqual(shown, msg.errorText!.key, `${code}: translated`);
      assert.doesNotMatch(shown, new RegExp(`\\b${code}\\b`), `${code}: no bare code`);
      assert.ok(shown.length > 20, `${code}: a sentence`);
    }
    assert.equal(visible(msg).at(-1), 'Retry');
  }
});

test('v0.22.5 `unknown_execution`: says what happened and what to do', async () => {
  const { msg } = await turn(V0225.refused('unknown_execution'));
  const shown = messageErrorText(msg, en);
  assert.match(shown, /restart/);
  assert.match(shown, /new chat/);
  assert.match(shown, /copy of this one/);
  assert.match(shown, /hermes sessions discard/);
  assert.equal(msg.errorText?.key, UNKNOWN_EXECUTION_KEY, 'the error card offers "Continue in new chat" for this key');
  assert.match(messageErrorText(msg, de), /neuen Chat/);
});

test('v0.22.5 `permission_denied`: generic text; in a Bot Chat: read-only from the app', async () => {
  const { msg } = await turn(V0225.refused('permission_denied'));
  assert.equal(msg.errorText?.key, FOREIGN_CHAT_KEY);
  assert.match(visible(msg)[1], /does not let the app write to this chat/);
  assert.equal(botChatFailureKey(msg, true), FOREIGN_BOT_CHAT_KEY);
  assert.equal(botChatFailureKey(msg, false), undefined);
  assert.match(visible(msg, en, true)[1], /bot’s chat can’t be written to from the app/);
  assert.match(visible(msg, de, true)[1], /neuen Chat mit dem Bot/);
  // another error in a Bot Chat keeps its own text
  const other = await turn(V0225.refused('queue_full'));
  assert.equal(botChatFailureKey(other.msg, true), undefined);
});

test('v0.22.5 `error` with a human message: shown as is (trimmed); no message: the generic text', async () => {
  const { msg } = await turn(V0225.agentError);
  assert.equal(msg.status, 'error');
  assert.equal(msg.errorText, undefined);
  assert.deepEqual(visible(msg), ['text:Teil 1', 'Answer failed', 'Provider returned 500: upstream overloaded', 'Retry']);
  const bare = await turn(V0225.errorNoMessage);
  assert.equal(messageErrorText(bare.msg, en), en('backends.hermes.errors.agentFailed'));
  // an endless server text is bounded
  const long = applyEvent(createAssistantMessage(0), { type: 'finish', reason: 'error', error: 'x'.repeat(10_000) }, 1);
  assert.equal(long.error?.length, SERVER_ERROR_MAX);
});

test('unknown future finish reason: a normal finished answer; without text a visible notice', async () => {
  const withText = await turn(V0225.futureText);
  assert.equal(withText.msg.status, 'done');
  assert.deepEqual(visible(withText.msg), ['text:Antwort']);
  const empty = await turn(V0225.futureEmpty);
  assert.equal(empty.msg.status, 'done');
  assert.equal(empty.msg.finishReason, 'content_filter');
  assert.deepEqual(visible(empty.msg), ['The answer ended without any text.']);
  assert.deepEqual(visible(empty.msg, de), ['Die Antwort endete ohne Text.']);
  // a plain `stop` without text (v0.22.2 too) gets the same notice instead of an empty bubble
  const stopEmpty = await turn(sseBody([{ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]));
  assert.deepEqual(visible(stopEmpty.msg), ['The answer ended without any text.']);
  // no notice while streaming or for a placeholder without a server finish
  assert.equal(emptyAnswerNotice(createAssistantMessage(0)), null);
  assert.equal(emptyAnswerNotice({ ...createAssistantMessage(0), status: 'done' }), null);
});

test('mid-stream error envelope with a reason code is explained too', () => {
  const evs = mapFrame({ event: 'message', data: JSON.stringify({ error: { message: 'runtime_draining', code: 'runtime_draining' } }) });
  assert.equal(evs[0].type, 'error');
  const m = applyEvent(createAssistantMessage(0), evs[0], 1);
  assert.equal(m.status, 'error');
  assert.match(messageErrorText(m, en), /restarting or shutting down/);
  // an unknown one stays as it is
  const u = applyEvent(createAssistantMessage(0), { type: 'error', message: '  boom  ' }, 1);
  assert.equal(messageErrorText(u, en), 'boom');
});

test('non-streaming / HTTP refusals (409 / 503) carry the explanation; no "retry in N s" around it', async () => {
  const f = fetchOf(() => json(V0225.httpRefusal('permission_denied'), 409));
  const err = await streamChatCore(f.fn, { conn, text: 'hi', sessionId: 's', onEvent: () => {} }).catch((e: unknown) => e);
  assert.ok(isHermesError(err));
  assert.equal(err.code, 'permission_denied');
  assert.equal(errorTextOf(err)?.key, FOREIGN_CHAT_KEY);
  const d = fetchOf(() => json(V0225.httpRefusal('runtime_draining'), 503, { 'retry-after': '30' }));
  const busy = await streamChatCore(d.fn, { conn, text: 'hi', sessionId: 's', onEvent: () => {} }).catch((e: unknown) => e);
  assert.ok(isHermesError(busy));
  assert.equal(busy.kind, 'busy');
  assert.equal(retryAfterErrorText(busy), undefined);
  assert.equal(errorTextOf(busy)?.key, 'backends.hermes.errors.reason.runtimeDraining');
  // a 404 `not_found` of something else (proxy, unknown route) is not taken for a refused turn
  const nf = fetchOf(() => json(V0225.httpRefusal('not_found'), 404));
  const e404 = await streamChatCore(nf.fn, { conn, text: 'hi', sessionId: 's', onEvent: () => {} }).catch((e: unknown) => e);
  assert.ok(isHermesError(e404));
  assert.equal(e404.text, undefined);
  // the plain-JSON answer of a turn that ended with an error carries its reason too
  const plain = fetchOf(() =>
    json({ id: FAKE_COMPLETION_ID, choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'error' }], error: { message: 'queue_full' }, hermes: { completed: false, failed: true, error: 'queue_full', error_code: 'agent_error' } })
  );
  let m = createAssistantMessage(0);
  await streamChatCore(plain.fn, { conn, text: 'hi', sessionId: 's', onEvent: (e) => (m = applyEvent(m, e, 1)) });
  assert.equal(m.errorText?.key, 'backends.hermes.errors.reason.queueFull');
});

test('refusal before any delta: the bubble shows the explanation, not an empty gap (live v0.22.5 shape)', async () => {
  const { msg, events } = await turn(V0225.refused('unknown_execution'));
  assert.equal(events.some((e) => e.type === 'text' || e.type === 'start'), false, 'no content at all');
  assert.equal(msg.text, '');
  assert.deepEqual(visible(msg).slice(0, 1), ['Answer failed']);
  assert.match(visible(msg)[1], /Hermes paused this chat/);
});

test('branch from a paused chat: the copy starts at the answer before the failed turn', () => {
  const at = 1_800_000_000_000;
  const a = (id: string, status: ChatMessage['status']): ChatMessage => ({ ...createAssistantMessage(at), id, status, text: id });
  const list: ChatMessage[] = [
    { ...createUserMessage('eins', at, undefined, 'UTC'), id: 'u1' },
    a('a1', 'done'),
    { ...createUserMessage('zwei', at, undefined, 'UTC'), id: 'u2' },
    a('a2', 'error'),
  ];
  assert.equal(branchPoint(list, 'a2'), 'a1');
  assert.equal(branchPoint(list, 'a1'), 'a1', 'a finished answer branches from itself (menu, unchanged)');
  assert.equal(branchPoint(list.slice(2), 'a2'), null, 'first turn failed: nothing to copy (no branch button)');
  assert.equal(branchPoint(list, 'nope'), null);
});

test('reasonErrorText: exact codes only (message or code field)', () => {
  assert.equal(reasonErrorText(' permission_denied\n')?.key, FOREIGN_CHAT_KEY);
  assert.equal(reasonErrorText('Something went wrong', 'chain_moved')?.key, 'backends.hermes.errors.reason.chainMoved');
  assert.equal(reasonErrorText('permission_denied because of x'), undefined);
  assert.equal(reasonErrorText(undefined), undefined);
});

// ------------------------------------------------------------------ approvals on v0.22.5

test('v0.22.5 approval event: timeout_s → deadline, execution_generation kept and sent in the exact body', async () => {
  const evs = mapFrame({ event: 'approval.request', data: JSON.stringify(V0225.approvalEvent) });
  assert.equal(evs[0].type, 'approval');
  const a = evs[0].type === 'approval' ? evs[0].approval : mapApproval({});
  assert.equal(a.timeoutSeconds, 120);
  assert.equal(a.executionGeneration, 3);
  assert.equal(a.patternKey, undefined);
  const m = applyEvent({ ...createAssistantMessage(1_800_000_000_000), status: 'streaming' }, evs[0], 1_800_000_000_000);
  const queued = pendingOf(m)[0];
  assert.equal(queued.deadlineAt, 1_800_000_000_000 + 120_000, 'deadline from timeout_s');
  const f = fetchOf(() => json({ status: 'resolved' }));
  await answerApprovalCore(f.fn, conn, queued, 'session', 1_800_000_001_000);
  const body = JSON.parse(f.calls[0].init.body as string);
  assert.deepEqual(Object.keys(body).sort(), ['choice', 'execution_generation', 'request_id']);
  assert.deepEqual(body, { request_id: FAKE_REQUEST_ID, execution_generation: 3, choice: 'session' });
  // generation 0 is a value, not "absent"
  const g = fetchOf(() => json({}));
  await respondApprovalCore(g.fn, conn, { ...queued, executionGeneration: 0 }, 'deny');
  assert.equal(JSON.parse(g.calls[0].init.body as string).execution_generation, 0);
});

test('v0.22.5: no `approval.responded` event – the answer POST (200) settles the card', async () => {
  const ev = mapFrame({ event: 'approval.request', data: JSON.stringify(V0225.approvalEvent) })[0];
  let m = applyEvent({ ...createAssistantMessage(1_800_000_000_000), status: 'streaming' }, ev, 1_800_000_000_000);
  const a = pendingOf(m)[0];
  const f = fetchOf(() => json({ status: 'resolved' }));
  await answerApprovalCore(f.fn, conn, a, 'once', 1_800_000_001_000);
  // useHermesChat respondFor: resolved right after the 200, no server event needed
  m = resolveApproval(m, approvalKey(a), 'once', 1_800_000_001_000);
  assert.equal(pendingOf(m).length, 0);
  assert.equal(m.approval, undefined);
  assert.equal(m.approvalLog?.at(-1)?.outcome, 'once');
  // the stream then ends normally; nothing is left waiting
  m = applyEvent(m, { type: 'finish', reason: 'stop' }, 1_800_000_002_000);
  assert.equal(m.status, 'done');
  assert.equal(m.approvalLog?.length, 1);
});

test('v0.22.5 run status: pending_controls → approval cards (prompt_id = request id); clarify ignored', async () => {
  // pending controls carry no timestamp: the deadline counts from receipt (real clock)
  const now = Date.now();
  const body = V0225.run('waiting_for_approval', [V0225.pendingApproval('apr_test_00000001'), V0225.pendingClarify(), V0225.pendingApproval('apr_test_00000002')]);
  const f = fetchOf(() => json(body, 200, { date: new Date(now).toUTCString() }));
  const st = await fetchRunStatusCore(f.fn, conn, FAKE_COMPLETION_ID);
  assert.equal(st.status, 'waiting_for_approval');
  assert.deepEqual(st.approvals?.map((a) => a.requestId), ['apr_test_00000001', 'apr_test_00000002']);
  assert.equal(st.approval?.requestId, 'apr_test_00000002');
  assert.equal(st.approval?.runId, FAKE_COMPLETION_ID);
  assert.equal(st.approval?.executionGeneration, 3);
  assert.equal(st.approval?.timeoutSeconds, 120);
  const m = applyRunStatus({ ...createAssistantMessage(now), completionId: FAKE_COMPLETION_ID, status: 'stopped', interrupted: 1 }, st, now);
  assert.deepEqual(pendingOf(m).map((a) => a.requestId), ['apr_test_00000001', 'apr_test_00000002']);
  // the same status again adds nothing
  assert.equal(pendingOf(applyRunStatus(m, st, now + 500)).length, 2);
});

test('run status values of both versions always end in a defined state', async () => {
  const at = Date.now(); // the event has no timestamp: mapApproval stamps the real clock
  const withCard = applyRunStatus({ ...createAssistantMessage(at), completionId: FAKE_COMPLETION_ID }, { status: 'waiting_for_approval', approval: mapApproval(V0225.approvalEvent), serverNowMs: at }, at);
  assert.equal(pendingOf(withCard).length, 1);
  const statusOf = async (body: unknown, code = 200): Promise<RunStatus> => fetchRunStatusCore(fetchOf(() => json(body, code)).fn, conn, FAKE_COMPLETION_ID);
  // queued / running: the card stays (the run goes on)
  for (const s of ['queued', 'running']) assert.equal(pendingOf(applyRunStatus(withCard, await statusOf(V0225.run(s)), at + 1)).length, 1, s);
  // over or lost (Hermes restarted: `unknown` / 404): open requests are closed and logged, never left as live cards
  for (const body of [V0225.run('cancelled'), V0225.run('failed'), V0225.run('completed'), V0225.run('unknown'), V0225.runNotFound()]) {
    const st = await statusOf(body, 'status' in body ? 200 : 404);
    assert.ok(isTerminalRunStatus(st.status), st.status);
    const m = applyRunStatus(withCard, st, at + 1);
    assert.equal(pendingOf(m).length, 0, st.status);
    assert.equal(m.approvalLog?.at(-1)?.outcome, 'cancelled', st.status);
  }
  // a body without status is not taken for Hermes' `unknown`
  assert.equal((await statusOf({ run_id: FAKE_COMPLETION_ID })).status, 'unreported');
  assert.equal(isTerminalRunStatus('unreported'), false);
});

// ------------------------------------------------------------------ lost runs (Hermes restart) and stored turns

function fakeTime(start: number) {
  let now = start;
  let seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: RecoveryTimers = {
    set: (fn, ms) => {
      pending.set(++seq, { at: now + ms, fn });
      return seq;
    },
    clear: (h) => void pending.delete(h as number),
  };
  return {
    timers,
    now: () => now,
    async next() {
      const [id, t] = [...pending.entries()].sort((a, b) => a[1].at - b[1].at)[0] ?? [];
      if (!t) return false;
      pending.delete(id as number);
      now = Math.max(now, t.at);
      t.fn();
      for (let i = 0; i < 20; i++) await Promise.resolve();
      return true;
    },
  };
}

function lostTurn(status: () => string | null) {
  const T0 = 1_800_000_000_000;
  const clock = fakeTime(T0 + 20_000);
  let list: ChatMessage[] = [
    createUserMessage('Räum auf', T0, undefined, 'UTC'),
    markInterrupted({ ...createAssistantMessage(T0), completionId: FAKE_COMPLETION_ID, text: 'Ich schaue nach' }, T0 + 20_000),
  ];
  let polls = 0;
  const rec = createRecovery({
    get: () => list,
    commit: (l) => (list = l),
    fetchRemote: async () => {
      polls++;
      return [];
    },
    inboxAvailable: () => true,
    runStatus: async () => status(),
    now: clock.now,
    timers: clock.timers,
  });
  return { rec, clock, list: () => list, polls: () => polls, T0 };
}

test('Hermes restarted mid-turn (`unknown`): recovery ends early with a clear text, not a spinner for 10 minutes', async () => {
  const h = lostTurn(() => 'unknown');
  h.rec.start();
  let guard = 0;
  while (h.list()[1].status === 'stopped' && (await h.clock.next()) && guard++ < 50);
  const m = h.list()[1];
  assert.equal(m.status, 'error');
  assert.equal(m.errorText?.key, RUN_LOST_KEY);
  assert.equal(h.polls(), RUN_OVER_CONFIRMATIONS, 'confirmed by a second stored-session check');
  assert.ok(h.clock.now() < h.T0 + RECOVERY_WINDOW_MS);
  assert.equal(m.text, 'Ich schaue nach', 'partial text kept');
  assert.match(messageErrorText(m, en), /restart/);
  assert.equal(visible(m).at(-1), 'Retry');
});

test('404 for the run (forgotten after a restart): waits out the window (a live run on an old server is 404 too), then says it is lost', async () => {
  const h = lostTurn(() => 'not_found');
  h.rec.start();
  let guard = 0;
  while (h.list()[1].status === 'stopped' && (await h.clock.next()) && guard++ < 100);
  const m = h.list()[1];
  assert.equal(m.status, 'error');
  assert.ok(h.clock.now() >= h.T0 + 20_000 + RECOVERY_WINDOW_MS);
  assert.equal(m.errorText?.key, RUN_LOST_KEY);
});

test('a running run keeps the recovery waiting; unreachable status changes nothing (old servers)', async () => {
  for (const st of ['running', null]) {
    const h = lostTurn(() => st);
    h.rec.start();
    for (let i = 0; i < 4; i++) await h.clock.next();
    assert.equal(h.list()[1].status, 'stopped', String(st));
  }
});

test('stored session: a turn Hermes stored as `cancelled` shows "Stopped"', () => {
  const rows: RemoteMessage[] = [
    { id: '1', role: 'user', content: 'Hallo', timestamp: 1_800_000_000_000 },
    { id: '2', role: 'assistant', content: 'Ich fange an', finishReason: 'cancelled', timestamp: 1_800_000_001_000 },
    { id: '3', role: 'user', content: 'Weiter', timestamp: 1_800_000_002_000 },
    { id: '4', role: 'assistant', content: 'Fertig', finishReason: 'stop', timestamp: 1_800_000_003_000 },
  ];
  const out = mapRemoteMessages(rows);
  assert.equal(out[1].status, 'stopped');
  assert.deepEqual(visible(out[1]), ['text:Ich fange an', 'Stopped']);
  assert.equal(out[3].status, 'done');
});

test('every new text exists in en, de and es and keeps "Hermes"', () => {
  const keys = [
    RUN_LOST_KEY,
    FOREIGN_BOT_CHAT_KEY,
    'chat.message.stepLimit',
    'chat.message.emptyAnswer',
    ...REASON_CODES.map((c) => reasonErrorText(c)!.key),
  ] as const;
  for (const k of keys) {
    for (const t of [en, de, es]) {
      const s = t(k);
      assert.notEqual(s, k, `${k} missing`);
      assert.doesNotMatch(s, /—/, `${k}: no em dash`);
    }
    if (en(k).includes('Hermes')) for (const t of [de, es]) assert.match(t(k), /Hermes/, k);
  }
});
