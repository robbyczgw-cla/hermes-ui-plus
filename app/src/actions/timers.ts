import AsyncStorage from '@react-native-async-storage/async-storage';
import { timerNotifier } from './notifications';
import { TimerStore } from './timerStore.ts';

let instance: TimerStore | null = null;

/** Process-wide TimerStore (AsyncStorage + local notifications). */
export function getTimerStore(): TimerStore {
  if (!instance) {
    instance = new TimerStore({
      storage: { getItem: (k) => AsyncStorage.getItem(k), setItem: (k, v) => AsyncStorage.setItem(k, v) },
      notifier: timerNotifier,
    });
    void instance.load();
  }
  return instance;
}
