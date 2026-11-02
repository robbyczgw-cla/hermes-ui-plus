/**
 * The bridge's routes behind "Über <Name>" and the working dot (bridge/src/bots-manage.mjs, bots-activity.mjs):
 *   GET  /bridge/bots/<name>/allowlist                 "Immer erlaubt" of one bot (`default` = the default bot)
 *   POST /bridge/bots/<name>/allowlist/revoke {pattern}
 *   POST /bridge/bots/<name>/archive | /restore        Hermes' gateway.parked (never the default bot)
 *   GET  /bridge/bots/activity                         running turns / routines per bot
 *   GET / PATCH /bridge/bots/<name>                    the three fields ("So arbeitet <Name>", slice 3 API)
 * Pure: the fetch is injected. Answers come back as values; server text never reaches the UI.
 */
import { DEFAULT_BOT, serverRootOf } from '../hermes/bots.ts';
import type { FetchLike } from '../hermes/stream.ts';
import { parseAllowList, type AllowList } from './about.ts';
import { parseActivity, UNKNOWN_ACTIVITY, type ActivitySnapshot } from './activity.ts';

type Conn = { baseUrl: string; apiKey: string };
type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

async function call(fetchImpl: FetchLike, conn: Conn, method: 'GET' | 'POST' | 'PATCH', path: string, body: unknown, timeoutMs: number) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${serverRootOf(conn.baseUrl)}${path}`, {
      method,
      headers: { Authorization: `Bearer ${conn.apiKey}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: ctl.signal,
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json };
  } catch {
    return { status: 0, json: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Why a call failed, in the app's words (bots.info.fail.*). */
export type AboutFailure = 'offline' | 'unsupported' | 'forbidden' | 'notFound' | 'parkedElsewhere' | 'server';

function failureOf(status: number, json: unknown): AboutFailure {
  const code = isObj(json) && isObj(json.error) && typeof json.error.code === 'string' ? json.error.code : '';
  if (status === 0) return 'offline';
  if (code === 'parked_elsewhere') return 'parkedElsewhere';
  if (status === 403 || code === 'bots_forbidden') return 'forbidden';
  if (code === 'not_found') return 'notFound';
  // an older bridge without the route, or no plugin behind it
  if (status === 404 || status === 405 || code === 'bots_unavailable') return 'unsupported';
  return 'server';
}

const seg = (bot: string | null | undefined) => encodeURIComponent(bot || DEFAULT_BOT);

export type AllowResult = { ok: true; list: AllowList } | { ok: false; failure: AboutFailure; reason?: string };

const reasonOf = (json: unknown) => (isObj(json) && isObj(json.error) && typeof json.error.reason === 'string' && /^[a-z_]{2,40}$/.test(json.error.reason) ? json.error.reason : undefined);

export async function fetchAllowList(fetchImpl: FetchLike, conn: Conn, bot: string | null | undefined, timeoutMs = 10_000): Promise<AllowResult> {
  const r = await call(fetchImpl, conn, 'GET', `/bridge/bots/${seg(bot)}/allowlist`, undefined, timeoutMs);
  const list = r.status === 200 ? parseAllowList(r.json) : null;
  if (list) return { ok: true, list };
  const reason = reasonOf(r.json);
  return { ok: false, failure: r.status === 200 ? 'server' : failureOf(r.status, r.json), ...(reason ? { reason } : {}) };
}

export async function revokeAllowed(fetchImpl: FetchLike, conn: Conn, bot: string | null | undefined, pattern: string, timeoutMs = 15_000): Promise<AllowResult> {
  const r = await call(fetchImpl, conn, 'POST', `/bridge/bots/${seg(bot)}/allowlist/revoke`, { pattern }, timeoutMs);
  const list = r.status === 200 ? parseAllowList(r.json) : null;
  if (list) return { ok: true, list };
  const reason = reasonOf(r.json);
  return { ok: false, failure: r.status === 200 ? 'server' : failureOf(r.status, r.json), ...(reason ? { reason } : {}) };
}

export type ParkResult = { ok: true } | { ok: false; failure: AboutFailure; reason?: string };

/** Archive (`archive`) or bring back (`restore`) a bot; the default bot is never archived. */
export async function parkBot(fetchImpl: FetchLike, conn: Conn, bot: string, action: 'archive' | 'restore', timeoutMs = 20_000): Promise<ParkResult> {
  if (!bot || bot === DEFAULT_BOT) return { ok: false, failure: 'forbidden' };
  const r = await call(fetchImpl, conn, 'POST', `/bridge/bots/${seg(bot)}/${action}`, {}, timeoutMs);
  if (r.status === 200 && isObj(r.json) && isObj(r.json.bot)) return { ok: true };
  const reason = reasonOf(r.json);
  return { ok: false, failure: r.status === 200 ? 'server' : failureOf(r.status, r.json), ...(reason ? { reason } : {}) };
}

/** Running work per bot; UNKNOWN_ACTIVITY when this server cannot tell (older bridge, offline). */
export async function fetchActivity(fetchImpl: FetchLike, conn: Conn, timeoutMs = 6000): Promise<ActivitySnapshot> {
  const r = await call(fetchImpl, conn, 'GET', '/bridge/bots/activity', undefined, timeoutMs);
  return r.status === 200 ? parseActivity(r.json) : UNKNOWN_ACTIVITY;
}

/** Stop a turn of a Bot Chat that this device does not stream (another device / a lost stream): the bridge holds it. */
export async function stopRemoteTurn(fetchImpl: FetchLike, conn: Conn, bot: string | null | undefined, sessionId: string, timeoutMs = 10_000): Promise<{ ok: boolean; stopped: number }> {
  const r = await call(fetchImpl, conn, 'POST', '/bridge/chat/stop', { sessionId, ...(bot && bot !== DEFAULT_BOT ? { profile: bot } : {}) }, timeoutMs);
  const stopped = isObj(r.json) && typeof r.json.stopped === 'number' ? r.json.stopped : 0;
  return { ok: r.status === 200, stopped };
}

export type BotFields = { title: string; job: string; how: string; app: boolean };

function parseFields(json: unknown): BotFields | null {
  const b = isObj(json) && isObj(json.bot) ? json.bot : null;
  if (!b || typeof b.title !== 'string') return null;
  const s = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  return { title: s(b.title, 40), job: s(b.job, 160), how: s(b.how, 2000), app: b.app === true };
}

/** The three fields of a bot for "So arbeitet <Name>"; null when this device may not read them or the route is missing. */
export async function fetchBotFields(fetchImpl: FetchLike, conn: Conn, bot: string, timeoutMs = 10_000): Promise<BotFields | null> {
  if (!bot || bot === DEFAULT_BOT) return null;
  const r = await call(fetchImpl, conn, 'GET', `/bridge/bots/${seg(bot)}`, undefined, timeoutMs);
  return r.status === 200 ? parseFields(r.json) : null;
}

export type SaveResult = { ok: true; fields: BotFields | null } | { ok: false; failure: AboutFailure | 'exists' | 'invalid'; field?: string };

export async function patchBotFields(fetchImpl: FetchLike, conn: Conn, bot: string, body: { title: string; job: string; how: string; lang?: string }, timeoutMs = 30_000): Promise<SaveResult> {
  const r = await call(fetchImpl, conn, 'PATCH', `/bridge/bots/${seg(bot)}`, body, timeoutMs);
  if (r.status === 200) return { ok: true, fields: null };
  const err = isObj(r.json) && isObj(r.json.error) ? r.json.error : {};
  if (r.status === 409 && err.code === 'exists') return { ok: false, failure: 'exists', field: 'title' };
  if (r.status === 400 && err.code === 'invalid_field') return { ok: false, failure: 'invalid', ...(typeof err.field === 'string' ? { field: err.field } : {}) };
  return { ok: false, failure: failureOf(r.status, r.json) };
}
