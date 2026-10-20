/// <reference types="node" />
// Routines slice 2: rights, inbox client + parsing, availability, demo localization + demo inbox, continue-in-chat
// seed, inbox action policy, live event parsing, push target / registration sources. Fixtures are invented
// (ids like ri_aaaa…, example.com, fake tokens).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeT } from '../i18n/core.ts';
import { HermesError, type FetchLike } from '../hermes/stream.ts';
import { parseJobList } from './jobs.ts';
import { controlsFor } from './status.ts';
import { canManage, parseCapabilities, readOnlyReason, routinesErrorKind } from './rights.ts';
import {
  appendPage,
  badgeCount,
  createInboxClient,
  inboxAvailability,
  inboxAvailabilityFromError,
  inboxBotParam,
  inboxOutcome,
  initialTab,
  parseInboxItem,
  parseInboxPage,
  parseInboxSummary,
  sortInbox,
  withAllRead,
  withRead,
  INBOX_ID_RE,
  type InboxApi,
  type InboxFilter,
  type InboxPage,
} from './inbox.ts';
import { createDemoRoutines, demoInbox, demoJobs } from './demo.ts';
import { continuationSeed } from './continueChat.ts';
import { inboxActionDecision } from './inboxActions.ts';
import { emitRoutineEvent, onRoutineEvent, parseRoutineEventData, routineEventMatches } from './events.ts';
import { parseTarget, registrationBody, routineTargetRoute, streamSources, type PushProfile } from '../push/model.ts';
import { fetchPushConfig, readInbox } from '../push/api.ts';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const ID_A = 'ri_aaaaaaaaaaaaaaaaaaaa';
const ID_B = 'ri_bbbbbbbbbbbbbbbbbbbb';

const SUMMARY = {
  id: ID_A,
  hermesProfile: 'research',
  jobId: 'aaaaaaaaaaaa',
  title: 'Morning briefing',
  runAt: '2026-10-16T05:00:01Z',
  finishedAt: '2026-10-16T05:01:40Z',
  status: 'ok',
  summary: 'Five items for today',
  truncated: false,
  sessionId: 'cron_aaaaaaaaaaaa_20261016_050001',
  hasRich: true,
  read: false,
  createdAt: 1_760_000_000_000,
};

function recorder(body: unknown, status = 200) {
  const calls: { url: string; method?: string; body?: string; auth?: string }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), method: init?.method, body: init?.body as string | undefined, auth: h.Authorization });
    const text = JSON.stringify(body);
    return { ok: status < 400, status, headers: new Headers(), body: null, text: async () => text } as never;
  };
  return { calls, fetchImpl };
}

// ---------------------------------------------------------------- rights

test('job list rights: hui.rights wins, slice-1 hui.routines still works, the stricter of both counts', () => {
  assert.deepEqual(pick(parseJobList({ jobs: [], hui: { routines: 'control', rights: 'manage' } })), { access: 'control', rights: 'manage' });
  assert.deepEqual(pick(parseJobList({ jobs: [], hui: { routines: 'read', rights: 'read' } })), { access: 'read', rights: 'read' });
  assert.deepEqual(pick(parseJobList({ jobs: [], hui: { routines: 'read' } })), { access: 'read', rights: 'read' }, 'slice-1 bridge');
  assert.deepEqual(pick(parseJobList({ jobs: [] })), { access: 'control', rights: 'manage' }, 'direct Hermes = owner');
  assert.deepEqual(pick(parseJobList({ jobs: [], hui: { routines: 'read', rights: 'manage' } })), { access: 'read', rights: 'read' }, 'contradiction: read wins');
  assert.deepEqual(pick(parseJobList({ jobs: [], hui: { routines: 'control', rights: 'bogus' } })), { access: 'control', rights: 'manage' });
});
const pick = (l: { access: string; rights: string }) => ({ access: l.access, rights: l.rights });

test('rights → controls: only manage gets pause/resume/run', () => {
  const job = { id: 'bbbbbbbbbbbb', name: 'J', prompt: '', skills: [], schedule: { kind: 'cron' as const, expr: '0 9 * * *' }, enabled: true, state: 'scheduled', failureStreak: 0, noAgent: false };
  const read = parseJobList({ jobs: [], hui: { routines: 'read', rights: 'read' } });
  const manage = parseJobList({ jobs: [], hui: { routines: 'control', rights: 'manage' } });
  assert.deepEqual(controlsFor(job, read.access), { pause: false, resume: false, run: false, runResumes: false });
  assert.equal(controlsFor(job, manage.access).pause, true);
  assert.equal(canManage('manage'), true);
  assert.equal(canManage('read'), false);
  assert.equal(canManage(undefined), false);
});

test('capabilities parse; read-only reason picks the device or the server text', () => {
  const caps = parseCapabilities({
    version: 1,
    hermesProfile: 'default',
    available: true,
    rights: 'read',
    mode: 'control',
    inbox: { available: true, durable: false, retentionDays: 30, maxItems: 300 },
    push: { available: true },
    features: { crud: false },
    reasons: ['read_only_device', 'inbox_memory_only', 'something_new'],
  });
  assert.ok(caps);
  assert.deepEqual(caps.reasons, ['read_only_device', 'inbox_memory_only']);
  assert.equal(caps.inbox.durable, false);
  assert.equal(caps.inbox.retentionDays, 30);
  assert.equal(parseCapabilities({ error: 'x' }), null);
  assert.equal(parseCapabilities({ version: 1 })?.rights, 'none', 'missing rights = none, never silent manage');
  assert.equal(readOnlyReason('manage', caps), null);
  assert.equal(readOnlyReason('read', caps), 'device');
  assert.equal(readOnlyReason('read', { reasons: ['read_only_server'] }), 'server');
  assert.equal(readOnlyReason('read', null), 'server', 'no capabilities: slice-1 server switch');
});

test('bridge error codes → what the UI says', () => {
  const e = (status: number, code?: string) => new HermesError('bad_request', 'x', { status, code });
  assert.equal(routinesErrorKind(e(403, 'routines_read_only')), 'readOnly');
  assert.equal(routinesErrorKind(e(403, 'routines_forbidden')), 'forbidden');
  assert.equal(routinesErrorKind(e(404, 'routines_off')), 'off');
  assert.equal(routinesErrorKind(e(404, 'unknown_profile')), 'unknownBot');
  assert.equal(routinesErrorKind(e(404, 'item_not_found')), 'notFound');
  assert.equal(routinesErrorKind(e(404)), 'unsupported');
  assert.equal(routinesErrorKind(e(500)), 'other');
  assert.equal(routinesErrorKind(new Error('x')), 'other');
});

// ---------------------------------------------------------------- inbox parsing + helpers

test('inbox parsing: summaries, items, pages; junk and foreign ids dropped', () => {
  const s = parseInboxSummary(SUMMARY);
  assert.ok(s);
  assert.equal(s.status, 'ok');
  assert.equal(s.read, false);
  assert.equal(s.hermesProfile, 'research');
  assert.equal(parseInboxSummary({ ...SUMMARY, id: '../../etc' }), null);
  assert.equal(parseInboxSummary({ ...SUMMARY, readAt: 5, read: undefined })?.read, true, 'stored shape (readAt)');
  assert.equal(parseInboxSummary({ ...SUMMARY, status: 'weird' })?.status, 'ok');
  assert.equal(parseInboxSummary({ ...SUMMARY, title: '' })?.title, 'aaaaaaaaaaaa', 'empty title falls back to the job id');
  const item = parseInboxItem({ ...SUMMARY, status: 'failed', text: '', error: 'Timeout talking to example.com' });
  assert.ok(item);
  assert.equal(item.error, 'Timeout talking to example.com');
  assert.equal(item.text, '');
  const page = parseInboxPage({ items: [SUMMARY, null, { id: 'x' }, { ...SUMMARY, id: ID_B }], unreadCount: 3, nextCursor: 'bogus' });
  assert.equal(page.items.length, 2);
  assert.equal(page.unreadCount, 3);
  assert.equal(page.nextCursor, null, 'invalid cursor ignored');
  assert.deepEqual(parseInboxPage('nope'), { items: [], unreadCount: 0, nextCursor: null });
});

test('inbox helpers: sort, paging, optimistic read flags, outcome, tab default, badge text', () => {
  const a = parseInboxSummary({ ...SUMMARY, finishedAt: '2026-10-15T05:00:00Z' })!;
  const b = parseInboxSummary({ ...SUMMARY, id: ID_B, finishedAt: '2026-10-16T05:00:00Z' })!;
  assert.deepEqual(sortInbox([a, b]).map((x) => x.id), [ID_B, ID_A]);
  const p1: InboxPage = { items: [b], unreadCount: 2, nextCursor: ID_B };
  const p2 = appendPage(p1, { items: [b, a], unreadCount: 2, nextCursor: null });
  assert.deepEqual(p2.items.map((x) => x.id), [ID_B, ID_A]);
  const r = withRead(p2, ID_A, true);
  assert.equal(r.unreadCount, 1);
  assert.equal(withRead(r, ID_A, true).unreadCount, 1, 'no double count');
  assert.equal(withRead(p2, ID_A, true, 7).unreadCount, 7, 'server count wins');
  assert.equal(withAllRead(p2).items.every((x) => x.read), true);
  assert.equal(inboxOutcome({ status: 'ok', deliveryFailed: true }), 'deliveryFailed');
  assert.equal(inboxOutcome({ status: 'silent', deliveryFailed: false }), 'silent');
  assert.equal(initialTab({ unread: 2, inboxAvailable: true }), 'inbox');
  assert.equal(initialTab({ unread: 0, inboxAvailable: true }), 'schedules');
  assert.equal(initialTab({ unread: null, inboxAvailable: true }), 'schedules', 'unknown count: schedules');
  assert.equal(initialTab({ unread: 5, inboxAvailable: false }), 'schedules', 'no inbox');
  assert.equal(initialTab({ param: 'inbox', unread: 0, inboxAvailable: false }), 'inbox', 'deep link wins');
  assert.equal(initialTab({ param: 'bogus', unread: 0, inboxAvailable: true }), 'schedules');
  assert.equal(badgeCount(3), '3');
  assert.equal(badgeCount(150), '99+');
  assert.equal(inboxBotParam(undefined), 'default');
  assert.equal(inboxBotParam('default'), 'default');
  assert.equal(inboxBotParam('research'), 'research');
});

// ---------------------------------------------------------------- inbox client

test('inbox client: bridge root (never /p/<bot>/), hermesProfile, filter/limit/cursor, Bearer token', async () => {
  const r = recorder({ items: [SUMMARY], unreadCount: 1, nextCursor: null });
  const c = createInboxClient(r.fetchImpl, { baseUrl: 'https://example.com/p/research/v1', apiKey: 'nca_test_token_000' }, 'research');
  const page = await c.list({ filter: 'unread', limit: 500, before: ID_B });
  assert.equal(page.items.length, 1);
  assert.equal(r.calls[0]?.url, `https://example.com/bridge/routines/inbox?hermesProfile=research&filter=unread&limit=100&before=${ID_B}`);
  assert.equal(r.calls[0]?.auth, 'Bearer nca_test_token_000');
  await c.list({ before: '../x' });
  assert.equal(r.calls[1]?.url, 'https://example.com/bridge/routines/inbox?hermesProfile=research&filter=all&limit=50', 'invalid cursor dropped');
  const d = createInboxClient(r.fetchImpl, { baseUrl: 'https://example.com/v1', apiKey: 'k' }, undefined);
  await d.list();
  assert.match(r.calls[2]?.url ?? '', /\?hermesProfile=default&/);
});

test('inbox client: get / mark read / read-all bodies; invalid ids never reach the network', async () => {
  const r = recorder({ item: { ...SUMMARY, text: 'Hello', truncated: false }, unreadCount: 0, updated: 2 });
  const c = createInboxClient(r.fetchImpl, { baseUrl: 'https://example.com', apiKey: 'k' }, undefined);
  const item = await c.get(ID_A);
  assert.equal(item.text, 'Hello');
  await c.setRead(ID_A, true);
  const all = await c.readAll();
  assert.equal(all.updated, 2);
  assert.deepEqual(
    r.calls.map((x) => [x.method, x.url, x.body]),
    [
      ['GET', `https://example.com/bridge/routines/inbox/${ID_A}?hermesProfile=default`, undefined],
      ['PATCH', `https://example.com/bridge/routines/inbox/${ID_A}`, '{"hermesProfile":"default","read":true}'],
      ['POST', 'https://example.com/bridge/routines/inbox/read-all', '{"hermesProfile":"default"}'],
    ],
  );
  await assert.rejects(() => c.get('ri_../../x'), (e: unknown) => e instanceof HermesError && e.code === 'item_not_found');
  await assert.rejects(() => c.setRead('nope', true));
  assert.equal(r.calls.length, 3);
});

test('inbox client: errors keep their code; availability from capabilities and from errors', async () => {
  const r = recorder({ error: { message: 'This device may only view routines', type: 'invalid_request_error', code: 'routines_read_only' } }, 403);
  const c = createInboxClient(r.fetchImpl, { baseUrl: 'https://example.com', apiKey: 'k' }, undefined);
  await assert.rejects(() => c.readAll(), (e: unknown) => routinesErrorKind(e) === 'readOnly');
  const old = recorder({ error: { message: 'not found' } }, 404);
  const err = await createInboxClient(old.fetchImpl, { baseUrl: 'https://example.com', apiKey: 'k' }, undefined)
    .capabilities()
    .catch((e: unknown) => e);
  assert.deepEqual(inboxAvailabilityFromError(err), { kind: 'unsupported' }, 'older bridge: plain 404');
  const e = (status: number, code?: string) => new HermesError('bad_request', 'x', { status, code });
  assert.deepEqual(inboxAvailabilityFromError(e(404, 'routines_off')), { kind: 'off' });
  assert.deepEqual(inboxAvailabilityFromError(e(403, 'routines_forbidden')), { kind: 'forbidden' });
  assert.equal(inboxAvailabilityFromError(e(502)), null, 'transient: ask again');
  assert.equal(inboxAvailabilityFromError(new HermesError('network', 'offline')), null);
  const caps = (o: object) => parseCapabilities({ version: 1, available: true, rights: 'read', inbox: { available: true, durable: true }, reasons: [], ...o })!;
  assert.equal(inboxAvailability(caps({})).kind, 'ready');
  assert.equal(inboxAvailability(caps({ rights: 'none', reasons: ['device_forbidden'] })).kind, 'forbidden');
  assert.equal(inboxAvailability(caps({ available: false, reasons: ['bot_not_enabled'] })).kind, 'off');
  assert.equal(inboxAvailability(caps({ inbox: { available: false } })).kind, 'off');
});

// ---------------------------------------------------------------- demo

test('demo routines are localized: names, prompts, errors and results follow the UI language', () => {
  const by = (lang: 'de' | 'en' | 'es') => demoJobs(NOW, lang);
  const de = by('de');
  const en = by('en');
  const es = by('es');
  assert.equal(de[0]?.name, 'Morgenbriefing');
  assert.equal(en[0]?.name, 'Morning briefing');
  assert.equal(es[0]?.name, 'Resumen matutino');
  for (let i = 0; i < en.length; i++) {
    assert.notEqual(de[i]?.name, en[i]?.name, `de name ${i}`);
    assert.notEqual(es[i]?.name, en[i]?.name, `es name ${i}`);
    assert.notEqual(de[i]?.prompt, en[i]?.prompt, `de prompt ${i}`);
    assert.notEqual(es[i]?.prompt, en[i]?.prompt, `es prompt ${i}`);
  }
  assert.deepEqual(demoJobs(NOW).map((j) => j.name), de.map((j) => j.name), 'unknown language: German like the other demo content');
  assert.match(de.find((j) => j.lastError)?.lastError ?? '', /Sekunden/);
  for (const lang of ['de', 'en', 'es'] as const) {
    const text = JSON.stringify([demoJobs(NOW, lang), demoInbox(NOW, lang)]);
    for (const url of text.match(/https?:\/\/[^\s"')\]\\]+/g) ?? []) assert.match(url, /^https:\/\/([a-z-]+\.)?example\.com\b/, `${lang}: ${url}`);
  }
});

test('demo inbox: five localized results, two unread, rich briefing and price check, a failed and a silent run', () => {
  for (const lang of ['de', 'en', 'es'] as const) {
    const items = demoInbox(NOW, lang);
    const jobs = new Set(demoJobs(NOW, lang).map((j) => j.id));
    assert.equal(items.length, 5);
    assert.equal(items.filter((i) => !i.read).length, 2);
    for (const i of items) {
      assert.ok(INBOX_ID_RE.test(i.id), i.id);
      assert.ok(jobs.has(i.jobId), `${i.id} belongs to a demo routine`);
      assert.ok(parseInboxItem(i), 'demo items have the bridge shape');
    }
    const briefing = items.find((i) => i.jobId === 'd0000000000a')!;
    assert.equal(briefing.read, false);
    assert.match(briefing.text, /```hui\n[\s\S]*"type": "sources"/);
    assert.match(items.find((i) => i.jobId === 'd0000000000b')!.text, /"type": "products"/);
    const failed = items.find((i) => i.status === 'failed')!;
    assert.equal(failed.read, false);
    assert.equal(failed.text, '');
    assert.ok(failed.error);
    assert.equal(items.find((i) => i.status === 'silent')?.read, true);
  }
  assert.match(demoInbox(NOW, 'de')[1]?.text ?? '', /Fünf Meldungen/);
  assert.match(demoInbox(NOW, 'es')[1]?.text ?? '', /Cinco noticias/);
});

async function allPages(api: InboxApi, filter: InboxFilter): Promise<InboxPage> {
  let page = await api.list({ filter, limit: 2 });
  while (page.nextCursor) page = appendPage(page, await api.list({ filter, limit: 2, before: page.nextCursor }));
  return page;
}

test('demo inbox API: paging, filter, read / unread, read-all, unknown id; memory only', async () => {
  const d = createDemoRoutines(NOW, 'en');
  assert.equal((await d.inbox.capabilities()).rights, 'manage');
  const all = await allPages(d.inbox, 'all');
  assert.equal(all.items.length, 5);
  assert.deepEqual(all.items.map((i) => i.id), sortInbox(all.items).map((i) => i.id), 'newest first');
  assert.equal(all.unreadCount, 2);
  assert.equal(all.items.some((i) => 'text' in i), false, 'list = summaries only');
  assert.equal((await allPages(d.inbox, 'unread')).items.length, 2);
  const first = all.items[0]!;
  assert.equal((await d.inbox.setRead(first.id, true)).unreadCount, all.items[0]!.read ? 2 : 1);
  assert.equal((await d.inbox.readAll()).unreadCount, 0);
  assert.equal((await d.inbox.list({ filter: 'unread' })).items.length, 0);
  assert.equal((await d.inbox.setRead(first.id, false)).unreadCount, 1);
  await assert.rejects(() => d.inbox.get('ri_ffffffffffffffffffff'), (e: unknown) => routinesErrorKind(e) === 'notFound');
  assert.equal((await d.lastResult('d0000000000a'))?.text.includes('```hui'), true);
  assert.equal((await createDemoRoutines(NOW, 'en').inbox.list()).unreadCount, 2, 'a new demo starts fresh');
});

// ---------------------------------------------------------------- continue in chat

test('continue-in-chat seed: localized user turn with title, date and task; the result as the answer', () => {
  const item = { ...parseInboxItem({ ...SUMMARY, text: 'Five items for today: …' })!, title: 'Morning briefing' };
  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const de = continuationSeed(item, { t: makeT('de', 'de-DE'), formatDate: fmt, prompt: 'Fasse  die\nNachrichten zusammen.', bot: 'research', now: NOW });
  assert.equal(de.messages.length, 2);
  assert.equal(de.messages[0]?.role, 'user');
  assert.equal(de.messages[0]?.text, 'Ergebnis der Routine „Morning briefing“ vom 2026-10-16. Auftrag: Fasse die Nachrichten zusammen.');
  assert.equal(de.messages[1]?.role, 'assistant');
  assert.equal(de.messages[1]?.text, 'Five items for today: …');
  assert.equal(de.messages[1]?.status, 'done');
  assert.equal(de.title, 'Morning briefing');
  assert.equal(de.bot, 'research');
  assert.notEqual(de.messages[0]?.id, de.messages[1]?.id);
  const en = continuationSeed(item, { t: makeT('en', 'en-US'), formatDate: fmt, now: NOW });
  assert.equal(en.messages[0]?.text, 'Result of the routine “Morning briefing” from 2026-10-16.', 'no task known: no second part');
  const es = continuationSeed(item, { t: makeT('es', 'es-ES'), formatDate: fmt, prompt: 'Resume', now: NOW });
  assert.equal(es.messages[0]?.text, 'Resultado de la rutina «Morning briefing» del 2026-10-16. Tarea: Resume');
  const failed = continuationSeed({ ...item, text: '', status: 'failed', error: 'Timeout' }, { t: makeT('en', 'en-US'), formatDate: fmt, now: NOW });
  assert.equal(failed.messages[1]?.text, 'The run failed: Timeout');
  const cut = continuationSeed({ ...item, truncated: true }, { t: makeT('en', 'en-US'), formatDate: fmt, now: NOW });
  assert.match(cut.messages[1]?.text ?? '', /\(result shortened\)$/);
  const long = continuationSeed(item, { t: makeT('en', 'en-US'), formatDate: fmt, prompt: 'x'.repeat(5000), now: NOW });
  assert.ok((long.messages[0]?.text.length ?? 0) < 1400, 'long task is cut');
});

// ---------------------------------------------------------------- result view actions

test('inbox action policy: nothing that sends; device actions and links go to the runner', () => {
  assert.deepEqual(inboxActionDecision({ type: 'send', text: 'I will take this' }), { kind: 'needsChat' });
  assert.deepEqual(inboxActionDecision({ type: 'submit' }), { kind: 'needsChat' });
  assert.deepEqual(inboxActionDecision({ type: 'ask', text: 'Explain' } as never), { kind: 'needsChat' });
  assert.deepEqual(inboxActionDecision({ type: 'add_to_list', list: 'x', items: [] } as never), { kind: 'needsChat' });
  assert.deepEqual(inboxActionDecision({ type: 'open_url', url: 'www.example.com/a' }), { kind: 'run', action: { type: 'open_url', url: 'https://www.example.com/a' } });
  assert.deepEqual(inboxActionDecision({ type: 'copy', text: 'x' }), { kind: 'run', action: { type: 'copy', text: 'x' } });
  assert.equal(inboxActionDecision({ type: 'calendar', title: 'x', start: '2026-10-20T09:00' } as never).kind, 'run');
  assert.deepEqual(inboxActionDecision(null), { kind: 'ignore' });
});

// ---------------------------------------------------------------- live events + push

test('live hui.routine event: parsed without content, matched by connection + bot, delivered to listeners', () => {
  assert.deepEqual(parseRoutineEventData(JSON.stringify({ id: ID_A, hermesProfile: 'research', jobId: 'aaaaaaaaaaaa', status: 'ok', source: 'routines' })), {
    id: ID_A,
    jobId: 'aaaaaaaaaaaa',
    status: 'ok',
    hermesProfile: 'research',
  });
  assert.equal(parseRoutineEventData(JSON.stringify({ id: ID_A, hermesProfile: 'default' }))?.hermesProfile, undefined, 'default = undefined');
  assert.equal(parseRoutineEventData(JSON.stringify({ id: ID_A, source: 'cron' })), null);
  assert.equal(parseRoutineEventData('{"status":"ok"}'), null);
  assert.equal(parseRoutineEventData('not json'), null);
  assert.equal(routineEventMatches({ profileId: 'p1', id: ID_A }, 'p1', undefined), true);
  assert.equal(routineEventMatches({ profileId: 'p1', id: ID_A, hermesProfile: 'research' }, 'p1', undefined), false);
  assert.equal(routineEventMatches({ profileId: 'p1', id: ID_A, hermesProfile: 'research' }, 'p1', 'research'), true);
  assert.equal(routineEventMatches({ profileId: 'p2', id: ID_A }, 'p1', undefined), false);
  const got: string[] = [];
  const off = onRoutineEvent((e) => got.push(e.id ?? ''));
  emitRoutineEvent({ profileId: 'p1', id: ID_A });
  off();
  emitRoutineEvent({ profileId: 'p1', id: ID_B });
  assert.deepEqual(got, [ID_A]);
});

test('push: kind routine notification → Routines inbox of that bot with the result open', () => {
  const data = { v: 1, kind: 'routine', src: 'hermes', profileId: 'p-h', hermesProfile: 'research', jobId: 'aaaaaaaaaaaa', itemId: ID_A };
  const t = parseTarget(JSON.stringify(data));
  assert.equal(t?.kind, 'routine');
  assert.equal(t?.itemId, ID_A);
  assert.equal(t?.jobId, 'aaaaaaaaaaaa');
  assert.equal(t?.hermesProfile, 'research');
  assert.deepEqual(routineTargetRoute(t!), { pathname: '/routines', params: { tab: 'inbox', bot: 'research', item: ID_A } });
  assert.deepEqual(routineTargetRoute(parseTarget({ ...data, hermesProfile: undefined })!), { pathname: '/routines', params: { tab: 'inbox', item: ID_A } });
  assert.equal(parseTarget({ ...data, itemId: '../../x' })?.kind, undefined, 'bad item id: no routine target');
  assert.equal(parseTarget({ ...data, src: 'test' })?.kind, undefined);
  assert.equal(parseTarget({ body: JSON.stringify(data) })?.itemId, ID_A, 'iOS body wrapper');
});

test('push: `routines` is registered and streamed only when the bridge lists it', async () => {
  const p: PushProfile = { id: 'p-h', kind: 'hermes', baseUrl: 'https://example.com/v1', apiKey: 'nca_test_token_000', bridge: true };
  const s = { enabled: true, preview: 'auto' as const, quiet: null };
  assert.deepEqual(registrationBody(p, s, { locale: 'de' }).scope, { sources: ['api_server'] }, 'old bridge: unchanged');
  assert.deepEqual(registrationBody(p, s, { locale: 'de', serverSources: ['api_server', 'cron', 'telegram', 'cli'] }).scope, { sources: ['api_server'] });
  assert.deepEqual(registrationBody(p, s, { locale: 'de', serverSources: ['api_server', 'cron', 'telegram', 'cli', 'routines'] }).scope, { sources: ['api_server', 'routines'] });
  assert.deepEqual(streamSources({ showCronReports: true }, ['routines']), ['api_server', 'cron', 'routines']);
  assert.deepEqual(streamSources({}, null), ['api_server']);
  const body = JSON.stringify({ platforms: { webpush: null, fcm: true, apns: false }, inbox: true, sources: ['api_server', 'cron', 'telegram', 'cli', 'routines', 'Bad Source', 3] });
  const f: FetchLike = async () => ({ ok: true, status: 200, headers: new Headers(), body: null, text: async () => body }) as never;
  assert.deepEqual((await fetchPushConfig(f, p))?.sources, ['api_server', 'cron', 'telegram', 'cli', 'routines']);
  const oldBody = JSON.stringify({ platforms: { webpush: null, fcm: true, apns: false }, inbox: true });
  const g: FetchLike = async () => ({ ok: true, status: 200, headers: new Headers(), body: null, text: async () => oldBody }) as never;
  assert.equal('sources' in ((await fetchPushConfig(g, p)) ?? {}), false);
});

test('inbox stream: hui.routine goes to onRoutine, never into the chat events', async () => {
  const frames = [`event: hui.ready\ndata: {}\n\nevent: hui.rou`, `tine\ndata: ${JSON.stringify({ id: ID_A, hermesProfile: 'research', jobId: 'aaaaaaaaaaaa', status: 'failed', source: 'routines' })}\n\n`];
  const f: FetchLike = async () =>
    ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => '',
      body: new ReadableStream({
        start(c) {
          for (const x of frames) c.enqueue(new TextEncoder().encode(x));
          c.close();
        },
      }),
    }) as never;
  const seen: string[] = [];
  await readInbox(f, 'https://example.com/bridge/inbox/stream', 'k', {
    signal: new AbortController().signal,
    onEvent: (e) => seen.push(`msg:${e.id}`),
    onRoutine: (r) => seen.push(`routine:${r.id}:${r.hermesProfile}:${r.status}`),
  });
  assert.deepEqual(seen, [`routine:${ID_A}:research:failed`]);
});
