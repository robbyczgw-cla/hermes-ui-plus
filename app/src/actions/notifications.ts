/**
 * expo-notifications adapter: permission, Android channel "Timer & Erinnerungen", local scheduling.
 * `expo-notifications` is imported lazily (it registers push-token side effects on import) and is
 * not available on web.
 */
import { Platform } from 'react-native';
import { getActionI18n } from './i18nState.ts';
import type { TimerNotifier } from './timerStore.ts';

export const NOTIFICATION_CHANNEL_ID = 'timers-reminders';

type NotificationsModule = typeof import('expo-notifications');

let modPromise: Promise<NotificationsModule | null> | null = null;
function loadModule(): Promise<NotificationsModule | null> {
  if (Platform.OS === 'web') return Promise.resolve(null);
  if (!modPromise) {
    modPromise = import('expo-notifications').then(
      (m) => m,
      () => null,
    );
  }
  return modPromise;
}

export type NotificationPermission = 'granted' | 'denied' | 'unsupported';

let readyPromise: Promise<NotificationPermission> | null = null;
let handlerInstalled = false;

/** Install the foreground handler (show banner + sound) and create the Android channel. */
async function prepare(N: NotificationsModule): Promise<void> {
  if (!handlerInstalled) {
    handlerInstalled = true;
    N.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
    });
  }
  if (Platform.OS === 'android') {
    const { t } = getActionI18n();
    await N.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, {
      name: t('actionRunner.notify.channelName'),
      description: t('actionRunner.notify.channelDescription'),
      importance: N.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 200, 250],
      sound: 'default',
    });
  }
}

/** Ask for permission when needed (channel first – required for the Android 13+ prompt). Cached after success. */
export function ensureNotificationPermission(): Promise<NotificationPermission> {
  if (readyPromise) return readyPromise;
  const p = (async (): Promise<NotificationPermission> => {
    const N = await loadModule();
    if (!N) return 'unsupported';
    try {
      await prepare(N);
      let st = await N.getPermissionsAsync();
      if (!st.granted && st.canAskAgain) st = await N.requestPermissionsAsync();
      return st.granted ? 'granted' : 'denied';
    } catch {
      return 'unsupported';
    }
  })();
  readyPromise = p;
  // only cache a positive answer: the user may enable notifications in settings later
  void p.then((r) => {
    if (r !== 'granted' && readyPromise === p) readyPromise = null;
  });
  return p;
}

export type ScheduleResult = { ok: true; id: string } | { ok: false; reason: 'denied' | 'unsupported' | 'error' };

/** Schedule one local notification at an absolute time. */
export async function scheduleLocalNotification(o: { title: string; body?: string; at: Date }): Promise<ScheduleResult> {
  const perm = await ensureNotificationPermission();
  if (perm !== 'granted') return { ok: false, reason: perm };
  const N = await loadModule();
  if (!N) return { ok: false, reason: 'unsupported' };
  try {
    const at = Math.max(o.at.getTime(), Date.now() + 1000);
    const id = await N.scheduleNotificationAsync({
      content: { title: o.title, body: o.body ?? undefined, sound: 'default' },
      trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: at, channelId: NOTIFICATION_CHANNEL_ID },
    });
    return { ok: true, id };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

export async function cancelLocalNotification(id: string): Promise<void> {
  const N = await loadModule();
  if (!N) return;
  try {
    await N.cancelScheduledNotificationAsync(id);
  } catch {
    /* already fired / unknown */
  }
}

/** Notifier for the TimerStore. A denied permission just means "no notification" (timer still runs in-app). */
export const timerNotifier: TimerNotifier = {
  async schedule(o) {
    const r = await scheduleLocalNotification({ title: getActionI18n().t('actionRunner.notify.timerDone'), body: o.body, at: o.at });
    return r.ok ? r.id : null;
  },
  cancel: cancelLocalNotification,
};
