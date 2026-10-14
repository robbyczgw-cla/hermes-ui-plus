/**
 * Push server API (`/bridge/push/*`) + live inbox stream reader. Pure cores with an injected fetch
 * (tests: node --test); the app binds them to `expo/fetch` in device.ts / PushHost.tsx.
 */
import { withDeadline } from '../net/deadline.ts';
import type { FetchLike } from '../hermes/stream.ts';
import { createSseParser } from '../hermes/sse.ts';
import { parseApprovalNotice, parseApprovalResolved, type ApprovalNotice, type ApprovalResolved } from './approvalInbox.ts';
import { pushBaseUrl, parseInboxEvent, type InboxEvent, type PushPlatform, type PushProfile } from './model.ts';

export type PushServerConfig = {
  platforms: { webpush: { vapidPublicKey: string } | null; fcm: boolean; apns: boolean };
  inbox: boolean;
};

export class PushApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'PushApiError';
    this.status = status;
    this.code = code;
  }
}

async function call(fetchImpl: FetchLike, p: PushProfile, method: 'GET' | 'POST', sub: string, body?: unknown, timeoutMs = 15000): Promise<unknown> {
  try {
    return await withDeadline(timeoutMs, async (signal) => {
      const res = await fetchImpl(`${pushBaseUrl(p)}/${sub}`, {
        method,
        headers: { Authorization: `Bearer ${p.apiKey}`, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* non-JSON (e.g. a 404 page) */
      }
      if (!res.ok) {
        const err = (json as { error?: { message?: string; code?: string } } | null)?.error;
        throw new PushApiError(err?.message ?? `HTTP ${res.status}`, res.status, err?.code ?? undefined);
      }
      return json;
    });
  } catch (e) {
    if (e instanceof PushApiError) throw e;
    throw new PushApiError(e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : String((e as Error)?.message ?? e), 0);
  }
}

/** GET /bridge/push/config. null = this server has no push support (404 / other server). */
export async function fetchPushConfig(fetchImpl: FetchLike, p: PushProfile): Promise<PushServerConfig | null> {
  try {
    const j = (await call(fetchImpl, p, 'GET', 'config', undefined, 8000)) as Partial<PushServerConfig> | null;
    if (!j || typeof j !== 'object' || !j.platforms) return null;
    return {
      platforms: {
        webpush: j.platforms.webpush && typeof j.platforms.webpush.vapidPublicKey === 'string' ? { vapidPublicKey: j.platforms.webpush.vapidPublicKey } : null,
        fcm: j.platforms.fcm === true,
        apns: j.platforms.apns === true,
      },
      inbox: j.inbox !== false,
    };
  } catch (e) {
    if (e instanceof PushApiError && (e.status === 404 || e.status === 405)) return null;
    throw e;
  }
}

export type DevicePart = { platform: 'fcm' | 'apns'; token: string } | { platform: 'webpush'; subscription: { endpoint: string; keys: { p256dh: string; auth: string } } };

export async function registerDevice(fetchImpl: FetchLike, p: PushProfile, device: DevicePart, settings: Record<string, unknown>): Promise<{ id: string; platform: PushPlatform }> {
  const j = (await call(fetchImpl, p, 'POST', 'register', { ...settings, ...device })) as { registration?: { id?: string; platform?: PushPlatform } } | null;
  if (!j?.registration?.id) throw new PushApiError('invalid register response', 502);
  return { id: j.registration.id, platform: j.registration.platform ?? device.platform };
}

export async function unregisterDevice(fetchImpl: FetchLike, p: PushProfile, o: { id?: string; platform?: PushPlatform; deviceKey?: string }): Promise<number> {
  const body = o.id ? { id: o.id } : o.platform === 'webpush' ? { platform: 'webpush', endpoint: o.deviceKey, profileId: p.id } : { platform: o.platform, token: o.deviceKey, profileId: p.id };
  const j = (await call(fetchImpl, p, 'POST', 'unregister', body)) as { removed?: number } | null;
  return j?.removed ?? 0;
}

export async function sendTestPush(fetchImpl: FetchLike, p: PushProfile, id?: string): Promise<{ ok: boolean; error?: string }[]> {
  const j = (await call(fetchImpl, p, 'POST', 'test', id ? { id } : {})) as { results?: { ok: boolean; error?: string }[] } | null;
  return j?.results ?? [];
}

/**
 * Read one inbox SSE connection until it ends / the signal aborts. Resolves 'ended' | 'aborted';
 * throws PushApiError for HTTP errors (401/403/404 → caller stops reconnecting).
 */
export async function readInbox(
  fetchImpl: FetchLike,
  url: string,
  apiKey: string,
  o: { signal: AbortSignal; onEvent(ev: InboxEvent): void; onReady?(): void; onApproval?(a: ApprovalNotice): void; onApprovalResolved?(r: ApprovalResolved): void },
): Promise<'ended' | 'aborted'> {
  const ctrl = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const res = await withDeadline(20_000, () => fetchImpl(url, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}`, Accept: 'text/event-stream' }, signal: ctrl.signal }), o.signal);
    if (!res.ok || !res.body) throw new PushApiError(`HTTP ${res.status}`, res.status);
    const parser = createSseParser();
    const decoder = new TextDecoder();
    reader = res.body.getReader();
    const handle = (frames: { event: string; data: string }[]) => {
      for (const f of frames) {
        if (f.event === 'hui.ready') o.onReady?.();
        else if (f.event === 'hui.message') {
          const ev = parseInboxEvent(f.data);
          if (ev) o.onEvent(ev);
        } else if (f.event === 'hui.approval') {
          const a = parseApprovalNotice(f.data);
          if (a) o.onApproval?.(a);
        } else if (f.event === 'hui.approval_resolved') {
          const r = parseApprovalResolved(f.data);
          if (r) o.onApprovalResolved?.(r);
        }
      }
    };
    for (;;) {
      // The bridge sends comment keepalives every 15 s. Allow three missed beats,
      // then reconnect even if a half-open native socket never rejects read().
      const activeReader = reader;
      const { value, done } = await withDeadline(45_000, () => activeReader.read(), o.signal);
      if (done) break;
      handle(parser.push(decoder.decode(value, { stream: true })));
    }
    handle(parser.flush());
    return 'ended';
  } catch (e) {
    if (o.signal.aborted) return 'aborted';
    if (e instanceof PushApiError) throw e;
    throw new PushApiError(String((e as Error)?.message ?? e), 0);
  } finally {
    ctrl.abort();
    // Cancellation itself may hang: never await it before allowing a reconnect.
    try {
      void reader?.cancel().catch(() => {});
      reader?.releaseLock();
    } catch {
      /* already released */
    }
  }
}
