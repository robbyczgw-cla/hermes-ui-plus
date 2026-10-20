/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AT_TAG, clearDeviceReminder, deviceReminderOf, JOB_TAG, setDeviceReminder, type DeviceNotifier } from './deviceReminder.ts';

/** In-memory stand-in for expo-notifications' scheduled list. */
function fakeNotifier(o: { result?: Awaited<ReturnType<DeviceNotifier['schedule']>> } = {}) {
  const pending: { id: string; data: Record<string, unknown>; at: number; title: string; body?: string }[] = [];
  let n = 0;
  const notifier: DeviceNotifier = {
    async list() {
      return pending.map((p) => ({ id: p.id, data: p.data }));
    },
    async schedule(s) {
      if (o.result && !o.result.ok) return o.result;
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

const AT = Date.parse('2026-10-21T09:00:00+02:00');

test('setDeviceReminder: one tagged notification at the reminder time, found again by the job', async () => {
  const { notifier, pending } = fakeNotifier();
  assert.equal(await deviceReminderOf(notifier, 'job1'), null);
  const r = await setDeviceReminder(notifier, { key: 'job1', title: 'Erinnerung', body: 'Tee kaufen', at: AT });
  assert.equal(r.ok, true);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].at, AT);
  assert.equal(pending[0].body, 'Tee kaufen');
  assert.deepEqual(pending[0].data, { [JOB_TAG]: 'job1', [AT_TAG]: String(AT) });
  assert.equal(await deviceReminderOf(notifier, 'job1'), AT);
  assert.equal(await deviceReminderOf(notifier, 'job2'), null);
});

test('setDeviceReminder: a moved reminder replaces the older copy of the same job, other jobs stay', async () => {
  const { notifier, pending } = fakeNotifier();
  await setDeviceReminder(notifier, { key: 'job1', title: 'E', body: 'Tee', at: AT });
  await setDeviceReminder(notifier, { key: 'job2', title: 'E', body: 'Zahnarzt', at: AT });
  await setDeviceReminder(notifier, { key: 'job1', title: 'E', body: 'Tee', at: AT + 3_600_000 });
  assert.deepEqual(pending.map((p) => [p.data[JOB_TAG], p.at]), [['job2', AT], ['job1', AT + 3_600_000]]);
  assert.equal(await deviceReminderOf(notifier, 'job1'), AT + 3_600_000);
});

test('clearDeviceReminder: removes only that job; untagged notifications (timers) are never touched', async () => {
  const { notifier, pending } = fakeNotifier();
  pending.push({ id: 'timer', data: {}, at: AT, title: 'Timer' });
  await setDeviceReminder(notifier, { key: 'job1', title: 'E', body: 'Tee', at: AT });
  await clearDeviceReminder(notifier, 'job1');
  await clearDeviceReminder(notifier, 'nothing');
  assert.deepEqual(pending.map((p) => p.id), ['timer']);
});

test('setDeviceReminder: a refused permission comes back as the reason, nothing is left scheduled', async () => {
  const { notifier, pending } = fakeNotifier({ result: { ok: false, reason: 'denied' } });
  assert.deepEqual(await setDeviceReminder(notifier, { key: 'job1', title: 'E', body: 'Tee', at: AT }), { ok: false, reason: 'denied' });
  assert.equal(pending.length, 0);
});
