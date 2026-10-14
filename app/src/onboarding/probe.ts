// Connection test for onboarding: GET <root>/health (no key) and GET <base>/models (with key).
// Detects the UI bridge via `X-Hermes-UI-Bridge: 1`. `fetch` is injectable → tested in probe.test.ts.
// Never logs or returns the key.
import { catalogSummary, parseModelOptions } from '../hermes/capabilities.ts';
import { classifyFetchError, classifyStatus, type ConnError, type Platform } from './errors.ts';
import type { NormalizedUrl } from './url.ts';

export type FetchLike = (url: string, init: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export type ProbeOptions = {
  platform: Platform;
  /** web: window.location.protocol */
  pageProtocol?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  /** abort the whole probe (screen left) */
  signal?: AbortSignal;
};

export type ProbeResult = {
  ok: boolean;
  /** `X-Hermes-UI-Bridge: 1` seen on /health or /models */
  bridge: boolean;
  /** /health reported `platform: hermes-agent` */
  hermes: boolean;
  version?: string;
  models: string[];
  /** Hermes provider catalog (GET /api/model/options): what the model picker really offers */
  catalog?: { models: number; providers: number };
  /** latency of the /models request (or /health if models failed) */
  ms: number;
  error?: ConnError;
};

export const BRIDGE_HEADER = 'X-Hermes-UI-Bridge';
const MAX_BODY = 512 * 1024;

const MAX_CATALOG_BODY = 4 * 1024 * 1024;

function parseJson(text: string, max = MAX_BODY): unknown {
  if (text.length > max) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** `/v1/models` body → model ids (OpenAI shape `{data:[{id}]}`); null if the body isn't that shape. */
export function parseModelIds(body: unknown): string[] | null {
  if (!isObj(body) || !Array.isArray(body.data)) return null;
  const ids: string[] = [];
  for (const m of body.data) {
    if (isObj(m) && typeof m.id === 'string' && m.id && m.id.length <= 200) ids.push(m.id);
    if (ids.length >= 500) break;
  }
  return ids;
}

export async function probeConnection(
  conn: { url: NormalizedUrl; apiKey: string },
  opts: ProbeOptions,
): Promise<ProbeResult> {
  const doFetch: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  const timeoutMs = opts.timeoutMs ?? 8000;
  const ctx = { platform: opts.platform, url: conn.url, pageProtocol: opts.pageProtocol };
  const key = conn.apiKey.trim();

  async function get(url: string, withKey: boolean, maxBody = MAX_BODY) {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    opts.signal?.addEventListener('abort', onAbort);
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const t0 = Date.now();
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (withKey && key) headers.Authorization = `Bearer ${key}`;
      const res = await doFetch(url, { method: 'GET', headers, signal: ctrl.signal });
      const text = await res.text().catch(() => '');
      return { res, body: parseJson(text, maxBody), ms: Date.now() - t0, bridge: res.headers.get(BRIDGE_HEADER) === '1' };
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  const result: ProbeResult = { ok: false, bridge: false, hermes: false, models: [], ms: 0 };

  // 1) health – unauthenticated; Hermes serves it at the root and under /v1.
  let healthLooksWrong = false;
  for (const url of [`${conn.url.root}/health`, `${conn.url.baseUrl}/health`]) {
    try {
      const r = await get(url, false);
      result.ms = r.ms;
      result.bridge ||= r.bridge;
      if (r.res.ok) {
        if (isObj(r.body)) {
          result.hermes = r.body.platform === 'hermes-agent';
          if (typeof r.body.version === 'string') result.version = r.body.version.slice(0, 40);
        } else healthLooksWrong = true; // HTML page etc.
        break;
      }
      if (r.res.status !== 404) break;
    } catch (e) {
      if (opts.signal?.aborted) return { ...result, error: { kind: 'timeout', host: conn.url.host } };
      // Nothing reachable: /models would fail the same way – report the more informative first error.
      return { ...result, error: classifyFetchError(e, ctx) };
    }
  }

  // 2) models – authenticated
  try {
    const r = await get(`${conn.url.baseUrl}/models`, true);
    result.ms = r.ms;
    result.bridge ||= r.bridge;
    if (!r.res.ok) return { ...result, error: classifyStatus(r.res.status, { host: conn.url.host, path: '/v1/models', hasKey: !!key }) };
    const ids = parseModelIds(r.body);
    if (ids === null) return { ...result, error: { kind: 'notHermes', host: conn.url.host, status: r.res.status } };
    // 3) provider catalog – optional; the alias list above is only the model_routes, not the picker
    try {
      const c = await get(`${conn.url.root}/api/model/options`, true, MAX_CATALOG_BODY);
      const sum = c.res.ok ? catalogSummary(parseModelOptions(c.body)) : null;
      if (sum) result.catalog = sum;
    } catch {
      // older Hermes / bridge without the endpoint: keep the alias count
    }
    return { ...result, ok: true, models: ids };
  } catch (e) {
    if (opts.signal?.aborted) return { ...result, error: { kind: 'timeout', host: conn.url.host } };
    const err = classifyFetchError(e, ctx);
    return { ...result, error: healthLooksWrong && err.kind === 'network' ? { kind: 'notHermes', host: conn.url.host } : err };
  }
}
