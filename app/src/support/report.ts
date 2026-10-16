/**
 * "Report a problem": a prefilled GitHub issue (issue form .github/ISSUE_TEMPLATE/bug_report.yml) built from a fixed
 * allow-list of technical facts. Pure (report.test.ts).
 *
 * The report holds ONLY: app version + build + commit, platform / OS version, flavor, connection type, the bridge /
 * Hermes versions if /v1/capabilities names them, enabled feature flags and the last error as category + code.
 * Every value passes a strict per-field pattern (anything else becomes "unknown"), and the whole text then passes
 * the scrubber (`scrubReportText`): no URLs, hosts, IPs, e-mail addresses, tokens or message contents, in every flavor.
 * The user sees this exact text before anything opens, and can copy it instead.
 */
import { RAW_NETWORK, networkFailureKind, scrubHosts } from '../hermes/networkFailure.ts';
import type { ChatMessage } from '../hermes/types.ts';
import { versionLabel } from '../settings/versionLabel.ts';

export type ConnectionType = 'bridge' | 'direct' | 'demo' | 'other' | 'unknown';
export type ErrorCategory = 'network' | 'auth' | 'timeout' | 'server' | 'app';
export type ErrorCode = { category: ErrorCategory; code: string };

export type ReportInput = {
  appName: string;
  version?: string;
  /** expo extra (buildNumber, buildSource), read by versionLabel */
  extra?: Record<string, unknown>;
  os: string;
  osVersion?: string | number;
  /** Tauri desktop platform (`macos`, `linux`, …); null/undefined outside the desktop app */
  desktop?: string | null;
  flavor: string;
  connection: ConnectionType;
  hermesVersion?: string | null;
  bridgeVersion?: string | null;
  /** /v1/capabilities `features.*` (only enabled names are reported) */
  serverFlags?: Record<string, boolean> | null;
  /** app build switches */
  appFlags?: Record<string, boolean>;
  lastError?: ErrorCode | null;
};

export type ReportField = { id: string; label: string; value: string };
export type ProblemReport = { title: string; fields: ReportField[]; text: string; url: string };

// ---------------------------------------------------------------- scrubbing

const EMAIL = /[^\s@<>()[\]"'`,;:]+@[^\s@<>()[\]"'`,;:]+/g;
const BEARER = /\b(bearer|token|key|secret|password|authorization)(\s*[:=]\s*|\s+)\S+/gi;
const TOKEN_PREFIX = /\b(?:nca_|sk-|sk_|pk_|ghp_|gho_|ghs_|github_pat_|xox[abpr]-|AIza|eyJ)[\w.~+/=-]*/g;
/** long opaque strings (keys, JWT parts, push tokens); a 7–12 char commit hash stays */
const LONG_OPAQUE = /\b(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]{20,}\b/g;

/** Safety net over any text that leaves the device: e-mail, credentials, URLs, IPs, host names. */
export function scrubReportText(text: string): string {
  return scrubHosts(text.replace(EMAIL, '<email>').replace(BEARER, '$1 <redacted>').replace(TOKEN_PREFIX, '<redacted>')).replace(LONG_OPAQUE, '<redacted>');
}

const UNKNOWN = 'unknown';
const pick = (v: unknown, re: RegExp): string | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim();
  return re.test(s) && scrubReportText(s) === s ? s : null;
};
const SEMVERISH = /^v?\d{1,4}(?:\.\d{1,6}){0,3}(?:[-+][0-9A-Za-z.-]{1,24})?$/;
const WORD = /^[a-z][a-z0-9_]{0,47}$/;
const CODE = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;

/**
 * Hermes `features.*` names the report may name (docs/HERMES-API.md). The names come from the user's server, so an
 * unknown name could carry anything (a host fragment): unknown enabled flags are only counted.
 */
export const KNOWN_SERVER_FLAGS: ReadonlySet<string> = new Set([
  'chat_completions', 'tool_progress_events', 'approval_events', 'run_approval_response', 'session_resources', 'model_options',
  'session_chat', 'session_chat_streaming', 'session_fork', 'session_model_lock', 'reasoning_streaming', 'skills_api', 'audio_api',
  'cors', 'run_submission', 'run_status', 'run_events_sse', 'run_stop', 'run_steer',
]);

function flagList(flags: Record<string, boolean> | null | undefined, known?: ReadonlySet<string>): string[] {
  if (!flags || typeof flags !== 'object') return [];
  const on = Object.entries(flags).filter(([, v]) => v === true).map(([k]) => k);
  const named = on.filter((k) => (!known || known.has(k)) && WORD.test(k) && scrubReportText(k) === k).sort().slice(0, 40);
  const other = on.length - named.length;
  return other > 0 ? [...named, `+${other} other`] : named;
}

// ---------------------------------------------------------------- last error (category + code, never text)

const keyCategory = (seg: string): ErrorCategory => (/auth|apikey|forbidden|denied/i.test(seg) ? 'auth' : /timeout/i.test(seg) ? 'timeout' : 'app');

/** Category + code of a failed message (the same mapping as the failure card), never its text. */
export function errorCodeOf(m: Pick<ChatMessage, 'error' | 'errorText'>): ErrorCode | null {
  const key = m.errorText?.key;
  if (key === 'backends.hermes.errors.networkDetail') {
    const detail = m.errorText?.params?.detail;
    return { category: 'network', code: (typeof detail === 'string' && networkFailureKind(detail)) || 'unreachable' };
  }
  if (key) {
    const seg = key.split('.').pop() ?? '';
    return CODE.test(seg) ? { category: keyCategory(seg), code: seg } : { category: 'app', code: UNKNOWN };
  }
  if (!m.error) return null;
  if (RAW_NETWORK.test(m.error)) return { category: 'network', code: networkFailureKind(m.error) ?? 'unreachable' };
  const status = /\b([45]\d\d)\b/.exec(m.error)?.[1];
  if (status) return { category: status === '401' || status === '403' ? 'auth' : status.startsWith('5') ? 'server' : 'app', code: `http_${status}` };
  return { category: 'app', code: UNKNOWN };
}

let lastError: { e: ErrorCode; at: number } | null = null;
/**
 * Remember the newest error shown on a failure card (in memory only). `at` = the message's createdAt: the chat list
 * mounts its cards newest first, so the mount order alone would keep the oldest one.
 */
export function noteLastError(e: ErrorCode | null, at = Date.now()): void {
  if (e && (!lastError || at >= lastError.at)) lastError = { e, at };
}
export function lastErrorCode(): ErrorCode | null {
  return lastError?.e ?? null;
}

// ---------------------------------------------------------------- the report

const CATEGORIES: readonly ErrorCategory[] = ['network', 'auth', 'timeout', 'server', 'app'];
const CONNECTIONS: readonly ConnectionType[] = ['bridge', 'direct', 'demo', 'other', 'unknown'];
const OS_NAMES: Record<string, string> = { android: 'Android', ios: 'iOS', web: 'Web', macos: 'macOS', windows: 'Windows' };

function platformText(i: ReportInput): string {
  const os = OS_NAMES[i.os] ?? UNKNOWN;
  const ver = pick(i.osVersion, /^[0-9A-Za-z._ -]{1,24}$/);
  const desktop = i.desktop ? pick(i.desktop, WORD) : null;
  const base = i.os === 'android' && ver ? `Android (API ${ver})` : ver ? `${os} ${ver}` : os;
  return desktop ? `Desktop app (${desktop})` : base;
}

/** The ids are the issue form's field ids (bug_report.yml): GitHub fills a field from `?<id>=…`. */
export const ISSUE_TEMPLATE = 'bug_report.yml';

export function buildReport(i: ReportInput, issuesNewUrl: string): ProblemReport {
  const version = scrubReportText(versionLabel(pick(i.version, SEMVERISH) ?? undefined, i.extra));
  const flavor = pick(i.flavor, WORD) ?? UNKNOWN;
  const connection = CONNECTIONS.includes(i.connection) ? i.connection : 'unknown';
  const hermes = pick(i.hermesVersion, SEMVERISH);
  const bridge = pick(i.bridgeVersion, SEMVERISH);
  const server = [hermes ? `Hermes ${hermes}` : null, bridge ? `bridge ${bridge}` : null].filter(Boolean).join(', ') || UNKNOWN;
  const sFlags = flagList(i.serverFlags, KNOWN_SERVER_FLAGS);
  const aFlags = flagList(i.appFlags);
  const flags = [aFlags.length ? `app: ${aFlags.join(', ')}` : null, sFlags.length ? `server: ${sFlags.join(', ')}` : null].filter(Boolean).join('\n') || 'none';
  const e = i.lastError;
  const err = e && CATEGORIES.includes(e.category) ? `${e.category}/${pick(e.code, CODE) ?? UNKNOWN}` : 'none';
  const platform = platformText(i);

  const fields: ReportField[] = [
    { id: 'version', label: 'App version', value: `${pick(i.appName, /^[A-Za-z][A-Za-z +]{0,15}$/) ?? 'app'} ${version}` },
    { id: 'platform', label: 'Platform', value: `${platform} · flavor ${flavor}` },
    { id: 'connection', label: 'Connection', value: connection },
    { id: 'server', label: 'Server versions', value: server },
    { id: 'flags', label: 'Enabled feature flags', value: flags },
    { id: 'last-error', label: 'Last error', value: err },
  ].map((f) => ({ ...f, value: scrubReportText(f.value) }));

  const title = scrubReportText(`[Bug]: ${err !== 'none' ? `${err} ` : ''}on ${platform}`);
  const text = scrubReportText([`Title: ${title}`, '', ...fields.flatMap((f) => [`### ${f.label}`, f.value, ''])].join('\n').trimEnd());
  const params = new URLSearchParams({ template: ISSUE_TEMPLATE, title });
  for (const f of fields) params.set(f.id, f.value);
  return { title, fields, text, url: `${issuesNewUrl}?${params.toString()}` };
}

/** `https://github.com/<owner>/<repo>` → its "new issue" page, or null. */
export function issuesNewUrl(repoUrl: string | null | undefined): string | null {
  return repoUrl && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(repoUrl) ? `${repoUrl.replace(/\/$/, '')}/issues/new` : null;
}
