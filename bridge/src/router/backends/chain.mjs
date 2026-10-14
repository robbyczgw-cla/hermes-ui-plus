// Fallback chain: try backends in order (e.g. jev -> claude) within the router's single time
// budget; the router itself adds the final heuristic fallback.
/** @param {{id: string, model: string, label?: string, decide: Function}[]} backends */
export function createChainBackend(backends) {
  if (backends.length === 1) return backends[0];
  return {
    id: backends.map((b) => b.id).join('>'),
    model: backends.map((b) => b.label ?? b.model).join('>'),
    /** @param {any[]} turns @param {{signal?: AbortSignal}} [o] */
    async decide(turns, o = {}) {
      let lastErr;
      for (const b of backends) {
        if (o.signal?.aborted) break;
        try {
          const d = await b.decide(turns, o);
          // Report which link answered: the RouteDecision.model shows the real model.
          return { ...d, _model: b.label ?? b.model };
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr ?? new Error('chain aborted');
    },
  };
}
