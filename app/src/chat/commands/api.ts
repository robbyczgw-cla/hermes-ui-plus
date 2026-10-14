/**
 * Hermes API calls behind slash commands (pure builders + parsers, tested; transport injected).
 *
 * Bridge allow-lists (bridge/src/bridge.mjs `apiAllowed` / `v1Allowed`, checked 2026-10-12): GET/PATCH/DELETE
 * /api/sessions/{id}, POST /api/sessions/{id}/fork (/branch) and GET /v1/skills pass; other /v1 paths are refused.
 *
 * /title uses the existing session client (conversations/hermesSync `remote.rename` → PATCH /api/sessions/{id}).
 */
import { parseSession, type JsonRequest, type RemoteSession } from '../../hermes/sessions.ts';
import { HermesError } from '../../hermes/stream.ts';

export type ApiRequest = { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; path: string; body?: unknown };

const sessionPath = (id: string) => `/api/sessions/${encodeURIComponent(id)}`;

export const requests = {
  /** /title */
  rename: (id: string, title: string): ApiRequest => ({ method: 'PATCH', path: sessionPath(id), body: { title } }),
  /** /branch: copies ALL messages into a new session and ends the source as `branched` */
  fork: (id: string, title?: string): ApiRequest => ({ method: 'POST', path: `${sessionPath(id)}/fork`, body: title ? { title } : {} }),
  /** /usage, /status */
  session: (id: string): ApiRequest => ({ method: 'GET', path: sessionPath(id) }),
  /** /skills */
  skills: (): ApiRequest => ({ method: 'GET', path: '/v1/skills' }),
};

export function send(request: JsonRequest, r: ApiRequest): Promise<unknown> {
  return request(r.method, r.path, r.body);
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const ms = (v: unknown): number | undefined => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  return n === undefined ? undefined : Math.round(n < 1e11 ? n * 1000 : n);
};

/**
 * Token view of a session (GET /api/sessions/{id}). Cost fields (`estimated_cost_usd`, `actual_cost_usd`) are
 * deliberately dropped: the user does not want costs in the app.
 */
export type SessionUsage = {
  id: string;
  title?: string;
  model?: string;
  messages?: number;
  toolCalls?: number;
  apiCalls?: number;
  startedAt?: number;
  lastActive?: number;
  endReason?: string;
  tokens: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; reasoning?: number; total?: number };
};

export function parseSessionUsage(json: unknown): SessionUsage | null {
  const s = isObj(json) && isObj(json.session) ? json.session : null;
  const id = s && str(s.id);
  if (!s || !id) return null;
  const tokens: SessionUsage['tokens'] = {};
  const put = (k: keyof SessionUsage['tokens'], v: unknown) => {
    const n = count(v);
    if (n !== undefined) tokens[k] = n;
  };
  put('input', s.input_tokens);
  put('output', s.output_tokens);
  put('cacheRead', s.cache_read_tokens);
  put('cacheWrite', s.cache_write_tokens);
  put('reasoning', s.reasoning_tokens);
  if (tokens.input !== undefined || tokens.output !== undefined) tokens.total = (tokens.input ?? 0) + (tokens.output ?? 0);
  const out: SessionUsage = { id, tokens };
  const set = <K extends keyof SessionUsage>(k: K, v: SessionUsage[K] | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  set('title', str(s.title));
  set('model', str(s.model));
  set('messages', count(s.message_count));
  set('toolCalls', count(s.tool_call_count));
  set('apiCalls', count(s.api_call_count));
  set('startedAt', ms(s.started_at));
  set('lastActive', ms(s.last_active));
  set('endReason', str(s.end_reason));
  return out;
}

export type Skill = { name: string; description?: string; category?: string };

/** GET /v1/skills → `{object:'list', data:[{name, description, category, …}]}` */
export function parseSkills(json: unknown): Skill[] {
  const data = isObj(json) && Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
  const out: Skill[] = [];
  for (const raw of data) {
    if (!isObj(raw)) continue;
    const name = str(raw.name);
    if (!name) continue;
    const sk: Skill = { name };
    const d = str(raw.description);
    if (d) sk.description = d.length > 240 ? `${d.slice(0, 239)}…` : d;
    const c = str(raw.category);
    if (c) sk.category = c;
    out.push(sk);
  }
  return out;
}

/** POST …/fork → the new session (`{object:'hermes.session', session:{…}}`) */
export function parseFork(json: unknown): RemoteSession | null {
  return parseSession(isObj(json) ? json.session : undefined);
}

export async function fetchUsage(request: JsonRequest, sessionId: string): Promise<SessionUsage | null> {
  return parseSessionUsage(await send(request, requests.session(sessionId)));
}

export async function fetchSkills(request: JsonRequest): Promise<Skill[]> {
  return parseSkills(await send(request, requests.skills()));
}

export async function forkSession(request: JsonRequest, sessionId: string): Promise<RemoteSession | null> {
  return parseFork(await send(request, requests.fork(sessionId)));
}

/**
 * /skills failure → what the sheet shows: a friendly localized headline (`kind`) and the raw server text as
 * `details` (HTTP status + code + message, collapsed in the UI). Hermes 0.21.4 answers 500 "Failed to enumerate
 * skills" (its own bug); /api/skills exists only on the dashboard (:9119, other auth), not on the API server
 * and not behind the bridge allow-list, so there is no fallback endpoint.
 */
export type SkillsError = { kind: 'auth' | 'failed' | 'hermesBug'; details: string };

/** Hermes ≥ 0.21.5 `GET /v1/skills` always answers 500 (stray `include_editorial` kwarg, upstream issue #120831). */
const KNOWN_SKILLS_BUG = /failed to enumerate skills|include_editorial/i;

export function skillsError(e: unknown): SkillsError {
  if (e instanceof HermesError) {
    const parts = [e.status ? `HTTP ${e.status}` : '', e.code ?? '', e.message].filter(Boolean);
    const details = parts.join(' · ');
    if (e.kind === 'auth') return { kind: 'auth', details };
    return { kind: e.status === 500 && KNOWN_SKILLS_BUG.test(e.message) ? 'hermesBug' : 'failed', details };
  }
  return { kind: 'failed', details: e instanceof Error ? e.message : String(e) };
}
