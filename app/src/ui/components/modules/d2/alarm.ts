/**
 * "Time is up" alarms for the d2 clocks (timer v2, guide step timers, workout rest).
 *
 * Native: a scheduled local notification via expo-notifications (permission + the
 * "Timer & Erinnerungen" channel come from actions/notifications.ts); with sound off it goes to a
 * silent channel. It fires in the background / when the app is closed.
 * Web: the Notification API when permitted (fires while the tab is open, also in the background);
 * otherwise `scheduleAlarm` resolves to null and the module shows its in-app alert instead.
 */
import { Platform, Vibration } from 'react-native';
import { ensureNotificationPermission, NOTIFICATION_CHANNEL_ID } from '../../../../actions/notifications';

export type AlarmOptions = { title: string; body?: string; at: number; sound: boolean };

const SILENT_CHANNEL_ID = 'timers-silent';

type NotificationsModule = typeof import('expo-notifications');
let modPromise: Promise<NotificationsModule | null> | null = null;
function loadModule(): Promise<NotificationsModule | null> {
  if (Platform.OS === 'web') return Promise.resolve(null);
  modPromise ??= import('expo-notifications').then(
    (m) => m,
    () => null,
  );
  return modPromise;
}

let silentChannel: Promise<void> | null = null;
function ensureSilentChannel(N: NotificationsModule, name: string): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  silentChannel ??= N.setNotificationChannelAsync(SILENT_CHANNEL_ID, {
    name,
    importance: N.AndroidImportance.DEFAULT,
    sound: null,
    enableVibrate: false,
  }).then(
    () => undefined,
    () => {
      silentChannel = null;
    },
  );
  return silentChannel;
}

/* ───────────── web ───────────── */

type WebTimer = { handle: ReturnType<typeof setTimeout> };
const webTimers = new Map<string, WebTimer>();
let webSeq = 0;

function webNotificationApi(): { permission: string; requestPermission?: () => Promise<string> } | null {
  const N = (globalThis as { Notification?: { permission: string; requestPermission?: () => Promise<string> } }).Notification;
  return N ?? null;
}

async function webPermitted(): Promise<boolean> {
  const N = webNotificationApi();
  if (!N) return false;
  if (N.permission === 'granted') return true;
  if (N.permission !== 'default' || !N.requestPermission) return false;
  try {
    return (await N.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

function showWebNotification(o: AlarmOptions): void {
  try {
    const Ctor = (globalThis as unknown as { Notification?: new (title: string, opts?: { body?: string; silent?: boolean; tag?: string }) => unknown }).Notification;
    if (Ctor) new Ctor(o.title, { body: o.body, silent: !o.sound, tag: `hui-timer-${o.at}` });
  } catch {
    /* some mobile browsers only allow notifications from a service worker */
  }
}

/* ───────────── API ───────────── */

/** Copy for the silent Android channel name (set once by the UI with the active language). */
let silentChannelName = 'Timer (lautlos)';
export function setSilentChannelName(name: string): void {
  silentChannelName = name;
}

/**
 * Schedule the "done" alarm at an absolute time; resolves to its id, or null when no system
 * notification is possible (denied, unsupported) → the caller relies on its in-app alert.
 */
export async function scheduleAlarm(o: AlarmOptions): Promise<string | null> {
  if (Platform.OS === 'web') {
    if (!(await webPermitted())) return null;
    const id = `web:${++webSeq}`;
    const delay = Math.max(0, o.at - Date.now());
    const handle = setTimeout(() => {
      webTimers.delete(id);
      showWebNotification(o);
    }, delay);
    webTimers.set(id, { handle });
    return id;
  }
  const perm = await ensureNotificationPermission();
  if (perm !== 'granted') return null;
  const N = await loadModule();
  if (!N) return null;
  try {
    if (!o.sound) await ensureSilentChannel(N, silentChannelName);
    const at = Math.max(o.at, Date.now() + 1000);
    return await N.scheduleNotificationAsync({
      content: { title: o.title, body: o.body ?? undefined, sound: o.sound ? 'default' : false },
      trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: at, channelId: o.sound ? NOTIFICATION_CHANNEL_ID : SILENT_CHANNEL_ID },
    });
  } catch {
    return null;
  }
}

export async function cancelAlarm(id: string | null | undefined): Promise<void> {
  if (!id) return;
  if (id.startsWith('web:')) {
    const w = webTimers.get(id);
    if (w) clearTimeout(w.handle);
    webTimers.delete(id);
    return;
  }
  const N = await loadModule();
  if (!N) return;
  try {
    await N.cancelScheduledNotificationAsync(id);
  } catch {
    /* already fired / unknown */
  }
}

/**
 * In-app "done" cue while the module is visible: vibration (native) or a short soft chime (web),
 * only when sound/vibration is on. Haptics are handled by the caller.
 */
export function playDoneCue(sound: boolean): void {
  if (!sound) return;
  if (Platform.OS !== 'web') {
    try {
      Vibration.vibrate([0, 250, 200, 250]);
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    const AC = (globalThis as { AudioContext?: new () => AudioContextLike }).AudioContext;
    if (!AC) return;
    const ctx = new AC();
    const now = ctx.currentTime;
    [0, 0.28].forEach((dt, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = i ? 1046.5 : 784;
      gain.gain.setValueAtTime(0.0001, now + dt);
      gain.gain.exponentialRampToValueAtTime(0.18, now + dt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dt + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + dt);
      osc.stop(now + dt + 0.5);
    });
    setTimeout(() => void ctx.close?.(), 1200);
  } catch {
    /* autoplay policy etc. */
  }
}

type AudioParamLike = { value: number; setValueAtTime(v: number, t: number): void; exponentialRampToValueAtTime(v: number, t: number): void };
type NodeLike = { connect(n: unknown): void };
type AudioContextLike = {
  currentTime: number;
  destination: unknown;
  createOscillator(): NodeLike & { type: string; frequency: AudioParamLike; start(t: number): void; stop(t: number): void };
  createGain(): NodeLike & { gain: AudioParamLike };
  close?: () => Promise<void>;
};
