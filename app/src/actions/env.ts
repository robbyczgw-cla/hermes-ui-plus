/** Production `ExecEnv` for React Native (expo-linking, expo-clipboard, notifications, calendar, stores). */
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { addCalendarEvent } from './calendar';
import type { ExecEnv } from './executor.ts';
import { listBus } from './listBus.ts';
import { appendToLatestChecklist } from './appendToLatestChecklist';
import { scheduleLocalNotification } from './notifications';
import { getTimerStore } from './timers';
import { validateUrl } from './validate.ts';

export function createNativeEnv(over: Partial<ExecEnv> = {}): ExecEnv {
  return {
    os: Platform.OS,
    now: () => new Date(),
    async openUrl(url) {
      if (!validateUrl(url)) throw new Error('blocked scheme');
      await Linking.openURL(url);
    },
    async copy(text) {
      await Clipboard.setStringAsync(text);
    },
    addCalendarEvent,
    scheduleNotification: scheduleLocalNotification,
    startTimer: (o) => getTimerStore().start(o),
    appendToList: appendToLatestChecklist,
    listBus,
    ...over,
  };
}
