/**
 * Per-chat model lock on the Hermes session (Hermes v0.22, capability `session_model_lock`). Pure, node:test.
 *
 * `POST /api/sessions/{id}/model {model, provider?}` persists the chat's model on the Hermes session
 * (`model_config.browser_model_lock`, confirmed, plus the session row's `model`), so it survives Hermes restarts and is
 * what Hermes' own session surfaces (`/api/sessions/{id}/chat[/stream]`, Hermes Desktop / browser) run the session on.
 * The app's own turns (`/v1/chat/completions`) keep sending the chat's model per request: Hermes does NOT read the lock
 * on that route (docs/HERMES-API.md "v0.22 additions"), so the lock is the durable server-side record, not a switch.
 *
 * Rules:
 *  - only an explicit per-chat pick is locked (not the profile default, not the virtual `hermes-agent`: Hermes answers
 *    400 missing_model for it, and there is no unlock route – a chat switched back to "Standard" keeps its last lock
 *    on the server until another model is picked)
 *  - only once the session exists on Hermes (it is created by the first accepted turn; before that: 404)
 *  - once per model: the outcome is stored on the conversation (`modelLock`), a change of model locks again
 */
import { splitProviderModel } from './capabilities.ts';
import type { ChatMessage } from './types';

export const HERMES_VIRTUAL_MODEL = 'hermes-agent';

/** outcome for one model, stored on the conversation */
export type ModelLockState = {
  model: string;
  /** locked = Hermes confirmed it; refused = Hermes cannot route this model (409/400), not retried for this model */
  status: 'locked' | 'refused';
  at: number;
};

/** what the lock request sends: the chat's `provider::model` pick split like a chat completion body */
export function modelLockBody(model: string): { model: string; provider?: string } {
  const p = splitProviderModel(model);
  return p.provider ? { model: p.model, provider: p.provider } : { model: p.model };
}

/** Hermes has a row for this chat's session: a turn was accepted (completion id) or the chat came from the server. */
export function sessionStored(messages: readonly ChatMessage[], fromServer: boolean): boolean {
  return fromServer || messages.some((m) => m.role === 'assistant' && (!!m.completionId || m.status === 'done'));
}

/** the model to lock now, or null */
export function modelLockTarget(input: {
  supported: boolean;
  /** the chat's own model pick (conversation meta), undefined = profile default */
  model?: string;
  lock?: ModelLockState;
  stored: boolean;
}): string | null {
  if (!input.supported || !input.stored) return null;
  const m = input.model?.trim();
  if (!m || m === HERMES_VIRTUAL_MODEL) return null;
  if (input.lock?.model === m) return null;
  return m;
}

export type ModelLockOutcome =
  | { kind: 'done'; state: ModelLockState }
  /** try again after the next turn (session not stored yet, network) */
  | { kind: 'later' }
  /** this server / bridge has no lock route: stop trying for this connection */
  | { kind: 'unsupported' };

/** classify the lock request's result (`error` undefined = success) */
export function modelLockOutcome(model: string, error: unknown, now: number): ModelLockOutcome {
  if (error === undefined) return { kind: 'done', state: { model, status: 'locked', at: now } };
  // HermesError (stream.ts), checked structurally so this module stays free of the network code
  if (typeof error !== 'object' || error === null || (error as { hermesError?: unknown }).hermesError !== true) return { kind: 'later' };
  const e = error as { status?: number; code?: string };
  if (e.status === 404 && e.code === 'session_not_found') return { kind: 'later' };
  if (e.status === 404 || e.status === 405 || e.status === 501) return { kind: 'unsupported' };
  if (e.status === 409 || e.status === 400) return { kind: 'done', state: { model, status: 'refused', at: now } };
  return { kind: 'later' };
}

/** the header shows the model as locked */
export function modelLocked(model: string | undefined, lock: ModelLockState | undefined): boolean {
  return !!model && lock?.status === 'locked' && lock.model === model;
}

/** stored value → ModelLockState (unknown shapes are dropped) */
export function sanitizeModelLock(raw: unknown): ModelLockState | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.model !== 'string' || !r.model.trim()) return undefined;
  if (r.status !== 'locked' && r.status !== 'refused') return undefined;
  const at = typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : 0;
  return { model: r.model, status: r.status, at };
}
