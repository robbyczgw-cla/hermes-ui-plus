import { createAnthropicBackend } from './anthropic.mjs';
import { createHeuristicBackend } from './heuristic.mjs';
import { createJevBackend } from './jev.mjs';
import { createNaceBackend } from './nace.mjs';
import { createChainBackend } from './chain.mjs';
import { createOpenAIBackend } from './openai.mjs';

/**
 * Build the primary decision backend from router config. Returns null for heuristic-only
 * (the router then uses the heuristic directly, without a time budget).
 * @param {ReturnType<typeof import('../../config.mjs').loadConfig>['router']} rc
 */
export function createBackend(rc) {
  const list = rc.chain.map((kind) => createOne(kind, rc)).filter(Boolean);
  return list.length ? createChainBackend(list) : null;
}

/** @param {string} kind @param {any} rc */
function createOne(kind, rc) {
  switch (kind) {
    case 'anthropic':
      // BRIDGE_ROUTER_MODEL applies to the anthropic link (default claude-haiku-5-5).
      return createAnthropicBackend({ apiKey: rc.anthropicApiKey, model: rc.anthropicModel || 'claude-haiku-5-5', effort: rc.effort, thinking: rc.thinking, maxTokens: rc.maxTokens });
    case 'openai':
      if (!rc.baseUrl || !rc.model) throw new Error('ROUTER_BACKEND=openai needs BRIDGE_ROUTER_BASE_URL and BRIDGE_ROUTER_MODEL');
      return createOpenAIBackend({ baseUrl: rc.baseUrl, apiKey: rc.apiKey, model: rc.model, jsonMode: rc.jsonMode, extraBody: rc.extraBody });
    case 'jev':
      return createJevBackend({ apiKey: rc.jevApiKey, model: rc.jevModel, url: rc.jevBaseUrl || undefined });
    case 'nace':
      return createNaceBackend({ apiKey: rc.naceApiKey, model: rc.naceModel, baseUrl: rc.naceBaseUrl || undefined });
    case 'heuristic':
    case 'off':
      return null;
    default:
      throw new Error(`unknown router kind ${kind}`);
  }
}

export { createChainBackend, createAnthropicBackend, createHeuristicBackend, createJevBackend, createNaceBackend, createOpenAIBackend };
