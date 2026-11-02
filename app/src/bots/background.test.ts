/// <reference types="node" />
// Working in the background, visible (slice 5): the bridge's activity snapshot, the roster's working line, remote turns
// of a Bot Chat, and the approval reminder two minutes before Hermes' deadline. Honest states when the server cannot tell.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseActivity, remoteTurnOf, UNKNOWN_ACTIVITY, workingOf } from './activity.ts';
import { fetchActivity, stopRemoteTurn } from './aboutApi.ts';
import { plannedReminders, reminderDiff, REMINDER_BEFORE_MS, REMINDER_TAG, scheduledReminders } from './approvalReminder.ts';
import type { AttentionItem } from './core.ts';

const SNAP = {
  object: 'bots.activity',
  at: 1_000,
  turns: { known: true },
  routines: { known: true },
  data: [
    { bot: 'scout', turns: [{ sessionId: 'api_1', since: 500, steps: [{ name: 'web_search', label: 'Sucht „Kopfhörer“', state: 'done' }, { name: 'browser', state: 'running' }] }], routines: [] },
    { bot: 'default', turns: [], routines: [{ jobId: 'abc123abc123', name: 'Preis-Check', since: 900 }] },
    { bot: 'writer', turns: [], routines: [] },
    { bot: 'Bad Bot', turns: [{ sessionId: 'x' }] },
    { bot: 'scout', turns: [] },
  ],
};

test('activity: known fields only, idle bots dropped, steps capped and typed', () => {
  const s = parseActivity(SNAP, 2_000);
  assert.equal(s.known, true);
  assert.deepEqual([...s.bots.keys()], ['scout', 'default']);
  assert.deepEqual(s.bots.get('scout')?.turns[0].steps, [{ name: 'web_search', label: 'Sucht „Kopfhörer“', state: 'done' }, { name: 'browser', state: 'running' }]);
  const many = parseActivity({ ...SNAP, data: [{ bot: 'a', turns: [{ sessionId: 's', steps: Array.from({ length: 30 }, (_, i) => ({ name: `t${i}`, state: 'done' })) }] }] });
  assert.equal(many.bots.get('a')?.turns[0].steps.length, 12);
  assert.equal(many.bots.get('a')?.turns[0].steps[0].name, 't18', 'the newest steps stay');
  assert.equal(parseActivity({ object: 'list', data: [] }).known, false);
  assert.equal(parseActivity(null), UNKNOWN_ACTIVITY);
  assert.deepEqual(parseActivity({ ...SNAP, routines: { known: false, reason: 'routines_off' } }).routines, { known: false, reason: 'routines_off' });
});

test('working: the running step of the bot chat turn, a routine name, local turns, routines off ignored', () => {
  const s = parseActivity(SNAP);
  assert.deepEqual(workingOf(s, 'scout', { localRunning: false, botChatSession: 'api_1', routinesOn: true }), {
    working: true,
    chatTurn: s.bots.get('scout')!.turns[0],
    line: { kind: 'step', text: 'browser' },
  });
  assert.deepEqual(workingOf(s, undefined, { localRunning: false, routinesOn: true }), { working: true, chatTurn: null, line: { kind: 'routine', name: 'Preis-Check' } });
  // Routines switched off on this device: a running routine is not shown at all
  assert.deepEqual(workingOf(s, undefined, { localRunning: false, routinesOn: false }), { working: false, chatTurn: null, line: null });
  // the server cannot tell: only this device's own running chat counts, no invented step
  assert.deepEqual(workingOf(UNKNOWN_ACTIVITY, 'scout', { localRunning: true, routinesOn: true }), { working: true, chatTurn: null, line: null });
  assert.deepEqual(workingOf(UNKNOWN_ACTIVITY, 'scout', { localRunning: false, routinesOn: true }), { working: false, chatTurn: null, line: null });
});

test('remote turn: only when this device does not stream it and the bridge knows the session', () => {
  const s = parseActivity(SNAP);
  assert.equal(remoteTurnOf(s, 'scout', 'api_1', false)?.sessionId, 'api_1');
  assert.equal(remoteTurnOf(s, 'scout', 'api_1', true), null, 'the own stream shows its own card');
  assert.equal(remoteTurnOf(s, 'scout', 'api_2', false), null);
  assert.equal(remoteTurnOf(UNKNOWN_ACTIVITY, 'scout', 'api_1', false), null);
});

test('api: activity and remote stop at the server root; an older bridge is "unknown", never "idle"', async () => {
  const calls: { url: string; method?: string; body?: string }[] = [];
  const mk = (status: number, body: unknown) =>
    (async (url: string, init: { method?: string; body?: string }) => {
      calls.push({ url, method: init.method, body: init.body });
      return { status, text: async () => JSON.stringify(body) };
    }) as unknown as Parameters<typeof fetchActivity>[0];
  const conn = { baseUrl: 'https://bridge.example.com/v1', apiKey: 'nca_user_test_token_000' };
  assert.equal((await fetchActivity(mk(200, SNAP), conn)).known, true);
  assert.equal(calls[0].url, 'https://bridge.example.com/bridge/bots/activity');
  assert.equal((await fetchActivity(mk(404, { error: {} }), conn)).known, false);
  assert.deepEqual(await stopRemoteTurn(mk(200, { stopped: 1 }), conn, 'scout', 'api_1'), { ok: true, stopped: 1 });
  assert.deepEqual(calls.at(-1), { url: 'https://bridge.example.com/bridge/chat/stop', method: 'POST', body: '{"sessionId":"api_1","profile":"scout"}' });
  await stopRemoteTurn(mk(200, { stopped: 0 }), conn, undefined, 'api_9');
  assert.equal(calls.at(-1)?.body, '{"sessionId":"api_9"}', 'the default bot has no profile');
});

const item = (o: Partial<AttentionItem>): AttentionItem => ({ requestId: 'r1', profileId: 'p1', since: 0, source: 'chat', ...o });

test('approval reminder: two minutes before the deadline, never without one, never too close, level respected', () => {
  const now = 1_000_000;
  const all = () => 'all' as const;
  const items = [
    item({ requestId: 'r1', expiresAt: now + 300_000 }),
    item({ requestId: 'r2' }), // no deadline known
    item({ requestId: 'r3', expiresAt: now + REMINDER_BEFORE_MS + 5_000 }), // reminder would fire in 5 s
    item({ requestId: 'r4', bot: 'scout', expiresAt: now + 300_000 }),
    item({ requestId: 'r1', expiresAt: now + 300_000 }),
  ];
  assert.deepEqual(plannedReminders(items, now, all).map((r) => [r.requestId, r.at]), [['r1', now + 180_000], ['r4', now + 180_000]]);
  const level = (_p: string, bot: string) => (bot === 'scout' ? ('off' as const) : ('needed' as const));
  assert.deepEqual(plannedReminders(items, now, level).map((r) => r.requestId), ['r1'], '"Aus" has no reminder, "needed" keeps it');
});

test('approval reminder: diff keeps what is right, replaces moved deadlines, cancels answered ones', () => {
  const planned = [
    { requestId: 'a', at: 10_000, item: item({ requestId: 'a' }) },
    { requestId: 'b', at: 50_000, item: item({ requestId: 'b' }) },
  ];
  const scheduled = [
    { id: 'n1', requestId: 'a', at: 10_500 },
    { id: 'n2', requestId: 'a', at: 10_000 }, // a second copy
    { id: 'n3', requestId: 'b', at: 20_000 }, // deadline moved
    { id: 'n4', requestId: 'c', at: 30_000 }, // answered meanwhile (seen in this run)
    { id: 'n5', requestId: 'd', at: 30_000 }, // after a cold start: not reported yet, must survive
    { id: 'n6', requestId: 'e', at: 500 }, // its time has passed
  ];
  const d = reminderDiff(planned, scheduled, { known: new Set(['a', 'b', 'c']), now: 1_000 });
  assert.deepEqual(d.cancel, ['n2', 'n3', 'n4', 'n6']);
  assert.deepEqual(d.add.map((p) => p.requestId), ['b']);
  assert.deepEqual(scheduledReminders([{ id: 'x', data: { [REMINDER_TAG]: 'a', huiApprovalAt: '10000' } }, { id: 'y', data: { huiCronJob: 'j' } }]), [{ id: 'x', requestId: 'a', at: 10_000 }]);
});

test('steps of the own streaming answer: tool label when it says more than the name, running vs done', async () => {
  const { stepsOfMessage } = await import('./activity.ts');
  assert.deepEqual(
    stepsOfMessage({ tools: [{ name: 'web_search', label: 'Kopfhörer  Angebote', status: 'done' }, { name: 'terminal', label: 'terminal', status: 'error' }, { name: 'browser', label: 'browser', status: 'running' }] }),
    [{ name: 'web_search', label: 'Kopfhörer Angebote', state: 'done' }, { name: 'terminal', state: 'done' }, { name: 'browser', state: 'running' }],
  );
  assert.deepEqual(stepsOfMessage(null), []);
});

test('stopped routine step: matched to its delivery by name and time, nothing without a note', async () => {
  const { stoppedRunFor, stoppedWhat } = await import('./stoppedRuns.ts');
  const { parseInboxSummary } = await import('../routines/inbox.ts');
  const at = Date.parse('2026-10-21T07:31:00Z');
  const e = (id: string, title: string, finishedAt: string, blocked?: unknown) =>
    parseInboxSummary({ id, hermesProfile: 'scout', jobId: 'abc123abc123', title, runAt: finishedAt, finishedAt, status: 'ok', ...(blocked ? { blocked } : {}) })!;
  const entries = [
    e('ri_00000000000000000001', 'Preis-Check', '2026-10-21T07:30:40Z', { description: 'delete in root path', command: 'rm -rf /tmp/x\u0007', extra: 1 }),
    e('ri_00000000000000000002', 'Preis-Check', '2026-10-20T07:30:40Z', { description: 'recursive delete' }), // yesterday
    e('ri_00000000000000000003', 'Briefing', '2026-10-21T07:30:00Z', { description: 'x' }),
    e('ri_00000000000000000004', 'Preis-Check', '2026-10-21T07:29:00Z'), // no note
  ];
  assert.deepEqual(entries[0].stopped, { description: 'delete in root path', command: 'rm -rf /tmp/x' });
  const hit = stoppedRunFor(entries, { name: '[bot:scout] preis-check', at });
  assert.deepEqual(hit, { entryId: 'ri_00000000000000000001', jobId: 'abc123abc123', routine: 'Preis-Check', description: 'delete in root path', command: 'rm -rf /tmp/x' });
  assert.equal(stoppedWhat(hit!), 'rm -rf /tmp/x');
  assert.equal(stoppedRunFor(entries, { name: 'Preis-Check', at: at + 3 * 3600_000 }), null, 'too far from the run');
  assert.equal(stoppedRunFor(entries, { name: 'Wetter', at }), null);
  assert.equal(stoppedRunFor(entries, { name: 'Preis-Check' }), null, 'no time, no guess');
  assert.equal(stoppedWhat({ entryId: 'x', jobId: 'j', routine: 'r' }), null);
});

test('stopped routine step: one card per stopped run, under its closest delivery (a routine every 5 min delivers often)', async () => {
  const { stoppedRunsByDelivery } = await import('./stoppedRuns.ts');
  const { parseInboxSummary } = await import('../routines/inbox.ts');
  const e = (id: string, finishedAt: string, blocked?: unknown) =>
    parseInboxSummary({ id, hermesProfile: 'scout', jobId: 'abc123abc123', title: 'Preis-Check', runAt: finishedAt, finishedAt, status: 'ok', ...(blocked ? { blocked } : {}) })!;
  const entries = [e('ri_00000000000000000001', '2026-10-21T07:30:40Z', { description: 'delete in root path' }), e('ri_00000000000000000002', '2026-10-21T07:35:40Z')];
  const at = (t: string) => Date.parse(`2026-10-21T${t}Z`);
  const runs = stoppedRunsByDelivery(entries, [
    { key: 'm1', name: 'Preis-Check', at: at('07:26:00') },
    { key: 'm2', name: 'Preis-Check', at: at('07:31:00') }, // the stopped run's delivery
    { key: 'm3', name: 'Preis-Check', at: at('07:36:00') },
    { key: 'm4', name: 'Wetter', at: at('07:31:00') },
  ]);
  assert.deepEqual([...runs.keys()], ['m2']);
  assert.equal(runs.get('m2')!.entryId, 'ri_00000000000000000001');
  assert.equal(stoppedRunsByDelivery(entries, []).size, 0);
});

test('working card: whole seconds for a minute (never "6 ms"), then whole minutes with a calmer tick', async () => {
  const { workingElapsed } = await import('./activity.ts');
  assert.deepEqual(workingElapsed(1_000_006, 1_000_000), { text: '1 s', tickMs: 1000 });
  assert.deepEqual(workingElapsed(1_002_999, 1_000_000), { text: '2 s', tickMs: 1000 });
  assert.deepEqual(workingElapsed(1_000_000, 1_000_500), { text: '1 s', tickMs: 1000 }, 'a start in the future: still 1 s');
  assert.deepEqual(workingElapsed(1_065_400, 1_000_000), { text: '1 min', tickMs: 15_000 });
  assert.deepEqual(workingElapsed(1_000_000 + 7 * 60_000 + 59_000, 1_000_000), { text: '7 min', tickMs: 15_000 });
});

test('activity: start times move onto this device\'s clock by the server time (a skewed phone clock)', async () => {
  const { parseActivity } = await import('./activity.ts');
  const local = 1_000_000_000;
  const server = local + 54_000; // the server's clock is 54 s ahead
  const snap = parseActivity({ object: 'bots.activity', at: server, turns: { known: true }, routines: { known: true }, data: [{ bot: 'research', turns: [{ sessionId: 's1', since: server - 25_000, steps: [] }], routines: [{ jobId: 'j1', name: 'Briefing', since: server - 60_000 }] }] }, local);
  assert.equal(snap.bots.get('research')!.turns[0].since, local - 25_000, 'the turn is 25 s old on this device too');
  assert.equal(snap.bots.get('research')!.routines[0].since, local - 60_000);
  const ahead = parseActivity({ object: 'bots.activity', at: local, data: [{ bot: 'research', turns: [{ sessionId: 's1', since: local + 5_000, steps: [] }], routines: [] }] }, local);
  assert.equal(ahead.bots.get('research')!.turns[0].since, local, 'never in the future');
});
