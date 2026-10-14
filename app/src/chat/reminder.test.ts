/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRecurringSchedule, parseNextRun, parseReminders, reminderChangePrefill, reminderDeleteMessage, reminderWhen } from './reminder.ts';
import type { ToolEvent } from '../hermes/types.ts';
import { makeT } from '../i18n/core.ts';

const de = makeT('de', 'de-DE');
const en = makeT('en', 'en-US');

const cron = (input: unknown, output: unknown, over: Partial<ToolEvent> = {}): ToolEvent => ({
  id: 'c1',
  name: 'cronjob_manage',
  label: 'create',
  status: 'done',
  startedAt: 1,
  detail: { tool: 'cronjob_manage', input, output },
  ...over,
});

const NOW = new Date(2026, 9, 12, 20, 30).getTime(); // Mon 12 Oct 2026 20:30 local
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();

test('parseReminders: create result with name, schedule and next run', () => {
  const r = parseReminders([
    cron(
      { action: 'create', schedule: 'in 12h', prompt: 'Erinnere Rob: Zahnarzt anrufen', name: 'Zahnarzt' },
      { success: true, job_id: 'j42', name: 'Zahnarzt', schedule: 'in 12h', next_run_at: '2026-10-13T08:00:00' },
    ),
  ]);
  assert.equal(r.length, 1);
  assert.deepEqual({ ...r[0], nextRun: undefined }, { id: 'c1', action: 'create', jobId: 'j42', name: 'Zahnarzt', text: 'Zahnarzt', schedule: 'in 12h', nextRun: undefined, recurring: false });
  assert.equal(r[0].nextRun, new Date('2026-10-13T08:00:00').getTime());
});

test('parseReminders: stored result as JSON string, prompt as text, recurring schedules', () => {
  const r = parseReminders([
    cron(JSON.stringify({ action: 'create', schedule: 'every day at 9am', prompt: 'Wasser trinken' }), JSON.stringify({ success: true, job_id: 'j1', name: 'job-j1', schedule: 'every day at 9am' })),
  ]);
  assert.equal(r[0].name, 'job-j1');
  assert.equal(r[0].recurring, true);
  assert.equal(r[0].nextRun, undefined);
  assert.equal(r[0].schedule, 'every day at 9am');
});

test('parseReminders: update counts, everything else does not', () => {
  const ok = { success: true, job_id: 'j1', name: 'A' };
  assert.equal(parseReminders([cron({ action: 'update', job_id: 'j1' }, ok, { label: 'update' })])[0].action, 'update');
  assert.equal(parseReminders([cron({ action: 'list' }, ok, { label: 'list' })]).length, 0);
  assert.equal(parseReminders([cron({ action: 'remove', job_id: 'j1' }, ok, { label: 'remove' })]).length, 0);
  // failed / running / no stored result / other tools
  assert.equal(parseReminders([cron({ action: 'create' }, { success: false, error: 'bad schedule' })]).length, 0);
  assert.equal(parseReminders([cron({ action: 'create' }, ok, { status: 'error' })]).length, 0);
  assert.equal(parseReminders([cron({ action: 'create' }, ok, { status: 'running' })]).length, 0);
  assert.equal(parseReminders([cron({ action: 'create' }, undefined)]).length, 0);
  assert.equal(parseReminders([cron({ action: 'create' }, ok, { name: 'terminal' })]).length, 0);
  assert.equal(parseReminders([cron({ action: 'create' }, { success: true })]).length, 0); // nothing to address it by
  // live label only (no detail yet)
  assert.equal(parseReminders([{ id: 'x', name: 'cronjob_manage', label: 'create', status: 'done', startedAt: 1 }]).length, 0);
});

test('parseNextRun / isRecurringSchedule', () => {
  assert.equal(parseNextRun('2026-10-13T08:00:00+00:00'), Date.parse('2026-10-13T08:00:00+00:00'));
  assert.equal(parseNextRun(1_780_000_000), 1_780_000_000_000);
  assert.equal(parseNextRun(1_780_000_000_000), 1_780_000_000_000);
  assert.equal(parseNextRun('bald'), undefined);
  assert.equal(parseNextRun(undefined), undefined);
  assert.equal(isRecurringSchedule('in 30m'), false);
  assert.equal(isRecurringSchedule('2026-06-01T09:00:00'), false);
  assert.equal(isRecurringSchedule('0 9 * * *'), true);
  assert.equal(isRecurringSchedule('every 2h'), true);
  assert.equal(isRecurringSchedule('30m'), true);
  assert.equal(isRecurringSchedule(undefined), false);
});

test('reminderWhen: heute / morgen / weekday / date, raw schedule as fallback', () => {
  const time = (t: typeof de, ms: number) => t('hermesTools.reminder.today', { time: '' }) && ms;
  void time;
  assert.match(reminderWhen(de, 'de-DE', { nextRun: at(12, 22) }, NOW), /^heute 22:00$/);
  assert.match(reminderWhen(de, 'de-DE', { nextRun: at(13, 8) }, NOW), /^morgen 08:00$/);
  assert.match(reminderWhen(en, 'en-US', { nextRun: at(13, 8) }, NOW), /^tomorrow 08:00 AM$/);
  assert.match(reminderWhen(de, 'de-DE', { nextRun: at(15, 8) }, NOW), /^Do\.?,? 08:00$/);
  assert.match(reminderWhen(de, 'de-DE', { nextRun: at(25, 8) }, NOW), /^25\.10\.,? 08:00$/);
  assert.equal(reminderWhen(de, 'de-DE', { schedule: 'every day at 9am' }, NOW), 'every day at 9am');
  assert.equal(reminderWhen(de, 'de-DE', {}, NOW), '');
});

test('button messages', () => {
  assert.equal(reminderChangePrefill(de, { name: 'Zahnarzt' }), 'Ändere die Erinnerung Zahnarzt: ');
  assert.equal(reminderDeleteMessage(de, { name: 'Zahnarzt' }), 'Bitte lösche die Erinnerung Zahnarzt.');
  assert.equal(reminderDeleteMessage(en, { name: 'dentist' }), 'Please delete the reminder dentist.');
});
