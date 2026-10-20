/**
 * Routines slice 2: the result inbox of a bot (UI bridge `/bridge/routines/*`). Types, parsers, the client (fetch
 * injected like jobs.ts) and small pure helpers for the screen. Pure, erasable TS (node:test).
 *
 * Bridge contract (all at the server root, Bearer like every bridge route, `hermesProfile` = bot or `default`):
 *   GET   /bridge/routines/inbox?hermesProfile=&filter=all|unread&limit=1..100&before=<id>
 *                                       → {items:[Summary], unreadCount, nextCursor: id|null}   newest first
 *   GET   /bridge/routines/inbox/<id>?hermesProfile=   → {item: Summary + {text, truncated, error?}}   404 item_not_found
 *   PATCH /bridge/routines/inbox/<id>   {hermesProfile, read}   → {item: Summary, unreadCount}
 *   POST  /bridge/routines/inbox/read-all {hermesProfile}       → {updated, unreadCount}
 * Read state is owner-wide (shared by all devices). Only the bridge has an inbox; direct Hermes connections do not.
 */
import { HermesError, type FetchLike } from '../hermes/stream.ts';
import { createJsonRequest, type ApiConn } from '../hermes/sessions.ts';
import { DEFAULT_BOT, botOf, serverRootOf } from '../hermes/bots.ts';
import { parseCapabilities, routinesErrorKind, type RoutinesCapabilities } from './rights.ts';

export type InboxStatus = 'ok' | 'failed' | 'silent' | 'blocked';
export type InboxFilter = 'unread' | 'all';

export type InboxSummary = {
  id: string;
  /** bot; `default` = the unprefixed profile */
  hermesProfile: string;
  jobId: string;
  title: string;
  /** ISO: session start or last_run_at */
  runAt: string;
  /** ISO: last_run_at */
  finishedAt: string;
  status: InboxStatus;
  /** the run worked, Hermes could not deliver it to its external target */
  deliveryFailed: boolean;
  /** plain text, ≤ 240 chars ('' when the run left no readable text) */
  summary: string;
  /** the stored text was cut at 16 KiB */
  truncated: boolean;
  sessionId: string | null;
  /** the answer has a ```hui block (cards) */
  hasRich: boolean;
  read: boolean;
  /** ms */
  createdAt: number;
};

export type InboxItem = InboxSummary & { text: string; error?: string };

export type InboxPage = { items: InboxSummary[]; unreadCount: number; nextCursor: string | null };

/** `ri_` + hex (bridge: sha256 slice); anything else never reaches the network. */
export const INBOX_ID_RE = /^ri_[a-f0-9]{8,64}$/;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const STATUSES: readonly InboxStatus[] = ['ok', 'failed', 'silent', 'blocked'];

export function parseInboxSummary(raw: unknown): InboxSummary | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id, 80);
  if (!INBOX_ID_RE.test(id)) return null;
  const finishedAt = str(raw.finishedAt, 64);
  const runAt = str(raw.runAt, 64) || finishedAt;
  const status = STATUSES.includes(raw.status as InboxStatus) ? (raw.status as InboxStatus) : 'ok';
  const jobId = str(raw.jobId, 64);
  return {
    id,
    hermesProfile: str(raw.hermesProfile, 64) || DEFAULT_BOT,
    jobId,
    title: str(raw.title, 200).trim() || jobId || id,
    runAt,
    finishedAt: finishedAt || runAt,
    status,
    deliveryFailed: raw.deliveryFailed === true,
    summary: str(raw.summary, 240).trim(),
    truncated: raw.truncated === true,
    sessionId: typeof raw.sessionId === 'string' && raw.sessionId ? raw.sessionId.slice(0, 200) : null,
    hasRich: raw.hasRich === true,
    // `read` (served shape) or `readAt` (stored shape) – anything else counts as unread
    read: raw.read === true || (typeof raw.readAt === 'number' && raw.readAt > 0),
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
  };
}

export function parseInboxItem(raw: unknown): InboxItem | null {
  const s = parseInboxSummary(raw);
  if (!s || !isObj(raw)) return null;
  const item: InboxItem = { ...s, text: str(raw.text, 16 * 1024 + 64) };
  const error = str(raw.error, 500).trim();
  if (error) item.error = error;
  return item;
}

export function parseInboxPage(json: unknown): InboxPage {
  const j = isObj(json) ? json : {};
  const items = (Array.isArray(j.items) ? j.items : []).map(parseInboxSummary).filter((x): x is InboxSummary => !!x);
  const next = typeof j.nextCursor === 'string' && INBOX_ID_RE.test(j.nextCursor) ? j.nextCursor : null;
  return { items, unreadCount: count(j.unreadCount), nextCursor: next };
}

const timeOf = (s: Pick<InboxSummary, 'finishedAt'>): number => {
  const n = Date.parse(s.finishedAt);
  return Number.isFinite(n) ? n : 0;
};

/** Newest first (finishedAt desc, id as tiebreak), like the bridge. */
export function sortInbox<T extends Pick<InboxSummary, 'finishedAt' | 'id'>>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => timeOf(b) - timeOf(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/** Append a further page (`before` cursor) without duplicates. */
export function appendPage(cur: InboxPage, next: InboxPage): InboxPage {
  const seen = new Set(cur.items.map((i) => i.id));
  return { items: [...cur.items, ...next.items.filter((i) => !seen.has(i.id))], unreadCount: next.unreadCount, nextCursor: next.nextCursor };
}

/** Local read flag (optimistic update; the server's unreadCount wins when it is known). */
export function withRead(page: InboxPage, id: string, read: boolean, unreadCount?: number): InboxPage {
  let delta = 0;
  const items = page.items.map((i) => {
    if (i.id !== id || i.read === read) return i;
    delta += read ? -1 : 1;
    return { ...i, read };
  });
  return { ...page, items, unreadCount: unreadCount ?? Math.max(0, page.unreadCount + delta) };
}

export function withAllRead(page: InboxPage): InboxPage {
  return { ...page, items: page.items.map((i) => (i.read ? i : { ...i, read: true })), unreadCount: 0 };
}

export type RoutinesTab = 'inbox' | 'schedules';

/**
 * Which tab the screen opens on: an explicit `tab` (notification tap, deep link) wins; otherwise the inbox when it has
 * unread results, else the schedules (also while the unread count is unknown, and whenever there is no inbox).
 */
export function initialTab(o: { param?: string | null; unread: number | null | undefined; inboxAvailable: boolean }): RoutinesTab {
  if (o.param === 'inbox' || o.param === 'schedules') return o.param;
  return o.inboxAvailable && (o.unread ?? 0) > 0 ? 'inbox' : 'schedules';
}

/** What a card says about the run (key part under `routines.inbox.status.*`). */
export type InboxOutcome = 'ok' | 'failed' | 'blocked' | 'silent' | 'deliveryFailed';
export function inboxOutcome(s: Pick<InboxSummary, 'status' | 'deliveryFailed'>): InboxOutcome {
  if (s.status === 'ok' && s.deliveryFailed) return 'deliveryFailed';
  return s.status;
}

/** Badge text: "1"…"99", then "99+". */
export function badgeCount(n: number): string {
  return n > 99 ? '99+' : String(Math.max(0, Math.floor(n)));
}

/** `hermesProfile` value for a bot of the app (undefined = default profile). */
export function inboxBotParam(bot: string | null | undefined): string {
  return botOf(bot) ?? DEFAULT_BOT;
}

/**
 * Can this connection + bot show an inbox, and if not, why (each case has its own explanation in the Inbox tab):
 * `noBridge` direct Hermes connection · `unsupported` bridge older than 0.2 · `off` owner has not enabled Routines
 * for this bot (or the inbox is switched off) · `forbidden` this device may not see them.
 */
export type InboxAvailability =
  | { kind: 'ready'; caps: RoutinesCapabilities }
  | { kind: 'noBridge' }
  | { kind: 'unsupported' }
  | { kind: 'off' }
  | { kind: 'forbidden' };

export function inboxAvailability(caps: RoutinesCapabilities): InboxAvailability {
  if (caps.rights === 'none' || caps.reasons.includes('device_forbidden')) return { kind: 'forbidden' };
  if (!caps.available || !caps.inbox.available) return { kind: 'off' };
  return { kind: 'ready', caps };
}

/** Capabilities request failed: a definite answer, or null for a transient error (offline, 5xx, auth: ask again). */
export function inboxAvailabilityFromError(e: unknown): InboxAvailability | null {
  switch (routinesErrorKind(e)) {
    case 'unsupported':
      return { kind: 'unsupported' };
    case 'off':
    case 'unknownBot':
      return { kind: 'off' };
    case 'forbidden':
      return { kind: 'forbidden' };
    default:
      return null;
  }
}

export function createInboxClient(fetchImpl: FetchLike, conn: ApiConn, bot: string | undefined, timeoutMs = 15000) {
  // bridge endpoints live at the server root, never under /p/<bot>/
  const request = createJsonRequest(fetchImpl, { baseUrl: serverRootOf(conn.baseUrl), apiKey: conn.apiKey }, timeoutMs);
  const hermesProfile = inboxBotParam(bot);
  const q = (extra: Record<string, string | number | undefined> = {}) => {
    const parts = [`hermesProfile=${encodeURIComponent(hermesProfile)}`];
    for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') parts.push(`${k}=${encodeURIComponent(String(v))}`);
    return `?${parts.join('&')}`;
  };
  const itemPath = (id: string) => {
    if (!INBOX_ID_RE.test(id)) throw new HermesError('bad_request', 'invalid inbox item id', { code: 'item_not_found' });
    return `/bridge/routines/inbox/${id}`;
  };
  return {
    hermesProfile,
    async capabilities(): Promise<RoutinesCapabilities> {
      const caps = parseCapabilities(await request('GET', `/bridge/routines/capabilities${q()}`));
      if (!caps) throw new HermesError('server', 'invalid capabilities response', { status: 404 });
      return caps;
    },
    async list(p: { filter?: InboxFilter; limit?: number; before?: string } = {}): Promise<InboxPage> {
      const limit = Math.max(1, Math.min(100, Math.floor(p.limit ?? 50)));
      const before = p.before && INBOX_ID_RE.test(p.before) ? p.before : undefined;
      return parseInboxPage(await request('GET', `/bridge/routines/inbox${q({ filter: p.filter ?? 'all', limit, before })}`));
    },
    async get(id: string): Promise<InboxItem> {
      const j = await request('GET', `${itemPath(id)}${q()}`);
      const item = parseInboxItem(isObj(j) ? j.item : undefined);
      if (!item) throw new HermesError('server', 'invalid inbox item response');
      return item;
    },
    async setRead(id: string, read: boolean): Promise<{ item: InboxSummary | null; unreadCount: number }> {
      const j = await request('PATCH', itemPath(id), { hermesProfile, read });
      return { item: parseInboxSummary(isObj(j) ? j.item : undefined), unreadCount: count(isObj(j) ? j.unreadCount : 0) };
    },
    async readAll(): Promise<{ updated: number; unreadCount: number }> {
      const j = await request('POST', '/bridge/routines/inbox/read-all', { hermesProfile });
      return { updated: count(isObj(j) ? j.updated : 0), unreadCount: count(isObj(j) ? j.unreadCount : 0) };
    },
  };
}

export type InboxClient = ReturnType<typeof createInboxClient>;
/** What the screen needs from an inbox (bridge client or the offline demo). */
export type InboxApi = Pick<InboxClient, 'capabilities' | 'list' | 'get' | 'setRead' | 'readAll'>;
