// Decision model via any OpenAI-compatible /chat/completions endpoint
// (Groq, OpenRouter, OpenCode Go, Concentrate, OpenAI, local llama.cpp/vLLM, ...).
import { renderTurns } from '../context.mjs';
import { ROUTE_JSON_SCHEMA, ROUTER_SYSTEM_PROMPT } from '../prompt.mjs';

/**
 * Extract the first JSON object from a model reply (tolerates code fences / leading prose /
 * reasoning tags from models that ignore JSON mode).
 * @param {string} text
 */
export function extractJson(text) {
  if (typeof text !== 'string') throw new Error('empty model reply');
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  if (start < 0) throw new Error('no JSON object in model reply');
  let depth = 0;
  let inStr = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return JSON.parse(cleaned.slice(start, i + 1));
  }
  throw new Error('unterminated JSON object in model reply');
}

/**
 * @param {{baseUrl: string, apiKey?: string, model: string, jsonMode?: 'schema'|'json'|'none',
 *   maxTokens?: number, extraBody?: object, extraHeaders?: Record<string,string>,
 *   fetchImpl?: typeof fetch}} opts
 */
export function createOpenAIBackend(opts) {
  if (!opts.baseUrl || !opts.model) throw new Error('openai backend needs baseUrl and model');
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const doFetch = opts.fetchImpl ?? fetch;
  // Downgrade chain when a provider rejects a response_format: schema -> json -> none.
  let jsonMode = opts.jsonMode ?? 'schema';

  function responseFormat() {
    if (jsonMode === 'schema') return { type: 'json_schema', json_schema: ROUTE_JSON_SCHEMA };
    if (jsonMode === 'json') return { type: 'json_object' };
    return undefined;
  }

  /** @param {{role: string, content: string}[]} turns @param {AbortSignal} [signal] */
  async function call(turns, signal) {
    const body = {
      model: opts.model,
      messages: [
        { role: 'system', content: ROUTER_SYSTEM_PROMPT },
        { role: 'user', content: renderTurns(turns) },
      ],
      temperature: 0,
      max_tokens: opts.maxTokens ?? 200,
      stream: false,
      ...(responseFormat() ? { response_format: responseFormat() } : {}),
      ...(opts.extraBody ?? {}),
    };
    const res = await doFetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
        ...(opts.extraHeaders ?? {}),
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const errText = (await res.text().catch(() => '')).slice(0, 300);
      const err = new Error(`router model HTTP ${res.status}`);
      /** @type {any} */ (err).status = res.status;
      /** @type {any} */ (err).detail = errText;
      throw err;
    }
    const json = await res.json();
    const msg = json?.choices?.[0]?.message;
    const text = typeof msg?.content === 'string' && msg.content.trim() ? msg.content : msg?.reasoning_content;
    return extractJson(text);
  }

  return {
    id: 'openai',
    model: opts.model,
    get jsonMode() { return jsonMode; },
    /** @param {{role: string, content: string}[]} turns @param {{signal?: AbortSignal}} [o] */
    async decide(turns, o = {}) {
      for (;;) {
        try {
          return await call(turns, o.signal);
        } catch (err) {
          const e = /** @type {any} */ (err);
          const rejectedFormat = (e.status === 400 || e.status === 422) && jsonMode !== 'none'
            && /response_format|json_schema|json_object|schema|unsupported|not support/i.test(e.detail ?? '');
          if (!rejectedFormat || o.signal?.aborted) throw err;
          jsonMode = jsonMode === 'schema' ? 'json' : 'none';
        }
      }
    },
  };
}
