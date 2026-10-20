// SELF-CONTAINED: this directory must import nothing outside itself (node: builtins and the optional
// @anthropic-ai/sdk only), so other servers can vendor it as a copy.
// Router core: context -> cache -> primary backend (with time budget) -> heuristic fallback.
import { contextHash } from './context.mjs';
import { classifyHeuristic, HEURISTIC_MODEL, looksLikeProductComparison } from './backends/heuristic.mjs';
import { PROMPT_VERSION } from './prompt.mjs';
import { neutralDecision, normalizeDecision } from './taxonomy.mjs';
import { LruCache } from './lru.mjs';
import { reformatDecision } from './reformat.mjs';
import { liveCardDecision } from './live.mjs';
import { silentLogger } from './log.mjs';
import { isForeignToHeuristic } from './lang.mjs';

/**
 * @typedef {{id: string, model: string, label?: string, decide: (turns: any[], o?: {signal?: AbortSignal}) => Promise<any>}} Backend
 * @typedef {import('./taxonomy.mjs').RouteDecision} RouteDecision
 */

/** @param {{role: string, content: string}[]} turns */
const latestUserText = (turns) => [...turns].reverse().find((t) => t.role === 'user')?.content ?? '';

/**
 * Heuristic-first (`ROUTER_BACKEND=heuristic,<model>…`): the heuristic decides whenever one of its rules fired; the model
 * is asked only when no rule fired, or when the message is in a language the rules do not cover (not de/en/es) and the
 * heuristic is not confident (< 0.85). Model-first (default): the model decides unless the heuristic fast path applies.
 * @param {{role: string, content: string}[]} turns @param {{confidence: number, fallthrough?: boolean}} h
 */
export function heuristicFirstAsksModel(turns, h) {
  return Boolean(h.fallthrough) || (h.confidence < 0.85 && isForeignToHeuristic(latestUserText(turns)));
}

/**
 * @param {{backend?: Backend|null, timeoutMs?: number, cache?: LruCache|null,
 *   fallback?: 'heuristic'|'neutral', fastPathMin?: number, mode?: 'model-first'|'heuristic-first',
 *   logger?: ReturnType<import('./log.mjs').createLogger>, now?: () => number}} [opts]
 */
export function createRouter(opts = {}) {
  const backend = opts.backend ?? null;
  const timeoutMs = opts.timeoutMs ?? 1500;
  const cache = opts.cache === undefined ? new LruCache({ max: 2000, ttlMs: 3600_000 }) : opts.cache;
  const log = opts.logger ?? silentLogger;
  const now = opts.now ?? (() => performance.now());
  const fallbackMode = opts.fallback ?? 'heuristic';
  const fastPathMin = opts.fastPathMin ?? 0;
  const heuristicFirst = opts.mode === 'heuristic-first';
  const salt = `${PROMPT_VERSION}|${heuristicFirst ? 'hf|' : ''}${backend ? `${backend.id}:${backend.label ?? backend.model}` : 'heuristic'}`;

  function fallback(turns, started, why) {
    if (fallbackMode === 'neutral') return neutralDecision(HEURISTIC_MODEL, now() - started, `fallback (${why})`);
    const h = classifyHeuristic(turns);
    const d = normalizeDecision(h, { model: HEURISTIC_MODEL, ms: now() - started });
    if (backend) d.reason = `fallback (${why}): ${d.reason}`;
    return d;
  }

  /**
   * @param {{role: string, content: string}[]} turns routing context (≤4 turns)
   * @param {{signal?: AbortSignal, reqId?: string, liveCards?: {id: string, type: string, focused?: boolean, patches?: number}[]}} [o]
   * @returns {Promise<RouteDecision & {cached?: boolean, fallback?: string}>}
   */
  async function route(turns, o = {}) {
    const started = now();
    if (!turns.length) return neutralDecision(HEURISTIC_MODEL, 0, 'no user message');
    // "Hermes fragen" / an edit request on a live card: format by card type + card=<id>, decided before the cache
    // (the same text routes differently with and without open cards), no model call
    const lf = liveCardDecision(turns, o.liveCards);
    if (lf) {
      const d = { ...normalizeDecision(lf, { model: HEURISTIC_MODEL, ms: now() - started }), card: lf.card, ...(lf.full ? { full: true } : {}) };
      log.info('route', { reqId: o.reqId, format: d.format, confidence: d.confidence, model: d.model, ms: d.ms, cached: false, live: true });
      return d;
    }
    // App "Umformen" chips (`[reformat:<kind>] …`) force the format: no cache, no model call.
    const rf = reformatDecision(turns);
    if (rf) {
      const d = normalizeDecision(rf, { model: HEURISTIC_MODEL, ms: now() - started });
      log.info('route', { reqId: o.reqId, format: d.format, component: d.component, confidence: d.confidence, model: d.model, ms: d.ms, cached: false, reformat: true });
      return d;
    }
    const key = contextHash(turns, salt);
    const hit = cache?.get(key);
    if (hit) {
      const d = { ...hit, ms: Math.round(now() - started) };
      log.info('route', { reqId: o.reqId, format: d.format, component: d.component, confidence: d.confidence, model: d.model, ms: d.ms, cached: true });
      return d;
    }

    /** @type {RouteDecision} */
    let d;
    let fellBack = '';
    const fast = backend && (fastPathMin > 0 || heuristicFirst) ? classifyHeuristic(turns) : null;
    if (!backend) {
      d = fallback(turns, started, 'no backend');
    } else if (heuristicFirst && fast && !heuristicFirstAsksModel(turns, fast)) {
      d = normalizeDecision(fast, { model: HEURISTIC_MODEL, ms: now() - started });
      d.reason = `heuristic first: ${d.reason}`;
    } else if (!heuristicFirst && fast && fast.confidence >= fastPathMin) {
      // Fast path: unambiguous explicit requests / strong text guards skip the model call
      // (100% precise at >= 0.85 on both eval sets; saves ~1.2-1.5 s for ~40% of messages).
      d = normalizeDecision(fast, { model: HEURISTIC_MODEL, ms: now() - started });
      d.reason = `fast path: ${d.reason}`;
    } else {
      const ac = new AbortController();
      const onAbort = () => ac.abort(o.signal?.reason);
      o.signal?.addEventListener('abort', onAbort, { once: true });
      let timer;
      let timedOut = false;
      try {
        const raw = await Promise.race([
          backend.decide(turns, { signal: ac.signal }),
          new Promise((_, rej) => {
            timer = setTimeout(() => {
              const e = new Error('router timeout');
              e.name = 'TimeoutError';
              timedOut = true;
              rej(e);
              ac.abort(e);
            }, timeoutMs);
          }),
        ]);
        d = normalizeDecision(raw, { model: raw?._model ?? backend.label ?? backend.model, ms: now() - started });
        // Backends with a coarse taxonomy (Jev) often return no component: borrow the
        // heuristic's component when both agree on the format.
        if (!d.component) {
          const h = fast ?? classifyHeuristic(turns);
          if (h.format === d.format && h.component) d.component = h.component;
        }
        // Named buyable products compared: product cards (photos, prices, specs table) instead of generic compare
        // columns, also when the model or a coarse backend says compare.
        if (d.format === 'compare' && looksLikeProductComparison(latestUserText(turns))) {
          d.format = 'products';
          d.component = 'compare';
          d.reason = `${d.reason ? `${d.reason}; ` : ''}named products → products compare`.slice(0, 160);
        }
      } catch (err) {
        const e = /** @type {any} */ (err);
        fellBack = timedOut ? 'timeout' : o.signal?.aborted ? 'aborted' : 'error';
        log.warn('route_backend_failed', { reqId: o.reqId, backend: backend.id, model: backend.model, why: fellBack, status: e?.status, error: String(e?.message ?? e).slice(0, 120), ms: Math.round(now() - started) });
        d = fallback(turns, started, fellBack);
      } finally {
        clearTimeout(timer);
        o.signal?.removeEventListener('abort', onAbort);
      }
    }
    // Only cache real decisions (a timeout fallback should be retried next time).
    if (!fellBack) cache?.set(key, d);
    log.info('route', { reqId: o.reqId, format: d.format, component: d.component, confidence: d.confidence, model: d.model, ms: d.ms, cached: false, fallback: fellBack || undefined });
    log.debug('route_reason', { reqId: o.reqId, reason: d.reason });
    return fellBack ? { ...d, fallback: fellBack } : d;
  }

  return { route, backend, timeoutMs, cache, mode: heuristicFirst ? 'heuristic-first' : 'model-first' };
}
