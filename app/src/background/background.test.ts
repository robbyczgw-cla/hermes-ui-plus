/// <reference types="node" />
// Background turns: per-conversation turn registry (chat switch keeps streaming), cut detection + "Fortsetzen"
// request building per backend, neutral cancelled tools, "Antwort ist da" routing + de-duplication, Hermes
// recovery with a realistic sessions-API payload, the Android keep-alive controller.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTurnRegistry, keptSessions, mountedSessionIds, MAX_BACKGROUND_TURNS, type RunningTurn } from './turnRegistry.ts';
import { applyBackgroundCut, cancelRunningTools, CONTINUE_PROMPT, CONTINUE_PROMPT_EMPTY, isConnectionLoss, isCut, planContinue } from './cut.ts';
import { createNoticeDeduper, firstLine, noticeKey, notificationBody, routeNotice, type NoticeContext } from './notice.ts';
import { createNoticeDelivery, flashStore, pillStore, recoveredAnswers, unreadStore, markRead } from './noticeState.ts';
import { createKeepAliveController, createTaskSlot } from './keepAlive.ts';
import { createThrottledSaver } from '../conversations/partialSave.ts';
import { mapRemoteMessages } from '../hermes/sessionMapping.ts';
import { applyInboxAnswer, applyRemoteAnswer, markInterrupted } from '../hermes/recovery.ts';
import { parseTarget } from '../push/model.ts';
import type { ChatMessage, ToolEvent } from '../hermes/types.ts';
import { parseMessages } from '../hermes/sessions.ts';

const T0 = 1_800_000_000_000;
const user = (text: string, id = 'u1', at = T0): ChatMessage => ({ id, role: 'user', text, tools: [], status: 'done', createdAt: at });
const tool = (id: string, status: ToolEvent['status'] = 'done'): ToolEvent => ({ id, name: 'web_search', label: id, status, startedAt: T0 });
const answer = (over: Partial<ChatMessage> = {}): ChatMessage => ({ id: 'a1', role: 'assistant', text: 'Teil eins', tools: [], status: 'done', createdAt: T0 + 1, ...over });
const turn = (conversationId: string, startedAt: number, stop?: () => void): RunningTurn => ({ conversationId, label: 'ChatGPT', startedAt, stop });

// ------------------------------------------------------------------ chat switch: the turn belongs to its conversation

test('switch chat mid-stream → the running session stays mounted (hidden); coming back shows the same instance', () => {
  const reg = createTurnRegistry();
  reg.begin(turn('A', T0));
  // user is in A: nothing extra
  assert.deepEqual(keptSessions('A', reg.snapshot()), []);
  assert.deepEqual(mountedSessionIds('A', []), ['A']);
  // user switches to B while A streams: A is kept (rendered hidden), B is the open one
  const kept = keptSessions('B', reg.snapshot());
  assert.deepEqual(kept, ['A']);
  assert.deepEqual(mountedSessionIds('B', kept), ['A', 'B']);
  // back to A while it still runs: one session for A (same key → same hook instance, no duplicate messages)
  const back = mountedSessionIds('A', keptSessions('A', reg.snapshot()));
  assert.deepEqual(back, ['A']);
  // the order is stable (by id) → React never re-parents a running session
  assert.deepEqual(mountedSessionIds('B', ['A']), mountedSessionIds('A', ['B']));
  // A ends while the user is in B → unmounted after its own final save
  reg.end('A');
  assert.deepEqual(keptSessions('B', reg.snapshot()), []);
});

test('switch chat mid-stream → partial saves keep landing in the conversation that started the turn', () => {
  const saved: { conv: string; text: string }[] = [];
  const pending: (() => void)[] = [];
  const timers = { set: (fn: () => void) => pending.push(fn), clear: () => {} };
  // each session binds its saver to its own conversation (conv.save of useConversation(id))
  const saverA = createThrottledSaver((m) => saved.push({ conv: 'A', text: m[m.length - 1].text }), 2500, timers);
  const streamA = [user('Frage A'), answer({ status: 'streaming', text: 'Antw' })];
  saverA.now(streamA);
  // the user switched to B (A keeps streaming hidden): tokens still go through A's saver
  saverA.update([user('Frage A'), answer({ status: 'streaming', text: 'Antwort A wächst' })]);
  pending.shift()?.(); // 2.5 s later, the user is in B by now
  saverA.update([user('Frage A'), answer({ status: 'done', text: 'Antwort A fertig' })]);
  saverA.flush(); // turn end (onTurnEnd) / unmount
  assert.ok(saved.length >= 2);
  assert.ok(saved.every((s) => s.conv === 'A'));
  assert.equal(saved[saved.length - 1].text, 'Antwort A fertig');
});

test('at most MAX_BACKGROUND_TURNS hidden turns: the oldest falls out (its hook aborts → stored as stopped)', () => {
  const reg = createTurnRegistry();
  for (let i = 0; i < MAX_BACKGROUND_TURNS + 2; i++) reg.begin(turn(`c${i}`, T0 + i));
  const kept = keptSessions('open', reg.snapshot());
  assert.equal(kept.length, MAX_BACKGROUND_TURNS);
  assert.deepEqual(kept, ['c4', 'c3', 'c2']);
  // the open chat never counts against the limit
  assert.deepEqual(keptSessions('c4', reg.snapshot()), ['c3', 'c2', 'c1']);
});

test('stop works from either place: the chat (hook) or the registry (notification / drawer)', () => {
  const reg = createTurnRegistry();
  const stopped: string[] = [];
  reg.begin(turn('A', T0, () => stopped.push('A')));
  reg.begin(turn('B', T0 + 1, () => stopped.push('B')));
  assert.equal(reg.stop('A'), true);
  assert.deepEqual(stopped, ['A']);
  assert.equal(reg.stopAll(), 2);
  assert.deepEqual(stopped, ['A', 'A', 'B']);
  assert.equal(reg.stop('nope'), false);
});

test('registry: begin is idempotent (keeps startedAt, no needless emits), snapshot identity changes only on change', () => {
  const reg = createTurnRegistry();
  let emits = 0;
  reg.subscribe(() => emits++);
  const stop = () => {};
  reg.begin({ conversationId: 'A', label: 'X', startedAt: 1, stop });
  const snap = reg.snapshot();
  reg.begin({ conversationId: 'A', label: 'X', startedAt: 99, stop });
  assert.equal(reg.snapshot(), snap);
  assert.equal(emits, 1);
  reg.begin({ conversationId: 'A', label: 'Y', startedAt: 99, stop });
  assert.equal(reg.snapshot()[0].startedAt, 1);
  assert.equal(emits, 2);
  reg.end('A');
  reg.end('A');
  assert.equal(emits, 3);
  assert.equal(reg.isRunning('A'), false);
});

// ------------------------------------------------------------------ cut detection

test('background → connection error → cut: partial text, tools and search results kept, calm keyed notice', () => {
  const failed = answer({
    status: 'error',
    text: 'Bisher gefunden: …',
    error: 'Keine Verbindung zu ChatGPT. Bitte Netzwerk prüfen. (Software caused connection abort)',
    errorText: { key: 'backends.hermes.errors.networkDetail' as never, params: { detail: 'Software caused connection abort' } },
    tools: [{ ...tool('ws1'), detail: { links: [{ title: 'Quelle', url: 'https://example.org' }] } }, tool('ws2', 'running')],
  });
  const list = [user('Recherchiere'), failed];
  const out = applyBackgroundCut(list, { backgrounded: true, now: T0 + 9, platform: 'android' });
  const m = out[1];
  assert.equal(isCut(m), true);
  assert.equal(m.cutInBackground, T0 + 9);
  assert.equal(m.errorText?.key, 'chat.backgroundCut.android');
  assert.match(m.error ?? '', /Hintergrund – Android hat die Verbindung getrennt/);
  assert.equal(m.text, 'Bisher gefunden: …');
  assert.deepEqual(m.tools[0].detail?.links, [{ title: 'Quelle', url: 'https://example.org' }]);
  assert.equal(m.tools[1].status, 'done');
  assert.equal(m.tools[1].detail?.cancelled, true);
  // iOS / web wording
  assert.equal(applyBackgroundCut(list, { backgrounded: true, now: 1, platform: 'ios' })[1].errorText?.key, 'chat.backgroundCut.other');
});

test('no cut: app stayed in the foreground, HTTP/auth errors, stopped turns, done turns', () => {
  const net = answer({ status: 'error', error: 'x', errorText: { key: 'backends.errors.network' as never } });
  const list = [user('q'), net];
  assert.equal(applyBackgroundCut(list, { backgrounded: false, now: 1, platform: 'android' }), list);
  const auth = [user('q'), answer({ status: 'error', error: 'Anmeldung abgelaufen', errorText: { key: 'backends.hermes.errors.authDenied' as never } })];
  assert.equal(applyBackgroundCut(auth, { backgrounded: true, now: 1, platform: 'android' }), auth);
  const stopped = [user('q'), answer({ status: 'stopped' })];
  assert.equal(applyBackgroundCut(stopped, { backgrounded: true, now: 1, platform: 'android' }), stopped);
  const done = [user('q'), answer()];
  assert.equal(applyBackgroundCut(done, { backgrounded: true, now: 1, platform: 'android' }), done);
});

test('isConnectionLoss: network/timeout/stream keys of all backends + unkeyed reducer texts; not HTTP errors', () => {
  for (const key of ['backends.errors.network', 'backends.hermes.errors.networkDetail', 'backends.hermes.errors.timeout', 'backends.hermes.errors.streamUnexpected']) {
    assert.equal(isConnectionLoss({ error: 'x', errorText: { key: key as never } }), true, key);
  }
  assert.equal(isConnectionLoss({ error: 'Die Verbindung wurde unerwartet beendet.' }), true);
  assert.equal(isConnectionLoss({ error: 'Die Verbindung zum Server wurde unterbrochen, die Antwort ist unvollständig.' }), true);
  assert.equal(isConnectionLoss({ error: 'x', errorText: { key: 'backends.hermes.errors.retryAfter' as never } }), false);
  assert.equal(isConnectionLoss({ error: 'Nutzungslimit erreicht.' }), false);
});

test('cancelRunningTools: only running tools, failed ones stay red', () => {
  const out = cancelRunningTools([tool('a'), tool('b', 'error'), tool('c', 'running')], 5);
  assert.deepEqual(out.map((t) => [t.status, !!t.detail?.cancelled]), [['done', false], ['error', false], ['done', true]]);
});



// ------------------------------------------------------------------ "Fortsetzen"

const cutList = (): ChatMessage[] => [
  user('Erste Frage', 'u0', T0 - 10_000),
  answer({ id: 'a0', text: 'Erste Antwort', createdAt: T0 - 9000 }),
  user('Recherchiere X', 'u1', T0),
  answer({
    id: 'a1',
    status: 'error',
    text: 'Zwischenstand: Punkt 1 ist',
    cutInBackground: T0 + 57_800,
    error: 'Die App war im Hintergrund – Android hat die Verbindung getrennt.',
    errorText: { key: 'chat.backgroundCut.android' as never },
    tools: [tool('ws1')],
    metrics: { startedAt: T0, endedAt: T0 + 57_800 } as ChatMessage['metrics'],
  }),
];

test('planContinue: same message streams again (id, text, tools kept); history = partial + hidden continue prompt', () => {
  const plan = planContinue(cutList(), T0 + 100_000);
  assert.ok(plan);
  const m = plan.messages[plan.messages.length - 1];
  assert.equal(plan.messages.length, 4, 'no extra bubbles');
  assert.equal(m.id, 'a1');
  assert.equal(m.status, 'streaming');
  assert.equal(m.text, 'Zwischenstand: Punkt 1 ist');
  assert.equal(m.tools.length, 1);
  assert.equal(m.error, undefined);
  assert.equal(m.errorText, undefined);
  assert.equal(m.cutInBackground, undefined);
  assert.equal(m.continuedAt, T0 + 100_000);
  assert.equal(m.metrics?.endedAt, undefined, 'the continuation sets a new end time');
  const h = plan.history;
  assert.equal(h[h.length - 1].role, 'user');
  assert.equal(h[h.length - 1].text, CONTINUE_PROMPT);
  assert.equal(h[h.length - 2].role, 'assistant');
  assert.equal(h[h.length - 2].status, 'done');
  assert.equal(h[h.length - 2].text, 'Zwischenstand: Punkt 1 ist');
  // the continue prompt is never stored
  assert.ok(!plan.messages.some((x) => x.text === CONTINUE_PROMPT));
});

test('planContinue: nothing written yet → plain "answer now" prompt; nothing to continue → null', () => {
  const list = [user('Frage'), answer({ status: 'error', text: '', error: 'x' })];
  const plan = planContinue(list, 1);
  assert.ok(plan);
  assert.equal(plan.history[plan.history.length - 1].text, CONTINUE_PROMPT_EMPTY);
  assert.ok(!plan.history.some((m) => m.role === 'assistant'));
  assert.equal(planContinue([user('x')], 1), null);
  assert.equal(planContinue([user('x'), answer()], 1), null, 'a finished answer is not continued');
  assert.equal(planContinue([answer({ status: 'error' })], 1), null);
});


// ------------------------------------------------------------------ "Antwort ist da": routing

const ctx = (over: Partial<NoticeContext> = {}): NoticeContext => ({ appActive: true, openConversationId: 'A', chatFocused: true, nearBottom: true, ...over });

test('routeNotice: background → notification; other chat / other screen → banner; scrolled away → pill; else flash only for late answers', () => {
  const ev = { conversationId: 'A', message: answer() };
  assert.equal(routeNotice(ev, ctx({ appActive: false })), 'notification');
  assert.equal(routeNotice(ev, ctx({ openConversationId: 'B' })), 'banner');
  assert.equal(routeNotice(ev, ctx({ chatFocused: false })), 'banner');
  assert.equal(routeNotice(ev, ctx({ nearBottom: false })), 'pill');
  assert.equal(routeNotice(ev, ctx()), 'none');
  assert.equal(routeNotice({ ...ev, late: true }, ctx()), 'flash');
  // stopped / failed / empty turns get no "ready" notice
  assert.equal(routeNotice({ conversationId: 'A', message: answer({ status: 'error' }) }, ctx({ appActive: false })), 'none');
  assert.equal(routeNotice({ conversationId: 'A', message: answer({ status: 'stopped' }) }, ctx({ appActive: false })), 'none');
  assert.equal(routeNotice({ conversationId: 'A', message: answer({ text: ' ' }) }, ctx({ appActive: false })), 'none');
});

test('notice delivery: one notice per finished turn even when inbox + sync + turn end all report it', () => {
  let c = ctx({ appActive: false });
  const notified: string[] = [];
  const banners: string[] = [];
  const deliver = createNoticeDelivery({ context: () => c, enabled: () => true, notify: (e) => notified.push(e.message.id), banner: (e) => banners.push(e.message.id), now: () => T0 });
  const m = answer({ id: 'a7', recoveredAt: T0 });
  assert.equal(deliver({ conversationId: 'A', message: m, late: true }), 'notification'); // inbox
  assert.equal(deliver({ conversationId: 'A', message: { ...m, text: m.text + ' (sync)' }, late: true }), 'none'); // transcript sync, same id
  c = ctx({ openConversationId: 'B' });
  assert.equal(deliver({ conversationId: 'A', message: m }), 'none'); // the open chat's onTurnEnd later
  assert.deepEqual(notified, ['a7']);
  assert.deepEqual(banners, []);
  assert.ok(unreadStore.get().has('A'));
  markRead('A');
  assert.ok(!unreadStore.get().has('A'));
});

test('notice delivery: routed at once, the system notification only once the answer is written', async () => {
  let c = ctx({ appActive: false });
  const notified: string[] = [];
  const deliver = createNoticeDelivery({ context: () => c, enabled: () => true, notify: (e) => notified.push(e.message.id), banner: () => assert.fail('no banner'), now: () => T0 });
  let written!: () => void;
  const write = new Promise<void>((r) => (written = r));
  assert.equal(deliver({ conversationId: 'W', message: answer({ id: 'w1' }), written: write }), 'notification');
  assert.ok(unreadStore.get().has('W'), 'unread at once');
  c = ctx({ openConversationId: 'W' }); // the user opens the app before the write is done: the decision stands
  await tick();
  assert.deepEqual(notified, [], 'nothing shown before the write');
  written();
  await write;
  await tick();
  assert.deepEqual(notified, ['w1']);
  // a failed write (reported + retried by the repo) still shows the answer that is in memory
  c = ctx({ appActive: false });
  assert.equal(deliver({ conversationId: 'W', message: answer({ id: 'w3' }), written: Promise.reject(new Error('disk full')) }), 'notification');
  await tick();
  assert.deepEqual(notified, ['w1', 'w3']);
  markRead('W');
});

test('notice delivery: banner + unread for another chat, pill when scrolled away, flash for a late answer, setting off', () => {
  const banners: string[] = [];
  let enabled = true;
  let c = ctx({ openConversationId: 'B' });
  const deliver = createNoticeDelivery({ context: () => c, enabled: () => enabled, notify: () => assert.fail('no notification in the foreground'), banner: (e) => banners.push(e.conversationId), now: () => T0 });
  assert.equal(deliver({ conversationId: 'A', message: answer({ id: 'x1' }) }), 'banner');
  assert.deepEqual(banners, ['A']);
  assert.ok(unreadStore.get().has('A'));
  c = ctx({ nearBottom: false });
  assert.equal(deliver({ conversationId: 'A', message: answer({ id: 'x2' }) }), 'pill');
  assert.equal(pillStore.get().get('A'), 'x2');
  c = ctx();
  assert.equal(deliver({ conversationId: 'A', message: answer({ id: 'x3' }), late: true }), 'flash');
  assert.ok((flashStore.get().get('x3') ?? 0) > T0);
  // "Benachrichtigen …" off: no banner/notification, but the drawer dot stays
  enabled = false;
  c = ctx({ openConversationId: 'B' });
  markRead('C');
  assert.equal(deliver({ conversationId: 'C', message: answer({ id: 'x4' }) }), 'banner');
  assert.deepEqual(banners, ['A']);
  assert.ok(unreadStore.get().has('C'));
  markRead('A');
  markRead('C');
});

test('deduper is bounded and keyed per conversation + message', () => {
  const d = createNoticeDeduper(2);
  assert.equal(d.first('a'), true);
  assert.equal(d.first('a'), false);
  d.first('b');
  d.first('c');
  assert.equal(d.has('a'), false, 'oldest evicted');
  assert.equal(noticeKey({ conversationId: 'A', message: answer({ id: 'm' }) }), 'A:m');
});

test('notification body: first readable line without hui/code blocks; previews off → generic text', () => {
  const text = '```hui\n{"type":"callout","text":"x"}\n```\n\n## **Ergebnis**: 3 Treffer\n\nMehr Text';
  assert.equal(firstLine(text), 'Ergebnis: 3 Treffer');
  assert.equal(firstLine('- [Link](https://x.y) am Anfang'), 'Link am Anfang');
  assert.equal(firstLine('```hui\n{}\n```'), '');
  assert.equal(notificationBody(answer({ text }), false, 'Deine Antwort ist fertig.'), 'Deine Antwort ist fertig.');
  assert.equal(notificationBody(answer({ text: '```hui\n{}\n```' }), true, 'G'), 'G');
  assert.equal(firstLine('x'.repeat(300), 10).length, 10);
});

test('notification tap target: `turn` notifications open their conversation', () => {
  assert.deepEqual(parseTarget({ src: 'turn', profileId: 'p1', conversationId: 'c9', messageId: 'a1' }), {
    src: 'turn',
    profileId: 'p1',
    conversationId: 'c9',
    sessionId: undefined,
    agent: undefined,
    source: undefined,
    messageId: 'a1',
  });
  assert.equal(parseTarget({ src: 'turn', profileId: 'p1' }), null);
});

// ------------------------------------------------------------------ Hermes recovery, realistic sessions payload

/** GET /api/sessions/{id}/messages (wire shape, seconds) of a deep-research turn: two tool calls, then the final answer with hui blocks */
const SESSION_PAYLOAD = { object: 'list', session_id: 'hui-s1', pagination: { limit: 50, offset: 0, order: 'latest', returned: 5 }, data: [
  { id: 900, role: 'user', content: 'Vergleiche die drei Akkus', timestamp: (T0 + 1000) / 1000 },
  {
    id: 901,
    role: 'assistant',
    content: 'Ich suche zuerst die Datenblätter.',
    tool_calls: [
      { id: 'call_a', call_id: 'call_a', type: 'function', function: { name: 'web_search', arguments: '{"query":"Akku A Datenblatt"}' } },
      { id: 'call_b', call_id: 'call_b', type: 'function', function: { name: 'web_extract', arguments: '{"urls":["https://example.org/b"]}' } },
    ],
    timestamp: (T0 + 4000) / 1000,
    finish_reason: 'tool_calls',
  },
  { id: 902, role: 'tool', tool_call_id: 'call_a', tool_name: 'web_search', content: '{"results":[{"title":"A","url":"https://example.org/a"}]}', timestamp: (T0 + 6000) / 1000 },
  { id: 903, role: 'tool', tool_call_id: 'call_b', tool_name: 'web_extract', content: '{"output":"Kapazität 5000 mAh"}', timestamp: (T0 + 9000) / 1000 },
  {
    id: 904,
    role: 'assistant',
    content: 'Hier der Vergleich:\n\n```hui\n{"type":"table","columns":["Akku","mAh"],"rows":[["A","4500"],["B","5000"]]}\n```\n\nFazit: B hält am längsten.',
    timestamp: (T0 + 167_000) / 1000,
    finish_reason: 'stop',
  },
] };

test('recovery with a realistic sessions payload: replaced in place, earlier tool steps kept + merged, hui blocks intact, notice once', () => {
  const live = markInterrupted(
    {
      id: 'a-live',
      role: 'assistant',
      text: 'Ich suche zuerst die Datenblätter.',
      tools: [{ id: 'call_a', name: 'web_search', label: 'Akku A Datenblatt', status: 'running', startedAt: T0 + 4000 }],
      status: 'streaming',
      createdAt: T0 + 1000,
    },
    T0 + 17_900,
  );
  const list: ChatMessage[] = [user('Vergleiche die drei Akkus', 'u-live', T0 + 1000), live];
  const remote = mapRemoteMessages(parseMessages(SESSION_PAYLOAD, 'hui-s1').messages);
  const next = applyRemoteAnswer(list, remote);
  assert.ok(next);
  assert.equal(next.length, 2, 'no second bubble');
  const m = next[1];
  assert.equal(m.id, 'a-live', 'same message replaced in place');
  assert.equal(m.status, 'done');
  assert.equal(m.interrupted, undefined);
  assert.ok(m.recoveredAt !== undefined, '"nachgeladen" cue');
  assert.match(m.text, /```hui\n\{"type":"table"/);
  assert.match(m.text, /Fazit: B hält am längsten\./);
  const ids = m.tools.map((t) => t.id);
  assert.ok(ids.includes('call_a') && ids.includes('call_b'), `tools merged: ${ids.join(',')}`);
  assert.ok(m.tools.every((t) => t.status !== 'running'));
  // notice: the recovery paths report exactly this answer, once
  const rec = recoveredAnswers(list, next);
  assert.deepEqual(rec.map((x) => x.id), ['a-live']);
  // a later inbox event for the same turn does not create a second answer
  assert.equal(applyInboxAnswer(next, { id: 'ev', content: 'Hier der Vergleich', timestamp: T0 + 167_000 }), null);
  // nothing recovered → nothing reported
  assert.deepEqual(recoveredAnswers(next, next), []);
});

// ------------------------------------------------------------------ Android keep-alive controller

function fakeModule() {
  const calls: string[] = [];
  const listeners: Record<string, () => void> = {};
  return {
    calls,
    emit: (e: string) => listeners[e]?.(),
    module: {
      start: async (title: string, text: string) => {
        calls.push(`start:${title}|${text}`);
        return true;
      },
      update: async (title: string, text: string) => {
        calls.push(`update:${title}|${text}`);
        return true;
      },
      stop: async () => {
        calls.push('stop');
        return true;
      },
      addListener: (e: 'onStopRequested' | 'onTimeout' | 'onStartFailed', fn: () => void) => {
        listeners[e] = fn;
        return { remove: () => delete listeners[e] };
      },
    },
  };
}
const texts = () => ({ title: (v: { name: string }) => `${v.name} antwortet …`, one: () => 'läuft', many: (v: { count: number }) => `${v.count} laufen`, stop: 'Stopp', channel: 'Laufende Antworten' });
const tick = () => new Promise((r) => setTimeout(r, 0));

test('keep-alive: foreground service for the duration of any running turn; text follows; stopped at the end', async () => {
  const reg = createTurnRegistry();
  const f = fakeModule();
  let enabled = true;
  const ctl = createKeepAliveController({ module: f.module, registry: reg, enabled: () => enabled, texts });
  reg.begin({ conversationId: 'A', label: 'ChatGPT', startedAt: 1 });
  await tick();
  assert.deepEqual(f.calls, ['start:ChatGPT antwortet …|läuft']);
  let taskEnded = false;
  void ctl.task().then(() => (taskEnded = true));
  reg.begin({ conversationId: 'B', label: 'Claude', startedAt: 2 });
  await tick();
  assert.equal(f.calls[1], 'update:Claude antwortet …|2 laufen');
  reg.end('A');
  await tick();
  assert.equal(taskEnded, false);
  reg.end('B');
  await tick();
  assert.equal(f.calls[f.calls.length - 1], 'stop');
  assert.equal(taskEnded, true, 'headless task released');
  // setting off → never started
  enabled = false;
  reg.begin({ conversationId: 'C', label: 'Demo', startedAt: 3 });
  await tick();
  assert.equal(f.calls.filter((c) => c.startsWith('start')).length, 1);
  reg.end('C');
  ctl.dispose();
});

test('keep-alive: the service (and its headless task) is held until the ended turn\'s final write is done', async () => {
  const reg = createTurnRegistry();
  const f = fakeModule();
  const ctl = createKeepAliveController({ module: f.module, registry: reg, enabled: () => true, texts });
  reg.begin({ conversationId: 'A', label: 'ChatGPT', startedAt: 1 });
  await tick();
  let taskEnded = false;
  void ctl.task().then(() => (taskEnded = true));
  // turn end: the final write starts (useSessionPersistence onTurnEnd), then the registry hears the end (effect)
  let written!: () => void;
  const write = reg.settle(new Promise<void>((r) => (written = r)));
  reg.end('A');
  await tick();
  assert.equal(reg.saving(), 1);
  assert.equal(f.calls.includes('stop'), false, 'not stopped while the final write runs');
  assert.equal(taskEnded, false, 'JS timers stay alive meanwhile');
  written();
  await write;
  await tick();
  assert.equal(reg.saving(), 0);
  assert.equal(f.calls[f.calls.length - 1], 'stop');
  assert.equal(taskEnded, true);
  // a failed write releases it too; a write with no service running never starts one
  void reg.settle(Promise.reject(new Error('disk full'))).catch(() => {});
  await tick();
  assert.equal(reg.saving(), 0);
  assert.equal(f.calls.filter((c) => c.startsWith('start')).length, 1);
  ctl.dispose();
});

test('keep-alive: notification "Stopp" stops every turn and does not restart until all have ended', async () => {
  const reg = createTurnRegistry();
  const f = fakeModule();
  const stopped: string[] = [];
  createKeepAliveController({ module: f.module, registry: reg, enabled: () => true, texts });
  reg.begin({ conversationId: 'A', label: 'X', startedAt: 1, stop: () => stopped.push('A') });
  await tick();
  f.emit('onStopRequested');
  assert.deepEqual(stopped, ['A']);
  // the hook re-registers (label change) before its abort lands → no new service
  reg.begin({ conversationId: 'A', label: 'X2', startedAt: 1, stop: () => stopped.push('A') });
  await tick();
  assert.equal(f.calls.filter((c) => c.startsWith('start')).length, 1);
  reg.end('A');
  await tick();
  // next turn: allowed again
  reg.begin({ conversationId: 'B', label: 'Y', startedAt: 2 });
  await tick();
  assert.equal(f.calls.filter((c) => c.startsWith('start')).length, 2);
});

test('keep-alive: a refused start (background / time limit) falls back quietly', async () => {
  const reg = createTurnRegistry();
  const f = fakeModule();
  f.module.start = async () => false;
  const logs: string[] = [];
  const ctl = createKeepAliveController({ module: f.module, registry: reg, enabled: () => true, texts, log: (m) => logs.push(m) });
  reg.begin({ conversationId: 'A', label: 'X', startedAt: 1 });
  await tick();
  assert.equal(ctl.state(), 'idle');
  assert.equal(logs.length, 1);
});

test('keep-alive: a start that fails after the acknowledgement (onStartFailed) resets the state, no restart loop', async () => {
  const reg = createTurnRegistry();
  const f = fakeModule();
  const logs: string[] = [];
  const ctl = createKeepAliveController({ module: f.module, registry: reg, enabled: () => true, texts, log: (m) => logs.push(m) });
  reg.begin({ conversationId: 'A', label: 'X', startedAt: 1 });
  await tick();
  assert.equal(ctl.state(), 'running');
  let taskEnded = false;
  void ctl.task().then(() => (taskEnded = true));
  f.emit('onStartFailed');
  await tick();
  assert.equal(ctl.state(), 'idle');
  assert.equal(taskEnded, true, 'headless task promise released');
  reg.begin({ conversationId: 'B', label: 'Y', startedAt: 2 });
  await tick();
  assert.equal(f.calls.filter((c) => c.startsWith('start')).length, 1, 'no retry while turns still run');
  reg.end('A');
  reg.end('B');
  await tick();
  reg.begin({ conversationId: 'C', label: 'Z', startedAt: 3 });
  await tick();
  assert.equal(f.calls.filter((c) => c.startsWith('start')).length, 2, 'next turn may start again');
  ctl.dispose();
});

test('keep-alive: update() reporting a stopped service resets the running state', async () => {
  const reg = createTurnRegistry();
  const f = fakeModule();
  f.module.update = async () => false;
  const ctl = createKeepAliveController({ module: f.module, registry: reg, enabled: () => true, texts });
  reg.begin({ conversationId: 'A', label: 'X', startedAt: 1 });
  await tick();
  assert.equal(ctl.state(), 'running');
  reg.begin({ conversationId: 'B', label: 'Y', startedAt: 2 });
  await tick();
  assert.equal(ctl.state(), 'idle');
  ctl.dispose();
});


test('a turn ending while service start is pending keeps the headless task through its final write', async () => {
  const reg = createTurnRegistry();
  const f = fakeModule();
  let started!: (ok: boolean) => void;
  f.module.start = () => new Promise<boolean>(r => { started = r; });
  const ctl = createKeepAliveController({ module: f.module, registry: reg, enabled: () => true, texts });
  reg.begin({ conversationId: 'test-chat', label: 'Hermes', startedAt: 1 });
  let taskEnded = false;
  void ctl.task().then(() => { taskEnded = true; });
  let written!: () => void;
  const write = reg.settle(new Promise<void>(r => { written = r; }));
  reg.end('test-chat');
  await tick();
  assert.equal(taskEnded, false, 'starting state must also retain the task');
  started(true);
  await tick();
  assert.equal(taskEnded, false);
  written();
  await write;
  await tick();
  assert.equal(taskEnded, true);
  ctl.dispose();
});

test('activity relaunch (theme change): the old host unmounting after the new one mounted keeps the new headless task', async () => {
  // smoke-3 2026-10-16: new surface "Running main" 37 ms before the old surface stopped; the old cleanup reset the
  // task body, the next service's headless task ended at once and Android stopped the service 24 ms after its start
  const slot = createTaskSlot();
  const reg = createTurnRegistry();
  const oldCtl = createKeepAliveController({ module: fakeModule().module, registry: reg, enabled: () => true, texts });
  const releaseOld = slot.claim(() => oldCtl.task());
  const f = fakeModule();
  const newCtl = createKeepAliveController({ module: f.module, registry: reg, enabled: () => true, texts });
  const releaseNew = slot.claim(() => newCtl.task()); // new surface mounts first …
  releaseOld(); // … then the old one unmounts
  oldCtl.dispose();
  reg.begin({ conversationId: 'test-chat', label: 'Hermes', startedAt: 1 });
  await tick();
  let taskEnded = false;
  void slot.run().then(() => { taskEnded = true; }); // the service's headless task
  await tick();
  assert.equal(taskEnded, false, 'the headless task must run until the turn ends');
  reg.end('test-chat');
  await tick();
  assert.equal(taskEnded, true);
  releaseNew();
  let idleEnded = false;
  void slot.run().then(() => { idleEnded = true; });
  await tick();
  assert.equal(idleEnded, true, 'without an owner the task ends at once');
  newCtl.dispose();
});
