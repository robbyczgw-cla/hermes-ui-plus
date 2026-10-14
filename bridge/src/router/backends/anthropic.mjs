// Decision model via the Anthropic Claude API (official @anthropic-ai/sdk).
// Default: claude-haiku-5-5, adaptive thinking, effort "low", structured output (json_schema).
// Notes (Claude API docs, 2026): Haiku 5.5 rejects non-default temperature/top_p and assistant
// prefill (400); thinking {type:"disabled"} is accepted at effort <= high. Sonnet 5.5 rejects
// "disabled" -> use {type:"between_tools"} for the lowest setting.
import { renderTurns } from '../context.mjs';
import { ROUTE_JSON_SCHEMA, ROUTER_SYSTEM_PROMPT } from '../prompt.mjs';

/** @typedef {'adaptive'|'disabled'|'between_tools'} ThinkingMode */

/**
 * @param {{apiKey?: string, model?: string, effort?: 'low'|'medium'|'high', thinking?: ThinkingMode,
 *   maxTokens?: number, baseURL?: string, client?: any}} opts
 */
export function createAnthropicBackend(opts = {}) {
  const model = opts.model || 'claude-haiku-5-5';
  const effort = opts.effort || 'low';
  const thinking = opts.thinking || 'adaptive';
  // Thinking tokens count against max_tokens; the JSON itself is ~40 tokens.
  const maxTokens = opts.maxTokens ?? (thinking === 'adaptive' ? 2048 : 256);
  let clientPromise = opts.client ? Promise.resolve(opts.client) : null;

  async function client() {
    clientPromise ??= import('@anthropic-ai/sdk').then(({ default: Anthropic }) => new Anthropic({
      ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      maxRetries: 0, // the router has its own time budget + heuristic fallback
      timeout: 30_000,
    }));
    return clientPromise;
  }

  return {
    id: 'anthropic',
    model,
    label: `${model}/${effort}/${thinking}`,
    /** @param {{role: string, content: string}[]} turns @param {{signal?: AbortSignal}} [o] */
    async decide(turns, o = {}) {
      const c = await client();
      const res = await c.messages.create({
        model,
        max_tokens: maxTokens,
        // Stable system prompt with a cache breakpoint (> 512-token minimum on Haiku 5.5).
        system: [{ type: 'text', text: ROUTER_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: renderTurns(turns) }],
        thinking: { type: thinking },
        output_config: { effort, format: { type: 'json_schema', schema: ROUTE_JSON_SCHEMA.schema } },
      }, { signal: o.signal });
      if (res.stop_reason === 'refusal') throw new Error('router model refused');
      if (res.stop_reason === 'max_tokens') throw new Error('router model hit max_tokens');
      const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      return JSON.parse(text);
    },
  };
}
