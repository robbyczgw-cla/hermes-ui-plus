/**
 * Display split of an agent turn (UX1): Hermes writes short interim notes before its tool calls
 * ("Ich lade kurz das UI-Format…", "Die Shortlist ist da, ich prüfe noch die Preise…"). They arrive as
 * normal answer text. Text that is immediately followed by a tool call in the same turn is a progress
 * note (shown as a status line in the tool timeline); the final answer is the text after the last tool
 * round. The stored message text stays complete – this is display only.
 *
 * Cuts come from `ToolEvent.textAt` (live: text length at the first `hermes.tool.progress`; history: offset
 * of the assistant row with `tool_calls` in the joined text, sessionMapping.ts). Nothing is lost:
 *  - pieces with fenced blocks (```hui components, code) stay in the answer,
 *  - a finished turn whose last tool round left no text keeps its last note as the answer.
 *
 * Pure TS (erasable syntax only) so `node --test` can run it.
 */
import type { ChatMessage } from './types';

export type ProgressNote = {
  /** trimmed note text */
  text: string;
  /** id of the tool call that followed the note */
  toolId: string;
  /** start of that tool call (ms) – the note's place in the timeline */
  at: number;
};

export type AnswerSplit = {
  /** text shown as the answer body (equals `message.text` when there are no notes) */
  answer: string;
  /** interim notes in order */
  notes: ProgressNote[];
};

type Msg = Pick<ChatMessage, 'text' | 'tools' | 'status' | 'role'>;

const NONE = (text: string): AnswerSplit => ({ answer: text, notes: [] });

const cache = new WeakMap<object, { text: string; status: string; split: AnswerSplit }>();

/** Split `msg.text` into interim notes + final answer (memoized per tools array / text / status). */
export function splitProgressNotes(msg: Msg): AnswerSplit {
  const { text, tools } = msg;
  if (msg.role !== 'assistant' || !tools.length || !text) return NONE(text);
  const hit = cache.get(tools);
  if (hit && hit.text === text && hit.status === msg.status) return hit.split;
  const split = compute(text, tools, msg.status === 'streaming');
  cache.set(tools, { text, status: msg.status, split });
  return split;
}

function compute(text: string, tools: Msg['tools'], streaming: boolean): AnswerSplit {
  // first call per offset (parallel calls share one cut)
  const cuts: { at: number; toolId: string; startedAt: number }[] = [];
  const seen = new Set<number>();
  for (const t of tools) {
    const at = t.textAt;
    if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0 || at > text.length || seen.has(at)) continue;
    seen.add(at);
    cuts.push({ at, toolId: t.id, startedAt: t.startedAt });
  }
  if (!cuts.length) return NONE(text);
  cuts.sort((a, b) => a.at - b.at);
  const notes: ProgressNote[] = [];
  const kept: string[] = [];
  let prev = 0;
  for (const c of cuts) {
    const piece = text.slice(prev, c.at);
    prev = c.at;
    const trimmed = piece.trim();
    if (!trimmed) continue;
    // components / code before a tool call are content, not a note
    if (/^ {0,3}(```|~~~)/m.test(piece)) kept.push(trimmed);
    else notes.push({ text: trimmed, toolId: c.toolId, at: c.startedAt });
  }
  let final = text.slice(prev).trim();
  if (!notes.length) return NONE(text);
  // a finished turn that ended with a tool round (memory save, …): its last note is the answer
  if (!final && !kept.length && !streaming) final = notes.pop()!.text;
  if (!notes.length) return NONE(text);
  const answer = kept.length ? [...kept, final].filter(Boolean).join('\n\n') : final;
  return { answer, notes };
}

/** The final answer text (drawer preview, notifications, read aloud). */
export function answerText(msg: Msg): string {
  return splitProgressNotes(msg).answer;
}
