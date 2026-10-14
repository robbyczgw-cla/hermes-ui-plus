// Connection error classification → explanation (text comes from the i18n dictionary). Pure; tested in errors.test.ts.
// Reality check: React Native's fetch rejects with a bare `TypeError: Network request failed` for DNS,
// TLS, refused and offline alike, and browsers say `Failed to fetch` for CORS and network errors. So the
// classifier uses the message when it is specific (Node/undici, iOS texts, Android exception names) and
// otherwise falls back to `network` with a *suspect* derived from the URL (https+IP → TLS, VPN host …).
import type { TFn, TKey } from '../i18n/core.ts';
import type { NormalizedUrl } from './url.ts';

export type Platform = 'ios' | 'android' | 'web' | 'node' | (string & {});

export type ConnErrorKind =
  | 'timeout' | 'dns' | 'refused' | 'tls' | 'cleartext' | 'mixedContent' | 'cors' | 'network'
  | 'unauthorized' | 'keyMissing' | 'forbidden' | 'notFound' | 'rateLimited' | 'server' | 'notHermes' | 'unknown';

/** Number of hint keys (`onboarding.errors.<kind>.hint1..N`) per error kind. */
export const HINT_COUNT: Record<ConnErrorKind, number> = {
  timeout: 3, dns: 3, refused: 3, tls: 3, cleartext: 2, mixedContent: 2, cors: 3, network: 3,
  unauthorized: 3, keyMissing: 1, forbidden: 2, notFound: 3, rateLimited: 0, server: 2, notHermes: 2, unknown: 1,
};

/** Extra hint shown first for the generic `network` error. */
export type Suspect = 'tls' | 'vpn' | 'emulator';

export type ConnError = {
  kind: ConnErrorKind;
  status?: number;
  host?: string;
  /** request path for 404 explanations */
  path?: string;
  suspect?: Suspect;
  /** technical detail (never contains the key) – shown small under the explanation */
  detail?: string;
};

export type ErrorContext = {
  platform: Platform;
  url: Pick<NormalizedUrl, 'scheme' | 'host' | 'hostKind'>;
  /** web only: `window.location.protocol` ('https:' | 'http:') */
  pageProtocol?: string;
};

function errorText(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur; i++) {
    if (cur instanceof Error || (typeof cur === 'object' && cur !== null)) {
      const o = cur as { name?: unknown; message?: unknown; code?: unknown; cause?: unknown };
      for (const v of [o.name, o.code, o.message]) if (typeof v === 'string' && v) parts.push(v);
      cur = o.cause;
    } else {
      parts.push(String(cur));
      break;
    }
  }
  return parts.join(' | ');
}

/** Tailscale address: MagicDNS name (`*.ts.net`) or the CGNAT range 100.64.0.0/10 Tailscale assigns. */
export function isTailnetHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return h.endsWith('.ts.net') || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h);
}

/** Classify a thrown fetch error (no HTTP response). */
export function classifyFetchError(e: unknown, ctx: ErrorContext): ConnError {
  const text = errorText(e);
  const host = ctx.url.host;
  const detail = text.slice(0, 200) || undefined;
  if (/AbortError|TimeoutError|timed? ?out|ETIMEDOUT|SocketTimeout|UND_ERR_CONNECT_TIMEOUT/i.test(text)) return { kind: 'timeout', host, detail };
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|UnknownHost|Unable to resolve host|hostname could not be found|NXDOMAIN|ERR_NAME_NOT_RESOLVED/i.test(text)) return { kind: 'dns', host, detail };
  if (/CLEARTEXT|cleartext|App Transport Security/i.test(text)) return { kind: 'cleartext', host, detail };
  if (/CERT|certificate|SSL|TLS|handshake|self[- ]signed|trust anchor|ERR_SSL|EPROTO/i.test(text)) return { kind: 'tls', host, detail };
  if (/ECONNREFUSED|Connection refused|ConnectException|Failed to connect|Could not connect/i.test(text)) return { kind: 'refused', host, detail };

  if (ctx.platform === 'web') {
    const page = (ctx.pageProtocol ?? '').toLowerCase();
    if (page === 'https:' && ctx.url.scheme === 'http' && ctx.url.hostKind !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
      return { kind: 'mixedContent', host, detail };
    }
    // Browsers hide the reason; a CORS rejection (Hermes default: 403 without CORS headers) is the
    // most common cause when the user can reach the server otherwise.
    return { kind: 'cors', host, detail };
  }

  let suspect: Suspect | undefined;
  if (ctx.url.scheme === 'https' && (ctx.url.hostKind === 'ipv4' || ctx.url.hostKind === 'ipv6')) suspect = 'tls';
  else if (isTailnetHost(host)) suspect = 'vpn';
  else if (ctx.platform === 'android' && (ctx.url.hostKind === 'localhost' || host === '127.0.0.1')) suspect = 'emulator';
  return { kind: 'network', host, suspect, detail };
}

/** Classify a non-2xx HTTP status. */
export function classifyStatus(status: number, ctx: { host?: string; path?: string; hasKey: boolean }): ConnError {
  const base = { status, host: ctx.host, path: ctx.path };
  if (status === 401) return { ...base, kind: ctx.hasKey ? 'unauthorized' : 'keyMissing' };
  if (status === 403) return { ...base, kind: 'forbidden' };
  if (status === 404 || status === 405) return { ...base, kind: 'notFound' };
  if (status === 429) return { ...base, kind: 'rateLimited' };
  if (status >= 500) return { ...base, kind: 'server' };
  return { ...base, kind: 'unknown', detail: `HTTP ${status}` };
}

export type ErrorText = { title: string; message: string; hints: string[]; detail?: string };

/** Human readable title/message/hints for a classified error, translated with `t`. */
export function describeConnError(err: ConnError, t: TFn): ErrorText {
  const kind: ConnErrorKind = err.kind in HINT_COUNT ? err.kind : 'unknown';
  const k = (leaf: string) => `onboarding.errors.${kind}.${leaf}` as TKey;
  const vars = { host: err.host ?? '', path: err.path ?? '', status: err.status ?? '', detail: err.detail ?? '' };
  const hints = Array.from({ length: HINT_COUNT[kind] }, (_, i) => t(k(`hint${i + 1}`), vars));
  if (err.kind === 'network' && err.suspect) hints.unshift(t(`onboarding.suspects.${err.suspect}` as TKey));
  return {
    title: t(k('title'), vars),
    message: t(k('message'), vars) || t('onboarding.errors.network.message', vars),
    hints,
    detail: err.kind === 'unknown' ? undefined : err.detail,
  };
}
