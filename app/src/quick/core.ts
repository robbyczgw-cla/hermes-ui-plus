/**
 * Quick answers ("Schnellfrage") – pure logic, tested in core.test.ts.
 *
 *   GET  {origin}/bridge/quick/config               Bearer → {available, model, provider, limits, allowModelOverride, streaming}
 *   POST {origin}/bridge/quick/v1/chat/completions  Bearer, {messages (≤ 6 turns, ≤ 4000 chars each), stream, provider?, model?}
 *                                                   → OpenAI-compatible SSE (chat.completion.chunk … usage … [DONE])
 *   errors {error:{message,type,code}}: 404 feature_off (Hermes plugin absent / off), 429 rate_limited + Retry-After,
 *   400 unknown_model / unknown_provider / override_disabled, 503 catalog_unavailable, 504 timeout.
 *
 * Backend: bridge/src/quick.mjs → the optional Hermes plugin (hermes-plugin/, docs/HERMES-PLUGIN.md). Quick answers are
 * not Hermes chats: one local thread per connection, entries expire after 24 h, nothing is synced to Hermes.
 */
import type { ChatMessage, QuickStamp } from '../hermes/types.ts';
import { botOf } from '../hermes/bots.ts';

export const QUICK_LIMITS = {
  /** user/assistant messages per request (bridge + plugin cap) */
  turns: 6,
  /** characters per message (plugin cap) */
  charsPerTurn: 4000,
  /** a question and its answer leave the local thread after this long */
  ttlMs: 24 * 60 * 60 * 1000,
  /** messages kept in the local thread at most */
  storeMax: 120,
  /** GET /bridge/quick/config */
  configTimeoutMs: 5000,
  /** availability is re-checked after this long (foreground / reconnect force it earlier) */
  configTtlMs: 10 * 60 * 1000,
} as const;

/** the bridge a quick question goes to (a Hermes profile with `bridge: true`) */
export type QuickConn = { baseUrl: string; apiKey: string };
/** bridge, or the offline demo's canned backend (quick/demo.ts) */
export type QuickBackend = { kind: 'bridge'; conn: QuickConn } | { kind: 'demo' };

export type QuickConfig = {
  available: boolean;
  /** model of the last answered request (the plugin only learns its route on the first answer); null = unknown yet */
  model: string | null;
  provider: string | null;
  /** per device (bridge) */
  perMinute?: number;
  perDay?: number;
  /** the server accepts a provider/model override */
  allowModelOverride: boolean;
};

/** a picked quick model (Settings → Schnellfrage); undefined = the server default ("Hermes-Standard") */
export type QuickModel = { provider: string; model: string };

/** Structural subset of settings/profiles ConnectionProfile (no cross-module import). */
export type ProfileLike = { kind: string; baseUrl: string; apiKey: string; bridge?: boolean };

/** node-state scope (card state) and shell id of a connection's quick thread – never a stored conversation */
export const quickConversationId = (profileId: string) => `quick:${profileId}`;

export function bridgeOrigin(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}
export const quickConfigUrl = (baseUrl: string) => `${bridgeOrigin(baseUrl)}/bridge/quick/config`;
export const quickChatUrl = (baseUrl: string) => `${bridgeOrigin(baseUrl)}/bridge/quick/v1/chat/completions`;

/** Quick needs the UI bridge (Hermes profile with `bridge: true`) – or it is the offline demo. Everything else: null. */
export function quickBackendFor(p: ProfileLike | null | undefined): QuickBackend | null {
  if (!p) return null;
  if (p.kind === 'demo' || /^demo:/i.test(p.baseUrl)) return { kind: 'demo' };
  if (p.kind !== 'hermes' || !p.bridge || !p.apiKey || !/^https?:\/\//i.test(p.baseUrl.trim())) return null;
  return { kind: 'bridge', conn: { baseUrl: p.baseUrl, apiKey: p.apiKey } };
}

/**
 * The connection whose quick answers a chat may offer: none in a bot chat (Hermes profile, `meta.hermesProfile`). The
 * plugin serves the whole gateway with one quick model, not one per profile, so ⚡ there would answer as "the server",
 * not as the bot. Only the chat's ⚡ entries are hidden; the quick thread itself belongs to the connection.
 */
export function quickProfileFor<T extends ProfileLike>(p: T | null | undefined, bot: string | null | undefined): T | null {
  return !p || botOf(bot) ? null : p;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Body of GET /bridge/quick/config → QuickConfig; anything unexpected = not available. */
export function parseQuickConfig(json: unknown): QuickConfig {
  const off: QuickConfig = { available: false, model: null, provider: null, allowModelOverride: false };
  if (!json || typeof json !== 'object') return off;
  const j = json as Record<string, unknown>;
  if (j.available !== true) return off;
  const limits = j.limits && typeof j.limits === 'object' ? (j.limits as Record<string, unknown>) : {};
  return {
    available: true,
    model: strOrNull(j.model),
    provider: strOrNull(j.provider),
    perMinute: num(limits.perDeviceMinute),
    perDay: num(limits.perDeviceDay),
    allowModelOverride: j.allowModelOverride === true,
  };
}

// ───────────────────────── request ─────────────────────────

export type QuickTurn = { role: 'user' | 'assistant'; content: string };

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.ceil(max * 0.6);
  return `${text.slice(0, head)} […] ${text.slice(text.length - (max - head - 7))}`;
}

/**
 * What goes to the bridge: complete earlier pairs (question + finished answer; failed / stopped turns are left out
 * so roles alternate) and the new question, at most QUICK_LIMITS.turns messages, each clipped to the per-turn cap.
 * Starts with a user message. Returns null when the question itself is too long for a quick answer.
 */
export function buildQuickHistory(messages: readonly Pick<ChatMessage, 'role' | 'text' | 'status'>[], question: string): QuickTurn[] | null {
  const q = question.trim();
  if (!q || q.length > QUICK_LIMITS.charsPerTurn) return null;
  const pairs: QuickTurn[][] = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const u = messages[i];
    const a = messages[i + 1];
    if (u.role !== 'user' || a.role !== 'assistant' || a.status !== 'done' || !u.text.trim() || !a.text.trim()) continue;
    pairs.push([
      { role: 'user', content: clip(u.text.trim(), QUICK_LIMITS.charsPerTurn) },
      { role: 'assistant', content: clip(a.text.trim(), QUICK_LIMITS.charsPerTurn) },
    ]);
  }
  const keep = Math.floor((QUICK_LIMITS.turns - 1) / 2);
  return [...pairs.slice(-keep).flat(), { role: 'user', content: q }];
}

export function buildQuickRequest(
  conn: QuickConn,
  history: readonly QuickTurn[],
  o: { model?: QuickModel; lang?: string } = {},
): { url: string; headers: Record<string, string>; body: string } {
  return {
    url: quickChatUrl(conn.baseUrl),
    headers: { Authorization: `Bearer ${conn.apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      messages: history,
      stream: true,
      ...(o.model ? { provider: o.model.provider, model: o.model.model } : {}),
      ...(o.lang ? { lang: o.lang } : {}),
    }),
  };
}

// ───────────────────────── local thread ─────────────────────────

/**
 * Drop everything asked more than `ttlMs` ago: the thread is cut before the first question that is still fresh
 * (its answer and later turns stay). Leading answers without their question go too. Same array when unchanged.
 */
export function pruneExpired<T extends Pick<ChatMessage, 'role' | 'createdAt'>>(messages: readonly T[], now: number, ttlMs: number = QUICK_LIMITS.ttlMs): readonly T[] {
  const cutoff = now - ttlMs;
  const i = messages.findIndex((m) => m.role === 'user' && m.createdAt >= cutoff);
  if (i === 0) return messages;
  if (i === -1) return messages.length ? [] : messages;
  return messages.slice(i);
}

/** Newest questions win when the thread grows past `max` messages (cut at a question). */
export function capThread<T extends Pick<ChatMessage, 'role'>>(messages: readonly T[], max: number = QUICK_LIMITS.storeMax): readonly T[] {
  if (messages.length <= max) return messages;
  let start = messages.length - max;
  while (start < messages.length && messages[start].role !== 'user') start++;
  return messages.slice(start);
}

/** when the oldest entry of the thread expires (ms), or undefined for an empty thread */
export function nextExpiry(messages: readonly Pick<ChatMessage, 'role' | 'createdAt'>[], ttlMs: number = QUICK_LIMITS.ttlMs): number | undefined {
  const first = messages.find((m) => m.role === 'user');
  return first ? first.createdAt + ttlMs : undefined;
}

/** "⚡ model · 1,6 s" data of a finished answer: time to first token (else total time), model as reported. */
export function quickStampOf(m: Pick<ChatMessage, 'createdAt' | 'metrics'>, fallbackModel?: string | null): QuickStamp {
  const first = m.metrics?.firstTokenAt;
  const end = m.metrics?.endedAt;
  const at = first ?? end;
  const ms = at !== undefined && at >= m.createdAt ? at - m.createdAt : undefined;
  const model = m.metrics?.model?.trim() || fallbackModel?.trim() || undefined;
  return { ...(model ? { model } : {}), ...(ms !== undefined ? { ms } : {}) };
}

/** a model id as shown in the meta line: provider prefixes (`provider/model`, `provider::model`) dropped */
export function shortModel(model: string | undefined): string | undefined {
  if (!model) return undefined;
  const last = model.trim().split('::').pop()!.split('/').pop()!.trim();
  return last || undefined;
}

// ───────────────────────── errors ─────────────────────────

export type QuickFailure =
  | { kind: 'rate_limited'; retryAfter?: number }
  | { kind: 'feature_off' }
  | { kind: 'model_rejected' }
  | { kind: 'other' };

/** Classify a thrown (Hermes-style) error: `status`, `code`, `retryAfter` as set by hermes/stream.ts errorFromResponse. */
export function quickFailureOf(e: unknown): QuickFailure {
  if (!e || typeof e !== 'object') return { kind: 'other' };
  const x = e as { status?: unknown; code?: unknown; retryAfter?: unknown };
  const status = typeof x.status === 'number' ? x.status : undefined;
  const code = typeof x.code === 'string' ? x.code : undefined;
  if (status === 429) return { kind: 'rate_limited', retryAfter: typeof x.retryAfter === 'number' && x.retryAfter >= 0 ? x.retryAfter : undefined };
  // 404 without a code = a bridge that has no quick route at all
  if (status === 404 && (code === 'feature_off' || code === undefined)) return { kind: 'feature_off' };
  if (status === 400 && (code === 'unknown_model' || code === 'unknown_provider' || code === 'override_disabled' || code === 'provider_required')) return { kind: 'model_rejected' };
  return { kind: 'other' };
}

/** Retry-After seconds → the largest sensible unit for "wieder in …" (s below 90 s, min below 90 min, else h). */
export function waitParts(seconds: number): { unit: 's' | 'min' | 'h'; value: number } {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 90) return { unit: 's', value: s };
  if (s < 90 * 60) return { unit: 'min', value: Math.ceil(s / 60) };
  return { unit: 'h', value: Math.ceil(s / 3600) };
}

// ───────────────────────── hand-off ─────────────────────────

/**
 * "Mit Hermes weitermachen": the question and the quick answer that become the first (copied) turns of a new Hermes
 * chat. The new chat sends them as a marked context block with the user's next message (hermes/turnOverride.ts,
 * branchSeedText – quick answers get their own label). null when the answer is not a finished quick answer.
 */
export function handOffMessages(messages: readonly ChatMessage[], answerId: string): ChatMessage[] | null {
  const i = messages.findIndex((m) => m.id === answerId);
  if (i < 1) return null;
  const a = messages[i];
  if (a.role !== 'assistant' || a.status !== 'done' || !a.text.trim()) return null;
  let q = i - 1;
  while (q >= 0 && messages[q].role !== 'user') q--;
  if (q < 0) return null;
  const strip = (m: ChatMessage): ChatMessage => {
    const { approval: _a, pendingApprovals: _p, statusNote: _s, ...rest } = m;
    return rest;
  };
  return [strip(messages[q]), { ...strip(a), quick: a.quick ?? {} }];
}

/** title of the handed-over chat: the question, one line, ≤ 60 chars */
export function handOffTitle(question: string): string {
  const one = question.replace(/\s+/g, ' ').trim();
  return one.length > 60 ? `${one.slice(0, 57).trimEnd()}…` : one;
}

// ───────────────────────── persistence (pure parts of store.ts) ─────────────────────────

type StoredThread = { v: 1; messages: ChatMessage[] };

function isMessage(x: unknown): x is ChatMessage {
  if (!x || typeof x !== 'object') return false;
  const m = x as Record<string, unknown>;
  return typeof m.id === 'string' && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && typeof m.createdAt === 'number' && typeof m.status === 'string';
}

/** stored thread → messages (malformed entries dropped, expired ones pruned, an unfinished answer stored as stopped) */
export function parseStoredThread(raw: string | null | undefined, now: number): ChatMessage[] {
  if (!raw) return [];
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = j && typeof j === 'object' && Array.isArray((j as StoredThread).messages) ? (j as StoredThread).messages : [];
  const msgs = list.filter(isMessage).map((m) => ({ ...m, tools: Array.isArray(m.tools) ? m.tools : [], ...(m.status === 'streaming' ? { status: 'stopped' as const } : {}) }));
  return [...pruneExpired(msgs, now)];
}

/** messages → stored JSON (transient fields dropped, unfinished answers stored as stopped, capped) */
export function serializeThread(messages: readonly ChatMessage[]): string {
  const clean = capThread(messages).map((m) => {
    const { approval: _a, pendingApprovals: _p, statusNote: _s, reasoning: _r, ...rest } = m;
    return rest.status === 'streaming' ? { ...rest, status: 'stopped' as const } : rest;
  });
  return JSON.stringify({ v: 1, messages: clean } satisfies StoredThread);
}

export type QuickSettings = {
  /** "⚡ im Eingabefeld anzeigen" (the toggle in the Hermes composer; long-press on Send stays) */
  showInComposer: boolean;
  /** picked quick model per connection (profile id); missing = the server default */
  models: Record<string, QuickModel>;
};
export const DEFAULT_QUICK_SETTINGS: QuickSettings = { showInComposer: true, models: {} };

const ID_RE = /^[A-Za-z0-9_.:\/@+-]{1,200}$/;

export function parseQuickSettings(raw: string | null | undefined): QuickSettings {
  if (!raw) return DEFAULT_QUICK_SETTINGS;
  try {
    const j = JSON.parse(raw) as Partial<QuickSettings>;
    const models: Record<string, QuickModel> = {};
    if (j.models && typeof j.models === 'object') {
      for (const [k, v] of Object.entries(j.models)) {
        if (v && typeof v === 'object' && typeof v.provider === 'string' && typeof v.model === 'string' && ID_RE.test(v.provider) && ID_RE.test(v.model)) {
          models[k] = { provider: v.provider, model: v.model };
        }
      }
    }
    return { showInComposer: j.showInComposer !== false, models };
  } catch {
    return DEFAULT_QUICK_SETTINGS;
  }
}
