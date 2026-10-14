/**
 * In-memory registry: does a server (root URL + key) offer the session API? Filled by the first
 * session request; `false` switches session sync + tool-detail fetches off for that server until the
 * app restarts (older Hermes, UI bridge, mock). Pure, erasable TS.
 */
import { apiRoot } from './sessions.ts';

const state = new Map<string, boolean>();
const listeners = new Set<() => void>();

export function serverKey(conn: { baseUrl: string; apiKey: string }): string {
  // the key is only used as a map key in memory; keep a short suffix so two keys on one server differ
  return `${apiRoot(conn.baseUrl)}#${conn.apiKey.slice(-6)}`;
}

/** undefined = not probed yet */
export function sessionsSupported(conn: { baseUrl: string; apiKey: string }): boolean | undefined {
  return state.get(serverKey(conn));
}

export function setSessionsSupported(conn: { baseUrl: string; apiKey: string }, supported: boolean): void {
  const k = serverKey(conn);
  if (state.get(k) === supported) return;
  state.set(k, supported);
  for (const f of Array.from(listeners)) f();
}

export function subscribeSupport(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** tests */
export function resetSupport(): void {
  state.clear();
}
