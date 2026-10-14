/**
 * Pure helpers for the "Werkzeuge & Ablauf" data on a ChatMessage (trace steps, metrics, raw
 * payloads) shared by the Hermes and the Claude backend, plus the storage caps. Erasable TS only.
 */
import type { ApprovalChoice, ChatMessage, ToolEvent, TraceKind, TraceStep, TurnMetrics } from './types.ts';

/** max JSON size of one stored tool input / output */
export const DETAIL_MAX_BYTES = 4096;
/** max JSON size of one stored raw frame / trace payload (Hermes frames are ~150 bytes) */
export const SMALL_MAX_BYTES = 1024;
/** max trace steps kept per message (live and stored) */
export const TRACE_MAX = 60;
/** max raw frames kept per tool */
export const RAW_MAX = 6;
/** max links kept per tool */
export const LINKS_MAX = 20;

export function pushTrace<M extends ChatMessage>(
  msg: M,
  kind: TraceKind,
  at: number,
  extra: { text?: string; data?: unknown; endedAt?: number } = {}
): M {
  const trace = msg.trace ?? [];
  if (trace.length >= TRACE_MAX) return msg;
  const step: TraceStep = { id: `${kind}-${trace.length}`, kind, at };
  if (extra.text !== undefined) step.text = extra.text;
  if (extra.data !== undefined) step.data = extra.data;
  if (extra.endedAt !== undefined) step.endedAt = extra.endedAt;
  return { ...msg, trace: [...trace, step] };
}

/** Replace the step with `id` (no-op if missing). */
export function updateTrace<M extends ChatMessage>(msg: M, id: string, fn: (s: TraceStep) => TraceStep): M {
  const trace = msg.trace;
  if (!trace) return msg;
  const idx = trace.findIndex((s) => s.id === id);
  if (idx === -1) return msg;
  const next = trace.slice();
  next[idx] = fn(trace[idx]);
  return { ...msg, trace: next };
}

export type ThinkingRange = { from: number; to: number };

export function thinkingRange(step: TraceStep): ThinkingRange | null {
  const d = step.data as Partial<ThinkingRange> | undefined;
  return d && typeof d.from === 'number' && typeof d.to === 'number' ? { from: d.from, to: d.to } : null;
}

/**
 * Hermes reasoning delta: extends the open thinking step (the last trace step) or opens a new one.
 * `prevLen`/`nextLen` = reasoning length before/after the delta.
 */
export function traceReasoning<M extends ChatMessage>(msg: M, prevLen: number, nextLen: number, now: number): M {
  const trace = msg.trace ?? [];
  const last = trace[trace.length - 1];
  const range = last?.kind === 'thinking' ? thinkingRange(last) : null;
  if (last && range && range.to === prevLen) {
    return updateTrace(msg, last.id, (s) => ({ ...s, endedAt: now, data: { from: range.from, to: nextLen } }));
  }
  return pushTrace(msg, 'thinking', now, { endedAt: now, data: { from: prevLen, to: nextLen } });
}

/** Set metric fields (returns the same object when nothing changes). */
export function withMetrics<M extends ChatMessage>(msg: M, patch: Partial<TurnMetrics>): M {
  const cur = msg.metrics ?? {};
  let changed = !msg.metrics;
  for (const k of Object.keys(patch) as (keyof TurnMetrics)[]) {
    if (cur[k] !== patch[k]) changed = true;
  }
  return changed ? { ...msg, metrics: { ...cur, ...patch } } : msg;
}

/** First visible token: set once. */
export function markFirstToken<M extends ChatMessage>(msg: M, now: number): M {
  return msg.metrics?.firstTokenAt !== undefined ? msg : withMetrics(msg, { firstTokenAt: now });
}

/** Record the user's approval answer as a timeline step. */
export function recordApprovalAnswer<M extends ChatMessage>(msg: M, choice: ApprovalChoice, now: number): M {
  return pushTrace(msg, 'approval_answer', now, { text: choice });
}

/** Append a raw frame to a tool (bounded). */
export function appendRaw(tool: ToolEvent, raw: unknown): ToolEvent {
  if (raw === undefined) return tool;
  const list = tool.raw ?? [];
  if (list.length >= RAW_MAX) return tool;
  return { ...tool, raw: [...list, raw] };
}

// ------------------------------------------------------------------ sanitizing / capping

const SECRET_KEYS = new Set(['encrypted_content', 'encrypted_stdout', 'encrypted_index', 'signature', 'data_base64']);

/**
 * Deep copy without encrypted blobs; long strings (e.g. base64 `data`) are shortened. Depth/width
 * bounded so a hostile payload cannot blow up the UI.
 */
export function sanitize(value: unknown, maxString = 2000, depth = 0): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string' && value.length > maxString) {
      return `${value.slice(0, maxString)}… (+${value.length - maxString} Zeichen)`;
    }
    return value;
  }
  if (depth > 6) return '…';
  if (Array.isArray(value)) {
    const out = value.slice(0, 50).map((v) => sanitize(v, maxString, depth + 1));
    if (value.length > 50) out.push(`… (+${value.length - 50})`);
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEYS.has(k)) {
      out[k] = typeof v === 'string' ? `<${v.length} Zeichen verschlüsselt>` : '<verschlüsselt>';
      continue;
    }
    if (k === 'data' && typeof v === 'string' && v.length > 200) {
      out[k] = `<${v.length} Zeichen Daten>`;
      continue;
    }
    out[k] = sanitize(v, maxString, depth + 1);
  }
  return out;
}

/** JSON-size cap: values whose JSON is larger than `max` become a truncated JSON string preview. */
export function capPayload(value: unknown, max: number = DETAIL_MAX_BYTES): unknown {
  if (value === undefined) return undefined;
  let json: string;
  try {
    json = JSON.stringify(value) ?? '';
  } catch {
    return '[nicht serialisierbar]';
  }
  if (json.length <= max) return value;
  return `${json.slice(0, max)}… [gekürzt, ${json.length} Zeichen]`;
}

function capString(s: string | undefined, max: number): string | undefined {
  if (s === undefined || s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

/** Keep stored tool details small: every payload ≤ DETAIL_MAX_BYTES, ≤ LINKS_MAX links. */
export function compactTool(t: ToolEvent): ToolEvent {
  if (!t.detail && !t.raw) return t;
  const out: ToolEvent = { ...t };
  if (t.raw) out.raw = t.raw.slice(0, RAW_MAX).map((r) => capPayload(r, SMALL_MAX_BYTES));
  if (t.detail) {
    const d = { ...t.detail };
    if (d.input !== undefined) d.input = capPayload(d.input);
    if (d.output !== undefined) d.output = capPayload(d.output);
    if (d.summary) d.summary = capString(d.summary, 200);
    if (d.links) {
      d.links = d.links.slice(0, LINKS_MAX).map((l) => ({
        title: capString(l.title, 160) ?? '',
        url: capString(l.url, 500) ?? '',
        ...(l.age ? { age: capString(l.age, 40) } : {}),
        ...(l.snippet ? { snippet: capString(l.snippet, 300) } : {}),
      }));
    }
    out.detail = d;
  }
  return out;
}

/** Storage form of the detail fields of one message (tools, trace). Never adds fields. */
export function compactDetails(m: ChatMessage): ChatMessage {
  const needsTools = m.tools?.some((t) => t.detail || t.raw);
  if (!needsTools && !m.trace) return m;
  const out: ChatMessage = { ...m };
  if (needsTools) out.tools = m.tools.map(compactTool);
  if (m.trace) {
    out.trace = m.trace.slice(0, TRACE_MAX).map((s) => {
      const step: TraceStep = { ...s };
      if (s.text !== undefined) step.text = capString(s.text, 500);
      if (s.data !== undefined) step.data = capPayload(s.data, SMALL_MAX_BYTES);
      return step;
    });
  }
  return out;
}
