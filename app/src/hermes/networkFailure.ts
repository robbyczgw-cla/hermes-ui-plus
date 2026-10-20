/**
 * Network failures on the failure card: friendly localized text instead of raw exception text
 * ("java.net.UnknownHostException: Unable to resolve host "<server>" …"), the raw detail only behind a "Details"
 * toggle and without host names / IPs / URLs. Pure (networkFailure.test.ts).
 *
 * Works on what a message stores: Hermes keeps fetch failures as `backends.hermes.errors.networkDetail` with the raw
 * text in `params.detail`; older messages / other paths may hold the raw text in `error` only. Mapped at render
 * time, so messages persisted before this change are shown the same way.
 */
import type { TFn, TKey } from '../i18n/core.ts';
import { messageErrorText } from './chatState.ts';
import type { ChatMessage } from './types.ts';

export type NetworkFailureKind = 'dns' | 'timeout' | 'refused' | 'reset' | 'tls' | 'offline' | 'unreachable';

const RULES: readonly [NetworkFailureKind, RegExp][] = [
  ['dns', /UnknownHost|Unable to resolve host|No address associated with hostname|ENOTFOUND|EAI_AGAIN|getaddrinfo|NXDOMAIN|ERR_NAME_NOT_RESOLVED|hostname could not be found/i],
  ['tls', /javax\.net\.ssl|SSLHandshake|SSLPeerUnverified|SSLException|CertPathValidator|Trust anchor|certificate|\bTLS\b|ERR_SSL|ERR_CERT|EPROTO|self[- ]signed|secure connection/i],
  ['timeout', /SocketTimeout|ETIMEDOUT|TimeoutError|UND_ERR_CONNECT_TIMEOUT|ERR_TIMED_OUT|\btimed? ?out\b/i],
  ['refused', /ECONNREFUSED|Connection refused|ConnectException|Failed to connect|Could not connect|ERR_CONNECTION_REFUSED/i],
  ['reset', /ECONNRESET|ECONNABORTED|Connection reset|connection abort|Broken pipe|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|socket hang up|unexpected end of stream/i],
  ['offline', /appears to be offline|ERR_INTERNET_DISCONNECTED|ENETUNREACH|Network is unreachable|not connected to the internet/i],
  ['unreachable', /Network request failed|Failed to fetch|NetworkError|\bLoad failed\b|EHOSTUNREACH|NoRouteToHost|No route to host|\bjava\.net\.|okhttp/i],
];

/** The kind of a transport failure from its raw text, or null when the text is not a network failure. */
export function networkFailureKind(text: string): NetworkFailureKind | null {
  for (const [kind, re] of RULES) if (re.test(text)) return kind;
  return null;
}

/** raw texts that are clearly a transport failure (unkeyed errors: server texts must not be re-labelled) */
export const RAW_NETWORK = /\bjava(x)?\.net\.|okhttp|Network request failed|Failed to fetch|NetworkError when attempting|ECONN(REFUSED|RESET|ABORTED)|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_|ERR_INTERNET_DISCONNECTED|appears to be offline|NSURLErrorDomain/i;

/** first labels of Java / Kotlin / RN package names in exception text – not host names */
const PACKAGE_ROOTS = new Set(['java', 'javax', 'android', 'androidx', 'kotlin', 'kotlinx', 'okhttp3', 'okio', 'sun', 'dalvik', 'libcore', 'expo', 'com', 'org']);
/** last labels that make a dotted word a file name (stack traces), not a host */
const FILE_EXTS = new Set(['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'kt', 'java', 'json', 'swift', 'm', 'mm']);

/** Remove host names, IP addresses and URLs from a technical error text. */
export function scrubHosts(text: string): string {
  return text
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)\]]+/gi, '<url>')
    .replace(/\[[0-9a-f:.]+\](?::\d+)?/gi, '<ip>')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '<ip>')
    .replace(/(?<![\w:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\w:])/gi, (m) => (m.includes('::') || m.split(':').length >= 5 ? '<ip>' : m))
    .replace(/\b(host(?:name)?\s+)"[^"]*"/gi, '$1"<host>"')
    .replace(/\b(Hostname\s+)(?!<)\S+(?=\s+not verified)/gi, '$1<host>')
    .replace(/\b(ENOTFOUND|EAI_AGAIN)\s+(?!<)[^\s,;)]+/g, '$1 <host>')
    .replace(/\b(connect(?:ed|ing)? to\s+)(?!<)[^\s/,;:)"']+/gi, '$1<host>')
    .replace(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]\b/gi, (m) => {
      const labels = m.toLowerCase().split('.');
      if (PACKAGE_ROOTS.has(labels[0]) || FILE_EXTS.has(labels[labels.length - 1])) return m;
      return '<host>';
    });
}

export type PresentedError = { text: string; detail?: string };

/** what the card knows besides the message: `plain` = a UI without setup jargon, `offline` = the browser says so */
export type PresentOptions = { plain?: boolean; offline?: boolean };

/**
 * fetch failures of OpenAI-compatible servers: their text is setup advice for whoever runs the server (CORS headers,
 * cleartext http, "localhost"); real-user PC-08 got it in the reduced UI for an ordinary offline browser
 */
const SETUP_ADVICE_KEY = /^backends\.openaicompat\.errors\.(cors|corsHttp|network[A-Za-z]*)$/;

/** What the failure card shows for an error message: the text, and a technical detail for the "Details" toggle. */
export function presentMessageError(m: Pick<ChatMessage, 'error' | 'errorText'>, t: TFn, opts: PresentOptions = {}): PresentedError {
  let raw: string | null = null;
  const key = m.errorText?.key;
  const detail = m.errorText?.params?.detail;
  if (key === 'backends.hermes.errors.networkDetail' && typeof detail === 'string') raw = detail;
  else if (!m.errorText && m.error && RAW_NETWORK.test(m.error)) raw = m.error;
  if (raw === null && key && SETUP_ADVICE_KEY.test(key)) {
    // offline browser or plain UI: one sentence, the advice behind "Details" (the full UI keeps it visible)
    if (!opts.plain && !opts.offline) return { text: messageErrorText(m, t) };
    return { text: plainNetworkText(opts.offline ? 'offline' : 'unreachable', t, opts.plain), detail: scrubHosts(messageErrorText(m, t)).trim() };
  }
  if (raw === null) return { text: messageErrorText(m, t) };
  const kind = opts.offline ? 'offline' : (networkFailureKind(raw) ?? 'unreachable');
  const text = plainNetworkText(kind, t, opts.plain);
  const shown = scrubHosts(raw).trim().slice(0, 300);
  return shown ? { text, detail: shown } : { text };
}

/** the card's sentence for a transport failure; `plain`: no Tailscale / bridge / certificate wording */
function plainNetworkText(kind: NetworkFailureKind, t: TFn, plain = false): string {
  if (plain) return t(kind === 'offline' ? 'chat.message.network.offline' : 'chat.message.network.plain');
  return t(`chat.message.network.${kind}` as TKey);
}
