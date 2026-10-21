/**
 * The app side of reminderSync.ts: applies its plans to the local notifications, keeps the reminder cards' job states
 * (AsyncStorage, newest 300, 90 days) and offers the hooks:
 * - useReminderSync()  in a Hermes chat: the job changes of its turns, then a check of its device copies against the
 *                      bot's job list when the chat opens
 * - <ReminderSyncHost/> on app start and when the app returns to the foreground: every tagged device copy against the
 *                      job list of its connection + bot
 * - useReminderFate() / useDeviceCopiesVersion()  for the card.
 * A job list that cannot be read (offline, routines off for this device, older Hermes, 401) changes nothing. The web
 * and desktop apps have no device copies: there only the turns update the cards.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { cancelLocalNotification, listLocalNotifications, scheduleLocalNotification } from '../actions/notifications';
import { withBot } from '../hermes/bots';
import { hermesJsonRequest } from '../hermes/client';
import { apiRoot } from '../hermes/sessions';
import type { ChatMessage, ToolEvent } from '../hermes/types';
import { useT } from '../i18n';
import { useConnection } from '../settings/ConnectionProvider';
import { isDemoProfile, type ConnectionProfile } from '../settings/profiles';
import { deviceCopies, type DeviceNotifier } from './deviceReminder';
import { parseReminders } from './reminder';
import { checkAgainstJobs, mergeFates, parseCronChanges, parseFates, planTurnSync, runSteps, type CronChange, type DeviceCopy, type ReminderFate, type SyncPlan } from './reminderSync';

export const deviceNotifier: DeviceNotifier = { list: listLocalNotifications, schedule: scheduleLocalNotification, cancel: cancelLocalNotification };
// local notifications exist on the phone apps only (actions/notifications.ts); web and desktop never offer the copy
export const DEVICE_REMINDERS = Platform.OS === 'ios' || Platform.OS === 'android';

const FATES_STORE = 'hui.reminderFates.v1';
/** one job-list check per connection + bot at most this often */
const RECHECK_MS = 60_000;
const FIRST_CHECK_DELAY_MS = 5000;

let fates = new Map<string, ReminderFate>();
let loading: Promise<void> | null = null;
/** bumped when the sync changed device copies: the cards read theirs again */
let copiesVersion = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of Array.from(listeners)) l();
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

function load(): Promise<void> {
  loading ??= AsyncStorage.getItem(FATES_STORE)
    .then((raw) => {
      let parsed: unknown = null;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {
        // broken value → nothing known
      }
      fates = mergeFates(parseFates(parsed), [...fates.values()], Date.now());
      emit();
    })
    .catch(() => {});
  return loading;
}

// one plan at a time: a turn sync and a list check never work on the same copies at once
let queue: Promise<unknown> = Promise.resolve();
function serial(fn: () => Promise<void>): Promise<void> {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}

async function apply(plan: SyncPlan, title: string): Promise<void> {
  await runSteps(deviceNotifier, plan.steps, title);
  if (plan.fates.length) {
    fates = mergeFates(fates, plan.fates, Date.now());
    void AsyncStorage.setItem(FATES_STORE, JSON.stringify([...fates.values()])).catch(() => {});
  }
  if (plan.steps.length) copiesVersion++;
  if (plan.steps.length || plan.fates.length) emit();
}

/** Apply the job changes of a chat's turns (cancel / move device copies, card states). `title`: notification title for a moved copy without one. */
export function syncTurnChanges(changes: readonly CronChange[], title: string): Promise<void> {
  if (!changes.length) return Promise.resolve();
  return serial(async () => {
    await load();
    const copies = DEVICE_REMINDERS ? await deviceCopies(deviceNotifier) : [];
    await apply(planTurnSync(changes, copies, fates, Date.now()), title);
  });
}

const jobList = (conn: { baseUrl: string; apiKey: string }) => () => hermesJsonRequest(conn)('GET', '/api/jobs?include_disabled=true');

const lastCheck = new Map<string, number>();

/** Check the device copies `owns` picks against a job list (reminderSync.ts checkAgainstJobs), at most once a minute per `key`. */
export async function reconcileWithJobs(o: { key: string; list: () => Promise<unknown>; owns: (c: DeviceCopy) => boolean; title: string; force?: boolean }): Promise<void> {
  if (!DEVICE_REMINDERS) return;
  const now = Date.now();
  if (!o.force && now - (lastCheck.get(o.key) ?? 0) < RECHECK_MS) return;
  lastCheck.set(o.key, now);
  await load();
  await serial(async () => {
    const plan = await checkAgainstJobs({ notifier: deviceNotifier, list: o.list, owns: o.owns, fates, now });
    if (plan) await apply(plan, o.title);
  });
}

// ------------------------------------------------------------------ hooks

export function useReminderFate(jobId: string | undefined): ReminderFate | undefined {
  useEffect(() => void load(), []);
  return useSyncExternalStore(
    subscribe,
    () => (jobId ? fates.get(jobId) : undefined),
    () => undefined,
  );
}

export function useDeviceCopiesVersion(): number {
  return useSyncExternalStore(subscribe, () => copiesVersion, () => 0);
}

// parsed once per tool list (messages re-render on every streamed token)
const changesCache = new WeakMap<readonly ToolEvent[], CronChange[]>();
const jobsCache = new WeakMap<readonly ToolEvent[], string[]>();

function turnChanges(m: ChatMessage): CronChange[] {
  if (m.role !== 'assistant' || m.status === 'streaming' || !m.tools.length) return [];
  let c = changesCache.get(m.tools);
  if (!c) changesCache.set(m.tools, (c = parseCronChanges(m.tools, m.createdAt)));
  return c;
}

function cardJobs(m: ChatMessage): string[] {
  if (m.role !== 'assistant' || m.status === 'streaming' || !m.tools.length) return [];
  let j = jobsCache.get(m.tools);
  if (!j) jobsCache.set(m.tools, (j = parseReminders(m.tools).flatMap((r) => (r.jobId ? [r.jobId] : []))));
  return j;
}

type Origin = { conn: string; bot: string; src: string };

/** The tag a copy set from this chat gets (deviceReminder.ts), from the chat's connection + bot. */
export function deviceOrigin(profile: Pick<ConnectionProfile, 'id' | 'baseUrl'> | undefined, bot: string | undefined): Origin | undefined {
  if (!profile) return undefined;
  return { conn: profile.id, bot: bot ?? '', src: apiRoot(withBot({ baseUrl: profile.baseUrl }, bot).baseUrl) };
}

const ownedBy = (o: Origin) => (c: DeviceCopy) => c.conn === o.conn && (c.bot ?? '') === o.bot && c.src === o.src;

/**
 * In a Hermes chat: apply the job changes of its turns, and when the chat opens (or its reminder cards first load)
 * check its device copies, also the untagged ones of its own cards, against the bot's job list.
 */
export function useReminderSync(messages: readonly ChatMessage[], profile: ConnectionProfile, bot: string | undefined): void {
  const tr = useT();
  const title = tr('actionRunner.notify.reminderTitle');
  const changes = useMemo(() => messages.flatMap(turnChanges), [messages]);
  const changeSig = changes.map((c) => `${c.jobId}:${c.kind}:${c.at}`).join('|');
  useEffect(() => {
    if (changes.length) void syncTurnChanges(changes, title);
  }, [changeSig]); // eslint-disable-line react-hooks/exhaustive-deps

  const jobIds = useMemo(() => [...new Set(messages.flatMap(cardJobs))].sort(), [messages]);
  const jobSig = jobIds.join(',');
  const demo = isDemoProfile(profile);
  const { id, baseUrl, apiKey } = profile;
  useEffect(() => {
    if (!DEVICE_REMINDERS || demo || !jobIds.length || !apiKey || !/^https?:\/\//i.test(baseUrl)) return;
    const origin = deviceOrigin({ id, baseUrl }, bot) as Origin;
    const own = new Set(jobIds);
    const tagged = ownedBy(origin);
    const conn = withBot({ baseUrl, apiKey }, bot);
    void reconcileWithJobs({
      key: `${origin.conn}|${origin.bot}|${origin.src}|${jobSig}`,
      list: jobList(conn),
      // its own cards' copies made by 0.2.0 carry no connection tag
      owns: (c) => tagged(c) || (!c.conn && own.has(c.key)),
      title,
    });
  }, [jobSig, demo, id, baseUrl, apiKey, bot]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** On app start and back in the foreground: every tagged device copy against its connection's job list. */
export function ReminderSyncHost() {
  const { profiles, ready } = useConnection();
  const tr = useT();
  const title = tr('actionRunner.notify.reminderTitle');
  useEffect(() => {
    if (!DEVICE_REMINDERS || !ready) return;
    const run = async () => {
      const groups = new Map<string, Origin>();
      for (const c of await deviceCopies(deviceNotifier)) {
        if (!c.conn || !c.src) continue;
        groups.set(`${c.conn}|${c.bot ?? ''}|${c.src}`, { conn: c.conn, bot: c.bot ?? '', src: c.src });
      }
      for (const [key, o] of groups) {
        const p = profiles.find((x) => x.id === o.conn);
        if (!p || p.kind !== 'hermes' || isDemoProfile(p) || !p.apiKey) continue;
        const bot = o.bot || undefined;
        // the connection now points elsewhere: its list says nothing about this copy
        if (deviceOrigin(p, bot)?.src !== o.src) continue;
        const conn = withBot({ baseUrl: p.baseUrl, apiKey: p.apiKey }, bot);
        await reconcileWithJobs({ key, list: jobList(conn), owns: ownedBy(o), title });
      }
    };
    const first = setTimeout(() => void run().catch(() => {}), FIRST_CHECK_DELAY_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void run().catch(() => {});
    });
    return () => {
      clearTimeout(first);
      sub.remove();
    };
  }, [ready, profiles, title]);
  return null;
}
