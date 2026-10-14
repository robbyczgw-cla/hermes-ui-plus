// Connection status state machine for the chat header (pure; tested in healthMachine.test.ts).
// "nicht erreichbar" must clear as soon as connectivity returns: useConnectionHealth re-checks on the browser
// `online` event, on app foreground, polls with backoff while unhealthy, and any successful request against the
// same server (reported via `reportReachable`) flips the status to online right away.

export type Health = 'checking' | 'online' | 'offline';
/** `denied`: the server answers but rejected the key / token (401/403) – the start screen must not say "ist bereit" */
export type HealthState = { health: Health; failures: number; denied: boolean };
/**
 * ok: reachable (`authorized`: a 2xx of an authenticated request – clears `denied`; /health is unauthenticated)
 * denied: a request was rejected with 401/403 · fail: a probe failed (inconclusive alone) · offline: the browser / OS
 * reports no network (conclusive) · reset: profile changed
 */
export type HealthEvent = { type: 'ok'; authorized?: boolean } | { type: 'denied' } | { type: 'fail' } | { type: 'offline' } | { type: 'reset' };

export const INITIAL_HEALTH: HealthState = { health: 'checking', failures: 0, denied: false };

export function reduceHealth(s: HealthState, e: HealthEvent): HealthState {
  switch (e.type) {
    case 'ok': {
      const denied = e.authorized ? false : s.denied;
      return s.health === 'online' && s.failures === 0 && s.denied === denied ? s : { health: 'online', failures: 0, denied };
    }
    case 'denied':
      return s.health === 'online' && s.failures === 0 && s.denied ? s : { health: 'online', failures: 0, denied: true };
    case 'fail':
      // A single slow/failed probe is inconclusive. Keep checking before showing red.
      return { health: s.failures + 1 >= 2 ? 'offline' : s.health, failures: s.failures + 1, denied: s.denied };
    case 'offline':
      // the device itself has no network: no confirmation probe needed; polling (backoff) notices the way back
      return { health: 'offline', failures: Math.max(2, s.failures + 1), denied: s.denied };
    case 'reset':
      return INITIAL_HEALTH;
  }
}

/** Budget of the first probe: a working link answers well within it, so a dead one turns "checking" quickly. */
export const FIRST_PROBE_MS = 8000;
/** Budget of the confirmation probes after a failure: a slow / throttled link still gets its chance. */
export const CONFIRM_PROBE_MS = 20000;

/** budget for the next probe in state `s` */
export function probeBudgetMs(s: HealthState): number {
  return s.failures === 0 ? FIRST_PROBE_MS : CONFIRM_PROBE_MS;
}

export const POLL_MIN_MS = 3000;
export const POLL_MAX_MS = 60000;

/** what a response status of a request to the server means for the status */
export function eventForStatus(status: number): HealthEvent | null {
  if (status === 401 || status === 403) return { type: 'denied' };
  if (status >= 200 && status < 300) return { type: 'ok', authorized: true };
  if (status > 0 && status < 500) return { type: 'ok' };
  return null;
}

/**
 * Retry after any failure, including the first inconclusive one (3 s … capped at 60 s). Never while the app is in the
 * background (`foreground` false): coming back to the foreground re-checks anyway.
 */
export function pollDelayMs(s: HealthState, foreground = true): number | null {
  if (s.failures === 0 || !foreground) return null;
  const n = Math.max(0, s.failures - 1);
  return Math.min(POLL_MAX_MS, POLL_MIN_MS * 2 ** Math.min(n, 10));
}

/** `scheme://host[:port]` of a URL (lower-case), or null. */
export function originOf(url: string | null | undefined): string | null {
  const m = /^(https?:\/\/[^/?#\s]+)/i.exec((url ?? '').trim());
  return m ? m[1].toLowerCase() : null;
}

// ── "a request just succeeded" bus ──────────────────────────────────────────────────────────────
type Listener = (origin: string, status: number) => void;
const listeners = new Set<Listener>();

/** Any HTTP response from a server (status < 500) proves it is reachable; 401/403 also mean "key rejected". */
export function reportReachable(url: string, status: number): void {
  if (status >= 500 || status <= 0) return;
  const o = originOf(url);
  if (!o) return;
  for (const l of listeners) l(o, status);
}

export function subscribeReachable(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
