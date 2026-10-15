import type { ConversationMeta, IndexFile, MessagesFile, ProfileKind, RemoteInfo } from './types.ts';
import { sanitizeChatOptions } from '../hermes/capabilities.ts';
import { sanitizeModelLock } from '../hermes/modelLock.ts';
import { botOf } from '../hermes/bots.ts';
import type { ChatMessage } from '../hermes/types.ts';
import { DEFAULT_TITLE, PROFILE_KINDS, SCHEMA_VERSION } from './types.ts';

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Validate/repair one index entry; null = unusable. */
export function sanitizeMeta(raw: unknown, now: number): ConversationMeta | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  if (!id) return null;
  // unknown / missing kinds were Hermes chats (before `profileKind` existed)
  const kind: ProfileKind = (PROFILE_KINDS as readonly unknown[]).includes(raw.profileKind) ? (raw.profileKind as ProfileKind) : 'hermes';
  const createdAt = num(raw.createdAt, now);
  return {
    id,
    title: str(raw.title) ?? DEFAULT_TITLE,
    titleSource: raw.titleSource === 'user' || raw.titleSource === 'remote' || raw.titleSource === 'meta' ? raw.titleSource : 'auto',
    profileId: str(raw.profileId) ?? '',
    profileKind: kind,
    hermesSessionId: str(raw.hermesSessionId),
    createdAt,
    updatedAt: num(raw.updatedAt, createdAt),
    pinned: raw.pinned === true ? true : undefined,
    preview: typeof raw.preview === 'string' ? raw.preview : '',
    messageCount: Math.max(0, Math.floor(num(raw.messageCount, 0))),
    ...(str(raw.model) ? { model: str(raw.model) } : {}),
    ...optional(raw),
  };
}

/** Additive fields of the session sync / per-chat options (no schema bump: unknown → dropped). */
function optional(raw: Record<string, unknown>): Partial<ConversationMeta> {
  const out: Partial<ConversationMeta> = {};
  const mo = sanitizeChatOptions(raw.modelOptions);
  if (mo) out.modelOptions = mo;
  const lock = sanitizeModelLock(raw.modelLock);
  if (lock) out.modelLock = lock;
  if (raw.origin === 'remote') out.origin = 'remote';
  const r = sanitizeRemote(raw.remote);
  if (r) out.remote = r;
  if (raw.archived === true) out.archived = true;
  if (raw.historyTruncated === true) out.historyTruncated = true;
  const bot = typeof raw.hermesProfile === 'string' ? botOf(raw.hermesProfile) : undefined;
  if (bot) out.hermesProfile = bot;
  if (typeof raw.branchSeed === 'number' && Number.isFinite(raw.branchSeed) && raw.branchSeed >= 1) out.branchSeed = Math.floor(raw.branchSeed);
  return out;
}

export function sanitizeRemote(raw: unknown): RemoteInfo | undefined {
  if (!isObj(raw)) return undefined;
  const source = str(raw.source);
  if (!source) return undefined;
  const r: RemoteInfo = { source };
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  if (n(raw.lastActive) !== undefined) r.lastActive = n(raw.lastActive);
  if (n(raw.remoteCount) !== undefined) r.remoteCount = n(raw.remoteCount);
  if (n(raw.loadedAt) !== undefined) r.loadedAt = n(raw.loadedAt);
  if (str(raw.title)) r.title = str(raw.title);
  return r;
}

/**
 * Migration hook for the index file. `raw` is the parsed JSON (anything). Add one `if (v < N)` step
 * per schema bump. Unknown newer versions are read best-effort (never throw, never wipe).
 */
export function migrateIndex(raw: unknown, now: number = Date.now()): IndexFile {
  let items: unknown[] = [];
  let activeId: string | undefined;
  let hiddenRemote: string[] | undefined;
  if (Array.isArray(raw)) {
    // v0: bare array of metas
    items = raw;
  } else if (isObj(raw)) {
    if (Array.isArray(raw.items)) items = raw.items;
    activeId = str(raw.activeId);
    if (Array.isArray(raw.hiddenRemote)) hiddenRemote = raw.hiddenRemote.filter((x): x is string => typeof x === 'string' && !!x).slice(-500);
  }
  // future: if (v < 2) { ... }
  const seen = new Set<string>();
  const out: ConversationMeta[] = [];
  for (const it of items) {
    const m = sanitizeMeta(it, now);
    if (m && !seen.has(m.id)) {
      seen.add(m.id);
      out.push(m);
    }
  }
  return {
    v: SCHEMA_VERSION,
    items: out,
    activeId: activeId && seen.has(activeId) ? activeId : undefined,
    ...(hiddenRemote?.length ? { hiddenRemote } : {}),
  };
}

/** Migration hook for a messages file. Drops entries that are not message-shaped. */
export function migrateMessages(raw: unknown): MessagesFile {
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (isObj(raw) && Array.isArray(raw.messages)) list = raw.messages;
  const messages: ChatMessage[] = [];
  for (const m of list) {
    if (!isObj(m)) continue;
    if (typeof m.id !== 'string' || (m.role !== 'user' && m.role !== 'assistant') || typeof m.text !== 'string') continue;
    const status = m.status === 'error' || m.status === 'stopped' || m.status === 'done' ? m.status : 'stopped';
    messages.push({
      ...(m as unknown as ChatMessage),
      tools: Array.isArray(m.tools) ? (m.tools as ChatMessage['tools']) : [],
      status,
      createdAt: num(m.createdAt, 0),
    });
  }
  return { v: SCHEMA_VERSION, messages };
}
