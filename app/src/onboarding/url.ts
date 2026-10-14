// Server URL normalization for the onboarding form and pair links. Pure (no RN, no `URL` global:
// React Native's URL polyfill lacks `hostname` & co.), unit-tested in url.test.ts.

export type UrlErrorCode = 'empty' | 'too-long' | 'whitespace' | 'scheme' | 'credentials' | 'host' | 'port' | 'path';

/** How exposed the API key is on this URL. `private`: http to a LAN/VPN/loopback address. */
export type Cleartext = 'none' | 'private' | 'public';

export type NormalizedUrl = {
  ok: true;
  /** OpenAI-compatible base URL incl. `/v1` (no trailing slash) – what `ConnectionProfile.baseUrl` stores */
  baseUrl: string;
  /** Server root (base URL without `/v1`) – `/health` lives here */
  root: string;
  scheme: 'http' | 'https';
  /** Lower-cased host without port; IPv6 without brackets */
  host: string;
  port?: number;
  /** `https://` was added because the input had no scheme */
  addedScheme: boolean;
  /** `/v1` was appended */
  addedV1: boolean;
  cleartext: Cleartext;
  hostKind: 'name' | 'ipv4' | 'ipv6' | 'localhost';
};

export type UrlResult = NormalizedUrl | { ok: false; error: UrlErrorCode };

export const MAX_URL_LENGTH = 2048;

// Endpoint paths people paste by accident (copied from docs / curl examples); stripped before `/v1` is added.
const ENDPOINT_SUFFIX = /\/(chat\/completions|completions|models|responses|health(\/detailed)?)$/i;

/**
 * Normalize user input to a Hermes base URL:
 * - adds `https://` when no scheme is given, rejects other schemes (`javascript:`, `file:`, `ftp:` …)
 * - rejects `user:pass@` credentials, whitespace, invalid hosts/ports
 * - drops query/fragment, trailing slashes and pasted endpoint paths (`/v1/models`, `/health` …)
 * - keeps a reverse-proxy prefix (`https://host/hermes` → `https://host/hermes/v1`), appends `/v1` once
 */
export function normalizeServerUrl(input: string): UrlResult {
  const raw = (input ?? '').trim();
  if (!raw) return { ok: false, error: 'empty' };
  if (raw.length > MAX_URL_LENGTH) return { ok: false, error: 'too-long' };
  // Any whitespace or control character inside is either a typo or an injection attempt.
   
  if (/[\s\u0000-\u001f\u007f]/.test(raw)) return { ok: false, error: 'whitespace' };

  let rest = raw;
  let scheme: 'http' | 'https' = 'https';
  let addedScheme = false;
  const m = /^([a-z][a-z0-9+.-]*):(\/\/)?/i.exec(rest);
  // `host:8645` also matches the scheme pattern – only treat it as scheme when followed by `//`
  // or when it is clearly not a host:port pair.
  if (m && (m[2] || !/^\d/.test(rest.slice(m[0].length)))) {
    const s = m[1].toLowerCase();
    if ((s !== 'http' && s !== 'https') || !m[2]) return { ok: false, error: 'scheme' };
    scheme = s;
    rest = rest.slice(m[0].length);
  } else {
    if (rest.startsWith('//')) rest = rest.slice(2);
    addedScheme = true;
  }

  const cut = rest.search(/[/?#]/);
  const authority = cut === -1 ? rest : rest.slice(0, cut);
  let path = cut === -1 ? '' : rest.slice(cut);
  if (authority.includes('@')) return { ok: false, error: 'credentials' };
  if (authority.includes('\\')) return { ok: false, error: 'host' };

  let hostPart = authority;
  let portStr: string | undefined;
  if (hostPart.startsWith('[')) {
    const end = hostPart.indexOf(']');
    if (end === -1) return { ok: false, error: 'host' };
    const after = hostPart.slice(end + 1);
    if (after && !/^:\d*$/.test(after)) return { ok: false, error: 'host' };
    portStr = after ? after.slice(1) : undefined;
    hostPart = hostPart.slice(0, end + 1);
  } else {
    const idx = hostPart.lastIndexOf(':');
    if (idx !== -1) {
      portStr = hostPart.slice(idx + 1);
      hostPart = hostPart.slice(0, idx);
    }
  }

  let port: number | undefined;
  if (portStr !== undefined) {
    if (!/^\d{1,5}$/.test(portStr)) return { ok: false, error: 'port' };
    port = Number(portStr);
    if (port < 1 || port > 65535) return { ok: false, error: 'port' };
  }

  const host = classifyHost(hostPart.toLowerCase());
  if (!host) return { ok: false, error: 'host' };

  // path: drop query/fragment, collapse slashes, strip pasted endpoints, ensure single /v1
  path = path.replace(/[?#].*$/, '').replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  if (!/^[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/.test(path)) return { ok: false, error: 'path' };
  if (/(^|\/)\.\.?(\/|$)/.test(path) || /%2f|%5c|%00|%2e/i.test(path)) return { ok: false, error: 'path' };
  path = path.replace(ENDPOINT_SUFFIX, '');
  let addedV1 = false;
  if (!/\/v1$/i.test(path)) {
    path = `${path}/v1`;
    addedV1 = true;
  } else {
    path = path.replace(/\/v1$/i, '/v1');
  }

  const defaultPort = scheme === 'https' ? 443 : 80;
  const hostOut = host.kind === 'ipv6' ? `[${host.host}]` : host.host;
  const portOut = port !== undefined && port !== defaultPort ? `:${port}` : '';
  const root = `${scheme}://${hostOut}${portOut}${path.replace(/\/v1$/, '')}`;
  return {
    ok: true,
    baseUrl: `${root}/v1`,
    root,
    scheme,
    host: host.host,
    port: portOut ? port : undefined,
    addedScheme,
    addedV1,
    cleartext: scheme === 'https' ? 'none' : isPrivateHost(host.host, host.kind) ? 'private' : 'public',
    hostKind: host.kind,
  };
}

function classifyHost(h: string): { host: string; kind: NormalizedUrl['hostKind'] } | null {
  if (!h) return null;
  if (h.startsWith('[')) {
    const inner = h.slice(1, -1);
    if (!/^[0-9a-f:.]+$/.test(inner) || !inner.includes(':') || inner.length > 45) return null;
    return { host: inner, kind: 'ipv6' };
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    if (h.split('.').some((o) => Number(o) > 255 || (o.length > 1 && o.startsWith('0')))) return null;
    return { host: h, kind: 'ipv4' };
  }
  // Trailing dot (FQDN) is legal DNS but confuses TLS name checks – drop it.
  const name = h.replace(/\.$/, '');
  if (name.length > 253) return null;
  const labels = name.split('.');
  if (labels.some((l) => !/^[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$/.test(l))) return null;
  // all-numeric dotted names that aren't valid IPv4 (e.g. 1.2.3 or 999.1.1.1)
  if (labels.every((l) => /^\d+$/.test(l))) return null;
  if (name === 'localhost' || name.endsWith('.localhost')) return { host: name, kind: 'localhost' };
  return { host: name, kind: 'name' };
}

/** Loopback, RFC1918, CGNAT/Tailscale (100.64/10, *.ts.net – WireGuard-encrypted), link-local, mDNS `.local`, single-label LAN names. */
export function isPrivateHost(host: string, kind?: NormalizedUrl['hostKind']): boolean {
  const k = kind ?? (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) ? 'ipv4' : host.includes(':') ? 'ipv6' : 'name');
  if (k === 'localhost') return true;
  if (k === 'ipv4') {
    const [a, b] = host.split('.').map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254);
  }
  if (k === 'ipv6') {
    const h = host.toLowerCase();
    return h === '::1' || /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h);
  }
  return host === 'localhost' || host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.home.arpa') || host.endsWith('.internal') || host.endsWith('.ts.net') || !host.includes('.');
}

/** `https://hermes.example.org/v1` → `hermes.example.org` (for default profile names / display). */
export function displayHost(n: Pick<NormalizedUrl, 'host' | 'port' | 'hostKind'>): string {
  const h = n.hostKind === 'ipv6' ? `[${n.host}]` : n.host;
  return n.port ? `${h}:${n.port}` : h;
}
