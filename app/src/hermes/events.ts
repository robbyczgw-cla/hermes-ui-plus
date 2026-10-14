/**
 * Maps parsed SSE frames (sse.ts) to normalised HermesEvents. Pure; unknown events/fields are ignored.
 * Wire format: docs/HERMES-API.md
 */
import type {
  ApprovalChoice,
  ApprovalRequest,
  HermesEvent,
  RouteDecision,
  ToolStatus,
  Usage,
} from './types';

type Frame = { event: string; data: string };

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function parseJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

export function mapToolStatus(s: unknown): ToolStatus {
  switch (typeof s === 'string' ? s.toLowerCase() : '') {
    case 'completed':
    case 'complete':
    case 'done':
    case 'success':
    case 'finished':
      return 'done';
    case 'error':
    case 'failed':
    case 'failure':
      return 'error';
    default:
      return 'running'; // "running" | "started" | unknown
  }
}

const APPROVAL_CHOICES: ApprovalChoice[] = ['once', 'session', 'always', 'deny'];

export function mapApproval(d: Json): ApprovalRequest {
  const rawChoices = Array.isArray(d.choices) ? d.choices : [];
  const choices = rawChoices.filter((c): c is ApprovalChoice =>
    APPROVAL_CHOICES.includes(c as ApprovalChoice)
  );
  return {
    runId: str(d.run_id) ?? '',
    requestId: str(d.request_id),
    command: str(d.command) ?? '',
    description: str(d.description) ?? '',
    patternKey: str(d.pattern_key),
    choices: choices.length ? choices : ['once', 'deny'],
    smartDenied: d.smart_denied === true ? true : undefined,
    timestamp: num(d.timestamp) ?? Date.now() / 1000,
    // not sent by Hermes v0.21 (no deadline field); honoured when a newer server / plugin adds them
    ...optionalDeadline(d),
  };
}

/** `expires_at` (epoch s or ms) and `timeout` / `timeout_seconds` (s) of an approval payload, if present. */
function optionalDeadline(d: Json): { expiresAt?: number; timeoutSeconds?: number } {
  const out: { expiresAt?: number; timeoutSeconds?: number } = {};
  const exp = num(d.expires_at) ?? num(d.deadline);
  if (exp !== undefined && exp > 0) out.expiresAt = exp < 1e12 ? exp * 1000 : exp;
  const to = num(d.timeout_seconds) ?? num(d.timeout);
  if (to !== undefined && to > 0) out.timeoutSeconds = to;
  return out;
}

function mapUsage(u: unknown): Usage | undefined {
  if (!isObj(u)) return undefined;
  return {
    promptTokens: num(u.prompt_tokens) ?? 0,
    completionTokens: num(u.completion_tokens) ?? 0,
    totalTokens: num(u.total_tokens) ?? 0,
  };
}

/** One SSE frame -> zero or more events. Never throws. */
export function mapFrame(frame: Frame): HermesEvent[] {
  const name = frame.event;
  const raw = frame.data;

  if (name === 'message' || name === '') {
    if (raw.trim() === '[DONE]') return [{ type: 'done' }];
    const json = parseJson(raw);
    if (!isObj(json)) return [];
    return mapChunk(json);
  }

  const json = parseJson(raw);
  if (!isObj(json)) return [];

  switch (name) {
    case 'hermes.tool.progress': {
      const callId = str(json.toolCallId) ?? str(json.tool_call_id) ?? str(json.id);
      const tool = str(json.tool) ?? str(json.name) ?? 'tool';
      if (!callId) return [];
      return [
        {
          type: 'tool',
          callId,
          name: tool,
          status: mapToolStatus(json.status),
          label: str(json.label),
          emoji: str(json.emoji),
          raw: json,
        },
      ];
    }
    case 'hermes.status': {
      const text = str(json.text);
      return text ? [{ type: 'status', kind: str(json.kind) ?? 'status', text }] : [];
    }
    case 'approval.request':
      return [{ type: 'approval', approval: mapApproval(json) }];
    case 'hermes.ui.route': {
      const format = str(json.format);
      if (!format) return [];
      return [{ type: 'route', route: json as unknown as RouteDecision }];
    }
    default:
      return []; // unknown named event: ignore
  }
}

/** One OpenAI `chat.completion.chunk` (or error envelope). */
function mapChunk(json: Json): HermesEvent[] {
  const out: HermesEvent[] = [];
  if (isObj(json.error) && !Array.isArray(json.choices)) {
    out.push({
      type: 'error',
      message: str(json.error.message) ?? 'Unknown error',
      code: str(json.error.code),
    });
    return out;
  }
  const choice = Array.isArray(json.choices) && isObj(json.choices[0]) ? json.choices[0] : undefined;
  if (!choice) return out;
  const delta = isObj(choice.delta) ? choice.delta : {};

  if (delta.role === 'assistant') {
    out.push({ type: 'start', completionId: str(json.id) ?? '', model: str(json.model) });
  }
  const reasoning = str(delta.reasoning_content);
  if (reasoning) out.push({ type: 'reasoning', text: reasoning });
  const content = str(delta.content);
  if (content) out.push({ type: 'text', text: content });

  const finish = str(choice.finish_reason);
  if (finish) {
    const err = isObj(json.error) ? json.error : undefined;
    const hermes = isObj(json.hermes) ? json.hermes : undefined;
    out.push({
      type: 'finish',
      reason: finish,
      usage: mapUsage(json.usage),
      error: str(err?.message) ?? str(hermes?.error),
      errorCode: str(hermes?.error_code),
      partial: hermes?.partial === true ? true : undefined,
    });
  }
  return out;
}
