// One-time pair codes (pairLink.ts `c=`): trade the code for a device token.
//   POST <root>/bridge/pair/redeem   {"code":"…"}  →  200 {"token","deviceId","name"}   (works once, 1 h TTL)
// `<root>` is the bridge base without `/v1` (keeps a reverse-proxy prefix: `https://host/hermes/v1` → `https://host/hermes`).
// Pure (fetch injected) → tested in pairRedeem.test.ts. Never logs, returns or keeps the code; the token only
// leaves through the returned PairData (which the flow saves like a token from a legacy `t=` link).
import { isHeaderSafeToken, type PairData } from './pairLink.ts';
import type { NormalizedUrl } from './url.ts';

export const PAIR_REDEEM_PATH = '/bridge/pair/redeem';
const MAX_BODY = 16 * 1024;

export type RedeemErrorCode =
  /** 404 / 410: unknown, already used or expired → a new link is needed */
  | 'expired'
  /** 429: too many attempts */
  | 'rate-limited'
  /** no answer (offline, wrong network / tailnet, timeout) */
  | 'network'
  /** anything else (5xx, not a bridge, malformed answer) */
  | 'failed';

export type RedeemResult = { ok: true; pair: PairData } | { ok: false; error: RedeemErrorCode; status?: number };

export type RedeemFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type RedeemOptions = {
  fetchImpl?: RedeemFetch;
  /** abort (screen left) */
  signal?: AbortSignal;
  timeoutMs?: number;
};

/** `https://host/prefix/v1` → `https://host/prefix/bridge/pair/redeem` */
export function pairRedeemUrl(url: Pick<NormalizedUrl, 'root'>): string {
  return `${url.root.replace(/\/+$/, '')}${PAIR_REDEEM_PATH}`;
}

/** HTTP status of a failed redeem → error code */
export function redeemErrorFor(status: number): RedeemErrorCode {
  if (status === 404 || status === 410) return 'expired';
  if (status === 429) return 'rate-limited';
  return 'failed';
}

/** Validated `{token}` of a redeem answer, or null. `deviceId` / `name` are informational only. */
export function parseRedeemBody(text: string): { token: string } | null {
  if (!text || text.length > MAX_BODY) return null;
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const token = (v as { token?: unknown }).token;
  return typeof token === 'string' && isHeaderSafeToken(token) ? { token } : null;
}

/**
 * Redeem `pair.code`. A pair without a code is returned unchanged (legacy `t=` links). On success the result carries
 * the device token and an EMPTY code (the caller must not keep the original pair around).
 */
export async function redeemPairCode(pair: PairData, opts: RedeemOptions = {}): Promise<RedeemResult> {
  if (!pair.code) return { ok: true, pair };
  const doFetch: RedeemFetch = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await doFetch(pairRedeemUrl(pair.url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ code: pair.code }),
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, error: redeemErrorFor(res.status), status: res.status };
    const body = parseRedeemBody(await res.text().catch(() => ''));
    if (!body) return { ok: false, error: 'failed', status: res.status };
    return { ok: true, pair: { ...pair, token: body.token, code: '' } };
  } catch {
    return { ok: false, error: 'network' };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}
