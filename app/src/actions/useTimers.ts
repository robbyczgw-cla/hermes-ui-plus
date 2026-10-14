import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import type { TimerRecord } from './timerModel.ts';
import { getTimerStore } from './timers';

/**
 * Live timer list. Re-renders once a second while a timer runs (`now` is shared), settles finished
 * timers and calls `onDone` for each timer that just finished while the app is open.
 */
export function useTimers(onDone?: (t: TimerRecord) => void): { timers: readonly TimerRecord[]; now: number } {
  const store = getTimerStore();
  const timers = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [now, setNow] = useState(() => Date.now());
  const cb = useRef(onDone);
  useEffect(() => {
    cb.current = onDone;
  });
  const running = timers.some((t) => t.status === 'running');

  useEffect(() => {
    void store.load();
  }, [store]);

  useEffect(() => {
    const tick = () => {
      const n = Date.now();
      setNow(n);
      for (const t of store.tick(n)) cb.current?.(t);
    };
    tick();
    if (!running) return;
    const id = setInterval(tick, 1000);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') tick();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [store, running]);

  return { timers, now };
}
