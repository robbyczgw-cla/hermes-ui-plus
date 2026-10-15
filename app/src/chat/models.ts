/**
 * Model picker logic (pure, node-tested). Per conversation: `ConversationMeta.model` overrides the
 * profile's model. Hermes lists its models via GET /v1/models (cached per profile, see useModelList.ts).
 */
import { providerModelId, splitProviderModel, usableProviders, type ModelOptionsCatalog } from '../hermes/capabilities.ts';
import type { TFn, TKey } from '../i18n/core.ts';
import type { ModelBadge, ModelEntry } from './modelSearch.ts';

export type ModelOption = {
  /** undefined = server/profile default */
  id: string | undefined;
  label: string;
  /** small secondary line in the picker */
  detail?: string;
};


/** Hermes' virtual default model (= gateway default; docs/HERMES-API.md). */
export const HERMES_DEFAULT_MODEL = 'hermes-agent';

/** Model actually requested for a turn: conversation override > profile model (undefined = server default). */
export function effectiveModel(
  kind: string,
  conversationModel: string | undefined,
  profileModel: string | undefined,
): string | undefined {
  const m = conversationModel?.trim() || profileModel?.trim() || undefined;
  return m;
}

/** Short label for the header. Hermes default → '' (the header then shows only "Hermes"). */
export function modelLabel(kind: string, model: string | undefined): string {
  if (!model || model === HERMES_DEFAULT_MODEL) return '';
  if (kind === 'hermes') return splitProviderModel(model).model;
  return model;
}


/** The header's model subtitle (modelLabel of the profile's kind). */
export function headerModelLabel(profile: { kind: string; name?: string; model?: string; baseUrl?: string; provider?: string }, model: string | undefined): string {
  return modelLabel(profile.kind, model);
}

/** Kinds whose model list comes from the server (GET /v1/models). */
export function listsServerModels(kind: string): boolean {
  return kind === 'hermes';
}


/**
 * Picker rows. Hermes: "Standard" first, then the server's models (without the virtual default),
 * plus the current selection if the server no longer lists it.
 */
export function modelOptions(kind: string, serverIds: readonly string[], current: string | undefined, t: TFn): ModelOption[] {
  if (kind !== 'hermes') return current ? [{ id: current, label: current }] : [];
  const out: ModelOption[] = [{ id: undefined, label: t('chat.models.default'), detail: t('chat.models.serverModel') }];
  const seen = new Set<string>();
  for (const id of serverIds) {
    if (!id || id === HERMES_DEFAULT_MODEL || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: id });
  }
  if (current && current !== HERMES_DEFAULT_MODEL && !seen.has(current)) out.push({ id: current, label: current, detail: t('chat.models.unlisted') });
  return out;
}

export type EntryInput = {
  kind: string;
  t: TFn;
  /** effective model of the chat (picker) or profile model (editor) */
  current: string | undefined;
  /** GET /v1/models ids (Hermes: model_routes aliases) */
  serverIds: readonly string[];
  /** hermes: GET /api/model/options */
  hermes?: ModelOptionsCatalog | null;
  /** no "Standard" row (profile editor: the profile model itself is being chosen) */
  noDefault?: boolean;
};


/**
 * Rows of the searchable picker for every kind. Hermes: "Standard (model · provider)", the
 * model_routes aliases, then every model of the authenticated providers of /api/model/options
 * (id `provider::model`, grouped by provider name). Others: the current model only.
 */
export function modelEntries(input: EntryInput): ModelEntry[] {
  const { kind, t, current } = input;
  if (kind !== 'hermes') {
    return modelOptions(kind, input.serverIds, current, t).map((o) => ({ id: o.id, label: o.label, detail: o.detail }));
  }
  const out: ModelEntry[] = [];
  const seen = new Set<string>();
  const add = (e: ModelEntry) => {
    if (!e.id || seen.has(e.id)) return;
    seen.add(e.id);
    out.push(e);
  };


  // hermes
  const cat = input.hermes;
  const curProvider = cat?.providers.find((p) => p.slug === cat.currentProvider);
  const defModel = cat?.currentModel;
  out.push({
    id: undefined,
    label: t('chat.models.default'),
    detail: defModel ? [defModel, curProvider?.name ?? cat?.currentProvider].filter(Boolean).join(' · ') : t('chat.models.serverModel'),
    pinned: true,
  });
  const aliasGroup = t('chat.models.aliases');
  for (const id of input.serverIds) {
    if (!id || id === HERMES_DEFAULT_MODEL) continue;
    add({ id, label: id, group: aliasGroup });
  }
  for (const p of usableProviders(cat)) {
    for (const m of p.models) {
      const caps = p.caps[m];
      const badges: ModelBadge[] = [];
      if (caps?.reasoning) badges.push('reasoning');
      if (caps?.fast) badges.push('fast');
      add({ id: providerModelId(p.slug, m), label: m, group: p.name, badges });
    }
  }
  if (current && current !== HERMES_DEFAULT_MODEL && !seen.has(current)) {
    const sp = splitProviderModel(current);
    add({ id: current, label: sp.model, detail: [sp.provider, t('chat.models.unlisted')].filter(Boolean).join(' · ') });
  }
  return out;
}

/**
 * Value to store on the conversation for a picked option: the profile default is stored as
 * undefined, so later changes of the profile default apply to the chat as well.
 */
export function overrideFor(kind: string, picked: string | undefined, profileModel: string | undefined): string | undefined {
  const base = profileModel?.trim() || undefined;
  const p = picked === HERMES_DEFAULT_MODEL && kind === 'hermes' ? undefined : picked;
  if ((p ?? undefined) === base) return undefined;
  // Hermes: "Standard" while the profile has a fixed model → explicit virtual default
  if (p === undefined && kind === 'hermes' && base) return HERMES_DEFAULT_MODEL;
  return p;
}

// ---- cache (GET /v1/models per profile) ----

export type ModelCacheEntry = { baseUrl: string; ids: string[]; at: number };

/** Cache entries older than this are refreshed when the picker opens. */
export const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;

export function parseModelCache(raw: string | null | undefined): ModelCacheEntry | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ModelCacheEntry>;
    if (typeof v.baseUrl !== 'string' || !Array.isArray(v.ids) || typeof v.at !== 'number') return null;
    const e: ModelCacheEntry = { baseUrl: v.baseUrl, ids: v.ids.filter((x): x is string => typeof x === 'string'), at: v.at };
    return e;
  } catch {
    return null;
  }
}

/** Usable for this profile URL (a changed base URL invalidates the list). */
export function cacheMatches(entry: ModelCacheEntry | null | undefined, baseUrl: string): entry is ModelCacheEntry {
  return !!entry && entry.baseUrl === baseUrl;
}

export function cacheIsStale(entry: ModelCacheEntry | null | undefined, now: number, ttl = MODEL_CACHE_TTL_MS): boolean {
  return !entry || now - entry.at > ttl;
}

/** the last turn failed while a per-chat model was active (→ offer "Standard", useModelFallback) */
export function failedWithPickedModel(messages: readonly { role: string; status?: string }[], override: string | undefined): boolean {
  if (!override) return false;
  const last = messages[messages.length - 1];
  return !!last && last.role === 'assistant' && last.status === 'error';
}
