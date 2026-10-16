/**
 * Hermes session messages (GET /api/sessions/{id}/messages) → ChatMessage / ToolEvent, and enrichment of
 * live turns with the stored tool arguments, results and reasoning. Pure, erasable TS (node:test).
 *
 * Storage shape (verified with a real call, docs/HERMES-API.md): one assistant turn is several rows
 *   assistant {content:"I'll check…", tool_calls:[{id, type:"function", function:{name, arguments:"<json>"}}], finish_reason:"tool_calls"}
 *   tool      {tool_call_id, tool_name, content:"<json result, e.g. {output, exit_code, error}>"}
 *   assistant {content:"answer", reasoning?, finish_reason:"stop"}
 * The `tool_calls[].id` equals the `toolCallId` of the live `hermes.tool.progress` events.
 */
import type { Attachment } from '../attachments/types';
import type { ChatMessage, ToolEvent, ToolDetail, TraceStep } from './types';
import type { RemoteMessage, RemoteToolCall } from './sessions';
import { DETAIL_MAX_BYTES, LINKS_MAX, capPayload, sanitize } from './trace.ts';
import { parseWebToolOutput } from './webResults.ts';
import { splitTurnExtras, stripTurnExtras, type TurnExtras } from './turnOverride.ts';
import { applyEvent } from './chatState.ts';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Stable ChatMessage id for a stored row (nodestate keys `conversationId:messageId` survive refreshes). */
export const remoteMessageId = (rowId: string, role: 'user' | 'assistant') => `h${role === 'user' ? 'u' : 'a'}-${rowId}`;
export const isRemoteMessageId = (id: string) => /^h[ua]-/.test(id);

/** Text of a stored content value (string or OpenAI parts); images become a `[Bild]` marker. */
export function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content === null || content === undefined ? '' : String(content);
  const out: string[] = [];
  let images = 0;
  let files = 0;
  for (const p of content) {
    if (!isObj(p)) continue;
    if ((p.type === 'text' || p.type === 'input_text') && typeof p.text === 'string') out.push(p.text);
    else if (p.type === 'image_url' || p.type === 'input_image') images++;
    else files++;
  }
  if (images) out.push(images === 1 ? '[Bild]' : `[${images} Bilder]`);
  if (files) out.push('[Datei]');
  return out.join('\n');
}

const THINK_RE = /<think(?:ing)?>([\s\S]*?)(?:<\/think(?:ing)?>|$)/gi;

/** Split inline `<think>…</think>` blocks (some providers) from the visible text. */
export function splitThink(text: string): { text: string; reasoning: string } {
  if (!/<think/i.test(text)) return { text, reasoning: '' };
  const parts: string[] = [];
  const visible = text.replace(THINK_RE, (_m, inner: string) => {
    if (inner.trim()) parts.push(inner.trim());
    return '';
  });
  return { text: visible.trim(), reasoning: parts.join('\n\n') };
}

const PREVIEW_KEYS = ['command', 'cmd', 'query', 'q', 'url', 'path', 'file_path', 'filename', 'pattern', 'code', 'prompt', 'text', 'name', 'action'];

/** One-line argument preview (like the server's `build_tool_preview` label). */
export function argsPreview(name: string, args: unknown): string {
  let s: string | undefined;
  if (typeof args === 'string') s = args;
  else if (isObj(args)) {
    for (const k of PREVIEW_KEYS) {
      const v = args[k];
      if (typeof v === 'string' && v.trim()) {
        s = v;
        break;
      }
    }
  }
  const line = (s ?? '').replace(/\s+/g, ' ').trim();
  if (!line) return name;
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

function parseResult(content: unknown): unknown {
  const text = contentText(content);
  const t = text.trim();
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try {
      return JSON.parse(t);
    } catch {
      // keep text
    }
  }
  return text;
}

/** Result summary + failure flag from a parsed tool result (`{output, exit_code, error}` for terminal). */
export function resultSummary(output: unknown): { summary?: string; failed: boolean } {
  if (isObj(output)) {
    const err = output.error;
    const code = typeof output.exit_code === 'number' ? output.exit_code : typeof output.returncode === 'number' ? output.returncode : undefined;
    if (typeof err === 'string' && err.trim()) {
      const line = err.trim().split('\n')[0];
      return { summary: line.length > 120 ? `${line.slice(0, 119)}…` : line, failed: true };
    }
    if (output.success === false) return { summary: 'Fehlgeschlagen', failed: true };
    if (code !== undefined) return { summary: `Exit ${code}`, failed: code !== 0 };
    return { failed: false };
  }
  if (typeof output === 'string' && /^(error|fehler)\b[:\s]/i.test(output.trim())) {
    return { summary: output.trim().split('\n')[0].slice(0, 120), failed: true };
  }
  return { failed: false };
}

/** Stored, capped detail for one call (+ its result row, if any). */
export function toolDetailFrom(call: RemoteToolCall, result: RemoteMessage | undefined): { detail: ToolDetail; failed: boolean } {
  const detail: ToolDetail = { tool: call.name };
  if (call.arguments !== undefined && call.arguments !== '') detail.input = capPayload(sanitize(call.arguments), DETAIL_MAX_BYTES);
  let failed = false;
  if (result) {
    const out = parseResult(result.content);
    detail.output = capPayload(sanitize(out, 3000), DETAIL_MAX_BYTES);
    const s = resultSummary(out);
    if (s.summary) detail.summary = s.summary;
    failed = s.failed;
    // web search / extract (WSP text layout, MCP / Hermes JSON): hits from the FULL result, before the output cap
    const web = parseWebToolOutput(out, call.name);
    if (web) {
      if (web.results.length) {
        detail.links = web.results.slice(0, LINKS_MAX).map((h) => ({ title: h.title, url: h.url, ...(h.published ? { age: h.published } : {}), ...(h.snippet ? { snippet: h.snippet } : {}) }));
      }
      detail.web = { count: web.results.length, ...(web.provider ? { provider: web.provider } : {}), ...(web.cached ? { cached: true } : {}) };
    }
  }
  return { detail, failed };
}

function toolEventFrom(call: RemoteToolCall, startedAt: number, result: RemoteMessage | undefined): ToolEvent {
  const { detail, failed } = toolDetailFrom(call, result);
  const ev: ToolEvent = {
    id: call.id,
    name: call.name,
    label: argsPreview(call.name, call.arguments),
    status: failed ? 'error' : 'done',
    startedAt,
    detail,
  };
  if (result?.timestamp !== undefined) ev.endedAt = Math.max(startedAt, result.timestamp);
  return ev;
}

const visible = (m: RemoteMessage) => m.displayKind !== 'hidden';

/**
 * Stored rows (chronological) → ChatMessages. Consecutive assistant/tool rows form one assistant
 * message (texts joined, tool calls → ToolEvents with input/output details and `textAt` = offset of the
 * call in the joined text, reasoning → `reasoning` + a thinking trace step). System rows, hidden rows and `_`-prefixed tools are skipped.
 */
export function mapRemoteMessages(rows: RemoteMessage[]): ChatMessage[] {
  const results = new Map<string, RemoteMessage>();
  for (const r of rows) if (r.role === 'tool' && r.toolCallId) results.set(r.toolCallId, r);

  const out: ChatMessage[] = [];
  let cur: { msg: ChatMessage; texts: string[]; reasoning: string[]; textLen: number } | null = null;
  let lastTs = 0;

  const close = () => {
    if (!cur) return;
    const m = cur.msg;
    m.text = cur.texts.join('\n\n');
    const reasoning = cur.reasoning.filter((t) => t.trim()).join('\n\n');
    if (reasoning) {
      m.reasoning = reasoning;
      const step: TraceStep = { id: 'thinking-0', kind: 'thinking', at: m.createdAt, endedAt: m.createdAt, data: { from: 0, to: reasoning.length } };
      m.trace = [step];
    }
    if (m.text || m.tools.length || m.reasoning || m.status === 'error') out.push(m);
    cur = null;
  };

  for (const r of rows) {
    if (!visible(r)) continue;
    const ts = r.timestamp ?? lastTs;
    lastTs = ts;
    if (r.role === 'user') {
      close();
      const id = remoteMessageId(r.id, 'user');
      // attachment references (`[Datei angehängt: …]`) → attachment chips, like the live message (no server path)
      const split = splitAttachmentMarkers(contentText(r.content).trim(), id);
      const { attachments } = split;
      // hidden app text (retry note, branch context) is not what the user wrote: cut, the bubble shows a chip
      const { text, extras } = splitStoredExtras(split.text);
      if (!text && !attachments.length && !extras) continue;
      out.push({ id, role: 'user', text, ...(attachments.length ? { attachments } : {}), ...(extras ? { turnExtras: extras } : {}), tools: [], status: 'done', createdAt: ts });
      continue;
    }
    if (r.role === 'assistant') {
      if (!cur) {
        cur = {
          msg: { id: remoteMessageId(r.id, 'assistant'), role: 'assistant', text: '', tools: [], status: 'done', createdAt: ts },
          texts: [],
          reasoning: [],
          textLen: 0,
        };
      }
      const split = splitThink(contentText(r.content));
      if (split.text.trim()) {
        cur.textLen += (cur.texts.length ? 2 : 0) + split.text.length;
        cur.texts.push(split.text);
      }
      if (r.reasoning) cur.reasoning.push(r.reasoning);
      else if (split.reasoning) cur.reasoning.push(split.reasoning);
      for (const call of r.toolCalls ?? []) {
        if (call.name.startsWith('_')) continue;
        // texts are joined on purpose (one answer bubble); the display split into interim notes + final
        // answer happens later (progressNotes.ts) from these offsets into the joined text
        cur.msg.tools.push({ ...toolEventFrom(call, ts, results.get(call.id)), textAt: cur.textLen });
      }
      if (r.finishReason) {
        if (r.finishReason === 'error') cur.msg = applyEvent(cur.msg, { type: 'finish', reason: 'error' }, ts);
        cur.msg.finishReason = r.finishReason;
        cur.msg.truncated = r.finishReason === 'length' ? true : undefined;
        if (cur.msg.truncated === undefined) delete cur.msg.truncated;
      }
      cur.msg.metrics = { endedAt: ts };
      continue;
    }
    // tool rows are consumed via `results`; other roles (system, …) are skipped
  }
  close();
  return out;
}

/**
 * Attachment text of a file in a stored user message (attachments/encodeHermes.ts; model-facing, German only):
 *   `[Datei angehängt: <name> (<mime>, <size>) – Pfad auf dem Server: <path>]`   (UI bridge upload)
 *   `[Datei angehängt: <name> (<mime>, <size>) – Inhalt:]` + a fenced block       (small text file, inlined)
 */
const FILE_MARKER_RE = /\[Datei angehängt: ([^\n]+?) \(([\w.+-]+\/[\w.+-]+), ([^()\n]+?)\) – (?:Pfad auf dem Server: ([^\n]*)\]|(Inhalt:)\])/g;
const SIZE_UNITS: Record<string, number> = { B: 1, KB: 1000, MB: 1_000_000 };

/** "1,2 MB" / "830 KB" / "12 B" (formatBytes) → bytes (approximate), 0 when unreadable */
function parseShownSize(s: string): number {
  const m = /^([\d.,]+)\s*(B|KB|MB)$/.exec(s.trim());
  const n = m ? Number(m[1].replace(',', '.')) : NaN;
  return m && Number.isFinite(n) ? Math.round(n * SIZE_UNITS[m[2]]) : 0;
}

/** end of the fenced block that follows an inlined file's marker (at `from`), or `from` when there is none */
function inlineBlockEnd(text: string, from: number): number {
  const open = /^\n(`{3,})[^\n]*\n/.exec(text.slice(from));
  if (!open) return from;
  const fence = open[1];
  // the fence is longer than any backtick run inside the content (fenceFor), so the first "\n<fence>" not followed
  // by another backtick closes the block
  for (let i = from + open[0].length - 1; ; ) {
    const k = text.indexOf(`\n${fence}`, i);
    if (k === -1) return text.length;
    if (text[k + 1 + fence.length] !== '`') return k + 1 + fence.length;
    i = k + 1;
  }
}

/**
 * Stored user text → typed text + attachments: file references and inlined text files become attachment entries
 * (name, type, size; no local file). The server path of an upload is only kept in `remoteRef` (never displayed).
 * Images arrive as `[Bild]` markers (contentText) and stay.
 * `idPrefix` makes the attachment ids stable across refreshes.
 */
export function splitAttachmentMarkers(text: string, idPrefix: string): { text: string; attachments: Attachment[] } {
  if (!text.includes('[Datei angehängt: ')) return { text, attachments: [] };
  const re = new RegExp(FILE_MARKER_RE.source, 'g');
  const attachments: Attachment[] = [];
  let out = '';
  let pos = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let end = m.index + m[0].length;
    if (m[5]) end = inlineBlockEnd(text, end);
    out += text.slice(pos, m.index);
    pos = end;
    re.lastIndex = end;
    const att: Attachment = { id: `${idPrefix}-att-${attachments.length}`, kind: 'file', name: m[1], mimeType: m[2], size: parseShownSize(m[3]), uri: '', status: 'ready' };
    // the upload on the bridge (kept 7 days): never shown, but a regenerate of this turn sends the same reference
    if (m[4]) att.remoteRef = { id: '', path: m[4], name: att.name, size: att.size, mimeType: att.mimeType };
    attachments.push(att);
  }
  if (!attachments.length) return { text, attachments };
  out += text.slice(pos);
  return { text: out.replace(/\n{3,}/g, '\n\n').trim(), attachments };
}

/** Normalised text for matching a local user message against a stored one. */
export function normText(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** start of an attachment text part (encodeHermes / encodeOpenAI): everything from here on is attachment content */
const ATTACHMENT_PART_RE = /\[(?:Datei|Bild) angehängt: /;
/** markers `contentText` puts at the end for image / non-text parts */
const MARKER_LINE_RE = /^\[(?:Bild|\d+ Bilder|Datei)\]$/;

/**
 * The typed part of a user message: attachment parts (`[Datei angehängt: …]` + inlined content) and the
 * `[Bild]` / `[N Bilder]` / `[Datei]` markers of stored image/file parts are cut off. `attachments` tells
 * whether any were present.
 */
export function userTextCore(s: string): { core: string; attachments: boolean } {
  let text = s;
  let attachments = false;
  const cut = text.search(ATTACHMENT_PART_RE);
  if (cut >= 0) {
    text = text.slice(0, cut);
    attachments = true;
  }
  const lines = text.split('\n');
  while (lines.length) {
    const l = lines[lines.length - 1].trim();
    if (l && !MARKER_LINE_RE.test(l)) break;
    if (l) attachments = true;
    lines.pop();
  }
  // hidden one-turn note / branch context block (turnOverride.ts) are not part of the typed text
  return { core: stripTurnExtras(lines.join('\n')), attachments };
}

/**
 * `splitTurnExtras` for a stored user text: the `[Bild]` / `[N Bilder]` / `[Datei]` marker lines `contentText` puts
 * after the text part (and so after a trailing note) stay at the end.
 */
export function splitStoredExtras(text: string): { text: string; extras?: TurnExtras } {
  const lines = text.split('\n');
  let n = lines.length;
  while (n > 0 && MARKER_LINE_RE.test(lines[n - 1].trim())) n--;
  const split = splitTurnExtras(lines.slice(0, n).join('\n'));
  if (!split.extras) return { text };
  return { text: [split.text, ...lines.slice(n)].join('\n').trim(), extras: split.extras };
}

function sameNorm(x: string, y: string): boolean {
  if (!x || !y) return false;
  return x === y;
}

/** Same typed text (attachment parts / markers ignored); empty texts never match (see sameUserTurn). */
export function sameUserText(a: string, b: string): boolean {
  return sameNorm(normText(userTextCore(a).core), normText(userTextCore(b).core));
}

/**
 * Does a local user message correspond to a stored user text? Like `sameUserText`, plus attachment-only
 * messages: an empty local text with attachments matches a stored text that consists only of attachment
 * parts/markers (`[Bild]`, `[Datei angehängt: …]`).
 */
export function sameUserTurn(local: Pick<ChatMessage, 'text' | 'attachments'>, remote: RemoteTurn): boolean {
  return matchUserTurn(local, normalizedUserText(local.text), withAttachments(normalizedUserText(remoteText(remote)), remote));
}

type UserTurn = Pick<ChatMessage, 'text' | 'attachments'>;
/** stored user turn: its raw text, or the mapped message (attachments parsed out of the text, mapRemoteMessages) */
type RemoteTurn = string | UserTurn;
type NormalizedUserText = { text: string; attachments: boolean };

const remoteText = (r: RemoteTurn) => (typeof r === 'string' ? r : r.text);
function withAttachments(n: NormalizedUserText, r: RemoteTurn): NormalizedUserText {
  return typeof r !== 'string' && r.attachments?.length && !n.attachments ? { ...n, attachments: true } : n;
}

function normalizedUserText(text: string): NormalizedUserText {
  const core = userTextCore(text);
  return { text: normText(core.core), attachments: core.attachments };
}

function matchUserTurn(local: UserTurn, l: NormalizedUserText, r: NormalizedUserText): boolean {
  if (!l.text && !r.text) return (!!local.attachments?.length || l.attachments) && r.attachments;
  return sameNorm(l.text, r.text);
}

/**
 * One transcript reconciliation may compare a prompt against many turns. Normalize each distinct
 * text once, rather than stripping attachments / folding whitespace for every candidate pair.
 * Keep this matcher scoped to one reconciliation so the cache cannot retain old transcripts.
 */
export function createUserTurnMatcher(): (local: UserTurn, remote: RemoteTurn) => boolean {
  const cache = new Map<string, NormalizedUserText>();
  const normalized = (text: string): NormalizedUserText => {
    let hit = cache.get(text);
    if (!hit) {
      hit = normalizedUserText(text);
      cache.set(text, hit);
    }
    return hit;
  };
  return (local, remote) => matchUserTurn(local, normalized(local.text), withAttachments(normalized(remoteText(remote)), remote));
}

/**
 * Merge stored details into a local assistant message: tools by id (fallback: unmatched tools with the
 * same name in order), reasoning when the local one is missing. Local text/metrics stay. With
 * `appendMissing`, stored calls without a live counterpart (tool progress disabled) are appended.
 * Returns the same object when nothing changed.
 */
export function mergeAssistantDetails(local: ChatMessage, remote: ChatMessage, appendMissing = false): ChatMessage {
  const byId = new Map(remote.tools.map((t) => [t.id, t]));
  const used = new Set<string>();
  let changed = false;
  const tools = local.tools.map((t) => {
    let r = byId.get(t.id);
    if (r && used.has(r.id)) r = undefined;
    if (!r) r = remote.tools.find((x) => !used.has(x.id) && !local.tools.some((l) => l.id === x.id) && x.name === t.name);
    if (!r) return t;
    used.add(r.id);
    if (!r.detail || (t.detail?.input !== undefined && t.detail?.output !== undefined)) return t;
    changed = true;
    const next: ToolEvent = { ...t, detail: { ...r.detail, ...stripUndefined(t.detail ?? {}) } };
    if (r.status === 'error' && t.status === 'done') next.status = 'error';
    if (!t.label || t.label === t.name) next.label = r.label;
    return next;
  });
  if (appendMissing) {
    for (const r of remote.tools) {
      if (used.has(r.id) || local.tools.some((l) => l.id === r.id)) continue;
      // `textAt` points into the stored text: only meaningful when the local text is that text
      if (r.textAt !== undefined && local.text !== remote.text) {
        const { textAt: _t, ...rest } = r;
        tools.push(rest);
      } else tools.push(r);
      changed = true;
    }
  }
  let out: ChatMessage = changed ? { ...local, tools } : local;
  if (!local.reasoning && remote.reasoning) {
    const at = local.metrics?.firstTokenAt ?? local.createdAt;
    const step: TraceStep = { id: `thinking-${local.trace?.length ?? 0}`, kind: 'thinking', at, endedAt: at, data: { from: 0, to: remote.reasoning.length } };
    out = { ...out, reasoning: remote.reasoning, trace: [...(local.trace ?? []), step] };
  }
  return out;
}

function stripUndefined<T extends Record<string, unknown>>(o: T): Partial<T> {
  const r: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (r as Record<string, unknown>)[k] = v;
  return r;
}

/**
 * Enrich the just-finished assistant message `msg` (whose user prompt was `userText`) from the latest
 * stored rows of its session. The stored turn is found by overlapping tool call ids, else by the
 * matching user text (searching from the newest turn). Returns `msg` unchanged when no turn matches.
 */
export function enrichTurn(msg: ChatMessage, rows: RemoteMessage[], userText?: string): ChatMessage {
  const mapped = mapRemoteMessages(rows);
  const localIds = new Set(msg.tools.map((t) => t.id));
  let target: ChatMessage | undefined;
  let byText = false;
  if (localIds.size) target = mapped.find((m) => m.role === 'assistant' && m.tools.some((t) => localIds.has(t.id)));
  if (!target && userText !== undefined) {
    for (let i = mapped.length - 1; i >= 0; i--) {
      const m = mapped[i];
      if (m.role === 'user' && sameUserText(m.text, userText)) {
        const next = mapped[i + 1];
        if (next?.role === 'assistant') {
          target = next;
          byText = true;
        }
        break;
      }
    }
  }
  if (!target) return msg;
  return mergeAssistantDetails(msg, target, byText || localIds.size === 0);
}

/**
 * True when a finished turn is worth one messages fetch: it used tools whose arguments/results we do
 * not have yet (the stream only carries a preview label). Reasoning streams live (`reasoning_streaming`),
 * so tool-less turns are not fetched.
 */
export function needsDetails(msg: ChatMessage): boolean {
  return msg.role === 'assistant' && msg.tools.some((t) => t.detail?.input === undefined && t.detail?.output === undefined);
}
