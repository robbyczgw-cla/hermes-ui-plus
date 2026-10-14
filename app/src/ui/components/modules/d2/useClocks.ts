/**
 * React side of the shared timer engine: ticking, settling, haptics/cue on finish and keeping one
 * scheduled "done" alarm per running countdown in sync (start/resume/±1 min → (re)schedule,
 * pause/reset/remove → cancel). The clocks themselves live in the caller's node state.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { haptic } from '../../../primitives/haptics';
import { cancelAlarm, playDoneCue, scheduleAlarm } from './alarm';
import { createArmGuard } from './alarmGuard.ts';
import { adjust as adjustClock, parseClock, pause as pauseClock, reset as resetClock, settleMap, start as startClock, type Clock } from './timerEngine.ts';

export type ClockMap = Record<string, Clock>;
export type ClockMapSetter = (fn: (prev: ClockMap) => ClockMap) => void;

/** Finishes older than this (app was closed) are shown as done but not "rung" again. */
const CUE_WINDOW_MS = 5000;

/** Drop corrupt persisted clocks. */
export function sanitizeClocks(raw: unknown): ClockMap {
  if (!raw || typeof raw !== 'object') return {};
  const out: ClockMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const c = parseClock(v);
    if (c) out[k] = c;
  }
  return out;
}

/** Delay until the next displayed second changes for any running clock (≥ 50 ms, ≤ 1 s). */
function nextTickDelay(clocks: ClockMap, now: number): number {
  let best = 1000;
  for (const c of Object.values(clocks)) {
    if (c.status !== 'running') continue;
    const phase = c.mode === 'countdown' ? ((c.endsAt ?? now) - now) % 1000 : 1000 - ((now - (c.startedAt ?? now)) % 1000);
    const d = phase <= 0 ? 1000 + phase : phase;
    if (d < best) best = d;
  }
  return Math.max(50, Math.min(1000, best + 8));
}

export type ClockControls = {
  now: number;
  start(key: string, base: Clock): void;
  pause(key: string): void;
  reset(key: string): void;
  adjust(key: string, deltaMs: number): void;
  remove(key: string): void;
};

export function useClocks(o: {
  clocks: ClockMap;
  setClocks: ClockMapSetter;
  /** node state loaded (don't re-arm / settle before) */
  ready: boolean;
  sound: boolean;
  alarm: (key: string) => { title: string; body?: string };
  onDone?: (key: string) => void;
}): ClockControls {
  const { clocks, setClocks, ready, sound } = o;
  const [now, setNow] = useState(() => Date.now());
  const latest = useRef(clocks);
  latest.current = clocks;
  const cb = useRef({ alarm: o.alarm, onDone: o.onDone, sound });
  cb.current = { alarm: o.alarm, onDone: o.onDone, sound };
  const anyRunning = useMemo(() => Object.values(clocks).some((c) => c.status === 'running'), [clocks]);

  const guard = useRef(createArmGuard()).current;

  /**
   * Schedule the alarm for `key` if it is a running countdown; attach the id only if this is still the
   * newest scheduling for the clock (a superseded result is cancelled, never orphaned).
   */
  const arm = useCallback(
    async (key: string) => {
      const c = latest.current[key];
      if (!c || c.mode !== 'countdown' || c.status !== 'running' || c.endsAt === null) {
        guard.bump(key);
        return;
      }
      const endsAt = c.endsAt;
      const { title, body } = cb.current.alarm(key);
      const sound = cb.current.sound;
      await guard.arm(
        key,
        () => scheduleAlarm({ title, body, at: endsAt, sound }),
        () => {
          const cur = latest.current[key];
          return !!cur && cur.status === 'running' && cur.endsAt === endsAt;
        },
        (id) => {
          // the committed id replaces any older one (which was cancelled when it was superseded)
          latest.current = { ...latest.current, [key]: { ...latest.current[key], notifId: id } };
          setClocks((p) => (p[key] && p[key].endsAt === endsAt ? { ...p, [key]: { ...p[key], notifId: id } } : p));
        },
        (id) => void cancelAlarm(id),
      );
    },
    [setClocks, guard],
  );

  const settleNow = useCallback(() => {
    const n = Date.now();
    setNow(n);
    const before = latest.current;
    const { done, clocks: settled } = settleMap(before, n);
    if (!done.length) return;
    latest.current = settled as ClockMap;
    setClocks((p) => settleMap(p, n).clocks as ClockMap);
    for (const k of done) {
      const c = before[k];
      if (c?.endsAt && n - c.endsAt < CUE_WINDOW_MS) {
        haptic('success');
        playDoneCue(cb.current.sound);
        cb.current.onDone?.(k);
      }
    }
  }, [setClocks]);

  // tick while something runs (aligned to the displayed second), and on app resume
  useEffect(() => {
    if (!ready) return;
    settleNow();
    if (!anyRunning) return;
    let handle: ReturnType<typeof setTimeout>;
    const loop = () => {
      settleNow();
      handle = setTimeout(loop, nextTickDelay(latest.current, Date.now()));
    };
    handle = setTimeout(loop, nextTickDelay(latest.current, Date.now()));
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') settleNow();
    });
    return () => {
      clearTimeout(handle);
      sub.remove();
    };
  }, [ready, anyRunning, settleNow]);

  // once loaded: (re)arm running countdowns without a live alarm (web alarms die with the page)
  const armedOnce = useRef(false);
  useEffect(() => {
    if (!ready || armedOnce.current) return;
    armedOnce.current = true;
    for (const [k, c] of Object.entries(latest.current)) {
      if (c.status === 'running' && c.mode === 'countdown' && (!c.notifId || c.notifId.startsWith('web:'))) void arm(k);
    }
  }, [ready, arm]);

  // sound toggle → re-schedule running alarms with the new setting
  const prevSound = useRef(sound);
  useEffect(() => {
    if (prevSound.current === sound) return;
    prevSound.current = sound;
    for (const [k, c] of Object.entries(latest.current)) {
      if (c.status === 'running' && c.mode === 'countdown') {
        void cancelAlarm(c.notifId);
        void arm(k);
      }
    }
  }, [sound, arm]);

  const update = useCallback(
    (key: string, fn: (c: Clock | undefined, n: number) => Clock | undefined) => {
      const n = Date.now();
      const prev = latest.current[key];
      const next = fn(prev, n);
      if (next === prev) return;
      if (prev?.notifId && (!next || next.notifId !== prev.notifId)) void cancelAlarm(prev.notifId);
      guard.bump(key); // any change supersedes an in-flight scheduling for this clock
      const map = { ...latest.current };
      if (next) map[key] = next;
      else delete map[key];
      latest.current = map;
      setNow(n);
      setClocks((p) => {
        const q = { ...p };
        if (next) q[key] = next;
        else delete q[key];
        return q;
      });
      if (next && next.status === 'running' && next.mode === 'countdown' && !next.notifId) void arm(key);
    },
    [setClocks, arm, guard],
  );

  const start = useCallback((key: string, base: Clock) => update(key, (c, n) => startClock(c ?? base, n)), [update]);
  const pause = useCallback((key: string) => update(key, (c, n) => (c ? pauseClock(c, n) : c)), [update]);
  const reset = useCallback((key: string) => update(key, (c) => (c ? resetClock(c) : c)), [update]);
  const adjust = useCallback((key: string, d: number) => update(key, (c, n) => (c ? adjustClock(c, d, n) : c)), [update]);
  const remove = useCallback((key: string) => update(key, () => undefined), [update]);

  return { now, start, pause, reset, adjust, remove };
}
