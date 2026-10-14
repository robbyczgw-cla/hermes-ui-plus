import { withDeadline } from '../net/deadline.ts';
import { CONFIRM_PROBE_MS, type HealthEvent } from './healthMachine.ts';

type HealthFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

/**
 * One probe, including fallback URLs; DNS, TLS and a throttled link share this budget (`timeoutMs`, default the
 * long confirmation budget). `signal` aborted (cleanup, profile change, offline event) → the request is aborted and
 * the probe reports nothing (`null`).
 */
export async function probeHealth(
  fetchImpl: HealthFetch,
  urls: readonly string[],
  apiKey: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<HealthEvent | null> {
  const { timeoutMs = CONFIRM_PROBE_MS, signal: parent } = opts;
  if (parent?.aborted) return null;
  let denied = false;
  try {
    return await withDeadline(
      timeoutMs,
      async (signal) => {
        const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
        for (const url of new Set(urls)) {
          try {
            const res = await fetchImpl(url, { headers, signal });
            if (res.ok) return { type: 'ok' };
            if (res.status === 401 || res.status === 403) denied = true;
          } catch (e) {
            if (signal.aborted) throw e;
          }
        }
        return { type: denied ? 'denied' : 'fail' };
      },
      parent,
    );
  } catch {
    if (parent?.aborted) return null;
    return { type: denied ? 'denied' : 'fail' };
  }
}
