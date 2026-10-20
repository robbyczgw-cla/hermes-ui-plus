/// <reference types="node" />
// Routines slice 1: job parsing (bridge projection + raw Hermes), client requests, schedule text, grouping, controls,
// last result lookup, demo source. Fixtures are invented (ids like aaaaaaaaaaaa, example.com).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeT } from '../i18n/core.ts';
import { HermesError, type FetchLike } from '../hermes/stream.ts';
import { createJobsClient, deliverKindOf, isRoutinesUnsupported, parseJob, parseJobList, type RoutineJob } from './jobs.ts';
import { describeCron, describeSchedule, isoOffsetMinutes, offsetLabel, parseWeekdays, serverClock } from './schedule.ts';
import { controlsFor, groupJobs, groupOf, lastOutcome } from './status.ts';
import { finalAnswer, loadLastResult, newestRunSession } from './lastResult.ts';
import { createDemoRoutines, demoJobs } from './demo.ts';

const en = { t: makeT('en', 'en-US'), locale: 'en-US' };
const de = { t: makeT('de', 'de-DE'), locale: 'de-DE' };
const es = { t: makeT('es', 'es-ES'), locale: 'es-ES' };

const RAW_HERMES_JOB = {
  id: 'aaaaaaaaaaaa',
  name: 'Morning briefing',
  prompt: 'Summarize the news',
  skills: ['hermes-ui'],
  model: null,
  provider: null,
  base_url: 'http://192.0.2.10:9999/v1',
  script: '/srv/fake/script.py',
  workdir: '/srv/fake',
  schedule: { kind: 'cron', expr: '0 7 * * 1-5', display: 'weekdays at 7am' },
  schedule_display: 'weekdays at 7am',
  repeat: { times: null, completed: 4 },
  enabled: true,
  state: 'scheduled',
  next_run_at: '2026-10-19T07:00:00+02:00',
  last_run_at: '2026-10-16T07:00:31+02:00',
  last_status: 'ok',
  failure_streak: 0,
  deliver: 'telegram:-100000000000:7,origin',
  origin: { platform: 'telegram', chat_id: '-100000000000', user: 'fake-user' },
  manual_run_prompt: 'secret one-off',
  latest_execution: { id: 'x', status: 'completed', pid: 4242, source: 'scheduled', claimed_at: '2026-10-16T05:00:01Z' },
};

const job = (over: Partial<RoutineJob> = {}): RoutineJob => ({
  id: 'bbbbbbbbbbbb',
  name: 'Job',
  prompt: '',
  skills: [],
  schedule: { kind: 'cron', expr: '0 9 * * *' },
  enabled: true,
  state: 'scheduled',
  failureStreak: 0,
  noAgent: false,
  ...over,
});

test('parseJob reads a raw Hermes record and never keeps chat ids, paths or one-off prompts', () => {
  const j = parseJob(RAW_HERMES_JOB);
  assert.ok(j);
  assert.equal(j.id, 'aaaaaaaaaaaa');
  assert.deepEqual(j.schedule, { kind: 'cron', expr: '0 7 * * 1-5', display: 'weekdays at 7am' });
  assert.equal(j.deliverKind, 'telegram,origin');
  assert.equal(j.originPlatform, 'telegram');
  assert.equal(j.model, undefined);
  assert.deepEqual(j.repeat, { times: null, completed: 4 });
  assert.deepEqual(j.latestExecution, { status: 'completed', source: 'scheduled', claimedAt: '2026-10-16T05:00:01Z' });
  const text = JSON.stringify(j);
  for (const leak of ['-100000000000', '192.0.2.10', '/srv/fake', 'secret one-off', 'fake-user', '4242']) assert.ok(!text.includes(leak), leak);
});

test('parseJob reads the bridge projection (deliver_kind / origin_platform) and tolerates junk', () => {
  const j = parseJob({ id: 'cccccccccccc', name: '', enabled: false, deliver_kind: 'local', origin_platform: 'cli', schedule: { kind: 'interval', minutes: 30 } });
  assert.ok(j);
  assert.equal(j.name, 'cccccccccccc', 'empty name falls back to the id');
  assert.equal(j.state, 'paused', 'disabled without state reads as paused');
  assert.equal(j.deliverKind, 'local');
  assert.equal(j.originPlatform, 'cli');
  assert.deepEqual(j.schedule, { kind: 'interval', minutes: 30 });
  assert.equal(parseJob(null), null);
  assert.equal(parseJob({ name: 'no id' }), null);
  assert.equal(parseJob({ id: 'dddddddddddd', schedule: 'weird' })?.schedule.kind, 'unknown');
});

test('deliverKindOf keeps only platform names', () => {
  assert.equal(deliverKindOf('local'), 'local');
  assert.equal(deliverKindOf('Telegram:-100000000000:7, discord:000000000000, telegram'), 'telegram,discord');
  assert.equal(deliverKindOf('bot-chat:writer'), 'bot-chat');
  assert.equal(deliverKindOf(''), undefined);
  assert.equal(deliverKindOf(42), undefined);
});

test('parseJobList: access comes from the bridge, direct Hermes means control', () => {
  assert.equal(parseJobList({ jobs: [RAW_HERMES_JOB] }).access, 'control');
  assert.equal(parseJobList({ jobs: [], hui: { routines: 'read' } }).access, 'read');
  assert.equal(parseJobList({ jobs: [RAW_HERMES_JOB, 'x', null] }).jobs.length, 1);
  assert.deepEqual(parseJobList('nope').jobs, []);
});

test('isRoutinesUnsupported: 404/405/501 yes, job_not_found / auth / network no', () => {
  assert.equal(isRoutinesUnsupported(new HermesError('bad_request', 'x', { status: 404 })), true);
  assert.equal(isRoutinesUnsupported(new HermesError('bad_request', 'x', { status: 404, code: 'routines_off' })), true);
  assert.equal(isRoutinesUnsupported(new HermesError('server', 'x', { status: 501 })), true);
  assert.equal(isRoutinesUnsupported(new HermesError('bad_request', 'x', { status: 404, code: 'job_not_found' })), false);
  assert.equal(isRoutinesUnsupported(new HermesError('auth', 'x', { status: 401 })), false);
  assert.equal(isRoutinesUnsupported(new HermesError('network', 'x')), false);
  assert.equal(isRoutinesUnsupported(new Error('x')), false);
});

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

test('jobs client: list asks for paused jobs too, under the bot prefix, with the key', async () => {
  const r = recorder({ jobs: [RAW_HERMES_JOB] });
  const c = createJobsClient(r.fetchImpl, { baseUrl: 'https://example.com/p/research/v1', apiKey: 'nca_test_token_000' });
  const list = await c.list();
  assert.equal(list.jobs.length, 1);
  assert.equal(r.calls[0]?.url, 'https://example.com/p/research/api/jobs?include_disabled=true');
  assert.equal(r.calls[0]?.method, 'GET');
  assert.equal(r.calls[0]?.auth, 'Bearer nca_test_token_000');
});

test('jobs client: actions post an empty body; run on a paused job states resume_paused; never a prompt', async () => {
  const r = recorder({ job: RAW_HERMES_JOB });
  const c = createJobsClient(r.fetchImpl, { baseUrl: 'https://example.com/v1', apiKey: 'k' });
  await c.act('aaaaaaaaaaaa', 'pause');
  await c.act('aaaaaaaaaaaa', 'run');
  await c.act('aaaaaaaaaaaa', 'run', { resumePaused: true });
  assert.deepEqual(
    r.calls.map((x) => [x.method, x.url, x.body]),
    [
      ['POST', 'https://example.com/api/jobs/aaaaaaaaaaaa/pause', '{}'],
      ['POST', 'https://example.com/api/jobs/aaaaaaaaaaaa/run', '{}'],
      ['POST', 'https://example.com/api/jobs/aaaaaaaaaaaa/run', '{"resume_paused":true}'],
    ],
  );
  await assert.rejects(() => c.act('../../etc', 'pause'), /invalid job id/);
  assert.equal(r.calls.length, 3, 'an invalid id never reaches the network');
});

test('jobs client: a bridge error keeps its code', async () => {
  const r = recorder({ error: { message: 'paused', type: 'invalid_request_error', code: 'job_paused' } }, 409);
  const c = createJobsClient(r.fetchImpl, { baseUrl: 'https://example.com/v1', apiKey: 'k' });
  await assert.rejects(() => c.act('aaaaaaaaaaaa', 'run'), (e: unknown) => e instanceof HermesError && e.code === 'job_paused' && e.status === 409);
});

test('cron schedules in plain language (en/de/es)', () => {
  assert.equal(describeCron('0 7 * * 1-5', en), 'Monday to Friday at 7:00 AM');
  assert.equal(describeCron('0 7 * * 1-5', de), 'Montag bis Freitag um 7:00');
  assert.equal(describeCron('0 7 * * 1-5', es), 'De lunes a viernes a las 7:00');
  assert.equal(describeCron('30 18 * * *', en), 'Daily at 6:30 PM');
  assert.equal(describeCron('0 9 * * 1', en), 'Every Monday at 9:00 AM');
  assert.equal(describeCron('0 9 * * MON', de), 'Jeden Montag um 9:00');
  assert.equal(describeCron('0 10 * * 0,6', en), 'Saturday and Sunday at 10:00 AM');
  assert.equal(describeCron('0 8,20 * * *', en), 'Daily at 8:00 AM and 8:00 PM');
  assert.equal(describeCron('0 9 * * 1,3,5', en), 'Mon, Wed and Fri at 9:00 AM');
  assert.equal(describeCron('15 * * * *', en), 'Hourly at minute 15');
  assert.equal(describeCron('*/30 * * * *', en), 'Every 30 minutes');
  assert.equal(describeCron('0 */4 * * *', en), 'Every 4 hours at minute 00');
  assert.equal(describeCron('0 6 1 * *', en), 'Monthly on day 1 at 6:00 AM');
  // shapes we do not phrase: null (the UI then shows the expression)
  for (const e of ['0 7 * 1 *', '0 7 1 * 1', '0 7-9 * * *', '0 7 * * 5-1', '* * *', '0 0 7 * * 1-5']) assert.equal(describeCron(e, en), null, e);
});

test('parseWeekdays: ranges, names, Sunday as 0 or 7', () => {
  assert.deepEqual(parseWeekdays('1-5'), [1, 2, 3, 4, 5]);
  assert.deepEqual(parseWeekdays('mon-fri'), [1, 2, 3, 4, 5]);
  assert.deepEqual(parseWeekdays('7'), [0]);
  assert.deepEqual(parseWeekdays('5-7'), [0, 5, 6]);
  assert.equal(parseWeekdays('x'), null);
});

test('describeSchedule: intervals, one-shots, unknown shapes fall back to the expression', () => {
  assert.equal(describeSchedule({ kind: 'interval', minutes: 30 }, en), 'Every 30 minutes');
  assert.equal(describeSchedule({ kind: 'interval', minutes: 120 }, en), 'Every 2 hours');
  assert.equal(describeSchedule({ kind: 'interval', minutes: 60 }, de), 'Jede Stunde');
  assert.equal(describeSchedule({ kind: 'interval', minutes: 2880 }, es), 'Cada 2 días');
  assert.match(describeSchedule({ kind: 'once', runAt: '2026-10-20T09:00:00+02:00' }, en), /^Once on Oct 20, 2026/);
  assert.equal(describeSchedule({ kind: 'cron', expr: '0 7 L * *' }, en), 'Schedule: 0 7 L * *');
  assert.equal(describeSchedule({ kind: 'unknown', display: 'every full moon' }, en), 'Schedule: every full moon');
  assert.equal(describeSchedule({ kind: 'unknown' }, en), 'Unknown schedule');
});

test('server clock from the stored offset', () => {
  assert.equal(isoOffsetMinutes('2026-10-19T07:00:00+02:00'), 120);
  assert.equal(isoOffsetMinutes('2026-10-19T07:00:00.123-03:30'), -210);
  assert.equal(isoOffsetMinutes('2026-10-19T05:00:00Z'), 0);
  assert.equal(isoOffsetMinutes('2026-10-19T05:00:00'), null);
  assert.equal(offsetLabel(120), 'UTC+2');
  assert.equal(offsetLabel(-210), 'UTC−3:30');
  assert.equal(offsetLabel(0), 'UTC');
  const c = serverClock({ nextRunAt: '2026-10-19T07:00:00+02:00', schedule: { kind: 'cron' } });
  assert.equal(c.offsetMinutes, 120);
  const device = -new Date(Date.parse('2026-10-19T07:00:00+02:00')).getTimezoneOffset();
  assert.equal(c.differsFromDevice, device !== 120);
  assert.deepEqual(serverClock({ schedule: { kind: 'cron' } }), { offsetMinutes: null, differsFromDevice: false });
});

test('grouping: attention first, then active by next run, paused, completed', () => {
  const jobs = [
    job({ id: 'p', name: 'P', enabled: false, state: 'paused' }),
    job({ id: 'c', name: 'C', state: 'completed', enabled: false }),
    job({ id: 'a2', name: 'A2', nextRunAt: '2026-10-20T07:00:00+02:00' }),
    job({ id: 'a1', name: 'A1', nextRunAt: '2026-10-19T07:00:00+02:00' }),
    job({ id: 'f', name: 'F', lastStatus: 'error', failureStreak: 2 }),
  ];
  assert.deepEqual(
    groupJobs(jobs).map((g) => [g.group, g.jobs.map((j) => j.id)]),
    [['attention', ['f']], ['active', ['a1', 'a2']], ['paused', ['p']], ['completed', ['c']]],
  );
  assert.equal(groupOf(job({ state: 'error' })), 'attention');
  assert.equal(groupOf(job({ lastStatus: 'delivery_failed' })), 'attention');
  assert.equal(lastOutcome(job()), 'none');
  assert.equal(lastOutcome(job({ lastStatus: 'blocked_config' })), 'blocked');
  assert.equal(lastOutcome(job({ lastStatus: 'something_new', lastRunAt: 'x' })), 'other');
});

test('controls: run on a paused job is marked as resuming; completed/error/read-only get none', () => {
  assert.deepEqual(controlsFor(job(), 'control'), { pause: true, resume: false, run: true, runResumes: false });
  assert.deepEqual(controlsFor(job({ enabled: false, state: 'paused' }), 'control'), { pause: false, resume: true, run: true, runResumes: true });
  assert.deepEqual(controlsFor(job({ latestExecution: { status: 'running' } }), 'control'), { pause: true, resume: false, run: false, runResumes: false });
  const none = { pause: false, resume: false, run: false, runResumes: false };
  assert.deepEqual(controlsFor(job({ state: 'completed' }), 'control'), none);
  assert.deepEqual(controlsFor(job({ state: 'error' }), 'control'), none);
  assert.deepEqual(controlsFor(job(), 'read'), none);
});

test('last result: newest cron session of this job, final visible assistant text', async () => {
  const sessions = [
    { id: 'cron_aaaaaaaaaaaa_20261015_070001', source: 'cron', startedAt: 1000, messageCount: 3 },
    { id: 'cron_aaaaaaaaaaaa_20261016_070001', source: 'cron', startedAt: 2000, messageCount: 3 },
    { id: 'cron_bbbbbbbbbbbb_20261016_080001', source: 'cron', startedAt: 3000, messageCount: 3 },
  ];
  assert.equal(newestRunSession('aaaaaaaaaaaa', sessions)?.id, 'cron_aaaaaaaaaaaa_20261016_070001');
  assert.equal(newestRunSession('cccccccccccc', sessions), undefined);
  const msgs = [
    { id: '3', role: 'assistant', content: '', timestamp: 3 },
    { id: '2', role: 'tool', content: 'tool output', timestamp: 2 },
    { id: '4', role: 'assistant', content: [{ type: 'text', text: 'Final report' }], timestamp: 4 },
    { id: '5', role: 'assistant', content: 'scaffold', displayKind: 'hidden', timestamp: 5 },
  ];
  assert.deepEqual(finalAnswer(msgs), { text: 'Final report', at: 4 });
  const asked: string[] = [];
  const fake = {
    async list(p: { source?: string; limit?: number }) {
      asked.push(`list ${p.source} ${p.limit}`);
      return { sessions, hasMore: false, limit: 100, offset: 0 };
    },
    async messages(id: string) {
      asked.push(`messages ${id}`);
      return { sessionId: id, messages: msgs };
    },
  };
  const r = await loadLastResult(fake, 'aaaaaaaaaaaa');
  assert.deepEqual(r, { sessionId: 'cron_aaaaaaaaaaaa_20261016_070001', at: 4, text: 'Final report' });
  assert.deepEqual(asked, ['list cron 100', 'messages cron_aaaaaaaaaaaa_20261016_070001']);
  assert.equal(await loadLastResult(fake, 'cccccccccccc'), null);
});

test('demo source: invented jobs cover every group; pause/resume/run change only memory', async () => {
  const groups = new Set(demoJobs(Date.parse('2026-10-16T12:00:00Z')).map(groupOf));
  assert.deepEqual([...groups].sort(), ['active', 'attention', 'completed', 'paused']);
  const d = createDemoRoutines(Date.parse('2026-10-16T12:00:00Z'));
  const first = (await d.list()).jobs[0];
  assert.ok(first);
  assert.equal((await d.act(first.id, 'pause')).enabled, false);
  assert.equal((await d.get(first.id)).state, 'paused');
  assert.equal((await d.act(first.id, 'resume')).state, 'scheduled');
  assert.ok(await d.lastResult(first.id));
});

test('demo: every next run matches its cron schedule in the demo bot clock (+02:00)', () => {
  for (const now of [Date.parse('2026-10-16T12:00:00Z'), Date.parse('2026-10-19T06:30:00Z'), Date.parse('2026-10-24T23:00:00Z')]) {
    for (const j of demoJobs(now)) {
      if (j.schedule.kind !== 'cron' || !j.nextRunAt) continue;
      const [mi, hr, , , dow] = (j.schedule.expr ?? '').split(' ');
      const m = /T(\d{2}):(\d{2}):\d{2}\+02:00$/.exec(j.nextRunAt);
      assert.ok(m, j.nextRunAt);
      assert.equal(Number(m[1]), Number(hr), `${j.name} hour`);
      assert.equal(Number(m[2]), Number(mi), `${j.name} minute`);
      const wall = new Date(Date.parse(j.nextRunAt) + 2 * 3600_000).getUTCDay();
      assert.ok(parseWeekdays(dow ?? '*')?.includes(wall), `${j.name} weekday ${wall}`);
      assert.ok(Date.parse(j.nextRunAt) > now, `${j.name} in the future`);
    }
  }
});

