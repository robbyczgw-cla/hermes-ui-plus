/**
 * Which slash commands the active chat offers, and what a command does (pure, tested).
 *
 * `availability` hides commands the backend cannot do at all (e.g. /branch through the UI bridge, whose
 * allow-list has no POST /api/sessions/{id}/fork) and disables commands the current state does not allow
 * (/stop with nothing running). `planCommand` turns a picked command + argument into an action the chat
 * view executes. A plan never contains the raw slash text: only `sendText` plans carry text for the model,
 * and those are built prompts (/search) or the user's explicit "Als Text senden".
 */
import type { HermesReasoning } from '../../hermes/capabilities.ts';
import type { ApprovalChoice, ApprovalRequest } from '../../hermes/types.ts';
import { approvalKey } from '../../hermes/approvals.ts';
import { COMMANDS, foldKey, type CommandDef, type CommandId } from './registry.ts';

export type BackendKind = 'hermes' | 'demo';

export type CommandContext = {
  kind: BackendKind;
  /** Hermes through the UI bridge (allow-listed /api paths only) */
  bridge: boolean;
  /** no palette at all (hidden session) */
  noPalette: boolean;
  /** Hermes session API reachable (false = server/bridge said 404/405; undefined = unknown → assume yes) */
  sessionsApi?: boolean;
  /** a turn already reached the server (the Hermes session exists) */
  hasRemoteSession: boolean;
  streaming: boolean;
  messageCount: number;
  /** retry possible (last turn finished, a user message exists) */
  canRetry: boolean;
  /** pending approval of the running turn (choices offered by Hermes) */
  approval: { choices: readonly ApprovalChoice[] } | null;
  /** per-chat model options the chat's model supports (null = no options sheet for this chat) */
  options: { reasoning: boolean; fast: boolean; canDisableReasoning: boolean } | null;
  /** current per-chat "Schnell" value (for the /fast toggle) */
  fast?: boolean;
};

export type Availability = { visible: false } | { visible: true; enabled: true } | { visible: true; enabled: false; reason: ReasonKey };

export type ReasonKey = 'notRunning' | 'running' | 'noApproval' | 'noSession' | 'empty' | 'nothingToRetry';

const HERMES_ONLY: ReadonlySet<CommandId> = new Set(['approve', 'deny', 'search', 'skills', 'branch', 'usage', 'status']);
const SESSION_API: ReadonlySet<CommandId> = new Set(['branch', 'usage', 'status']);

export function availability(id: CommandId, ctx: CommandContext): Availability {
  if (ctx.noPalette) return { visible: false };
  const hermes = ctx.kind === 'hermes';
  if (HERMES_ONLY.has(id) && !hermes) return { visible: false };
  if (SESSION_API.has(id) && ctx.sessionsApi === false) return { visible: false };
  if (id === 'reasoning' && !ctx.options?.reasoning) return { visible: false };
  if (id === 'fast' && !ctx.options?.fast) return { visible: false };
  const off = (reason: ReasonKey): Availability => ({ visible: true, enabled: false, reason });
  switch (id) {
    case 'stop':
      return ctx.streaming ? ON : off('notRunning');
    case 'retry':
      if (ctx.streaming) return off('running');
      return ctx.canRetry ? ON : off('nothingToRetry');
    case 'approve':
    case 'deny':
      return ctx.approval ? ON : off('noApproval');
    case 'search':
      return ctx.streaming ? off('running') : ON;
    case 'branch':
      if (ctx.streaming) return off('running');
      return ctx.hasRemoteSession ? ON : off('noSession');
    case 'usage':
      return ctx.hasRemoteSession ? ON : off('noSession');
    case 'export':
    case 'delete':
      return ctx.messageCount > 0 ? ON : off('empty');
    default:
      return ON;
  }
}
const ON: Availability = { visible: true, enabled: true };

/** commands shown in the palette for this chat (hidden ones dropped, table order) */
export function visibleCommands(ctx: CommandContext): CommandDef[] {
  return COMMANDS.filter((c) => availability(c.id, ctx).visible);
}

// ---- argument parsing --------------------------------------------------------------------------------

const REASONING_WORDS: Record<string, HermesReasoning> = {
  default: 'default', standard: 'default', auto: 'default', normal: 'default', predeterminado: 'default',
  off: 'off', aus: 'off', none: 'off', no: 'off', nein: 'off', apagado: 'off', ninguno: 'off', '0': 'off',
  minimal: 'minimal', minimo: 'minimal', min: 'minimal',
  low: 'low', niedrig: 'low', wenig: 'low', bajo: 'low', poco: 'low',
  medium: 'medium', mittel: 'medium', medio: 'medium', mid: 'medium',
  high: 'high', hoch: 'high', viel: 'high', alto: 'high', mucho: 'high',
  xhigh: 'xhigh', 'x-high': 'xhigh', sehrhoch: 'xhigh', 'sehr-hoch': 'xhigh', muyalto: 'xhigh',
  max: 'max', maximal: 'max', maximum: 'max', maximo: 'max',
};

export function parseReasoning(arg: string): HermesReasoning | undefined {
  return REASONING_WORDS[foldKey(arg).replace(/\s+/g, '')];
}

const ON_WORDS = new Set(['on', 'an', 'ein', 'ja', 'yes', 'si', 'true', '1', 'fast', 'schnell', 'rapido', 'activar']);
const OFF_WORDS = new Set(['off', 'aus', 'nein', 'no', 'false', '0', 'normal', 'desactivar']);

/** "/fast on|off" (any language); '' toggles; undefined = not understood */
export function parseToggle(arg: string, current: boolean): boolean | undefined {
  const k = foldKey(arg.trim());
  if (!k) return !current;
  if (ON_WORDS.has(k)) return true;
  if (OFF_WORDS.has(k)) return false;
  return undefined;
}

/** "/approve [once|session|always]" (any language); undefined = not understood */
export function parseApprovalChoice(arg: string): Exclude<ApprovalChoice, 'deny'> | undefined {
  const k = foldKey(arg.trim());
  if (!k || ['once', 'einmal', 'auftrag', 'una', 'unavez', 'ok', 'ja', 'yes', 'si'].includes(k)) return 'once';
  if (['session', 'sitzung', 'chat', 'sesion'].includes(k)) return 'session';
  if (['always', 'immer', 'siempre', 'permanent'].includes(k)) return 'always';
  return undefined;
}

// ---- plans -------------------------------------------------------------------------------------------

export type CommandPlan =
  | { type: 'newChat' }
  | { type: 'rename'; title: string }
  /** put text into the composer (command needs an argument / prefill for editing) */
  | { type: 'fill'; text: string }
  | { type: 'openModel'; query?: string }
  | { type: 'openOptions' }
  | { type: 'setReasoning'; value: HermesReasoning }
  | { type: 'setFast'; value: boolean }
  | { type: 'retry' }
  | { type: 'stop' }
  | { type: 'approve'; choice: Exclude<ApprovalChoice, 'deny'>; confirm: boolean }
  | { type: 'deny' }
  /** a BUILT prompt for the model (never the raw slash text), shown with a label */
  | { type: 'sendText'; text: string; label: 'search' | 'raw' }
  | { type: 'skills' }
  | { type: 'branch' }
  | { type: 'usage' }
  | { type: 'status' }
  | { type: 'export' }
  | { type: 'delete' }
  | { type: 'help' }
  | { type: 'error'; key: ReasonKey | 'badArg' | 'unavailable' };

export type PlanEnv = {
  /** localized search prompt, e.g. "Durchsuche unsere früheren Chats nach: {query}" */
  searchPrompt(query: string): string;
  /** current chat title (prefill for "/title" without argument) */
  title?: string;
};

/** What running `/<def.name> <arg>` does in this chat. */
export function planCommand(def: CommandDef, arg: string, ctx: CommandContext, env: PlanEnv): CommandPlan {
  const a = availability(def.id, ctx);
  if (!a.visible) return { type: 'error', key: 'unavailable' };
  if (!a.enabled) return { type: 'error', key: a.reason };
  const text = arg.trim();
  switch (def.id) {
    case 'new':
      return { type: 'newChat' };
    case 'title':
      return text ? { type: 'rename', title: text.slice(0, 120) } : { type: 'fill', text: `/title ${env.title ?? ''}`.trimEnd() + ' ' };
    case 'model':
      return { type: 'openModel', query: text || undefined };
    case 'reasoning': {
      if (!text) return { type: 'openOptions' };
      const v = parseReasoning(text);
      if (!v) return { type: 'error', key: 'badArg' };
      if (v === 'off' && ctx.options && !ctx.options.canDisableReasoning) return { type: 'error', key: 'badArg' };
      return { type: 'setReasoning', value: v };
    }
    case 'fast': {
      const v = parseToggle(text, !!ctx.fast);
      return v === undefined ? { type: 'error', key: 'badArg' } : { type: 'setFast', value: v };
    }
    case 'retry':
      return { type: 'retry' };
    case 'stop':
      return { type: 'stop' };
    case 'approve': {
      const choice = parseApprovalChoice(text);
      if (!choice || !ctx.approval?.choices.includes(choice)) return { type: 'error', key: 'badArg' };
      // "immer" is permanent: always confirm (research G5)
      return { type: 'approve', choice, confirm: choice === 'always' };
    }
    case 'deny':
      return { type: 'deny' };
    case 'search':
      return text ? { type: 'sendText', text: env.searchPrompt(text), label: 'search' } : { type: 'fill', text: '/search ' };
    case 'skills':
      return { type: 'skills' };
    case 'branch':
      return { type: 'branch' };
    case 'usage':
      return { type: 'usage' };
    case 'status':
      return { type: 'status' };
    case 'export':
      return { type: 'export' };
    case 'delete':
      return { type: 'delete' };
    case 'help':
      return { type: 'help' };
  }
}

/**
 * /approve after a confirmation dialog: the request captured BEFORE the dialog, if it is still pending and not
 * expired – never the new queue head (review M6: the original choice must not be applied to another request).
 */
export function stillPendingApproval<T extends Pick<ApprovalRequest, 'requestId' | 'runId' | 'timestamp' | 'command' | 'expired'>>(
  pending: readonly T[],
  target: T
): T | null {
  const key = approvalKey(target);
  return pending.find((a) => approvalKey(a) === key && !a.expired) ?? null;
}
