// Connection profiles: pure data + helpers (no React, no native modules) so it is unit-testable.
// Shipped defaults are generic: the only built-in profile is the offline demo. Personal hosts/keys
// for development come from EXPO_PUBLIC_DEV_PROFILES (see devProfiles.ts, docs/BUILD.md "Dev profiles").

import type { TFn } from '../i18n/core.ts';
import { normalizeServerUrl } from '../onboarding/url.ts';

/**
 * - `hermes`  Hermes Agent API server (optionally behind the UI bridge: `bridge: true`)
 * - `demo`    offline demo: replays bundled scenarios, no network (`baseUrl: demo://local`)
 */
export type ProfileKind = 'hermes' | 'demo';
export const PROFILE_KINDS: readonly ProfileKind[] = ['hermes', 'demo'];


export type ConnectionProfile = {
  id: string;
  kind: ProfileKind;
  name: string;
  /** hermes: OpenAI-compatible base URL incl. `/v1`, e.g. http://192.0.2.10:8642/v1. demo: demo://local */
  baseUrl: string;
  /** hermes: API key / bridge token. Stored in the secure store. */
  apiKey: string;
  model?: string;
  /** hermes: X-Hermes-Session-Key (memory scope per channel) */
  sessionKey?: string;
  /** hermes: baseUrl points to the UI bridge (it injects the bootstrap system message itself) */
  bridge?: boolean;
  /** hermes: list the app's Hermes sessions + load transcripts from Hermes (default on = undefined) */
  syncSessions?: boolean;
  /** hermes: also show Telegram/CLI chats and other API clients' sessions (default off; hiding is local only) */
  showForeignChats?: boolean;
  /** hermes: show cron reports as chats + live inbox/notifications for them (default off) */
  showCronReports?: boolean;
  /** extra request headers (openai: e.g. OpenRouter HTTP-Referer / X-Title); kept in the secure store (secretHeaders.ts) */
  headers?: Record<string, string>;
  /** persona waiting animation (ui/loaders LoaderKind, e.g. 'chameleon'); unset/'auto' = heuristic on name/model */
  loaderStyle?: string;
};


export const DEMO_BASE_URL = 'demo://local';
export const PRESET_DEMO_ID = 'preset-demo';
export const DEFAULT_SESSION_KEY = 'hermes-ui';

/** The offline demo profile: always present, cannot be deleted. */
export function demoProfile(name = 'Demo (offline)'): ConnectionProfile {
  return { id: PRESET_DEMO_ID, kind: 'demo', name, baseUrl: DEMO_BASE_URL, apiKey: '' };
}

/** Built-in profiles shipped with every build (dev profiles are added on top, see devProfiles.ts). */
export function builtinProfiles(): ConnectionProfile[] {
  return [demoProfile()];
}

export function isDemoProfile(p: Pick<ConnectionProfile, 'kind' | 'baseUrl'>): boolean {
  return p.kind === 'demo' || /^demo:/i.test(p.baseUrl);
}

export function newProfileId(): string {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Trim and drop trailing slashes. */
export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * Base URL as it is stored: Hermes servers go through the same normalization as onboarding / pair links
 * (onboarding/url.ts: scheme, `/v1` appended once, query/fragment/endpoint paths dropped), so a pasted root URL or
 * `https://host/v1?x=1` ends up as `https://host/v1`. Other kinds only get trimmed (own-URL servers differ in layout).
 * An input the strict parser rejects is returned trimmed; validateProfile reports it.
 */
export function cleanBaseUrl(kind: ProfileKind, url: string): string {
  if (kind === 'hermes') {
    const n = normalizeServerUrl(url);
    if (n.ok) return n.baseUrl;
  }
  return normalizeBaseUrl(url);
}

/** Server root for `/health` – strips a trailing `/v1`. */
export function serverRoot(baseUrl: string): string {
  return normalizeBaseUrl(baseUrl).replace(/\/v1$/i, '');
}

/** Kinds whose connection is a base URL the user enters. */
export function needsBaseUrl(kind: ProfileKind): boolean {
  return kind === 'hermes';
}

/** Kinds that sign in with an account instead of a key (tokens live in the secure store of their module). */
export function usesAccountLogin(kind: ProfileKind): boolean {
  return false; // no account-login kinds in this build
}

export type ProfileError = 'name' | 'url' | 'urlPlaceholder' | 'model' | 'temperature' | 'header';

/** Validation for the editor. Returns an error code (the screen translates it) or null. */
export function validateProfile(
  p: Pick<ConnectionProfile, 'name' | 'baseUrl' | 'kind'> & Partial<Pick<ConnectionProfile, 'model' | 'headers'>>,
): ProfileError | null {
  if (!p.name.trim()) return 'name';
  if (!needsBaseUrl(p.kind)) return null;
  const url = normalizeBaseUrl(p.baseUrl);
  if (/<[^>]*>/.test(url)) return 'urlPlaceholder';
  if (!/^https?:\/\/[^\s/]+/i.test(url)) return 'url';
  // Hermes: exactly what onboarding accepts (no credentials in the URL, valid host / port / path)
  if (p.kind === 'hermes' && !normalizeServerUrl(url).ok) return 'url';
  return null;
}

export function isHeaderName(k: string): boolean {
  return /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(k);
}

/** Shorten a key for display: never show more than the last 4 characters. */
export function maskKey(key: string): string {
  if (!key) return '';
  return key.length <= 4 ? '••••' : `••••${key.slice(-4)}`;
}

/** Fresh profile of a kind for the editor ("Neue Verbindung"). */
export function blankProfile(kind: ProfileKind, id = newProfileId()): ConnectionProfile {
  switch (kind) {
    case 'demo':
      return { ...demoProfile(), id };
    case 'hermes':
    default:
      return { id, kind: 'hermes', name: '', baseUrl: 'http://', apiKey: '', sessionKey: DEFAULT_SESSION_KEY };
  }
}


// ── header list <-> map (editor) ───────────────────────────────────────────────────────────────────
/** "Name: value" lines → map. Blank lines ignored; lines without a colon are kept as invalid names. */
export function parseHeaderLines(text: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const i = line.indexOf(':');
    const k = (i < 0 ? line : line.slice(0, i)).trim();
    const v = i < 0 ? '' : line.slice(i + 1).trim();
    out[i < 0 ? `${k} ` : k] = v; // a name with a trailing space fails isHeaderName → validation error
  }
  return Object.keys(out).length ? out : undefined;
}

export function formatHeaderLines(h: Record<string, string> | undefined): string {
  return h ? Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\n') : '';
}

// ── merging + active profile ───────────────────────────────────────────────────────────────────────
/**
 * Built-ins (demo + dev profiles) first, then the user's stored profiles in their order. A stored copy
 * of a built-in (user edited it) wins, keeps the built-in's kind and falls back to the built-in's key.
 */
export function mergeWithBuiltins(stored: ConnectionProfile[], builtins: ConnectionProfile[]): ConnectionProfile[] {
  const byId = new Map(stored.map((p) => [p.id, p]));
  const ids = new Set(builtins.map((b) => b.id));
  const out: ConnectionProfile[] = builtins.map((b) => {
    const s = byId.get(b.id);
    if (!s) return b;
    return { ...b, ...s, kind: b.kind, apiKey: s.apiKey || b.apiKey };
  });
  for (const p of stored) if (!ids.has(p.id)) out.push(p);
  return out;
}

/** Initial active profile: stored choice if it still exists > first dev profile > first user profile > demo. */
export function pickActiveId(profiles: ConnectionProfile[], storedActive: string | null | undefined, preferred?: string): string {
  if (storedActive && profiles.some((p) => p.id === storedActive)) return storedActive;
  if (preferred && profiles.some((p) => p.id === preferred)) return preferred;
  const real = profiles.find((p) => p.kind !== 'demo');
  return real?.id ?? PRESET_DEMO_ID;
}

/** Human readable target for list rows (without key info). */
export function profileTarget(p: ConnectionProfile, t: TFn): string {
  switch (p.kind) {
    case 'demo':
      return t('settings.profileTarget.demo');
    case 'hermes':
    default:
      return p.bridge ? `${hostOf(p.baseUrl)} · Bridge` : hostOf(p.baseUrl);
  }
}

function hostOf(url: string): string {
  const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(url.trim());
  return m ? m[1] : url;
}

// ── per-conversation model (session components, e.g. demo) ─────────────────────────────────────
/** Conversation override > profile model > fallback (kind default). */
export function resolveModel(conversationModel: string | undefined, profileModel: string | undefined, fallback: string): string {
  return conversationModel?.trim() || profileModel?.trim() || fallback;
}

/** Value to store on the conversation for a picked model: the profile default is stored as undefined. */
export function modelOverride(picked: string | undefined, profileModel: string | undefined, fallback: string): string | undefined {
  const base = profileModel?.trim() || fallback;
  const p = picked?.trim() || undefined;
  return !p || p === base ? undefined : p;
}
