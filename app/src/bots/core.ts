/**
 * Bots as contacts (Bots v2, docs/BOTS-SERVER.md "How the app uses this"): pure, erasable TS (node:test).
 *
 * - A bot is a Hermes profile (hermes/bots.ts). Each bot has ONE thread, its "Bot Chat": the Hermes session titled
 *   exactly "Bot Chat" in that profile, the same thread Hermes Desktop's bot mode shows. The app adopts it (lookup by
 *   title, hidden sessions included) or asks the bridge to create it, and binds a conversation with `botChat: true`.
 * - The drawer's Bots tab lists the default bot ("Hermes") first, then pinned bots, then the rest by last activity.
 *   A row carries at most one badge: approval > unread. "arbeitet …" replaces the last line while a turn runs.
 * - "Wartet auf dich": approvals Hermes is waiting for, from open / running chats and from the bridge's inbox events,
 *   one item per request, oldest first. An approval never silently disappears: it stays until answered, resolved
 *   elsewhere or past its deadline.
 */
import { botOf, DEFAULT_BOT, type HermesBot } from '../hermes/bots.ts';
import type { RemoteSession } from '../hermes/sessions.ts';
import type { ConversationMeta } from '../conversations/types.ts';

/** Title of a bot's one shared thread (Hermes Desktop's bot mode convention; the bridge only creates this title). */
export const BOT_CHAT_TITLE = 'Bot Chat';

/** `default` for the unprefixed profile, else the profile name. */
export function botKey(bot: string | null | undefined): string {
  return botOf(bot) ?? DEFAULT_BOT;
}

/**
 * The Bots tab exists when a Hermes connection has at least one bot besides the default profile, or when this device
 * may create the first one (`createTab`, bots/create/core.ts createShowsTab).
 */
export function botsTabAvailable(kind: string | undefined, bots: readonly HermesBot[], createTab = false): boolean {
  return kind === 'hermes' && (createTab || bots.some((b) => !b.default));
}

/** The bot's Bot Chat conversation on this connection, if the app has one. */
export function findBotChat(items: readonly ConversationMeta[], profileId: string, bot: string | null | undefined): ConversationMeta | undefined {
  const b = botOf(bot);
  return items.find((c) => c.botChat && c.profileId === profileId && botOf(c.hermesProfile) === b);
}

/** An existing conversation of exactly that session (synced earlier as an ordinary chat): adopted, not duplicated. */
export function conversationOfSession(items: readonly ConversationMeta[], profileId: string, bot: string | null | undefined, sessionId: string): ConversationMeta | undefined {
  const b = botOf(bot);
  return items.find((c) => c.profileKind === 'hermes' && c.profileId === profileId && botOf(c.hermesProfile) === b && c.hermesSessionId === sessionId);
}

/** Is this an ordinary chat entry of a Bot Chat session (listed before the Bots tab existed, e.g. Hermes Desktop's)? */
export function isBotChatEntry(c: ConversationMeta): boolean {
  return !!c.botChat || c.remote?.title === BOT_CHAT_TITLE;
}

/**
 * Can the app write into a bot's Bot Chat on this Hermes? Not under the session authority of Hermes v0.22.3+ (unified
 * gateway): there the Bot Chat is a local chat the gateway owns, `/v1/chat/completions` into it is refused with
 * `permission_denied`, but deliveries (reminders, routine results) still land there and stay readable. The authority
 * is the only setup that advertises `features.run_unknown_resolution`; v0.22.2 and older do not (writable as before).
 */
export function botChatReadOnly(flags: Readonly<Record<string, boolean>> | undefined): boolean {
  return flags?.run_unknown_resolution === true;
}

// ------------------------------------------------------------------ session lookup / create answers

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const SESSION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * The Bot Chat row of a `GET /api/sessions?title=Bot%20Chat&include_hidden=1` answer (`data` or `sessions`): only the
 * EXACT title counts (some Hermes versions match the title loosely), the most recently active one wins.
 */
export function pickBotChatRow(json: unknown, parse: (raw: unknown) => RemoteSession | null): RemoteSession | null {
  const j = isObj(json) ? json : {};
  const rows = Array.isArray(j.data) ? j.data : Array.isArray(j.sessions) ? j.sessions : Array.isArray(json) ? (json as unknown[]) : [];
  const hits = rows
    .map(parse)
    .filter((s): s is RemoteSession => !!s && s.title === BOT_CHAT_TITLE && SESSION_ID.test(s.id))
    .sort((a, b) => (b.lastActive ?? b.startedAt) - (a.lastActive ?? a.startedAt));
  return hits[0] ?? null;
}

/** `{session}` of the bridge's / Hermes' create answer, when it is a Bot Chat. */
export function botChatFromAnswer(json: unknown, parse: (raw: unknown) => RemoteSession | null): RemoteSession | null {
  const s = parse(isObj(json) ? json.session : undefined);
  return s && SESSION_ID.test(s.id) && (s.title === BOT_CHAT_TITLE || s.title === undefined) ? { ...s, title: BOT_CHAT_TITLE } : null;
}

// ------------------------------------------------------------------ attention ("Wartet auf dich")

export type AttentionItem = {
  requestId: string;
  runId?: string;
  /** connection (ConnectionProfile id) */
  profileId: string;
  /** Hermes profile; undefined = default */
  bot?: string;
  /** the app conversation the request belongs to, when known */
  conversationId?: string;
  sessionId?: string;
  /** when Hermes started waiting (ms) */
  since: number;
  /** deadline estimate (ms); past it Hermes denied by itself */
  expiresAt?: number;
  /** `chat`: an open / running chat shows the card; `inbox`: the bridge reported it (chat not mounted) */
  source: 'chat' | 'inbox';
};

/** grace after the deadline estimate before an item is dropped (clock skew, a late answer still lands) */
export const ATTENTION_GRACE_MS = 30_000;

export function liveAttention(items: readonly AttentionItem[], now: number): AttentionItem[] {
  return items.filter((i) => !i.expiresAt || i.expiresAt + ATTENTION_GRACE_MS > now);
}

/**
 * App-wide attention store (module state, injected clock). Chats replace their own items on every change
 * (`setChat`: answered cards vanish); inbox events add / resolve single requests. A chat item wins over an inbox item
 * of the same request (it knows the conversation and the exact deadline).
 */
export function createAttentionStore(now: () => number = Date.now) {
  let items: AttentionItem[] = [];
  let version = 0;
  const listeners = new Set<() => void>();
  const emit = () => {
    version++;
    for (const f of Array.from(listeners)) f();
  };
  const set = (next: AttentionItem[]) => {
    if (JSON.stringify(next) === JSON.stringify(items)) return;
    items = next;
    emit();
  };
  return {
    setChat(conversationId: string, list: readonly Omit<AttentionItem, 'source' | 'conversationId'>[]) {
      const mine = list.map((i) => ({ ...i, conversationId, source: 'chat' as const, bot: botOf(i.bot) }));
      const ids = new Set(mine.map((i) => i.requestId));
      set([...items.filter((i) => !(i.source === 'chat' && i.conversationId === conversationId) && !ids.has(i.requestId)), ...mine]);
    },
    addInbox(i: Omit<AttentionItem, 'source'>) {
      if (items.some((x) => x.requestId === i.requestId)) return;
      set([...items, { ...i, bot: botOf(i.bot), source: 'inbox' }]);
    },
    resolve(requestId: string) {
      set(items.filter((i) => i.requestId !== requestId));
    },
    /** live items (past-deadline ones dropped), oldest first */
    snapshot(): AttentionItem[] {
      return liveAttention(items, now()).sort((a, b) => a.since - b.since);
    },
    version: () => version,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    /** tests */
    clear() {
      set([]);
    },
  };
}

export type AttentionStore = ReturnType<typeof createAttentionStore>;

/** Items of one connection; `of(bot)` = items of that bot (an item without a known conversation matches by bot). */
export function attentionOf(items: readonly AttentionItem[], profileId: string): AttentionItem[] {
  return items.filter((i) => i.profileId === profileId);
}

export type WaitingSummary = { count: number; bots: string[]; first: AttentionItem | null };

/** The "Wartet auf dich" row: how many, which bots (keys, oldest first, unique), what a tap opens. */
export function waitingSummary(items: readonly AttentionItem[]): WaitingSummary {
  const bots: string[] = [];
  for (const i of items) {
    const k = botKey(i.bot);
    if (!bots.includes(k)) bots.push(k);
  }
  return { count: items.length, bots, first: items[0] ?? null };
}

// ------------------------------------------------------------------ roster

export type RosterBadge = 'approval' | 'unread' | null;

export type RosterRow = {
  /** `default` or the profile name */
  key: string;
  bot: HermesBot;
  /** the bot's Bot Chat in the app, if any */
  chat?: ConversationMeta;
  /** last activity of the Bot Chat (ms), shown as time */
  time?: number;
  /** a turn of the Bot Chat is running */
  working: boolean;
  /** approvals waiting for this bot */
  waiting: number;
  badge: RosterBadge;
};

export type RosterInput = {
  bots: readonly HermesBot[];
  items: readonly ConversationMeta[];
  profileId: string;
  /** conversation ids with a running turn */
  running: ReadonlySet<string>;
  /** conversation ids with an unseen answer */
  unread: ReadonlySet<string>;
  attention: readonly AttentionItem[];
};

/**
 * Rows of the Bots tab: the default bot first, then pinned bots, then the rest by last activity of their Bot Chat
 * (never-used bots last, by name). Badges never change the order.
 */
export function rosterRows(o: RosterInput): RosterRow[] {
  const rows = o.bots.map((bot): RosterRow => {
    const key = bot.default ? DEFAULT_BOT : bot.name;
    const chat = findBotChat(o.items, o.profileId, bot.default ? undefined : bot.name);
    // an item of a known conversation belongs to that chat only (an approval in an ordinary chat is not the bot's row)
    const waiting = o.attention.filter((i) => i.profileId === o.profileId && (i.conversationId ? i.conversationId === chat?.id : botKey(i.bot) === key)).length;
    const unread = !!chat && o.unread.has(chat.id);
    const hasContent = !!chat && (chat.messageCount > 0 || chat.preview !== '');
    return {
      key,
      bot,
      ...(chat ? { chat } : {}),
      ...(hasContent ? { time: chat.updatedAt } : {}),
      working: !!chat && o.running.has(chat.id),
      waiting,
      badge: waiting ? 'approval' : unread ? 'unread' : null,
    };
  });
  const rank = (r: RosterRow) => (r.bot.default ? 0 : r.bot.pinned ? 1 : 2);
  return rows.sort((a, b) => rank(a) - rank(b) || (b.time ?? 0) - (a.time ?? 0) || a.key.localeCompare(b.key));
}

// ------------------------------------------------------------------ look

/** One letter for the avatar: the first letter / digit of the name, upper case (never an emoji half). */
export function botMonogram(name: string): string {
  const m = /[\p{L}\p{N}]/u.exec(name.trim());
  return m ? m[0].toLocaleUpperCase() : '?';
}

/** Index into the theme's bot palette (stable per bot name). The default bot uses the brand look instead. */
export function botTintIndex(name: string, size: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193);
  return (h >>> 0) % Math.max(1, size);
}

/** Header status line of a bot chat: waiting beats working beats the bot's description. */
export function botStatusKind(o: { working: boolean; waiting: boolean }): 'waiting' | 'working' | 'idle' {
  return o.waiting ? 'waiting' : o.working ? 'working' : 'idle';
}

/**
 * Approval choices in a bot chat: no "for this session" (a Bot Chat never ends, "session" would mean "always" there).
 * Order and the refusable `deny` stay as the server sent them (approvals/approvalModel.ts normalises the rest).
 */
export function botApprovalChoices(choices: readonly string[] | undefined): string[] | undefined {
  if (!choices) return choices;
  const out = choices.filter((c) => c !== 'session');
  // a server that offered only once/session/deny keeps "once" + "deny"
  return out.length ? out : ['once', 'deny'];
}

// ------------------------------------------------------------------ cron deliveries in a Bot Chat

/** `[Cronjob "<name>" output — scheduled job, not the user. …]\n\n<output>` (Hermes' injected row; dash variants tolerated) */
const CRON_INJECT = /^\[Cronjob "([^"\n]{0,200})" output\b[^\]\n]*\]\s*([\s\S]*)$/;

export type CronDelivery = { name: string; output: string; silent: boolean };

/**
 * A job's delivery into a Bot Chat (`deliver: bot-chat`): Hermes injects the job's output as a user-ish row, then the bot
 * comments. Shown as a marker with the output itself (a reminder's text is in this row, not in the comment), never as
 * the user's bubble. Desktop's `[bot:<name>] ` name tag is dropped. null = an ordinary message.
 */
export function cronDelivery(text: string | undefined): CronDelivery | null {
  const m = CRON_INJECT.exec(String(text ?? '').trim());
  if (!m) return null;
  const output = m[2].trim();
  return { name: m[1].replace(/^\[bot:[^\]]*\]\s*/, '').trim(), output, silent: /^\[?SILENT\]?\b/i.test(output) };
}

/** The output as one calm plain text block: fenced blocks and Markdown marks dropped (the bot's comment carries cards). */
export function cronPlainText(output: string): string {
  return output
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>)\s+/gm, '')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
