import type { TFn } from '../i18n/core.ts';
import { catalogSummary } from '../hermes/capabilities.ts';
import { parseModelIds } from '../onboarding/probe.ts';
import { authFlag } from './saveGuard';
import { normalizeBaseUrl, serverRoot, type ConnectionProfile } from './profiles';

export type CheckResult = { ok: boolean; status?: number; ms: number; detail: string };
export type ConnectionTestResult = { health: CheckResult; models: CheckResult & { ids: string[] } };

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;
const MAX_BODY = 512 * 1024;

/**
 * fetch + (optionally) the body under ONE deadline: the timer runs until the body is read, so a server / proxy that
 * answers the headers and then stalls cannot keep the test spinning (review part 5, finding 10). Without `readBody`
 * the request is released right after the headers.
 */
async function timedFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: FetchFn = (u, i) => fetch(u, i),
  readBody = false,
): Promise<{ res: Response; ms: number; body: string }> {
  const ctrl = new AbortController();
  let onTimeout: () => void = () => undefined;
  const deadline = new Promise<never>((_, reject) => {
    onTimeout = () => {
      ctrl.abort();
      reject(Object.assign(new Error('timeout'), { name: 'AbortError' }));
    };
  });
  deadline.catch(() => undefined);
  const timer = setTimeout(() => onTimeout(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await Promise.race([fetchImpl(url, { ...init, signal: ctrl.signal }), deadline]);
    let body = '';
    if (readBody) body = await Promise.race([res.text(), deadline]);
    else ctrl.abort(); // headers are enough: release the connection
    return { res, ms: Date.now() - t0, body };
  } finally {
    clearTimeout(timer);
  }
}

function describeError(e: unknown, t: TFn): string {
  if (e instanceof Error && e.name === 'AbortError') return t('settings.test.timeout');
  const msg = e instanceof Error ? e.message : String(e);
  return /network|fetch/i.test(msg) ? t('settings.test.unreachable') : msg;
}

/** GET /health (server root, then base URL) and GET /v1/models. Never logs the key. */
export async function testConnection(p: Pick<ConnectionProfile, 'baseUrl' | 'apiKey'>, t: TFn, timeoutMs = 6000, fetchImpl?: FetchFn): Promise<ConnectionTestResult> {
  const base = normalizeBaseUrl(p.baseUrl);
  const headers: Record<string, string> = p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {};

  let health: CheckResult = { ok: false, ms: 0, detail: t('settings.test.notChecked') };
  const healthUrls = Array.from(new Set([`${serverRoot(base)}/health`, `${base}/health`]));
  for (const url of healthUrls) {
    try {
      const { res, ms } = await timedFetch(url, { headers }, timeoutMs, fetchImpl);
      health = { ok: res.ok, status: res.status, ms, detail: res.ok ? t('settings.test.healthOk', { ms }) : t('settings.test.http', { status: res.status }) };
      if (res.ok) break;
    } catch (e) {
      health = { ok: false, ms: 0, detail: describeError(e, t) };
    }
  }

  let models: ConnectionTestResult['models'] = { ok: false, ms: 0, detail: t('settings.test.notChecked'), ids: [] };
  try {
    const { res, ms, body: text } = await timedFetch(`${base}/models`, { headers }, timeoutMs, fetchImpl, true);
    if (res.ok) {
      // only a real model list counts: an HTML login page or garbage is "reachable but not a Hermes/OpenAI API"
      let ids: string[] | null = null;
      if (text.length <= MAX_BODY) {
        try {
          ids = parseModelIds(JSON.parse(text));
        } catch {
          ids = null;
        }
      }
      models = ids
        ? { ok: true, status: res.status, ms, detail: ids.length ? t('settings.test.modelCount', { count: ids.length }) : 'OK', ids }
        : { ok: false, status: res.status, ms, detail: t('settings.test.badResponse'), ids: [] };
    } else {
      models = {
        ok: false,
        status: res.status,
        ms,
        detail: res.status === 401 || res.status === 403 ? t('settings.test.invalidKey') : t('settings.test.http', { status: res.status }),
        ids: [],
      };
    }
  } catch (e) {
    models = { ok: false, ms: 0, detail: describeError(e, t), ids: [] };
  }
  return { health, models };
}

export type TestRow = { label: string; ok: boolean; detail: string; /** failed because the key / token was rejected (saveGuard) */ auth?: boolean };
export type TestView = { rows: TestRow[]; models: string[] };

/**
 * "Verbindung testen" for every profile kind. Texts come from `t`.
 */
export async function runConnectionTest(p: ConnectionProfile, t: TFn): Promise<TestView> {
  switch (p.kind) {
    case 'demo':
      return { rows: [{ label: 'Demo', ok: true, detail: t('settings.test.demoDetail') }], models: [] };
    case 'hermes':
    default: {
      const r = await testConnection(p, t, timeoutDefault);
      // /v1/models only lists the model_routes aliases; the picker offers the provider catalog
      let modelsDetail = r.models.detail;
      if (r.models.ok) {
        try {
          const { fetchModelOptions } = await import('../hermes/client');
          const sum = catalogSummary(await fetchModelOptions({ baseUrl: p.baseUrl, apiKey: p.apiKey }));
          if (sum) modelsDetail = t('onboarding.result.catalog', { models: sum.models, providers: sum.providers });
        } catch {
          // no catalog endpoint: keep the alias count
        }
      }
      return {
        rows: [
          { label: t('settings.test.healthRow'), ok: r.health.ok, detail: r.health.detail, auth: authFlag(r.health.status) },
          { label: t('settings.test.modelsRow'), ok: r.models.ok, detail: modelsDetail, auth: authFlag(r.models.status) },
        ],
        models: r.models.ids,
      };
    }
  }
}

const timeoutDefault = 6000;

