/**
 * The bridge's group routes (bridge/src/groups.mjs). Pure: the fetch is injected (groups/useGroups.ts passes the app's).
 * Errors come back as values (groups/core.ts failureOf), never as server text.
 */
import { serverRootOf } from '../hermes/bots.ts';
import type { FetchLike } from '../hermes/stream.ts';
import { failureOf, parseGroupsList, parseGroupState, type GroupFailure, type GroupInfo, type GroupsList, type GroupState } from './core.ts';

export type Conn = { baseUrl: string; apiKey: string };
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function call(fetchImpl: FetchLike, conn: Conn, method: Method, path: string, body?: unknown, timeoutMs = 15_000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${serverRootOf(conn.baseUrl)}/bridge/groups${path}`, {
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

export type Result<T> = { ok: true; value: T } | { ok: false; failure: GroupFailure };
const fail = <T>(status: number, json: unknown): Result<T> => ({ ok: false, failure: failureOf(status, json) });

/** null = no answer we understand (older bridge, offline, direct Hermes): the app shows no groups. */
export async function fetchGroups(fetchImpl: FetchLike, conn: Conn): Promise<GroupsList | null> {
  const r = await call(fetchImpl, conn, 'GET', '', undefined, 8000);
  return r.status === 200 ? parseGroupsList(r.json) : null;
}

export async function createGroup(fetchImpl: FetchLike, conn: Conn, body: { name: string; members: string[] }): Promise<Result<GroupInfo>> {
  const r = await call(fetchImpl, conn, 'POST', '', body);
  if (r.status !== 201) return fail(r.status, r.json);
  const st = parseGroupState({ group: (r.json as { group?: unknown } | null)?.group, entries: [] });
  return st ? { ok: true, value: st.group } : { ok: false, failure: 'server' };
}

export async function fetchGroup(fetchImpl: FetchLike, conn: Conn, id: string, since = 0): Promise<Result<GroupState>> {
  const r = await call(fetchImpl, conn, 'GET', `/${id}${since ? `?since=${since}` : ''}`);
  if (r.status !== 200) return fail(r.status, r.json);
  const st = parseGroupState(r.json);
  return st ? { ok: true, value: st } : { ok: false, failure: 'server' };
}

export async function sendGroupMessage(fetchImpl: FetchLike, conn: Conn, id: string, text: string): Promise<Result<{ seq: number }>> {
  const r = await call(fetchImpl, conn, 'POST', `/${id}/messages`, { text });
  if (r.status !== 202) return fail(r.status, r.json);
  const seq = (r.json as { seq?: unknown } | null)?.seq;
  return { ok: true, value: { seq: typeof seq === 'number' ? seq : 0 } };
}

export async function stopGroup(fetchImpl: FetchLike, conn: Conn, id: string): Promise<boolean> {
  const r = await call(fetchImpl, conn, 'POST', `/${id}/stop`);
  return r.status === 200;
}

export async function patchGroup(fetchImpl: FetchLike, conn: Conn, id: string, body: { name?: string; members?: string[] }): Promise<Result<GroupInfo>> {
  const r = await call(fetchImpl, conn, 'PATCH', `/${id}`, body);
  if (r.status !== 200) return fail(r.status, r.json);
  const st = parseGroupState({ group: (r.json as { group?: unknown } | null)?.group, entries: [] });
  return st ? { ok: true, value: st.group } : { ok: false, failure: 'server' };
}

export async function deleteGroup(fetchImpl: FetchLike, conn: Conn, id: string): Promise<boolean> {
  const r = await call(fetchImpl, conn, 'DELETE', `/${id}`);
  return r.status === 204 || r.status === 404;
}
