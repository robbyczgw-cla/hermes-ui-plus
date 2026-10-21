/// <reference types="node" />
// Device copies of Hermes reminders follow the Hermes job (reminderSync.ts). The turn fixtures are the cron tool calls
// the app stored in QA round 4 on the released 0.2.0 (2026-10-21, Hermes v0.22 test instance, default bridge):
// EN_TURNS = "Erinnere mich in fünf Minuten einmal daran, die QA-Teepause zu machen" + "Delete this reminder, the QA
// tea break is cancelled." (the alarm stayed although jobs.json was empty), DE_TURNS = create "in fünf Minuten",
// "Verschieb diese Erinnerung … auf in zehn Minuten", "Lösch die Erinnerung wieder". Only the cronjob_manage calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ToolEvent } from '../hermes/types.ts';
import { AT_TAG, BOT_TAG, CONN_TAG, deviceCopies, JOB_TAG, NAME_TAG, setDeviceReminder, SRC_TAG, type DeviceNotifier } from './deviceReminder.ts';
import { parseReminders } from './reminder.ts';
import {
  checkAgainstJobs,
  fateNote,
  mergeFates,
  parseCronChanges,
  parseFates,
  planServerSync,
  planTurnSync,
  runSteps,
  type DeviceCopy,
  type ReminderFate,
} from './reminderSync.ts';
import { parseJob, type RoutineJob } from '../routines/jobs.ts';

type Turn = { createdAt: number; tools: ToolEvent[] };

const EN_TURNS: Turn[] = [
 {
  "createdAt": 1792573798079,
  "tools": [
   {
    "id": "toolu_01JWpkDcTKLCHi8yUYd1Pqpk",
    "name": "cronjob_manage",
    "label": "Erinnere den Benutzer daran, die QA-Teepause zu machen.",
    "status": "done",
    "startedAt": 1792573801019,
    "endedAt": 1792573801233,
    "detail": {
     "tool": "cronjob_manage",
     "input": {
      "action": "create",
      "schedule": "in 5m",
      "prompt": "Erinnere den Benutzer daran, die QA-Teepause zu machen.",
      "deliver": "bot-chat",
      "name": "QA-Teepause-Erinnerung"
     },
     "output": {
      "success": true,
      "job_id": "e25e9d2dafb0",
      "name": "QA-Teepause-Erinnerung",
      "skill": null,
      "skills": [],
      "schedule": "once in 5m",
      "repeat": "once",
      "deliver": "bot-chat",
      "next_run_at": "2026-10-21T09:15:01.162299+00:00",
      "job": {
       "job_id": "e25e9d2dafb0",
       "name": "QA-Teepause-Erinnerung",
       "skill": null,
       "skills": [],
       "prompt_preview": "Erinnere den Benutzer daran, die QA-Teepause zu machen.",
       "model": null,
       "provider": null,
       "pinned": false,
       "base_url": null,
       "schedule": "once in 5m",
       "repeat": "once",
       "deliver": "bot-chat",
       "next_run_at": "2026-10-21T09:15:01.162299+00:00",
       "last_run_at": null,
       "last_status": null,
       "last_delivery_error": null,
       "last_delivery_unverified": null,
       "last_fire_error": null,
       "last_error": null,
       "enabled": true,
       "state": "scheduled",
       "paused_at": null,
       "paused_reason": null
      },
      "message": "Cron job 'QA-Teepause-Erinnerung' created.",
      "gateway_running": true
     }
    }
   }
  ]
 },
 {
  "createdAt": 1792573935907,
  "tools": [
   {
    "id": "toolu_018vHECzgdXKdhgnu7JmyVCk",
    "name": "cronjob_manage",
    "label": "remove",
    "status": "done",
    "startedAt": 1792573935907,
    "endedAt": 1792573935950,
    "detail": {
     "tool": "cronjob_manage",
     "input": {
      "action": "remove",
      "job_id": "e25e9d2dafb0"
     },
     "output": {
      "success": true,
      "message": "Cron job 'QA-Teepause-Erinnerung' removed.",
      "removed_job": {
       "id": "e25e9d2dafb0",
       "name": "QA-Teepause-Erinnerung",
       "schedule": "once in 5m"
      }
     }
    }
   }
  ]
 }
];

const DE_TURNS: Turn[] = [
 {
  "createdAt": 1792573234665,
  "tools": [
   {
    "id": "toolu_012biTCQpM9HHVCCXncxe41C",
    "name": "cronjob_manage",
    "label": "create",
    "status": "done",
    "startedAt": 1792573240192,
    "endedAt": 1792573240240,
    "detail": {
     "tool": "cronjob_manage",
     "input": {
      "action": "create",
      "schedule": "in 5m",
      "prompt": "Erinnere den Benutzer: Zeit, Tee für den QA-Test zu trinken.",
      "deliver": "bot-chat",
      "name": "Tee-Erinnerung QA-Test"
     },
     "output": {
      "success": true,
      "job_id": "b726944cff11",
      "name": "Tee-Erinnerung QA-Test",
      "skill": null,
      "skills": [],
      "schedule": "once in 5m",
      "repeat": "once",
      "deliver": "bot-chat",
      "next_run_at": "2026-10-21T09:05:40.145527+00:00",
      "job": {
       "job_id": "b726944cff11",
       "name": "Tee-Erinnerung QA-Test",
       "skill": null,
       "skills": [],
       "prompt_preview": "Erinnere den Benutzer: Zeit, Tee für den QA-Test zu trinken.",
       "model": null,
       "provider": null,
       "pinned": false,
       "base_url": null,
       "schedule": "once in 5m",
       "repeat": "once",
       "deliver": "bot-chat",
       "next_run_at": "2026-10-21T09:05:40.145527+00:00",
       "last_run_at": null,
       "last_status": null,
       "last_delivery_error": null,
       "last_delivery_unverified": null,
       "last_fire_error": null,
       "last_error": null,
       "enabled": true,
       "state": "scheduled",
       "paused_at": null,
       "paused_reason": null
      },
      "message": "Cron job 'Tee-Erinnerung QA-Test' created.",
      "gateway_running": true
     }
    }
   }
  ]
 },
 {
  "createdAt": 1792573266055,
  "tools": [
   {
    "id": "toolu_01CobefvobmmeygMKCL8KaNy",
    "name": "cronjob_manage",
    "label": "update",
    "status": "done",
    "startedAt": 1792573268303,
    "endedAt": 1792573268316,
    "detail": {
     "tool": "cronjob_manage",
     "input": {
      "action": "update",
      "job_id": "b726944cff11",
      "schedule": "in 10m"
     },
     "output": {
      "success": true,
      "job": {
       "job_id": "b726944cff11",
       "name": "Tee-Erinnerung QA-Test",
       "skill": null,
       "skills": [],
       "prompt_preview": "Erinnere den Benutzer: Zeit, Tee für den QA-Test zu trinken.",
       "model": null,
       "provider": null,
       "pinned": false,
       "base_url": null,
       "schedule": "once in 10m",
       "repeat": "once",
       "deliver": "bot-chat",
       "next_run_at": "2026-10-21T09:11:08.257033+00:00",
       "last_run_at": null,
       "last_status": null,
       "last_delivery_error": null,
       "last_delivery_unverified": null,
       "last_fire_error": null,
       "last_error": null,
       "enabled": true,
       "state": "scheduled",
       "paused_at": null,
       "paused_reason": null
      }
     }
    }
   }
  ]
 },
 {
  "createdAt": 1792573269813,
  "tools": [
   {
    "id": "toolu_01E23nhs3k7TjMU9HobspW7S",
    "name": "cronjob_manage",
    "label": "remove",
    "status": "done",
    "startedAt": 1792573271636,
    "endedAt": 1792573271650,
    "detail": {
     "tool": "cronjob_manage",
     "input": {
      "action": "remove",
      "job_id": "b726944cff11"
     },
     "output": {
      "success": true,
      "message": "Cron job 'Tee-Erinnerung QA-Test' removed.",
      "removed_job": {
       "id": "b726944cff11",
       "name": "Tee-Erinnerung QA-Test",
       "schedule": "once in 10m"
      }
     }
    }
   }
  ]
 }
];

function fakeNotifier() {
  const pending: { id: string; data: Record<string, unknown>; at: number; title: string; body?: string }[] = [];
  let n = 0;
  const notifier: DeviceNotifier = {
    async list() {
      return pending.map((p) => ({ id: p.id, data: p.data, title: p.title, body: p.body }));
    },
    async schedule(s) {
      const id = `n${++n}`;
      pending.push({ id, data: { ...(s.data ?? {}) }, at: s.at.getTime(), title: s.title, body: s.body });
      return { ok: true, id };
    },
    async cancel(id) {
      const i = pending.findIndex((p) => p.id === id);
      if (i >= 0) pending.splice(i, 1);
    },
  };
  return { notifier, pending };
}

const NONE = new Map<string, ReminderFate>();
const changesOf = (turns: Turn[]) => turns.flatMap((t) => parseCronChanges(t.tools, t.createdAt));
const ORIGIN = { conn: 'conn-test', bot: '', src: 'https://hermes.example.com' };

/** the card's "Auch auf diesem Gerät erinnern" for the create turn, as HermesExtras sets it */
async function setFromCard(notifier: DeviceNotifier, turn: Turn, origin: { conn?: string; bot?: string; src?: string } = ORIGIN) {
  const r = parseReminders(turn.tools)[0];
  assert.ok(r?.jobId && r.nextRun);
  const res = await setDeviceReminder(notifier, { key: r.jobId, title: 'Erinnerung', body: r.text, at: r.nextRun, origin: { name: r.name, ...origin } });
  assert.equal(res.ok, true);
  return r;
}

test('QA round 4: "Delete this reminder" in the chat cancels the device copy and the old card says so', async () => {
  const { notifier, pending } = fakeNotifier();
  const r = await setFromCard(notifier, EN_TURNS[0]);
  assert.equal(r.jobId, 'e25e9d2dafb0');
  assert.equal(pending.length, 1);
  assert.deepEqual(pending[0].data, {
    [JOB_TAG]: 'e25e9d2dafb0',
    [AT_TAG]: String(Date.parse('2026-10-21T09:15:01.162299+00:00')),
    [NAME_TAG]: 'QA-Teepause-Erinnerung',
    [CONN_TAG]: 'conn-test',
    [BOT_TAG]: '',
    [SRC_TAG]: 'https://hermes.example.com',
  });
  const changes = changesOf(EN_TURNS);
  assert.deepEqual(changes, [{ jobId: 'e25e9d2dafb0', at: 1792573935950, kind: 'removed' }]);
  const now = 1792573936000; // right after the turn, 11:12 Vienna, the alarm was due at 11:15
  const plan = planTurnSync(changes, await deviceCopies(notifier), NONE, now);
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].kind, 'cancel');
  await runSteps(notifier, plan.steps, 'Erinnerung');
  assert.equal(pending.length, 0, 'no alarm left for 11:15');
  assert.deepEqual(plan.fates, [{ jobId: 'e25e9d2dafb0', status: 'removed', at: 1792573935950, via: 'chat', device: 'removed' }]);
  assert.deepEqual(fateNote(plan.fates[0], r), { kind: 'removed', device: true });
});

test('a reminder deleted in the chat without a device copy: card note only (web, or never set on the phone)', () => {
  const plan = planTurnSync(changesOf(EN_TURNS), [], NONE, 1792573936000);
  assert.deepEqual(plan.steps, []);
  assert.deepEqual(fateNote(plan.fates[0], {}), { kind: 'removed', device: false });
});

test('"verschieb auf in zehn Minuten": the device copy moves to Hermes\' new time, the update card matches it', async () => {
  const { notifier, pending } = fakeNotifier();
  const created = await setFromCard(notifier, DE_TURNS[0]);
  const update = changesOf([DE_TURNS[1]]);
  const next = Date.parse('2026-10-21T09:11:08.257033+00:00');
  assert.deepEqual(update, [{ jobId: 'b726944cff11', at: DE_TURNS[1].tools[0].endedAt, kind: 'scheduled', nextRun: next, recurring: false, name: 'Tee-Erinnerung QA-Test' }]);
  const now = Date.parse('2026-10-21T09:01:10Z');
  const plan = planTurnSync(update, await deviceCopies(notifier), NONE, now);
  assert.equal(plan.steps[0].kind, 'move');
  await runSteps(notifier, plan.steps, 'Erinnerung');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].at, next);
  assert.equal(pending[0].title, 'Erinnerung');
  assert.equal(pending[0].body, created.text, 'same text');
  assert.equal(pending[0].data[CONN_TAG], 'conn-test', 'tags kept');
  // the old create card says where it went, the update card shows its own time (no note)
  assert.deepEqual(fateNote(plan.fates[0], created), { kind: 'moved', at: next });
  assert.equal(fateNote(plan.fates[0], parseReminders(DE_TURNS[1].tools)[0]), null);
});

test('create, move, delete in one chat: only the newest change counts, the copy is gone', async () => {
  const { notifier, pending } = fakeNotifier();
  await setFromCard(notifier, DE_TURNS[0]);
  const plan = planTurnSync(changesOf(DE_TURNS), await deviceCopies(notifier), NONE, Date.parse('2026-10-21T09:02:00Z'));
  assert.deepEqual(plan.steps.map((s) => s.kind), ['cancel']);
  await runSteps(notifier, plan.steps, 'Erinnerung');
  assert.equal(pending.length, 0);
  assert.equal(plan.fates[0].status, 'removed');
});

test('turns seen again or out of order never undo a newer state', async () => {
  const { notifier, pending } = fakeNotifier();
  await setFromCard(notifier, DE_TURNS[0]);
  const removedAt = DE_TURNS[2].tools[0].endedAt as number;
  const fates = new Map([['b726944cff11', { jobId: 'b726944cff11', status: 'removed', at: removedAt, via: 'chat' } as ReminderFate]]);
  // an older history page with the move arrives after the delete was applied
  const plan = planTurnSync(changesOf([DE_TURNS[1]]), await deviceCopies(notifier), fates, Date.parse('2026-10-21T09:02:00Z'));
  assert.deepEqual(plan, { steps: [], fates: [] });
  assert.equal(pending.length, 1);
  // the same delete seen twice: nothing new
  assert.deepEqual(planTurnSync(changesOf(DE_TURNS), [], fates, Date.parse('2026-10-21T09:02:00Z')), { steps: [], fates: [] });
});

const cronEv = (input: Record<string, unknown>, output: unknown, over: Partial<ToolEvent> = {}): ToolEvent => ({
  id: `call-${String(input.action)}`,
  name: 'cronjob_manage',
  label: String(input.action),
  status: 'done',
  startedAt: 1792573900000,
  endedAt: 1792573900100,
  detail: { input, output },
  ...over,
});

test('nothing changes on a failed, cancelled, unfinished or detail-less call, nor on create / list / run', () => {
  const id = 'e25e9d2dafb0';
  const tools: ToolEvent[] = [
    cronEv({ action: 'remove', job_id: id }, { success: false, error: 'Job not found' }),
    cronEv({ action: 'remove', job_id: id }, { error: 'boom' }),
    cronEv({ action: 'remove', job_id: id }, { success: true }, { status: 'running' }),
    cronEv({ action: 'remove', job_id: id }, { success: true }, { detail: { input: { action: 'remove', job_id: id }, output: { success: true }, cancelled: true } }),
    { id: 'live', name: 'cronjob_manage', label: 'remove', status: 'done', startedAt: 1 },
    cronEv({ action: 'list' }, { success: true, jobs: [] }),
    cronEv({ action: 'run', job_id: id }, { success: true }),
    cronEv({ action: 'create', schedule: 'in 5m', prompt: 'x' }, { success: true, job_id: id }),
  ];
  assert.deepEqual(parseCronChanges(tools), []);
});

test('pause removes the copy ("pausiert"), resume makes the card offer the device again', async () => {
  const { notifier, pending } = fakeNotifier();
  const r = await setFromCard(notifier, EN_TURNS[0]);
  const pausedJob = { job_id: r.jobId, name: r.name, enabled: false, state: 'paused', schedule: 'once in 5m', next_run_at: '2026-10-21T09:15:01+00:00' };
  const pause = parseCronChanges([cronEv({ action: 'pause', job_id: r.jobId }, { success: true, job: pausedJob })]);
  assert.deepEqual(pause, [{ jobId: r.jobId, at: 1792573900100, kind: 'paused' }]);
  const p1 = planTurnSync(pause, await deviceCopies(notifier), NONE, 1792573901000);
  await runSteps(notifier, p1.steps, 'Erinnerung');
  assert.equal(pending.length, 0);
  assert.deepEqual(fateNote(p1.fates[0], r), { kind: 'paused', device: true });
  // an update of a paused job keeps it paused
  assert.equal(parseCronChanges([cronEv({ action: 'update', job_id: r.jobId, name: 'Neu' }, { success: true, job: pausedJob })])[0].kind, 'paused');
  const resume = parseCronChanges([
    cronEv({ action: 'resume', job_id: r.jobId }, { success: true, job: { ...pausedJob, enabled: true, state: 'scheduled' } }, { endedAt: 1792573910000 }),
  ]);
  const p2 = planTurnSync(resume, [], new Map([[r.jobId as string, p1.fates[0]]]), 1792573911000);
  assert.deepEqual(p2.steps, []);
  assert.equal(p2.fates[0].status, 'active');
  assert.equal(fateNote(p2.fates[0], r), null);
});

test('renamed in the chat: the copy keeps its time and gets the new name; a job that now repeats loses its copy', async () => {
  const { notifier, pending } = fakeNotifier();
  const r = await setFromCard(notifier, EN_TURNS[0]);
  const job = { job_id: r.jobId, name: 'Teepause', enabled: true, state: 'scheduled', schedule: 'once in 5m', next_run_at: '2026-10-21T09:15:01.162299+00:00' };
  const now = 1792573900500;
  const rename = parseCronChanges([cronEv({ action: 'update', job_id: r.jobId, name: 'Teepause' }, { success: true, job })]);
  const plan = planTurnSync(rename, await deviceCopies(notifier), NONE, now);
  assert.deepEqual(plan.steps.map((s) => s.kind), ['move']);
  await runSteps(notifier, plan.steps, 'Erinnerung');
  assert.equal(pending[0].body, 'Teepause');
  assert.equal(pending[0].data[NAME_TAG], 'Teepause');
  assert.equal(pending[0].at, r.nextRun);
  const weekly = parseCronChanges([cronEv({ action: 'update', job_id: r.jobId, schedule: 'every monday 9am' }, { success: true, job: { ...job, schedule: 'every monday 9am', next_run_at: '2026-10-26T09:00:00+01:00' } }, { endedAt: now + 1000 })]);
  const p2 = planTurnSync(weekly, await deviceCopies(notifier), new Map([[r.jobId as string, plan.fates[0]]]), now + 2000);
  await runSteps(notifier, p2.steps, 'Erinnerung');
  assert.equal(pending.length, 0);
  assert.deepEqual(fateNote(p2.fates[0], r), { kind: 'deviceStopped' });
});

test('a move without a usable time keeps the copy (unknown next run, already due)', async () => {
  const { notifier } = fakeNotifier();
  const r = await setFromCard(notifier, EN_TURNS[0]);
  const copies = await deviceCopies(notifier);
  const noTime = parseCronChanges([cronEv({ action: 'update', job_id: r.jobId, prompt: 'x' }, { success: true, job: { job_id: r.jobId, enabled: true, schedule: 'once in 5m' } })]);
  assert.deepEqual(planTurnSync(noTime, copies, NONE, 1792573900500).steps, []);
  const due = parseCronChanges([cronEv({ action: 'update', job_id: r.jobId, schedule: 'in 1m' }, { success: true, job: { job_id: r.jobId, enabled: true, schedule: 'once in 1m', next_run_at: new Date(1792573930000).toISOString() } })]);
  assert.deepEqual(planTurnSync(due, copies, NONE, 1792573900500).steps, []);
});

// ------------------------------------------------------------------ job list (app start / chat open)

/** a Hermes v0.22 job record as GET /api/jobs?include_disabled=true returns it (fields the app reads) */
const rawJob = (over: Record<string, unknown> = {}) => ({
  id: 'e25e9d2dafb0',
  name: 'QA-Teepause-Erinnerung',
  prompt: 'Erinnere den Benutzer daran, die QA-Teepause zu machen.',
  skills: [],
  schedule: { kind: 'once', run_at: '2026-10-21T11:15:01.162299+02:00', display: 'once in 5m' },
  schedule_display: 'once in 5m',
  repeat: { times: 1, completed: 0 },
  enabled: true,
  state: 'scheduled',
  next_run_at: '2026-10-21T11:15:01.162299+02:00',
  deliver: 'bot-chat',
  ...over,
});
const jobs = (...raw: Record<string, unknown>[]): RoutineJob[] => raw.map((r) => parseJob(r) as RoutineJob);

async function withCopy() {
  const f = fakeNotifier();
  const r = await setFromCard(f.notifier, EN_TURNS[0]);
  return { ...f, r, copies: await deviceCopies(f.notifier) };
}
const NOW = 1792573700000; // 11:08 Vienna

test('job list: the job is gone (deleted in another chat / the dashboard) → copy cancelled, card says so', async () => {
  const { notifier, pending, r } = await withCopy();
  const plan = await checkAgainstJobs({ notifier, list: async () => ({ jobs: [] }), owns: () => true, fates: NONE, now: NOW });
  assert.ok(plan);
  await runSteps(notifier, plan.steps, 'Erinnerung');
  assert.equal(pending.length, 0);
  assert.deepEqual(plan.fates, [{ jobId: 'e25e9d2dafb0', status: 'removed', at: NOW, via: 'server', device: 'removed' }]);
  assert.deepEqual(fateNote(plan.fates[0], r), { kind: 'removed', device: true });
});

test('job list unreadable: offline, routines off (404/403), a 200 without a job list → nothing is cancelled', async () => {
  const { notifier, pending } = await withCopy();
  for (const list of [
    async () => {
      throw new Error('network');
    },
    async () => ({}),
    async () => ({ error: { message: 'Routines are off' } }),
    async () => null,
    async () => ({ jobs: 'nope' }),
  ]) {
    assert.equal(await checkAgainstJobs({ notifier, list, owns: () => true, fates: NONE, now: NOW }), null);
  }
  assert.equal(pending.length, 1);
});

test('job list: unchanged job → nothing; paused → copy removed; moved / renamed → copy follows; repeating → removed', async () => {
  const { copies, r } = await withCopy();
  assert.deepEqual(planServerSync(jobs(rawJob()), copies, NONE, NOW), { steps: [], fates: [] });

  const paused = planServerSync(jobs(rawJob({ enabled: false, state: 'paused', paused_at: '2026-10-21T11:09:00+02:00' })), copies, NONE, NOW);
  assert.deepEqual(paused.steps.map((s) => s.kind), ['cancel']);
  assert.deepEqual(fateNote(paused.fates[0], r), { kind: 'paused', device: true });

  const moved = planServerSync(jobs(rawJob({ next_run_at: '2026-10-21T11:45:00+02:00', schedule: { kind: 'once', run_at: '2026-10-21T11:45:00+02:00' } })), copies, NONE, NOW);
  assert.deepEqual(moved.steps, [{ kind: 'move', copy: copies[0], at: Date.parse('2026-10-21T11:45:00+02:00') }]);
  assert.deepEqual(fateNote(moved.fates[0], r), { kind: 'moved', at: Date.parse('2026-10-21T11:45:00+02:00') });

  const renamed = planServerSync(jobs(rawJob({ name: 'Teepause' })), copies, NONE, NOW);
  assert.deepEqual(renamed.steps, [{ kind: 'move', copy: copies[0], at: r.nextRun, name: 'Teepause' }]);

  const weekly = planServerSync(jobs(rawJob({ schedule: { kind: 'cron', expr: '0 9 * * 1', display: 'every monday 9am' }, next_run_at: '2026-10-26T09:00:00+01:00' })), copies, NONE, NOW);
  assert.deepEqual(weekly.steps.map((s) => s.kind), ['cancel']);
});

test('job list: completed, failed or running jobs and unknown schedules keep the copy', async () => {
  const { copies } = await withCopy();
  for (const over of [
    { enabled: false, state: 'completed', next_run_at: null },
    { state: 'error' },
    { state: 'running' },
    { schedule: { display: '???' }, schedule_display: '???' },
  ]) {
    assert.deepEqual(planServerSync(jobs(rawJob(over)), copies, NONE, NOW).steps, [], JSON.stringify(over));
  }
});

test('job list: only copies of this bot with a Hermes job id, and only those that existed before the list was asked', async () => {
  const { notifier, pending } = fakeNotifier();
  await setDeviceReminder(notifier, { key: 'call-no-job-id', title: 'Erinnerung', body: 'x', at: NOW + 3_600_000 });
  await setDeviceReminder(notifier, { key: 'aaaaaaaaaaaa', title: 'Erinnerung', body: 'other bot', at: NOW + 3_600_000, origin: { conn: 'conn-test', bot: 'writer', src: 'https://hermes.example.com/p/writer' } });
  const owns = (c: DeviceCopy) => c.conn === 'conn-test' && (c.bot ?? '') === '';
  assert.equal(await checkAgainstJobs({ notifier, list: async () => ({ jobs: [] }), owns: () => true, fates: NONE, now: NOW }).then((p) => p?.steps.length), 1, 'tool-call keys are never judged');
  assert.equal(await checkAgainstJobs({ notifier, list: async () => ({ jobs: [] }), owns, fates: NONE, now: NOW }), null, 'nothing of this bot: no request');
  await setFromCard(notifier, EN_TURNS[0]);
  let asked = 0;
  const plan = await checkAgainstJobs({
    notifier,
    list: async () => {
      asked++;
      // a reminder set while the list request runs: the list may not know its job yet
      await setDeviceReminder(notifier, { key: 'bbbbbbbbbbbb', title: 'Erinnerung', body: 'new', at: NOW + 600_000, origin: { conn: 'conn-test', bot: '', src: 'https://hermes.example.com' } });
      return { jobs: [rawJob()] };
    },
    owns,
    fates: NONE,
    now: NOW,
  });
  assert.equal(asked, 1);
  assert.deepEqual(plan, { steps: [], fates: [] });
  assert.equal(pending.length, 4);
});

test('job list: a fate newer than the list wins (the chat deleted it while the list was on its way)', async () => {
  const { copies } = await withCopy();
  const fates = new Map([['e25e9d2dafb0', { jobId: 'e25e9d2dafb0', status: 'removed', at: NOW + 5000, via: 'chat' } as ReminderFate]]);
  assert.deepEqual(planServerSync(jobs(rawJob()), copies, fates, NOW), { steps: [], fates: [] });
});

test('0.2.0 copies without connection tags are read too (the chat matches them by its own cards)', async () => {
  const { notifier } = fakeNotifier();
  await setDeviceReminder(notifier, { key: 'e25e9d2dafb0', title: 'Erinnerung', body: 'QA-Teepause-Erinnerung', at: NOW + 420_000 });
  const [c] = await deviceCopies(notifier);
  assert.deepEqual(c, { id: 'n1', key: 'e25e9d2dafb0', at: NOW + 420_000, title: 'Erinnerung', body: 'QA-Teepause-Erinnerung' });
  // no name tag: a job list name never counts as a rename
  assert.deepEqual(planServerSync(jobs(rawJob({ name: 'Anders', next_run_at: new Date(NOW + 420_000).toISOString() })), [c], NONE, NOW).steps, []);
});

test('fates: newer wins, old and surplus entries drop, stored JSON round-trips, garbage is ignored', () => {
  const a: ReminderFate = { jobId: 'aaaaaaaaaaaa', status: 'removed', at: 2000, via: 'chat', device: 'removed' };
  const older: ReminderFate = { ...a, status: 'active', at: 1000 };
  const m = mergeFates(new Map([[a.jobId, a]]), [older], 3000);
  assert.equal(m.get(a.jobId)?.status, 'removed');
  assert.equal(mergeFates(m, [], 2000 + 91 * 86_400_000).size, 0, 'older than 90 days');
  const many = Array.from({ length: 5 }, (_, i): ReminderFate => ({ jobId: `job${i}`, status: 'active', at: i, via: 'server' }));
  assert.deepEqual([...mergeFates(new Map(), many, 10, undefined, 3).keys()], ['job4', 'job3', 'job2']);
  const moved: ReminderFate = { jobId: 'bbbbbbbbbbbb', status: 'active', at: 5, via: 'server', device: 'moved', deviceAt: 99 };
  assert.deepEqual(parseFates(JSON.parse(JSON.stringify([a, moved]))), new Map([[a.jobId, a], [moved.jobId, moved]]));
  assert.equal(parseFates([{ jobId: 'x', status: 'gone', at: 1 }, { status: 'removed', at: 1 }, null, 'x']).size, 0);
  assert.equal(parseFates({}).size, 0);
});
