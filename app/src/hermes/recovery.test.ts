/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streamChatCore } from './stream.ts';
import {
  applyInboxAnswer,
  applyRemoteAnswer,
  createRecovery,
  failInterrupted,
  findRemoteAnswer,
  isRecovering,
  markInterrupted,
  resumeCutOff,
  resumeRecovering,
  RECOVERY_WINDOW_MS,
  type RecoveryTimers,
} from './recovery.ts';
import { reconcileTranscript } from '../conversations/remoteSync.ts';
import { stripMessage } from '../conversations/messages.ts';
import type { ChatMessage, HermesConn, ToolEvent } from './types';

const T0 = 1_800_000_000_000;
const tool = (id: string, status: ToolEvent['status'] = 'done'): ToolEvent => ({ id, name: 'terminal', label: id, status, startedAt: T0 });
const user = (text: string, at = T0, id = 'u1'): ChatMessage => ({ id, role: 'user', text, tools: [], status: 'done', createdAt: at });
const streaming = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'a1',
  role: 'assistant',
  text: 'Ich schaue nach',
  tools: [tool('call_1'), tool('call_2', 'running')],
  status: 'streaming',
  createdAt: T0,
  ...over,
});
/** stored session, mapped (sessionMapping.mapRemoteMessages) */
const remoteTurn = (question: string, answer: Partial<ChatMessage> = {}, at = T0 + 1000): ChatMessage[] => [
  { id: 'r:1:user', role: 'user', text: question, tools: [], status: 'done', createdAt: at },
  {
    id: 'r:2:assistant',
    role: 'assistant',
    text: 'Ich schaue nach\n\nFertig: alles erledigt.',
    tools: [{ ...tool('call_1'), detail: { input: { cmd: 'ls' }, output: 'a b' } }, tool('call_2'), tool('call_3')],
    status: 'done',
    createdAt: at,
    finishReason: 'stop',
    metrics: { endedAt: at + 40_000 },
    ...answer,
  },
];

function interruptedChat(): ChatMessage[] {
  return [user('Räum den Server auf'), markInterrupted(streaming(), T0 + 20_000)];
}

/** manual clock + timers */
function fakeTime() {
  let now = T0 + 20_000;
  let seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: RecoveryTimers = {
    set: (fn, ms) => {
      const id = ++seq;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clear: (h) => void pending.delete(h as number),
  };
  return {
    timers,
    now: () => now,
    pending: () => pending.size,
    /** run the next timer (advancing the clock), then let the async check settle */
    async next() {
      const [id, t] = [...pending.entries()].sort((a, b) => a[1].at - b[1].at)[0] ?? [];
      if (!t) return false;
      pending.delete(id as number);
      now = Math.max(now, t.at);
      t.fn();
      for (let i = 0; i < 5; i++) await Promise.resolve();
      return true;
    },
  };
}

function harness(fetchRemote: () => Promise<ChatMessage[] | null>, opts: { inbox?: boolean; list?: ChatMessage[]; runStatus?: () => Promise<string | null> } = {}) {
  const clock = fakeTime();
  let list = opts.list ?? interruptedChat();
  const commits: ChatMessage[][] = [];
  const rec = createRecovery({
    get: () => list,
    commit: (l) => {
      list = l;
      commits.push(l);
    },
    fetchRemote,
    inboxAvailable: () => opts.inbox ?? true,
    runStatus: opts.runStatus,
    now: clock.now,
    timers: clock.timers,
  });
  return { rec, clock, commits, list: () => list };
}

// ------------------------------------------------------------------ stream: when is a failure an interruption?

const conn: HermesConn = { baseUrl: 'http://bridge.test/v1', apiKey: 'k', bridge: true };
const chunk = (o: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(o)}\n\n`);

test('stream: a connection drop after HTTP 200 (events already in) is marked accepted; refused before is not', async () => {
  let sent = false;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (!sent) {
        sent = true;
        c.enqueue(chunk({ choices: [{ delta: { content: 'Ich' } }] }));
        return;
      }
      c.error(new Error('Software caused connection abort'));
    },
  });
  let acceptedCalls = 0;
  const ok = async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }) as never;
  const err = await streamChatCore(ok, { conn, text: 'x', sessionId: 's', onEvent: () => {}, onAccepted: () => acceptedCalls++ }).catch((e) => e);
  assert.equal(err.kind, 'network');
  assert.equal(err.accepted, true);
  assert.equal(acceptedCalls, 1);

  const refused = async () => {
    throw new TypeError('Connection refused');
  };
  const err2 = await streamChatCore(refused as never, { conn, text: 'x', sessionId: 's', onEvent: () => {}, onAccepted: () => acceptedCalls++ }).catch((e) => e);
  assert.equal(err2.kind, 'network');
  assert.equal(err2.accepted, undefined);
  assert.equal(acceptedCalls, 1);

  const http500 = async () => new Response('{"error":{"message":"boom"}}', { status: 500, headers: { 'content-type': 'application/json' } }) as never;
  const err3 = await streamChatCore(http500, { conn, text: 'x', sessionId: 's', onEvent: () => {} }).catch((e) => e);
  assert.equal(err3.kind, 'server');
  assert.equal(err3.accepted, undefined);
});

// ------------------------------------------------------------------ pure transitions

test('markInterrupted: calm stopped state, tools kept and closed', () => {
  const m = markInterrupted(streaming(), T0 + 5);
  assert.equal(m.status, 'stopped');
  assert.equal(m.interrupted, T0 + 5);
  assert.equal(m.error, undefined);
  assert.deepEqual(m.tools.map((t) => [t.id, t.status]), [['call_1', 'done'], ['call_2', 'done']]);
  assert.equal(isRecovering(m), true);
  assert.equal(isRecovering(finalizeStopped()), false, 'a user stop is not recovered');
});

function finalizeStopped(): ChatMessage {
  return { ...streaming(), status: 'stopped', metrics: { endedAt: T0 + 9 } };
}

test('inbox event completes the interrupted message in place – never a second answer', () => {
  const list = interruptedChat();
  const next = applyInboxAnswer(list, { id: 'h_x_9', content: 'Fertig: alles erledigt.', timestamp: T0 + 60_000 });
  assert.ok(next);
  assert.equal(next.length, 2);
  assert.equal(next[1].id, 'a1');
  assert.equal(next[1].status, 'done');
  assert.equal(next[1].text, 'Fertig: alles erledigt.');
  assert.equal(next[1].interrupted, undefined);
  assert.equal(next[1].tools.length, 2, 'tools received before the drop stay');
  // the same event again (replay after reconnect) or a later one: nothing left to complete
  assert.equal(applyInboxAnswer(next, { id: 'h_x_9', content: 'Fertig: alles erledigt.', timestamp: T0 + 60_000 }), null);
  // an event older than the turn does not complete it
  assert.equal(applyInboxAnswer(list, { id: 'old', content: 'alt', timestamp: T0 - 3_600_000 }), null);
});

test('stored session: final answer found by tool ids or newest run; unfinished / older runs are not taken', () => {
  const list = interruptedChat();
  const done = applyRemoteAnswer(list, remoteTurn('Räum den Server auf'));
  assert.ok(done);
  assert.equal(done[1].id, 'a1');
  assert.equal(done[1].status, 'done');
  assert.match(done[1].text, /Fertig/);
  assert.equal(done[1].tools.length, 3, 'missing tools appended');
  assert.deepEqual(done[1].tools[0].detail?.input, { cmd: 'ls' });

  // Hermes still working: last stored row ended with a tool call
  assert.equal(applyRemoteAnswer(list, remoteTurn('Räum den Server auf', { finishReason: 'tool_calls', text: 'Ich schaue nach' })), null);
  // question stored, no answer yet
  assert.equal(applyRemoteAnswer(list, remoteTurn('Räum den Server auf').slice(0, 1)), null);
  // the same question an hour earlier (an older run) is not this turn's answer
  const older = remoteTurn('Räum den Server auf', { tools: [] }, T0 - 3_600_000);
  assert.equal(findRemoteAnswer(list, 1, older), null);
  // older run answered + this run stored without answer yet → wait (do not fall back to the old answer)
  const both = [...older, ...remoteTurn('Räum den Server auf', { tools: [] }).slice(0, 1)];
  assert.equal(findRemoteAnswer(list, 1, both), null);
});

test('resumeCutOff: an answer persisted mid-stream (app killed) is recovered on reopen; finalised ones are not', () => {
  const stored = [user('Räum den Server auf'), stripMessage(streaming())];
  assert.equal(stored[1].status, 'stopped');
  const resumed = resumeCutOff(stored);
  assert.equal(isRecovering(resumed[1]), true);
  assert.equal(resumed[1].interrupted, T0);
  const userStopped = [user('x'), finalizeStopped()];
  assert.equal(resumeCutOff(userStopped), userStopped);
});

// ------------------------------------------------------------------ driver (state machine)

test('interrupted → recovered via inbox; a later poll and the transcript sync add nothing', async () => {
  let fetches = 0;
  const h = harness(async () => {
    fetches++;
    return remoteTurn('Räum den Server auf');
  });
  h.rec.start();
  assert.equal(h.clock.pending(), 1, 'poll scheduled');
  assert.equal(h.rec.inbox({ id: 'h_1', content: 'Fertig: alles erledigt.', timestamp: T0 + 50_000 }), true);
  assert.equal(h.commits.length, 1);
  assert.equal(h.clock.pending(), 0, 'nothing left to recover → polling stopped');
  assert.equal(fetches, 0);
  // the inbox event replayed after a reconnect
  assert.equal(h.rec.inbox({ id: 'h_1', content: 'Fertig: alles erledigt.', timestamp: T0 + 50_000 }), false);
  // transcript sync afterwards: same message enriched, not duplicated
  const synced = reconcileTranscript(h.list(), remoteTurn('Räum den Server auf'));
  assert.equal(synced.length, 2);
  assert.equal(synced.filter((m) => m.role === 'assistant').length, 1);
  assert.equal(synced[1].id, 'a1');
  h.rec.dispose();
});

test('interrupted → recovered via the stored session (poll with backoff)', async () => {
  let n = 0;
  const h = harness(async () => {
    n++;
    if (n === 1) throw new Error('offline');
    if (n === 2) return remoteTurn('Räum den Server auf', { finishReason: 'tool_calls', text: 'Ich schaue nach' });
    return remoteTurn('Räum den Server auf');
  });
  h.rec.start();
  await h.clock.next(); // offline
  assert.equal(h.commits.length, 0);
  await h.clock.next(); // still working
  assert.equal(h.commits.length, 0);
  await h.clock.next(); // done
  assert.equal(h.commits.length, 1);
  const last = h.list()[1];
  assert.equal(last.status, 'done');
  assert.equal(last.id, 'a1');
  assert.equal(h.clock.pending(), 0);
  // a late inbox event for the same turn does not add a second answer
  assert.equal(h.rec.inbox({ id: 'h_2', content: 'Fertig: alles erledigt.', timestamp: T0 + 90_000 }), false);
  assert.equal(h.list().length, 2);
});

test('foreground / reconnect poke checks right away', async () => {
  let n = 0;
  const h = harness(async () => {
    n++;
    return remoteTurn('Räum den Server auf');
  });
  h.rec.start();
  h.rec.poke();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(n, 1);
  assert.equal(h.list()[1].status, 'done');
});

test('interrupted → failed after the window: error with "Erneut", partial output kept', async () => {
  const h = harness(async () => remoteTurn('Räum den Server auf').slice(0, 1));
  h.rec.start();
  let guard = 0;
  while (h.commits.length === 0 && (await h.clock.next()) && guard++ < 100);
  assert.equal(h.commits.length, 1);
  assert.ok(h.clock.now() >= T0 + 20_000 + RECOVERY_WINDOW_MS, 'gave up only after the window');
  const m = h.list()[1];
  assert.equal(m.status, 'error');
  assert.equal(m.errorText?.key, 'backends.hermes.errors.interruptedLost');
  assert.equal(m.interrupted, T0 + 20_000, 'kept: retry checks the stored session before re-sending');
  assert.equal(m.tools.length, 2);
  assert.equal(h.clock.pending(), 0);
  // a late inbox event still completes it in place
  assert.equal(h.rec.inbox({ id: 'late', content: 'Doch noch fertig.', timestamp: T0 + 700_000 }), true);
  assert.equal(h.list()[1].status, 'done');
  assert.equal(h.list().length, 2);
});

test('no session API and no live inbox: fails right away (nothing could ever deliver the answer)', async () => {
  const h = harness(async () => null, { inbox: false });
  h.rec.start();
  await h.clock.next();
  assert.equal(h.list()[1].status, 'error');
});

test('retry after a given-up interruption: the finished stored turn is shown instead of sending it again', async () => {
  const list = [user('Räum den Server auf'), failInterrupted(markInterrupted(streaming(), T0 + 20_000), T0 + 700_000)];
  const h = harness(async () => remoteTurn('Räum den Server auf'), { list });
  const res = await h.rec.checkTurn('a1');
  assert.equal(res.kind, 'recovered');
  const recovered = res.kind === 'recovered' ? res.list : [];
  assert.equal(recovered.length, 2);
  assert.equal(recovered[1].status, 'done');
  // Hermes has nothing (turn never stored, run state unknown) → the caller re-sends
  const h2 = harness(async () => [], { list });
  assert.equal((await h2.rec.checkTurn('a1')).kind, 'resend');
});

test('transcript sync after an app kill: the cut-off partial is completed by the stored answer', () => {
  const stored = [user('Räum den Server auf'), stripMessage(streaming())];
  const merged = reconcileTranscript(stored, remoteTurn('Räum den Server auf'));
  assert.notEqual(merged, stored);
  assert.equal(merged.length, 2);
  assert.equal(merged[1].id, 'a1');
  assert.equal(merged[1].status, 'done');
  assert.match(merged[1].text, /Fertig/);
  // a user-stopped answer with text stays as it is (only details merged)
  const stopped = [user('Räum den Server auf'), finalizeStopped()];
  assert.equal(reconcileTranscript(stopped, remoteTurn('Räum den Server auf'))[1].status, 'stopped');
});

/** two turns within the skew window; the second was interrupted (no tool ids: only prompt text + age match) */
function twoTurns(question1: string, question2: string): ChatMessage[] {
  return [
    user(question1, T0, 'u1'),
    { id: 'a0', role: 'assistant', text: 'Erste Antwort', tools: [], status: 'done', createdAt: T0 + 1 },
    user(question2, T0 + 60_000, 'u2'),
    markInterrupted(streaming({ id: 'a2', tools: [], createdAt: T0 + 60_000 }), T0 + 70_000),
  ];
}

test('H8: a delayed inbox event of the EARLIER turn is not assigned to the newer interrupted turn', () => {
  const list = twoTurns('Frage eins', 'Frage zwei');
  // replay of the first turn's answer (same text as the delivered one)
  assert.equal(applyInboxAnswer(list, { id: 'h_s_1', content: 'Erste Antwort', timestamp: T0 + 2000 }), null);
  // any event while another turn is within the skew window is ambiguous: the stored session decides
  assert.equal(applyInboxAnswer(list, { id: 'h_s_2', content: 'Zweite Antwort', timestamp: T0 + 65_000 }), null);
  // single-turn chat: the event is assigned directly (unchanged behaviour)
  const single = interruptedChat();
  assert.equal(applyInboxAnswer(single, { id: 'h_s_3', content: 'Fertig', timestamp: T0 + 30_000 })?.[1].text, 'Fertig');
});

test('H8: ambiguous inbox event → Recovery matches the stored session by turn instead', async () => {
  let list = twoTurns('Frage eins', 'Frage zwei');
  const remote = [
    ...remoteTurn('Frage eins', { text: 'Erste Antwort', tools: [] }, T0),
    ...remoteTurn('Frage zwei', { id: 'r:4:assistant', text: 'Zweite Antwort', tools: [] }, T0 + 60_000).map((m, i) => ({ ...m, id: `r:${i + 3}` })),
  ];
  const rec = createRecovery({ get: () => list, commit: (l) => (list = l), fetchRemote: async () => remote, inboxAvailable: () => true });
  assert.equal(rec.inbox({ id: 'h_s_1', content: 'Erste Antwort', timestamp: T0 + 2000 }), false);
  await new Promise((r) => setTimeout(r, 0));
  rec.dispose();
  assert.equal(list[3].text, 'Zweite Antwort');
  assert.equal(list[3].status, 'done');
});

test('H8: poll does not take the previous answer to the same prompt while the new user row is not stored yet', () => {
  const list = twoTurns('Wie spät ist es?', 'Wie spät ist es?');
  const onlyFirst = remoteTurn('Wie spät ist es?', { text: 'Erste Antwort', tools: [] }, T0);
  assert.equal(findRemoteAnswer(list, 3, onlyFirst), null);
  const both = [
    ...onlyFirst,
    ...remoteTurn('Wie spät ist es?', { text: '12:01 Uhr', tools: [] }, T0 + 60_000).map((m, i) => ({ ...m, id: `r:${i + 3}` })),
  ];
  assert.equal(findRemoteAnswer(list, 3, both)?.text, '12:01 Uhr');
});

test('M4: retry never re-sends while the original run may still be going or the check failed', async () => {
  const list = [user('Räum den Server auf'), failInterrupted(markInterrupted(streaming(), T0 + 20_000), T0 + 700_000)];
  // session read fails transiently → wait (no resend)
  assert.equal((await harness(async () => Promise.reject(new Error('offline')), { list }).rec.checkTurn('a1')).kind, 'wait');
  // run still running on the server → wait
  assert.equal((await harness(async () => [], { list, runStatus: async () => 'running' }).rec.checkTurn('a1')).kind, 'wait');
  // the stored session has the question but no answer yet (run state unknown) → wait
  const storedQuestion = remoteTurn('Räum den Server auf').slice(0, 1);
  assert.equal((await harness(async () => storedQuestion, { list }).rec.checkTurn('a1')).kind, 'wait');
  // run known to be over without a stored answer → resend
  assert.equal((await harness(async () => storedQuestion, { list, runStatus: async () => 'failed' }).rec.checkTurn('a1')).kind, 'resend');
});

test('M4: resumeRecovering turns a given-up answer back into a recovering one', () => {
  const failed = failInterrupted(markInterrupted(streaming(), T0 + 20_000), T0 + 700_000);
  const m = resumeRecovering(failed, T0 + 800_000);
  assert.equal(isRecovering(m), true);
  assert.equal(m.error, undefined);
  assert.equal(m.interrupted, T0 + 800_000);
});

for (const trigger of ['start', 'poke'] as const) {
  test(`recovery ${trigger} reloads an answer after the offline recovery window expired`, async () => {
    const list = interruptedChat();
    list[1] = failInterrupted(list[1], T0 + RECOVERY_WINDOW_MS + 30_000);
    const h = harness(async () => remoteTurn('Räum den Server auf'), { list });
    h.rec[trigger]();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(h.list()[1].status, 'done');
    assert.equal(h.list()[1].id, list[1].id);
    assert.equal(h.clock.pending(), 0, 'late recovery is a single check, not another polling loop');
    h.rec.dispose();
  });
}
