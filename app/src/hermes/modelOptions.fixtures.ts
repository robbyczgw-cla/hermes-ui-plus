/** GET /api/model/options of a Hermes server, shape as served (api_server `_handle_model_options`); provider / model ids are examples */
export const HERMES_MODEL_OPTIONS = {
  model: 'kimi-k3-fast',
  provider: 'moonshot',
  providers: [
    {
      slug: 'moonshot',
      name: 'Moonshot',
      authenticated: true,
      is_current: true,
      total_models: 2,
      models: ['kimi-k3-fast', 'kimi-k3'],
      featured_models: ['kimi-k3'],
      capabilities: { 'kimi-k3-fast': { fast: true, reasoning: true }, 'kimi-k3': { fast: false, reasoning: true, can_disable_reasoning: false } },
    },
    {
      slug: 'openrouter',
      name: 'OpenRouter',
      authenticated: true,
      is_current: false,
      total_models: 2,
      models: ['anthropic/claude-haiku-5.5', 'deepseek/deepseek-v4-pro'],
      featured_models: [],
      capabilities: { 'anthropic/claude-haiku-5.5': { fast: false, reasoning: true } },
    },
    {
      slug: 'nous',
      name: 'Nous Portal',
      authenticated: false,
      is_current: false,
      total_models: 1,
      models: ['hermes-5-405b'],
      featured_models: [],
      capabilities: {},
    },
  ],
} as const;
