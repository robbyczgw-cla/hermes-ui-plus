/**
 * Answer "⋯" menu, pure part (node:test, answerMenu.test.ts): which items an answer offers, how "In neuem Chat
 * fortsetzen" branches per backend, what a retry variant does, whether a turn used web search, and the header line
 * ("Modell: <model> · <reasoning effort>").
 *
 * Branch per backend (decision, see also hermes/turnOverride.ts):
 * - Hermes, LAST answer, session API reachable → `fork`: POST /api/sessions/{id}/fork (same as /branch) copies the
 *   whole server-side session, so the new chat continues with the full stored context (tool results included).
 * - Hermes, an EARLIER answer (or no fork API) → `seed`: a new app conversation with the transcript up to and
 *   including that answer and a FRESH session id. Hermes ignores request `messages` when a session id is sent, so the
 *   copied turns go along as a context block in front of the first new message (`ConversationMeta.branchSeed`)
 *   until Hermes accepted a turn of the new session. The server-side session itself is never rewritten.
 * - other backends (demo) → `copy`: they resend the local history every turn, so a
 *   copy of the transcript up to the answer IS the branch.
 */
import type { ChatMessage } from '../hermes/types.ts';
import type { TurnOverride } from '../hermes/turnOverride.ts';
import { hermesToolKind } from './hermesTools.ts';

export type BackendKind = 'hermes' | 'demo';

// ---------------------------------------------------------------- branch

export type BranchMode = 'fork' | 'seed' | 'copy';

export type BranchContext = {
  kind: BackendKind | string;
  /** the answer is the last message of the chat */
  isLast: boolean;
  /** Hermes: a turn reached the server (the session exists) */
  hasRemoteSession: boolean;
  /** Hermes session API reachable (false = 404/405; undefined = unknown → assume yes) */
  sessionsApi?: boolean;
};

export function planBranch(ctx: BranchContext): BranchMode {
  if (ctx.kind !== 'hermes') return 'copy';
  if (ctx.isLast && ctx.hasRemoteSession && ctx.sessionsApi !== false) return 'fork';
  return 'seed';
}

/**
 * Transcript of the new chat: everything up to and including `answerId`. Runtime-only fields (pending approvals,
 * status line) are dropped; a message that was still streaming is stored as stopped. null = id not found.
 */
export function branchHistory(messages: readonly ChatMessage[], answerId: string): ChatMessage[] | null {
  const idx = messages.findIndex((m) => m.id === answerId);
  if (idx === -1) return null;
  return messages.slice(0, idx + 1).map((m) => {
    const { approval: _a, pendingApprovals: _p, statusNote: _s, ...rest } = m;
    return rest.status === 'streaming' ? { ...rest, status: 'stopped' as const } : rest;
  });
}

// ---------------------------------------------------------------- web search detection

/** tool names (raw or display) that read the web: search engines, page fetches, browsers, X search */
const WEB_TOOL_RE = /(^|[_:.\s-])(web[_-]?search|web[_-]?fetch|web[_-]?extract|x[_-]?(keyword[_-]?|semantic[_-]?|user[_-]?)?search|x[_-]?thread[_-]?fetch|browse[_-]?page|fetch[_-]?page|google[_-]?search|bing[_-]?search|search[_-]?web)/i;
/** German display names some reducers give their chips */
const WEB_DISPLAY = new Set(['websuche', 'x-suche', 'x-nutzersuche', 'x-thread laden', 'webseite laden', 'webseite abrufen']);

function isWebToolName(name: string | undefined): boolean {
  if (!name) return false;
  const n = name.trim();
  if (!n) return false;
  if (WEB_DISPLAY.has(n.toLowerCase())) return true;
  const kind = hermesToolKind(n);
  if (kind === 'web' || kind === 'browser') return true;
  return WEB_TOOL_RE.test(n);
}

/** Did this answer's turn use web search / page fetch tools? ("Ohne Websuche erneut versuchen") */
export function usedWebSearch(m: Pick<ChatMessage, 'tools' | 'metrics'>): boolean {
  if ((m.metrics?.webSearchRequests ?? 0) > 0 || (m.metrics?.webFetchRequests ?? 0) > 0) return true;
  return m.tools.some((t) => isWebToolName(t.name) || isWebToolName(t.detail?.tool) || !!t.detail?.links?.length);
}


// ---------------------------------------------------------------- retry variants

export type RetryVariant = 'same' | 'model' | 'longer' | 'shorter' | 'noWeb';

export type RetryPlan =
  | { type: 'retry'; override?: TurnOverride }
  /** open the model picker; the pick comes back as `retryWithModel` */
  | { type: 'pickModel' }
  /** a reformat request (`[reformat:longer|shorter] …`, A1 tags) */
  | { type: 'reformat'; kind: 'longer' | 'shorter' };

export type RetryContext = {
  kind: BackendKind | string;
  /** localized hidden instruction ("Beantworte ohne Websuche/Web-Tools.") */
  noWebNote: string;
};

export function planRetry(variant: RetryVariant, ctx: RetryContext): RetryPlan {
  switch (variant) {
    case 'same':
      return { type: 'retry' };
    case 'model':
      return { type: 'pickModel' };
    case 'longer':
    case 'shorter':
      return { type: 'reformat', kind: variant };
    case 'noWeb':
      // Hermes: only the note – its web tools are agent tools the request cannot switch off
      return { type: 'retry', override: { note: ctx.noWebNote } };
  }
}

/**
 * Model of "Mit anderem Modell…": the picked id, or for "Standard" (undefined) the profile model / Hermes default.
 * undefined = nothing to override (plain retry).
 */
export function retryModel(kind: BackendKind | string, picked: string | undefined, profileModel: string | undefined): string | undefined {
  const m = picked?.trim() || profileModel?.trim() || undefined;
  if (m) return m;
  return kind === 'hermes' ? 'hermes-agent' : undefined;
}

// ---------------------------------------------------------------- header

export type AnswerModelInput = {
  kind: BackendKind | string;
  /** model reported for the turn (metrics.model) */
  reported?: string;
  /** model the chat is set to (conversation override > profile model); undefined = server default */
  selected?: string;
  /** Hermes: the server's current default model (GET /api/model/options), if known */
  serverDefault?: string;
  /** reasoning effort of the chat (Hermes per-chat option) */
  effort?: string;
};

export type AnswerModelInfo = {
  /** model label; `isDefault` = Hermes server default ("Standard (<model>)") */
  model?: string;
  isDefault?: boolean;
  /** effort key (`off`, `low`, …); `default` / unknown are omitted */
  effort?: string;
};

const HERMES_DEFAULT = 'hermes-agent';
const EFFORTS = new Set(['off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

export function answerModelInfo(i: AnswerModelInput): AnswerModelInfo {
  const out: AnswerModelInfo = {};
  const reported = i.reported?.trim();
  const selected = i.selected?.trim();
  if (i.kind === 'hermes') {
    // Hermes echoes the request model; `hermes-agent` / nothing = the gateway default
    const m = reported && reported !== HERMES_DEFAULT ? reported : selected && selected !== HERMES_DEFAULT ? selected : undefined;
    if (m) out.model = m;
    else {
      out.isDefault = true;
      if (i.serverDefault?.trim()) out.model = i.serverDefault.trim();
    }
  } else {
    const m = reported || selected;
    if (m) out.model = m;
  }
  const e = i.effort?.trim().toLowerCase();
  if (e && EFFORTS.has(e)) out.effort = e === 'none' ? 'off' : e;
  return out;
}

// ---------------------------------------------------------------- items

export type AnswerItemKey =
  | 'branch'
  | 'retry'
  | 'noWeb'
  | 'copy'
  | 'copyMarkdown'
  | 'share'
  | 'shareImage'
  | 'report'
  | 'undoReport';

export type AnswerMenuState = {
  /** local (app-generated) message: never sent to a model */
  local: boolean;
  streaming: boolean;
  failed: boolean;
  isLast: boolean;
  /** a turn of this chat is running (another answer) */
  busy: boolean;
  /** answer has copyable text */
  hasText: boolean;
  /** stream lost, answer being recovered */
  recovering: boolean;
  usedWeb: boolean;
  shareImage: boolean;
  reported: boolean;
  /** the chat menu can branch (stored conversation) */
  canBranch: boolean;
};

/** Menu items of one answer, top to bottom ("Melden" last). */
export function answerMenuItems(s: AnswerMenuState): AnswerItemKey[] {
  const out: AnswerItemKey[] = [];
  const done = !s.streaming && !s.local;
  if (done && s.canBranch && !s.failed) out.push('branch');
  if (done && s.isLast && !s.recovering && !s.busy) {
    out.push('retry');
    if (s.usedWeb) out.push('noWeb');
  }
  if (s.hasText && !s.streaming) out.push('copy', 'copyMarkdown', 'share');
  if (s.hasText && !s.streaming && s.shareImage) out.push('shareImage');
  if (done && !s.failed) out.push(s.reported ? 'undoReport' : 'report');
  return out;
}
