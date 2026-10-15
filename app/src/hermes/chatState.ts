/**
 * Pure state transitions for one assistant message. The hook (useHermesChat.ts) applies
 * HermesEvents with these and throttles React updates; keeping them here makes them testable.
 */
import type { Attachment } from '../attachments/types';
import { deviceTimeZone } from './timeZone.ts';
import { makeT, type TFn, type TKey, type Vars } from '../i18n/core.ts';
import type { ChatMessage, HermesEvent, MessageStatus, ToolEvent, Usage } from './types';
import { appendRaw, markFirstToken, pushTrace, traceReasoning, withMetrics } from './trace.ts';
import { addApproval, closePending } from './approvals.ts';
import { authErrorText } from './authError.ts';
import type { AppendRun } from '../protocol/appendRun.ts';

export type ErrorText = NonNullable<ChatMessage['errorText']>;

/** Accumulated answer text per message (UTF-16 code units); beyond this the stream is cut with CAP_MARKER. */
export const MAX_MESSAGE_TEXT = 1_000_000;
/** Accumulated reasoning per message. */
export const MAX_MESSAGE_REASONING = 200_000;
/** Visible end of a capped text / reasoning (language-neutral; the answer also shows a translated notice). */
export const CAP_MARKER = '\n\n[…]';

/**
 * `prev + add`, but never more than `max` chars (+ CAP_MARKER once). Text that already hit the cap stays as it is,
 * so a runaway stream cannot grow a message (or the per-tick copies of it) without bound.
 */
export function appendCapped(prev: string, add: string, max: number): { text: string; capped: boolean } {
  if (prev.length > max) return { text: prev, capped: true }; // only a capped text (marker) is longer than max
  if (prev.length + add.length <= max) return { text: prev + add, capped: false };
  let cut = max - prev.length;
  // don't split a surrogate pair at the cut
  const code = add.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut--;
  return { text: prev + add.slice(0, cut) + CAP_MARKER, capped: true };
}

/**
 * The stable i18n key + params of a thrown/mapped backend error (HermesError, OpenAICompatError,
 * errors of the other backends carry `text: {key, params}` too), if any.
 */
export function errorTextOf(e: unknown): ErrorText | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const x = (e as { text?: unknown }).text;
  if (typeof x !== 'object' || x === null || typeof (x as { key?: unknown }).key !== 'string') return undefined;
  const { key, params } = x as ErrorText;
  return params ? { key, params } : { key };
}

const deT = makeT('de', 'de-DE');

/** Error whose `message` is the German text of `key` (setup errors of the chat hooks); `text` keeps the key. */
export function keyedError(key: TKey, params?: Vars): Error & { text: ErrorText } {
  const err = new Error(deT(key, params)) as Error & { text: ErrorText };
  err.text = params ? { key, params } : { key };
  return err;
}

/** `{ errorText }` of a thrown error, or `{}` (spread into a message). */
export function errorTextPatch(e: unknown): { errorText?: ErrorText } {
  const k = errorTextOf(e);
  return k ? { errorText: k } : {};
}

/** Error text of a message in the active language (keyed errors are translated; server text as is). */
export function messageErrorText(m: Pick<ChatMessage, 'error' | 'errorText'>, t: TFn): string {
  if (m.errorText) {
    const s = t(m.errorText.key, m.errorText.params);
    if (s && s !== m.errorText.key) return s;
  }
  return m.error ?? '';
}

export function newId(prefix: string): string {
  let hex = '';
  const c: { getRandomValues?: (a: Uint8Array) => Uint8Array } | undefined = (
    globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }
  ).crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const a = c.getRandomValues(new Uint8Array(8));
    for (let i = 0; i < a.length; i++) hex += a[i].toString(16).padStart(2, '0');
  } else {
    for (let i = 0; i < 16; i++) hex += Math.floor(Math.random() * 16).toString(16);
  }
  return `${prefix}-${hex}`;
}

export function createUserMessage(text: string, now: number, attachments?: Attachment[], timeZone: string = deviceTimeZone()): ChatMessage {
  return {
    id: newId('u'),
    role: 'user',
    text,
    tools: [],
    status: 'done',
    createdAt: now,
    timeZone,
    ...(attachments?.length ? { attachments } : {}),
  };
}

export function createAssistantMessage(now: number): ChatMessage {
  return { id: newId('a'), role: 'assistant', text: '', tools: [], status: 'streaming', createdAt: now };
}

function closeRunningTools(tools: ToolEvent[], now: number): ToolEvent[] {
  if (!tools.some((t) => t.status === 'running')) return tools;
  return tools.map((t) => (t.status === 'running' ? { ...t, status: 'done', endedAt: now } : t));
}

/** message object → its append run (protocol/appendRun.ts): set by `applyEvent` only */
const appendRuns = new WeakMap<ChatMessage, AppendRun>();

/**
 * The append run of a message's text: two message objects with the same run have texts where the longer one extends
 * the shorter one (`applyEvent` appended to it or left it alone). Undefined for objects made anywhere else.
 */
export function textAppendRun(m: ChatMessage): AppendRun | undefined {
  return appendRuns.get(m);
}

export function applyEvent(msg: ChatMessage, ev: HermesEvent, now: number): ChatMessage {
  const next = applyEventTo(msg, ev, now);
  if (next !== msg) {
    const run = appendRuns.get(msg);
    // a text delta continues the run (or starts one); `textReplace` ends it; other events keep it if the text stayed
    if (ev.type === 'text') appendRuns.set(next, run ?? {});
    else if (run && ev.type !== 'textReplace' && next.text === msg.text) appendRuns.set(next, run);
  }
  return next;
}

function applyEventTo(msg: ChatMessage, ev: HermesEvent, now: number): ChatMessage {
  switch (ev.type) {
    case 'start': {
      const m = ev.completionId ? { ...msg, completionId: ev.completionId } : msg;
      return withMetrics(m, { model: ev.model ?? m.metrics?.model, requests: (m.metrics?.requests ?? 0) + 1 });
    }
    case 'text': {
      if (msg.textCapped) return msg; // over the cap: the rest of the stream is dropped
      const r = appendCapped(msg.text, ev.text, MAX_MESSAGE_TEXT);
      return markFirstToken({ ...msg, text: r.text, statusNote: undefined, ...(r.capped ? { textCapped: true } : {}) }, now);
    }
    case 'textReplace': {
      // the whole answer text so far is new (a corrected live draft); tool cuts past its end are ignored by progressNotes
      const r = appendCapped('', ev.text, MAX_MESSAGE_TEXT);
      const { textCapped: _capped, ...rest } = msg;
      const next = { ...rest, text: r.text, statusNote: undefined, ...(r.capped ? { textCapped: true } : {}) };
      return r.text ? markFirstToken(next, now) : next;
    }
    case 'reasoning': {
      const prev = msg.reasoning ?? '';
      if (prev.length > MAX_MESSAGE_REASONING) return msg; // capped already
      const next = appendCapped(prev, ev.text, MAX_MESSAGE_REASONING).text;
      return traceReasoning({ ...msg, reasoning: next }, prev.length, next.length, now);
    }
    case 'tool': {
      const idx = msg.tools.findIndex((t) => t.id === ev.callId);
      if (idx === -1) {
        const t: ToolEvent = {
          id: ev.callId,
          name: ev.name,
          label: ev.label || ev.name,
          status: ev.status,
          startedAt: now,
          emoji: ev.emoji,
          // display split (progressNotes.ts): text streamed before this call is an interim note
          textAt: msg.text.length,
        };
        if (ev.status !== 'running') t.endedAt = now;
        if (ev.detail) t.detail = ev.detail;
        return { ...msg, tools: [...msg.tools, appendRaw(t, ev.raw)], statusNote: undefined };
      }
      const prev = msg.tools[idx];
      const next: ToolEvent = appendRaw(
        {
          ...prev,
          status: ev.status,
          label: ev.label || prev.label,
          emoji: ev.emoji ?? prev.emoji,
          endedAt: ev.status === 'running' ? undefined : (prev.endedAt ?? now),
          ...(ev.detail ? { detail: { ...prev.detail, ...ev.detail } } : {}),
        },
        ev.raw
      );
      const tools = msg.tools.slice();
      tools[idx] = next;
      return { ...msg, tools };
    }
    case 'status': {
      const last = msg.trace?.[msg.trace.length - 1];
      const m = { ...msg, statusNote: ev.text };
      // identical repeated status lines (retry countdowns) collapse into one step
      if (last?.kind === 'status' && last.text === ev.text) return m;
      return pushTrace(m, 'status', now, { text: ev.text, data: { kind: ev.kind } });
    }
    case 'route':
      // first route event wins in the timeline (a doubled mock+bridge setup sends two)
      return msg.trace?.some((s) => s.kind === 'route')
        ? { ...msg, route: ev.route }
        : pushTrace({ ...msg, route: ev.route }, 'route', now);
    case 'approval':
      // queued per request_id (parallel tool calls); deadline stamped by the hook (advertised timeout) or here
      return addApproval(msg, ev.approval, now);
    case 'finish': {
      const failed = ev.reason === 'error';
      const next: ChatMessage = {
        // the run is over: still-open requests are logged as expired / cancelled
        ...withMetrics(closePending(msg, now), { endedAt: now, ...usageMetrics(ev.usage ?? msg.usage) }),
        finishReason: ev.reason,
        truncated: ev.reason === 'length' ? true : msg.truncated,
        usage: ev.usage ?? msg.usage,
        tools: closeRunningTools(msg.tools, now),
        statusNote: undefined,
      };
      if (failed) {
        next.status = 'error';
        next.error = ev.error || 'Der Agent hat den Lauf mit einem Fehler beendet.';
        if (ev.error) delete next.errorText;
        else next.errorText = { key: 'backends.hermes.errors.agentFailed' };
      } else {
        next.status = 'done';
      }
      return next;
    }
    case 'error':
      return finalize(msg, 'error', ev.message, now, authErrorText(undefined, ev.message));
    case 'done':
      return msg;
    default:
      return msg;
  }
}

/** Close a message for good (stream ended, aborted, failed). Keeps already streamed text. */
export function finalize(
  msg: ChatMessage,
  status: MessageStatus,
  error: string | undefined,
  now: number,
  errorText?: ErrorText
): ChatMessage {
  const closed = closePending(msg, now);
  const m = closed.metrics?.endedAt !== undefined ? closed : withMetrics(closed, { endedAt: now });
  const isError = status === 'error';
  // a new error without a key must not keep the key of an older one
  const key = isError ? (errorText ?? (error === undefined ? msg.errorText : undefined)) : undefined;
  const { errorText: _old, ...rest } = m;
  return {
    ...rest,
    ...(key ? { errorText: key } : {}),
    status,
    error: isError ? (error ?? msg.error) : undefined,
    tools: closeRunningTools(msg.tools, now),
    statusNote: undefined,
  };
}

function usageMetrics(u: Usage | undefined): { inputTokens?: number; outputTokens?: number } {
  return u ? { inputTokens: u.promptTokens, outputTokens: u.completionTokens } : {};
}
