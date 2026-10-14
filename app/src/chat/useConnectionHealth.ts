import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { probeHealth } from './healthProbe';
import { normalizeBaseUrl, serverRoot } from '../settings/profiles';
import { INITIAL_HEALTH, eventForStatus, originOf, pollDelayMs, probeBudgetMs, reduceHealth, subscribeReachable, type Health } from './healthMachine';

export type { Health } from './healthMachine';

/**
 * Lightweight reachability check (one GET /health) on mount, profile change, app foreground, the browser
 * `online` event and on demand (`recheck`, e.g. after a failed request). While unhealthy it polls with backoff
 * (healthMachine.pollDelayMs), including confirmation after one failed probe; healthy → no polling, and never while
 * the app is in the background. The first probe has a short budget, confirmation probes the long one
 * (probeBudgetMs). The browser `offline` event is conclusive (offline right away). A new probe, the offline event,
 * a profile change and unmount abort the probe in flight. Any successful request to the same server
 * (reportReachable) marks it online immediately; a 401/403 marks it `denied` (reachable, but the key / token was
 * rejected).
 */
export function useConnectionHealth(baseUrl: string, apiKey: string): { health: Health; denied: boolean; recheck: () => void } {
  const [state, dispatch] = useReducer(reduceHealth, INITIAL_HEALTH);
  const stateRef = useRef(state);
  stateRef.current = state;
  const inFlight = useRef<AbortController | null>(null);
  const [foreground, setForeground] = useState(() => AppState.currentState !== 'background' && AppState.currentState !== 'inactive');

  /** abort the probe in flight (its result is dropped) */
  const abortProbe = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
  }, []);

  const check = useCallback(async () => {
    abortProbe();
    const ctrl = new AbortController();
    inFlight.current = ctrl;
    const base = normalizeBaseUrl(baseUrl);
    const event = await probeHealth(fetch, [`${serverRoot(base)}/health`, `${base}/health`], apiKey, { timeoutMs: probeBudgetMs(stateRef.current), signal: ctrl.signal });
    if (inFlight.current === ctrl) inFlight.current = null;
    if (event && !ctrl.signal.aborted) dispatch(event);
  }, [baseUrl, apiKey, abortProbe]);

  // mount / profile change, foreground, browser online/offline
  useEffect(() => {
    if (!baseUrl) return;
    dispatch({ type: 'reset' });
    stateRef.current = INITIAL_HEALTH; // the first probe of a profile gets the short budget
    void check();
    const sub = AppState.addEventListener('change', (s) => {
      setForeground(s === 'active');
      if (s === 'active') void check();
    });
    const win = Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.addEventListener === 'function' ? window : null;
    const onOnline = () => void check();
    const onOffline = () => {
      abortProbe(); // drop an in-flight check
      dispatch({ type: 'offline' });
    };
    win?.addEventListener('online', onOnline);
    win?.addEventListener('offline', onOffline);
    return () => {
      sub.remove();
      win?.removeEventListener('online', onOnline);
      win?.removeEventListener('offline', onOffline);
      abortProbe();
    };
  }, [baseUrl, check, abortProbe]);

  // any successful request to this server → online
  const origin = originOf(normalizeBaseUrl(baseUrl));
  useEffect(() => {
    if (!origin) return;
    return subscribeReachable((o, status) => {
      if (o !== origin) return;
      const ev = eventForStatus(status);
      if (!ev) return;
      abortProbe(); // a real response beats a probe still in flight
      dispatch(ev);
    });
  }, [origin, abortProbe]);

  // backoff polling while unhealthy (foreground only; returning to the foreground re-checks)
  const delay = baseUrl ? pollDelayMs(state, foreground) : null;
  useEffect(() => {
    if (delay == null) return;
    const t = setTimeout(() => void check(), delay);
    return () => clearTimeout(t);
  }, [delay, state.failures, check]);

  return { health: state.health, denied: state.denied, recheck: check };
}
