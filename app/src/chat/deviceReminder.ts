/**
 * Device copy of a Hermes reminder ("Auch auf diesem Gerät erinnern" on the reminder card). A job created from the app
 * runs on Hermes, but its answer only reaches a channel Hermes knows (Telegram, the Bot Chat, …): an API session cannot
 * receive it, so with no such channel nothing tells the user. The copy is a local notification tagged with the Hermes
 * job, so the card knows after a restart that it is set, a moved reminder replaces it and Delete removes it.
 * Pure over an injected notifier (deviceReminder.test.ts); the app passes actions/notifications.ts.
 */
import type { ScheduleResult } from '../actions/notifications.ts';

export type DeviceNotifier = {
  list(): Promise<{ id: string; data: Record<string, unknown> }[]>;
  schedule(o: { title: string; body?: string; at: Date; data?: Record<string, string> }): Promise<ScheduleResult>;
  cancel(id: string): Promise<void>;
};

/** `data` keys of the tag: the Hermes job (or the tool call when the result had no job id) and the time (ms) */
export const JOB_TAG = 'huiCronJob';
export const AT_TAG = 'huiCronAt';

async function tagged(n: DeviceNotifier, key: string): Promise<{ id: string; at: number }[]> {
  return (await n.list()).filter((x) => x.data[JOB_TAG] === key).map((x) => ({ id: x.id, at: Number(x.data[AT_TAG]) }));
}

/** Time (ms) of the pending device reminder for this job, or null. */
export async function deviceReminderOf(n: DeviceNotifier, key: string): Promise<number | null> {
  const hit = (await tagged(n, key)).find((x) => Number.isFinite(x.at));
  return hit ? hit.at : null;
}

/** Set the device reminder for a job; an older one of the same job (moved reminder) is cancelled first. */
export async function setDeviceReminder(n: DeviceNotifier, o: { key: string; title: string; body: string; at: number }): Promise<ScheduleResult> {
  await clearDeviceReminder(n, o.key);
  return n.schedule({ title: o.title, body: o.body, at: new Date(o.at), data: { [JOB_TAG]: o.key, [AT_TAG]: String(o.at) } });
}

export async function clearDeviceReminder(n: DeviceNotifier, key: string): Promise<void> {
  for (const x of await tagged(n, key)) await n.cancel(x.id);
}
