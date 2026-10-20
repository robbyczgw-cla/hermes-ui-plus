/**
 * The bridge's bot routes (bridge/src/bots-manage.mjs) for the create flow: `GET /bridge/bots` (may this device create
 * bots here, and why not) and `POST /bridge/bots`. Pure: the fetch is injected (bots/create/useBotCreate.ts passes the
 * app's). Errors come back as values, never as server text.
 */
import { serverRootOf } from '../../hermes/bots.ts';
import type { FetchLike } from '../../hermes/stream.ts';
import { createFailure, parseBotsConfig, parseCreated, type BotsConfig, type CreatedBot, type CreateFailure } from './core.ts';

type Conn = { baseUrl: string; apiKey: string };

async function call(fetchImpl: FetchLike, conn: Conn, method: 'GET' | 'POST', body: unknown, timeoutMs: number) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${serverRootOf(conn.baseUrl)}/bridge/bots`, {
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
    return { status: res.status, json, aborted: false };
  } catch {
    return { status: 0, json: null, aborted: ctl.signal.aborted };
  } finally {
    clearTimeout(timer);
  }
}

/** null = no answer we understand (older bridge, offline, direct Hermes): the app shows no create button. */
export async function fetchBotsConfig(fetchImpl: FetchLike, conn: Conn, timeoutMs = 8000): Promise<BotsConfig | null> {
  const r = await call(fetchImpl, conn, 'GET', undefined, timeoutMs);
  return r.status === 200 ? parseBotsConfig(r.json) : null;
}

export type CreateResult = { ok: true; bot: CreatedBot } | { ok: false; failure: CreateFailure };

/** Creating a profile takes a few seconds on the server (clone, skills); allow a minute. */
export async function postBot(fetchImpl: FetchLike, conn: Conn, body: unknown, timeoutMs = 60_000): Promise<CreateResult> {
  const r = await call(fetchImpl, conn, 'POST', body, timeoutMs);
  if (r.status === 0) return { ok: false, failure: r.aborted ? { kind: 'server', reason: 'timeout' } : { kind: 'offline' } };
  if (r.status === 201 || r.status === 200) {
    const bot = parseCreated(r.json);
    return bot ? { ok: true, bot } : { ok: false, failure: { kind: 'server', reason: 'unknown' } };
  }
  return { ok: false, failure: createFailure(r.status, r.json) };
}
