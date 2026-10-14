/**
 * Capability handshake + per-chat model options. Pure (erasable TS, node:test).
 *
 * Verified in /opt/hermes/gateway/platforms/api_server.py:
 * - `GET /v1/capabilities` (`_handle_capabilities`): `{object:"hermes.api_server.capabilities", platform, model,
 *   auth, runtime, features:{…flags…, session_continuity_header, session_key_header, cors, …}, endpoints:{name:{method,path}}}`
 * - `GET /api/model/options` (`_handle_model_options` → hermes_cli/inventory.build_model_options_payload):
 *   `{providers:[{slug, name, is_current, models:[id], capabilities:{<model>:{fast, reasoning, can_disable_reasoning?, ultrafast?}}, …}],
 *     model:<current model>, provider:<current provider>}`
 * - chat completions accept body `model_options` (`_request_agent_overrides` → api_server_request_options.py):
 *   `reasoning:{enabled, effort}` (efforts: none|minimal|low|medium|high|xhigh|max|ultra; unknown ignored) or legacy
 *   `reasoning_effort`, and `fast:true` (→ service_tier "priority") / `service_tier`.
 */

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

export type HermesCapabilities = {
  /** model name the server advertises (usually the virtual `hermes-agent`) */
  model?: string;
  /** boolean feature flags (`features.*` with boolean values) */
  flags: Record<string, boolean>;
  /** endpoint names from `endpoints` (e.g. `sessions`, `session_messages`, `model_options`) */
  endpoints: string[];
  sessionIdHeader?: string;
  sessionKeyHeader?: string;
  /**
   * `approvals.timeout` in seconds when the server advertises it (`approvals.timeout`, `features.approval_timeout`
   * or `features.approval_timeout_seconds`). Hermes v0.21 does not (config only) → the app falls back to 300 s.
   */
  approvalTimeoutSeconds?: number;
};

const posNum = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

function approvalTimeout(json: Json, features: Json): number | undefined {
  const ap = isObj(json.approvals) ? json.approvals : undefined;
  return posNum(ap?.timeout) ?? posNum(features.approval_timeout) ?? posNum(features.approval_timeout_seconds) ?? posNum(features.approvals_timeout);
}

export function parseCapabilities(json: unknown): HermesCapabilities | null {
  if (!isObj(json)) return null;
  const features = isObj(json.features) ? json.features : {};
  const flags: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(features)) if (typeof v === 'boolean') flags[k] = v;
  const endpoints = isObj(json.endpoints) ? Object.keys(json.endpoints) : [];
  if (!Object.keys(flags).length && !endpoints.length) return null;
  const caps: HermesCapabilities = {
    model: str(json.model),
    flags,
    endpoints,
    sessionIdHeader: str(features.session_continuity_header),
    sessionKeyHeader: str(features.session_key_header),
  };
  const apTimeout = approvalTimeout(json, features);
  if (apTimeout) caps.approvalTimeoutSeconds = apTimeout;
  return caps;
}

/** Feature check with a default for servers that predate the flag. */
export function hasFeature(caps: HermesCapabilities | null | undefined, flag: string, fallback = false): boolean {
  if (!caps) return fallback;
  return flag in caps.flags ? caps.flags[flag] : fallback;
}

/** The server *claims* the session API (the bridge forwards /v1/capabilities but not /api/sessions → still probe). */
export function advertisesSessions(caps: HermesCapabilities | null | undefined): boolean {
  return !!caps && (caps.flags.session_resources === true || caps.endpoints.includes('sessions'));
}

// ------------------------------------------------------------------ /api/model/options

export type ModelCaps = {
  /** model accepts a reasoning effort */
  reasoning: boolean;
  /** model can run with reasoning disabled (unknown → true) */
  canDisableReasoning: boolean;
  /** "fast" (priority service tier) available */
  fast: boolean;
};

export type ProviderOptions = {
  slug: string;
  name: string;
  current: boolean;
  /** `authenticated` of the payload; undefined when the server does not report it (older Hermes) */
  authenticated?: boolean;
  models: string[];
  caps: Record<string, ModelCaps>;
};

export type ModelOptionsCatalog = {
  currentModel?: string;
  currentProvider?: string;
  providers: ProviderOptions[];
};

function parseCaps(v: unknown): ModelCaps {
  const c = isObj(v) ? v : {};
  return {
    reasoning: c.reasoning !== false,
    canDisableReasoning: c.can_disable_reasoning !== false,
    fast: c.fast === true,
  };
}

export function parseModelOptions(json: unknown): ModelOptionsCatalog | null {
  if (!isObj(json) || !Array.isArray(json.providers)) return null;
  const providers: ProviderOptions[] = [];
  for (const p of json.providers) {
    if (!isObj(p)) continue;
    const slug = str(p.slug);
    if (!slug) continue;
    const models = Array.isArray(p.models) ? p.models.filter((m): m is string => typeof m === 'string') : [];
    const caps: Record<string, ModelCaps> = {};
    if (isObj(p.capabilities)) for (const [m, c] of Object.entries(p.capabilities)) caps[m] = parseCaps(c);
    const prov: ProviderOptions = { slug, name: str(p.name) ?? slug, current: p.is_current === true, models, caps };
    if (typeof p.authenticated === 'boolean') prov.authenticated = p.authenticated;
    providers.push(prov);
  }
  return { currentModel: str(json.model), currentProvider: str(json.provider), providers };
}

const DEFAULT_CAPS: ModelCaps = { reasoning: true, canDisableReasoning: true, fast: false };

/**
 * Capabilities of the model a chat runs on. `model` = the request model (undefined / `hermes-agent`
 * = server default → the catalog's current model). `provider/model` ids are split. Unknown models get
 * permissive defaults (reasoning dial shown, fast hidden).
 */
export function modelCapsFor(catalog: ModelOptionsCatalog | null | undefined, model?: string): ModelCaps {
  if (!catalog) return DEFAULT_CAPS;
  const picked = model && model !== 'hermes-agent' ? splitProviderModel(model) : undefined;
  let id = picked ? picked.model : catalog.currentModel;
  let provider = picked ? picked.provider : catalog.currentProvider;
  if (!id) return DEFAULT_CAPS;
  const slash = id.indexOf('/');
  if (!provider && slash > 0 && catalog.providers.some((p) => p.slug === id!.slice(0, slash))) {
    provider = id.slice(0, slash);
    id = id.slice(slash + 1);
  }
  const ordered = [
    ...catalog.providers.filter((p) => p.slug === provider),
    ...catalog.providers.filter((p) => p.slug !== provider && p.current),
    ...catalog.providers.filter((p) => p.slug !== provider && !p.current),
  ];
  for (const p of ordered) if (p.caps[id]) return p.caps[id];
  return DEFAULT_CAPS;
}

// ------------------------------------------------------------------ per-chat provider model

/**
 * Per-chat pick of a provider model from /api/model/options, stored on the conversation as
 * `provider::model` (the separator Hermes' own session API uses, `_split_provider_prefixed_model`).
 * On /v1/chat/completions it is sent as separate body fields `model` + `provider`
 * (`_request_agent_overrides`: an explicit provider is always honoured; a bare model only with the
 * server's direct_model_requests opt-in).
 */
export const PROVIDER_MODEL_SEP = '::';

export function providerModelId(provider: string, model: string): string {
  return `${provider}${PROVIDER_MODEL_SEP}${model}`;
}

export function splitProviderModel(id: string): { provider?: string; model: string } {
  const i = id.indexOf(PROVIDER_MODEL_SEP);
  if (i <= 0) return { model: id };
  const provider = id.slice(0, i);
  const model = id.slice(i + PROVIDER_MODEL_SEP.length).trim();
  // same validation as the server's prefix split
  if (!/^[a-zA-Z0-9_.-]{2,64}$/.test(provider) || !model) return { model: id };
  return { provider, model };
}

/** providers whose models the picker offers (unauthenticated ones would fail on use) */
export function usableProviders(catalog: ModelOptionsCatalog | null | undefined): ProviderOptions[] {
  return (catalog?.providers ?? []).filter((p) => p.authenticated !== false && p.models.length > 0);
}

/** What the model picker will list: distinct models over usable providers (for connection-test summaries). */
export function catalogSummary(catalog: ModelOptionsCatalog | null | undefined): { models: number; providers: number } | null {
  const providers = usableProviders(catalog);
  if (!providers.length) return null;
  const ids = new Set<string>();
  for (const p of providers) for (const m of p.models) ids.add(providerModelId(p.slug, m));
  return ids.size ? { models: ids.size, providers: providers.length } : null;
}

// ------------------------------------------------------------------ per-chat options

export const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type HermesReasoningEffort = (typeof REASONING_EFFORTS)[number];
/** `default` = server/model default (nothing sent), `off` = reasoning disabled */
export type HermesReasoning = 'default' | 'off' | HermesReasoningEffort;

/** Per-conversation Hermes request options (persisted on the conversation). */
export type HermesChatOptions = {
  reasoning?: HermesReasoning;
  /** priority service tier where the model supports it */
  fast?: boolean;
  /** OpenAI-compatible provider profiles: web search for this chat (presets.ts); ignored by Hermes */
  web?: boolean;
};

export const REASONING_LABELS: Record<HermesReasoning, string> = {
  default: 'Standard',
  off: 'Aus',
  minimal: 'Minimal',
  low: 'Niedrig',
  medium: 'Mittel',
  high: 'Hoch',
  xhigh: 'Sehr hoch',
  max: 'Maximal',
};

export function sanitizeChatOptions(raw: unknown): HermesChatOptions | undefined {
  if (!isObj(raw)) return undefined;
  const out: HermesChatOptions = {};
  const r = raw.reasoning;
  if (r === 'off' || (REASONING_EFFORTS as readonly unknown[]).includes(r)) out.reasoning = r as HermesReasoning;
  if (raw.fast === true) out.fast = true;
  if (raw.web === true) out.web = true;
  return Object.keys(out).length ? out : undefined;
}

/** Same options with model-incompatible values dropped (so we never send a dial the model ignores). */
export function effectiveChatOptions(o: HermesChatOptions | undefined, caps: ModelCaps = DEFAULT_CAPS): HermesChatOptions | undefined {
  if (!o) return undefined;
  const out: HermesChatOptions = {};
  if (o.reasoning && o.reasoning !== 'default') {
    if (o.reasoning === 'off' ? caps.canDisableReasoning || !caps.reasoning : caps.reasoning) out.reasoning = o.reasoning;
  }
  if (o.fast && caps.fast) out.fast = true;
  return Object.keys(out).length ? out : undefined;
}

/** Body field `model_options` for /v1/chat/completions (undefined = send nothing). */
export function modelOptionsBody(o: HermesChatOptions | undefined): Record<string, unknown> | undefined {
  if (!o) return undefined;
  const body: Record<string, unknown> = {};
  if (o.reasoning === 'off') body.reasoning = { enabled: false };
  else if (o.reasoning && o.reasoning !== 'default') body.reasoning = { enabled: true, effort: o.reasoning };
  if (o.fast) body.fast = true;
  return Object.keys(body).length ? body : undefined;
}

/** Short chip text for the header ("Denken: Hoch · Schnell"), '' when everything is default. */
export function chatOptionsSummary(o: HermesChatOptions | undefined): string {
  if (!o) return '';
  const parts: string[] = [];
  if (o.reasoning && o.reasoning !== 'default') parts.push(o.reasoning === 'off' ? 'Denken aus' : `Denken: ${REASONING_LABELS[o.reasoning]}`);
  if (o.fast) parts.push('Schnell');
  if (o.web) parts.push('Websuche');
  return parts.join(' · ');
}
