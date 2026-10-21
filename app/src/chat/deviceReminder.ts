/**
 * Device copy of a Hermes reminder ("Auch auf diesem Gerät erinnern" on the reminder card). A job created from the app
 * runs on Hermes, but its answer only reaches a channel Hermes knows (Telegram, the Bot Chat, …): an API session cannot
 * receive it, so with no such channel nothing tells the user. The copy is a local notification tagged with the Hermes
 * job, so the card knows after a restart that it is set, a moved reminder replaces it and Delete removes it. The tag
 * also names the job, the connection and the bot, so reminderSync.ts can check the copy against Hermes' job list.
 * Pure over an injected notifier (deviceReminder.test.ts); the app passes actions/notifications.ts.
 */
import type { ScheduleResult } from '../actions/notifications.ts';
import type { DeviceCopy } from './reminderSync.ts';

export type DeviceNotifier = {
  list(): Promise<{ id: string; data: Record<string, unknown>; title?: string; body?: string }[]>;
  schedule(o: { title: string; body?: string; at: Date; data?: Record<string, string> }): Promise<ScheduleResult>;
  cancel(id: string): Promise<void>;
};

/** `data` keys of the tag: the Hermes job (or the tool call when the result had no job id) and the time (ms) */
export const JOB_TAG = 'huiCronJob';
export const AT_TAG = 'huiCronAt';
/** job name, app connection id, Hermes profile ("" = default) and that bot's API root when the copy was set (not on 0.2.0 copies) */
export const NAME_TAG = 'huiCronName';
export const CONN_TAG = 'huiCronConn';
export const BOT_TAG = 'huiCronBot';
export const SRC_TAG = 'huiCronSrc';

/** Where the copy's Hermes job lives. */
export type DeviceOrigin = { name?: string; conn?: string; bot?: string; src?: string };

const tagStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Every pending device copy of a Hermes reminder. */
export async function deviceCopies(n: DeviceNotifier): Promise<DeviceCopy[]> {
  const out: DeviceCopy[] = [];
  for (const x of await n.list()) {
    const key = tagStr(x.data[JOB_TAG]);
    const at = Number(x.data[AT_TAG]);
    if (!key || !Number.isFinite(at)) continue;
    const c: DeviceCopy = { id: x.id, key, at };
    if (x.title) c.title = x.title;
    if (x.body) c.body = x.body;
    const name = tagStr(x.data[NAME_TAG]);
    const conn = tagStr(x.data[CONN_TAG]);
    const bot = tagStr(x.data[BOT_TAG]);
    const src = tagStr(x.data[SRC_TAG]);
    if (name) c.name = name;
    if (conn) c.conn = conn;
    if (bot !== undefined) c.bot = bot;
    if (src) c.src = src;
    out.push(c);
  }
  return out;
}

function originTags(o: DeviceOrigin): Record<string, string> {
  const t: Record<string, string> = {};
  if (o.name) t[NAME_TAG] = o.name;
  if (o.conn) t[CONN_TAG] = o.conn;
  if (o.conn || o.bot) t[BOT_TAG] = o.bot ?? '';
  if (o.src) t[SRC_TAG] = o.src;
  return t;
}

async function tagged(n: DeviceNotifier, key: string): Promise<{ id: string; at: number }[]> {
  return (await n.list()).filter((x) => x.data[JOB_TAG] === key).map((x) => ({ id: x.id, at: Number(x.data[AT_TAG]) }));
}

/** Time (ms) of the pending device reminder for this job, or null. */
export async function deviceReminderOf(n: DeviceNotifier, key: string): Promise<number | null> {
  const hit = (await tagged(n, key)).find((x) => Number.isFinite(x.at));
  return hit ? hit.at : null;
}

/** Set the device reminder for a job; an older one of the same job (moved reminder) is cancelled first. */
export async function setDeviceReminder(n: DeviceNotifier, o: { key: string; title: string; body: string; at: number; origin?: DeviceOrigin }): Promise<ScheduleResult> {
  await clearDeviceReminder(n, o.key);
  return n.schedule({ title: o.title, body: o.body, at: new Date(o.at), data: { [JOB_TAG]: o.key, [AT_TAG]: String(o.at), ...originTags(o.origin ?? {}) } });
}

/** Move a copy to another time (and name): same title, the body follows a new name, tags kept. */
export async function moveDeviceReminder(n: DeviceNotifier, copy: DeviceCopy, to: { at: number; name?: string }, fallbackTitle: string): Promise<ScheduleResult> {
  const body = to.name ?? copy.body ?? copy.name ?? '';
  return setDeviceReminder(n, {
    key: copy.key,
    title: copy.title ?? fallbackTitle,
    body,
    at: to.at,
    origin: { name: to.name ?? copy.name, conn: copy.conn, bot: copy.bot, src: copy.src },
  });
}

export async function clearDeviceReminder(n: DeviceNotifier, key: string): Promise<void> {
  for (const x of await tagged(n, key)) await n.cancel(x.id);
}
