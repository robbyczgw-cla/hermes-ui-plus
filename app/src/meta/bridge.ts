/** fetchMeta(): POST /bridge/meta (contract in core.ts). Uses the global fetch (RN, web, node). */
import type { Lang } from '../i18n/core';
import { META_LIMITS, MetaError, metaUrl, parseMetaResponse } from './core';
import type { MetaConn, MetaResult, MetaTurn, MetaWant } from './core';

export async function fetchMeta(
  bridge: MetaConn,
  messages: readonly MetaTurn[],
  want: readonly MetaWant[] = ['title', 'followups'],
  o: { lang?: Lang; signal?: AbortSignal; timeoutMs?: number; fetch?: typeof fetch } = {},
): Promise<MetaResult> {
  const ctrl = new AbortController();
  let timedOut = false;
  const t = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, o.timeoutMs ?? META_LIMITS.timeoutMs);
  const onAbort = () => ctrl.abort();
  if (o.signal?.aborted) ctrl.abort();
  else o.signal?.addEventListener('abort', onAbort);
  try {
    const res = await (o.fetch ?? fetch)(metaUrl(bridge.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(bridge.apiKey ? { Authorization: `Bearer ${bridge.apiKey}` } : {}),
      },
      body: JSON.stringify({ messages: messages.slice(-META_LIMITS.turns), want, ...(o.lang ? { lang: o.lang } : {}) }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      let code = '';
      try {
        code = JSON.parse(text)?.error?.code ?? '';
      } catch {
        /* not JSON */
      }
      if (res.status === 404 && code === 'feature_off') throw new MetaError('feature_off', 'meta feature is off', 404);
      throw new MetaError(res.status === 504 ? 'timeout' : 'http', `HTTP ${res.status}`, res.status);
    }
    return parseMetaResponse(text);
  } catch (e) {
    if (e instanceof MetaError) throw e;
    if (timedOut) throw new MetaError('timeout', 'meta timeout');
    throw new MetaError('network', e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(t);
    o.signal?.removeEventListener('abort', onAbort);
  }
}
