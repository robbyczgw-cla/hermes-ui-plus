/**
 * Meta (titles & follow-ups) – pure logic, tested in core.test.ts.
 *
 *   POST {origin}/bridge/meta   Bearer, {messages:[{role,content}] (≤ 4), want:['title','followups'], lang?}
 *                               → {title?, followups?, model, ms, cached?}
 *   errors: {error:{message,type,code}}; 404 code feature_off = bridge has no ANTHROPIC_API_KEY.
 */
import type { HuiNode } from '../protocol/types.ts';

export type MetaWant = 'title' | 'followups';
export type MetaTurn = { role: 'user' | 'assistant'; content: string };
export type MetaConn = { baseUrl: string; apiKey: string };
export type MetaResult = { title?: string; followups?: string[]; model?: string; ms?: number; cached?: boolean };

export const META_LIMITS = { turns: 4, charsPerTurn: 1200, followups: 3, followupChars: 60, titleWords: 6, timeoutMs: 4000 } as const;

/** Structural subset of settings/profiles ConnectionProfile (kept local: no cross-module import). */
export type ProfileLike = { kind: string; baseUrl: string; apiKey: string; bridge?: boolean };
/** Structural subset of hermes ChatMessage. */
export type MetaMessage = { id: string; role: string; text: string; status: string };

export function bridgeOrigin(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}
export const metaUrl = (baseUrl: string) => `${bridgeOrigin(baseUrl)}/bridge/meta`;

/** Meta needs the UI bridge: Hermes profiles with `bridge: true`. Others → null. */
export function metaConnFromProfile(p: ProfileLike | null | undefined): MetaConn | null {
  if (!p || p.kind !== 'hermes' || !p.bridge || !p.baseUrl.trim()) return null;
  return { baseUrl: p.baseUrl, apiKey: p.apiKey };
}

export class MetaError extends Error {
  code: 'feature_off' | 'timeout' | 'http' | 'network' | 'invalid';
  status?: number;
  constructor(code: MetaError['code'], message: string, status?: number) {
    super(message);
    this.name = 'MetaError';
    this.code = code;
    this.status = status;
  }
}

// ───────────────────────── message preparation ─────────────────────────

/** Remove fenced code/hui/hui-html blocks (closed or still open) and collapse whitespace. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.ceil(max * 0.6);
  return `${text.slice(0, head)} […] ${text.slice(text.length - (max - head))}`;
}

/** Last ≤ 4 finished text turns, text only (no hui/code blocks), truncated; empty turns dropped. */
export function buildMetaMessages(messages: readonly MetaMessage[]): MetaTurn[] {
  const turns: MetaTurn[] = [];
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    if (m.role === 'assistant' && m.status !== 'done') continue;
    const content = clip(plainText(m.text), META_LIMITS.charsPerTurn);
    if (content) turns.push({ role: m.role, content });
  }
  return turns.slice(-META_LIMITS.turns);
}

// ───────────────────────── interactive-node detection ─────────────────────────

export const INTERACTIVE_HUI_TYPES: ReadonlySet<string> = new Set([
  'choice', 'form', 'slots', 'confirm', 'checklist', 'calc', 'quiz',
]);

function walk(value: unknown, depth: number): boolean {
  if (depth > 12 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((v) => walk(v, depth + 1));
  const o = value as Record<string, unknown>;
  if (typeof o.type === 'string' && INTERACTIVE_HUI_TYPES.has(o.type)) return true;
  return Object.values(o).some((v) => walk(v, depth + 1));
}

const FENCE_RE = /```hui[ \t]*\r?\n([\s\S]*?)(?:```|$)/g;
const TYPE_RE = /"type"\s*:\s*"(choice|form|slots|confirm|checklist|calc|quiz)"/;

/** True if the answer contains a ```hui block with an interactive node (also nested; tolerant of invalid/unclosed JSON). */
export function hasInteractiveHui(markdown: string): boolean {
  for (const m of markdown.matchAll(FENCE_RE)) {
    const body = m[1].trim();
    if (!body) continue;
    try {
      if (walk(JSON.parse(body), 0)) return true;
    } catch {
      if (TYPE_RE.test(body)) return true;
    }
  }
  return false;
}

// ───────────────────────── turn detection + planning ─────────────────────────

/** Statuses of the previous render, keyed by message id. */
export type StatusMap = ReadonlyMap<string, string>;

export const statusMapOf = (messages: readonly MetaMessage[]): Map<string, string> => new Map(messages.map((m) => [m.id, m.status]));

/** Assistant messages that just went streaming → done (opening an old chat yields none). */
export function newlyFinished(prev: StatusMap, messages: readonly MetaMessage[]): MetaMessage[] {
  return messages.filter((m) => m.role === 'assistant' && m.status === 'done' && prev.get(m.id) === 'streaming' && m.text.trim());
}

export type MetaPlan = { want: MetaWant[] };

/**
 * What to ask for after `msg` finished. Title: only once per conversation (`titleDone`) and only when the
 * conversation has no title yet. Follow-ups: every turn unless the answer is interactive.
 */
export function planMeta(
  msg: MetaMessage,
  o: { titleDone: boolean; hasTitle: boolean; followups: boolean; title: boolean },
): MetaPlan | null {
  const want: MetaWant[] = [];
  if (o.title && !o.titleDone && !o.hasTitle) want.push('title');
  if (o.followups && !hasInteractiveHui(msg.text)) want.push('followups');
  return want.length ? { want } : null;
}

// ───────────────────────── response + rendering ─────────────────────────

export function parseMetaResponse(raw: unknown): MetaResult {
  const o = (typeof raw === 'string' ? safeJson(raw) : raw) as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') throw new MetaError('invalid', 'Ungültige Meta-Antwort');
  const out: MetaResult = {};
  if (typeof o.title === 'string' && o.title.trim()) out.title = o.title.trim();
  if (Array.isArray(o.followups)) out.followups = cleanFollowups(o.followups);
  if (typeof o.model === 'string') out.model = o.model;
  if (typeof o.ms === 'number') out.ms = o.ms;
  if (o.cached === true) out.cached = true;
  return out;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export function cleanFollowups(items: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const i of items) {
    if (typeof i !== 'string') continue;
    const t = i.replace(/\s+/g, ' ').trim();
    if (!t || t.length > META_LIMITS.followupChars || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length === META_LIMITS.followups) break;
  }
  return out;
}

/** Follow-ups as the existing `suggestions` hui node (tap = send as user message). Null if nothing to show. */
export function followupsNode(items: readonly string[] | undefined | null, id?: string): HuiNode | null {
  const list = cleanFollowups(items ?? []);
  if (!list.length) return null;
  return { type: 'suggestions', items: list, ...(id ? { id } : {}) };
}

/** User-facing (German) message for a MetaError – meta is best-effort, callers normally stay silent. */
export function metaErrorText(e: unknown): string {
  if (e instanceof MetaError) {
    if (e.code === 'feature_off') return 'Titel und Vorschläge sind auf der Bridge nicht aktiviert.';
    if (e.code === 'timeout') return 'Titel und Vorschläge: Zeitüberschreitung.';
  }
  return 'Titel und Vorschläge sind gerade nicht verfügbar.';
}
