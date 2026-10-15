/**
 * Push + live inbox – pure logic (no React, no native modules; node --test). Server side: docs/SELF-HOSTING.md "Push notifications".
 *
 * Server: the UI bridge (Hermes profiles with `bridge: true`) serves `/bridge/push/*` at the server root. Live inbox:
 * `GET /bridge/inbox/stream`. Agent servers (`adapter`) use the same routes and `<baseUrl>/inbox/stream`.
 */
import type { ChatMessage } from '../hermes/types.ts';
import type { ConversationMeta } from '../conversations/types.ts';
import { inboxSources, sessionAllowed, type SyncFilter } from '../conversations/remoteSync.ts';
import { botOf } from '../hermes/bots.ts';

export type PreviewMode = 'auto' | 'on' | 'off';
export type QuietHours = { from: string; to: string };
export type PushPlatform = 'fcm' | 'apns' | 'webpush';

/** Per app profile, stored locally (AsyncStorage `hui.push.v1`). */
export type PushProfileSettings = {
  enabled: boolean;
  preview: PreviewMode;
  quiet: QuietHours | null;
  /** last successful server registration (for unregister / status) */
  registrationId?: string;
  platform?: PushPlatform;
  /** device token / endpoint used for that registration (needed to unregister) */
  deviceKey?: string;
};

export const DEFAULT_PUSH_SETTINGS: PushProfileSettings = { enabled: false, preview: 'auto', quiet: null };
export const DEFAULT_QUIET: QuietHours = { from: '22:00', to: '07:00' };

/** Structural subset of ConnectionProfile (keeps this file import-free of settings). */
export type PushProfile = {
  id: string;
  kind: string;
  baseUrl: string;
  apiKey: string;
  bridge?: boolean;
  model?: string;
  name?: string;
  /** hermes: "Andere Hermes-Chats anzeigen" (default off) */
  showForeignChats?: boolean;
  /** hermes: "Cron-Berichte anzeigen" (default off): cron reports in the live inbox + notifications */
  showCronReports?: boolean;
};

/** Hermes session filter of a profile (same as conversations/hermesSync syncFilterOf). */
export function pushFilterOf(p: Pick<PushProfile, 'showForeignChats' | 'showCronReports'>): SyncFilter {
  return { foreign: p.showForeignChats === true, cron: p.showCronReports === true };
}

/** Hermes sources requested from the bridge (inbox stream + device scope): api_server, + cron when enabled. */
export function hermesInboxSources(p: Pick<PushProfile, 'showForeignChats' | 'showCronReports'>): string[] {
  return inboxSources(pushFilterOf(p));
}

/**
 * Hermes inbox event allowed for this profile? Default: only the app's own sessions (api_server + `hui-` id);
 * cron reports only with "Cron-Berichte anzeigen". Anything else creates no chat and no notification.
 * Events without a session id are dropped (they cannot belong to an app chat).
 */
export function hermesInboxAllowed(p: Pick<PushProfile, 'showForeignChats' | 'showCronReports'>, ev: { source?: string; sessionId?: string | null }): boolean {
  if (!ev.sessionId) return false;
  const f = pushFilterOf(p);
  if (!inboxSources(f).includes(ev.source ?? '')) return false;
  return sessionAllowed(ev.source, ev.sessionId, f);
}

export type PushServerKind = 'bridge' | 'adapter';

const trimUrl = (u: string) => u.trim().replace(/\/+$/, '');
const root = (u: string) => trimUrl(u).replace(/\/v1$/i, '');

/** Which push-capable server a profile talks to (null = none: direct Hermes, Claude, demo, …). */
export function pushServerKind(p: PushProfile | undefined): PushServerKind | null {
  if (!p || !/^https?:\/\//i.test(p.baseUrl) || !p.apiKey) return null;
  if (p.kind === 'hermes') return p.bridge ? 'bridge' : null;
  return null;
}

export function pushBaseUrl(p: PushProfile): string {
  return `${root(p.baseUrl)}/bridge/push`;
}

export function inboxUrl(p: PushProfile, o: { since?: number; agents?: string[]; sources?: string[] } = {}): string | null {
  const kind = pushServerKind(p);
  if (!kind) return null;
  const q: string[] = [];
  if (o.since && o.since > 0) q.push(`since=${Math.floor(o.since)}`);
  if (o.agents?.length) q.push(`agents=${o.agents.map(encodeURIComponent).join(',')}`);
  if (o.sources?.length) q.push(`sources=${o.sources.map(encodeURIComponent).join(',')}`);
  const base = kind === 'bridge' ? `${root(p.baseUrl)}/bridge/inbox/stream` : `${root(p.baseUrl)}/v1/inbox/stream`;
  return q.length ? `${base}?${q.join('&')}` : base;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export function validTime(s: string): boolean {
  return HHMM.test(s.trim());
}

/** Normalize "7:5" / "0730" style input to HH:MM, or null. */
export function normalizeTime(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{1,2}):(\d{1,2})$/.exec(t) ?? /^(\d{2})(\d{2})$/.exec(t);
  if (!m) {
    const h = /^(\d{1,2})$/.exec(t);
    if (!h) return null;
    m = [t, h[1], '0'] as unknown as RegExpExecArray;
  }
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Body of POST /bridge/push/register (without the device part). */
export function registrationBody(
  p: PushProfile,
  s: PushProfileSettings,
  o: { locale: string; tz?: string; label?: string },
): Record<string, unknown> {
  const kind = pushServerKind(p);
  return {
    profileId: p.id,
    preview: s.preview,
    quiet: s.quiet ?? null,
    tz: o.tz,
    locale: ['de', 'en', 'es'].includes(o.locale) ? o.locale : 'de',
    label: o.label,
    // bridge: which Hermes sources notify (api_server; + cron with "Cron-Berichte anzeigen"); adapter: all of the token's agents (data.agent picks the chat)
    scope: kind === 'bridge' ? { sources: hermesInboxSources(p) } : {},
  };
}

/** What a notification tap / inbox event refers to (deep link). */
export type PushTarget = {
  /** `turn`: local "Antwort fertig" notification of a turn that finished in the background (background/) */
  src: 'hermes' | 'test' | 'turn';
  profileId: string;
  /** `turn`: the conversation to open */
  conversationId?: string;
  sessionId?: string;
  agent?: string;
  source?: string;
  messageId?: string;
  /** `approval`: Hermes waits for a decision (bridge push "Hermes wartet auf deine Freigabe"); runId = completion id */
  kind?: 'approval';
  runId?: string;
  requestId?: string;
  /** hermes: Hermes profile ("bot") of the session (bridge `hermesProfile`; undefined = default) */
  hermesProfile?: string;
};

/**
 * Notification data from any platform → PushTarget. Accepts the plain data object (iOS `body`, web), an
 * Android expo `data` that is still a JSON string, and drops anything without a profile id.
 */
export function parseTarget(raw: unknown): PushTarget | null {
  let d: unknown = raw;
  if (typeof d === 'string') {
    try {
      d = JSON.parse(d);
    } catch {
      return null;
    }
  }
  if (!d || typeof d !== 'object') return null;
  const o = d as Record<string, unknown>;
  if (o.body && typeof o.body === 'object' && !o.profileId) return parseTarget(o.body);
  if (typeof o.body === 'string' && !o.profileId) return parseTarget(o.body);
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const profileId = str(o.profileId);
  const src = str(o.src);
  if (!profileId || (src !== 'hermes' && src !== 'test' && src !== 'turn')) return null;
  if (src === 'turn' && !str(o.conversationId)) return null;
  return {
    src,
    profileId,
    sessionId: str(o.sessionId),
    agent: str(o.agent),
    source: str(o.source),
    messageId: str(o.messageId),
    ...(str(o.conversationId) ? { conversationId: str(o.conversationId) } : {}),
    ...(botOf(str(o.hermesProfile)) ? { hermesProfile: botOf(str(o.hermesProfile)) } : {}),
    ...(o.kind === 'approval' ? { kind: 'approval' as const, runId: str(o.runId), requestId: str(o.requestId) } : {}),
  };
}

/** One live inbox event (`event: hui.message`) as sent by the bridge / adapter. */
export type InboxEvent = {
  id: string;
  content: string;
  timestamp: number;
  title?: string;
  /** hermes */
  sessionId?: string | null;
  source?: string;
  /** agent servers */
  agent?: string;
  /** hermes: Hermes profile ("bot") of the session (undefined = default) */
  hermesProfile?: string;
};

export function parseInboxEvent(data: string): InboxEvent | null {
  try {
    const o = JSON.parse(data) as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.content !== 'string') return null;
    return {
      id: o.id,
      content: o.content,
      timestamp: typeof o.timestamp === 'number' ? o.timestamp : Date.now(),
      title: typeof o.title === 'string' ? o.title : undefined,
      sessionId: typeof o.sessionId === 'string' ? o.sessionId : null,
      source: typeof o.source === 'string' ? o.source : undefined,
      agent: typeof o.agent === 'string' ? o.agent : undefined,
      ...(typeof o.hermesProfile === 'string' && botOf(o.hermesProfile) ? { hermesProfile: botOf(o.hermesProfile) } : {}),
    };
  } catch {
    return null;
  }
}

const isDraft = (c: ConversationMeta) => !c.preview && c.messageCount === 0;

/**
 * The conversation an inbox event / notification belongs to, or null (Hermes: fetch + merge the session;
 * agent servers: start a new conversation).
 * - Hermes: same profile and `hermesSessionId === sessionId`; the chat of the same bot (`hermesProfile`) wins over
 *   one of another bot with the same session id (events of older bridges carry no bot: session match only).
 * - agent servers: same profile; with a session id only the matching chat (none → null: a new chat bound to it),
 *   otherwise (the adapter's default thread per user+agent) the most recent chat of that agent
 *   (`meta.model ?? profile.model`).
 */
export function pickConversation(
  list: readonly ConversationMeta[],
  profile: Pick<PushProfile, 'id' | 'kind' | 'model'>,
  t: { sessionId?: string | null; agent?: string; hermesProfile?: string },
): ConversationMeta | null {
  const mine = list.filter((c) => c.profileId === profile.id);
  if (profile.kind === 'hermes') {
    if (!t.sessionId) return null;
    const bot = botOf(t.hermesProfile);
    const same = mine.filter((c) => c.hermesSessionId === t.sessionId);
    return same.find((c) => botOf(c.hermesProfile) === bot) ?? same[0] ?? null;
  }
  // an explicit session is THAT thread: unmatched stays unmatched (never another chat of the agent, Astra F09)
  if (t.sessionId) return mine.find((c) => c.hermesSessionId === t.sessionId) ?? null;
  const agentChats = mine
    .filter((c) => !isDraft(c) && (!t.agent || (c.model ?? profile.model) === t.agent))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return agentChats[0] ?? null;
}

/** Inbox event → assistant ChatMessage (id = server message id, used for de-duplication). */
export function inboxToMessage(ev: InboxEvent): ChatMessage {
  return { id: ev.id, role: 'assistant', text: ev.content, tools: [], status: 'done', createdAt: ev.timestamp, finishReason: 'stop' };
}

/** Append an inbox message unless it is already there (same id or identical trailing assistant text). */
export function mergeInboxMessage(messages: readonly ChatMessage[], ev: InboxEvent): ChatMessage[] | null {
  if (messages.some((m) => m.id === ev.id)) return null;
  const last = messages[messages.length - 1];
  if (last && last.role === 'assistant' && last.text.trim() === ev.content.trim()) return null;
  return [...messages, inboxToMessage(ev)];
}

/** VAPID public key (base64url) → bytes for pushManager.subscribe. */
export function vapidKeyBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4);
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Reconnect delay for the inbox stream (ms): 1 s, 2 s, 4 s … capped at 60 s. */
export function backoffMs(attempt: number): number {
  return Math.min(60_000, 1000 * 2 ** Math.max(0, Math.min(attempt, 6)));
}
