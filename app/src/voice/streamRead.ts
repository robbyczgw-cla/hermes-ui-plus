/**
 * Read-aloud while an answer is still streaming (pure, streamRead.test.ts).
 *
 * `createStreamReader()` turns the growing markdown of one answer into stable pieces: text that will not change
 * any more and can be converted with toSpeechText on its own. A piece ends
 *  - at a blank line, or after a complete list item / heading line (outside fenced blocks and tables),
 *  - or inside the paragraph that is still streaming, after the last complete sentence (chunking.ts rules; only
 *    when the inline markup before it is balanced and the paragraph is not a table).
 * An open fence (```hui component, code) holds everything from its first line until it is closed.
 *
 * `createLiveReader()` adds the agent-turn rules on top (Hermes writes short interim notes before tool calls,
 * hermes/progressNotes.ts): text before a tool call is a note, so a section (text since the last tool call)
 * is only started once it has `minChars` of stable text or a finished paragraph; held text of a section that a
 * tool call ends is dropped. Once a section started, every further stable piece is handed out as it arrives.
 */
import { lastSentenceEnd } from './chunking.ts';

const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;
const BLOCK_LINE_RE = /^\s{0,3}(?:#{1,6}\s|[-*+•]\s|\d{1,3}[.)]\s)/;

export type StreamReader = {
  /** stable markdown pieces that became available with this text (in order, never overlapping) */
  push(text: string, done: boolean): string[];
  /** absolute offset up to which text was handed out */
  readonly consumed: number;
  /** skip everything before `offset` (dropped text, e.g. an interim note) */
  skipTo(offset: number): void;
};

export function createStreamReader(): StreamReader {
  let consumed = 0;
  // incremental line scan: complete lines before `scanned` are classified
  let scanned = 0;
  let fenceAt = -1; // start of the open fence line, -1 = none
  let fenceMark = '';
  let blockEnd = 0; // last offset after which nothing can change any more (outside fences)

  const balanced = (s: string) => {
    const ticks = (s.match(/`/g) ?? []).length;
    const stars = (s.match(/\*\*/g) ?? []).length;
    const open = (s.match(/\[/g) ?? []).length;
    const close = (s.match(/\]/g) ?? []).length;
    return ticks % 2 === 0 && stars % 2 === 0 && open === close;
  };

  return {
    get consumed() {
      return consumed;
    },
    skipTo(offset: number) {
      if (offset > consumed) consumed = offset;
    },
    push(text: string, done: boolean): string[] {
      let end: number;
      if (done) {
        end = text.length;
      } else {
        for (let nl = text.indexOf('\n', scanned); nl !== -1; nl = text.indexOf('\n', scanned)) {
          const line = text.slice(scanned, nl);
          const start = scanned;
          scanned = nl + 1;
          if (fenceAt >= 0) {
            const t = line.trim();
            if (t.length >= fenceMark.length && t[0] === fenceMark[0] && /^(`{3,}|~{3,})$/.test(t)) {
              fenceAt = -1;
              blockEnd = scanned;
            }
            continue;
          }
          const fm = line.match(FENCE_OPEN_RE);
          if (fm) {
            fenceAt = start;
            fenceMark = fm[1];
            continue;
          }
          if (!line.trim()) blockEnd = scanned;
          else if (BLOCK_LINE_RE.test(line) && !line.includes('|')) blockEnd = scanned;
        }
        end = blockEnd;
        // the paragraph still streaming (not a fence, not a table): up to its last complete sentence
        const limit = fenceAt >= 0 ? fenceAt : text.length;
        const from = Math.max(blockEnd, consumed);
        if (from < limit) {
          const open = text.slice(from, limit);
          if (!open.includes('|') && !FENCE_OPEN_RE.test(open)) {
            const cut = lastSentenceEnd(open);
            if (cut > 0 && balanced(text.slice(blockEnd, from + cut))) end = Math.max(end, from + cut);
          }
        }
      }
      if (end <= consumed) return [];
      const piece = text.slice(consumed, end);
      consumed = end;
      return piece.trim() ? [piece] : [];
    },
  };
}

/** Structural subset of the streaming assistant message. */
export type LiveAnswer = { text: string; status: string; tools?: readonly { textAt?: number }[] };

export type LiveReader = {
  /** pieces to read now (empty while held) */
  push(m: LiveAnswer): string[];
  /** something of this answer was handed out (the caller then must not read the whole answer at the end) */
  readonly started: boolean;
};

/** text length at the start of the latest tool call (the current section starts there) */
function sectionStart(m: LiveAnswer): number {
  let cut = 0;
  for (const t of m.tools ?? []) {
    const at = t.textAt;
    if (typeof at === 'number' && Number.isFinite(at) && at > cut && at <= m.text.length) cut = at;
  }
  return cut;
}

export function createLiveReader(opts: { minChars?: number } = {}): LiveReader {
  const minChars = opts.minChars ?? 100;
  const reader = createStreamReader();
  let section = 0;
  let sectionStarted = false;
  let started = false;
  let held = '';
  let prev = '';
  let broken = false;

  return {
    get started() {
      return started;
    },
    push(m: LiveAnswer): string[] {
      // the reader assumes an append-only text; a replaced answer (recovery, reformat) ends live reading
      const c = reader.consumed;
      const k = Math.max(0, c - 64); // spot check of the text already handed out (cheap per tick)
      if (broken || m.text.length < prev.length || m.text.slice(k, c) !== prev.slice(k, c)) {
        broken = true;
        return [];
      }
      prev = m.text;
      const done = m.status !== 'streaming';
      const cut = sectionStart(m);
      if (cut > section) {
        // a tool call ended the section: what was held is an interim note → never read
        section = cut;
        sectionStarted = false;
        held = '';
        reader.skipTo(cut);
      }
      const pieces = reader.push(m.text, done);
      if (sectionStarted) return pieces;
      held += pieces.join('');
      if (done) {
        // nothing started this turn: the caller reads the whole answer (with the note rules) as before;
        // an earlier section already plays: the final section follows it, however short
        const out = started && held.trim() ? [held] : [];
        held = '';
        return out;
      }
      const stable = held.trim();
      if (stable.length >= minChars || /\n\s*\n\s*\S/.test(held)) {
        sectionStarted = true;
        started = true;
        const out = [held];
        held = '';
        return out;
      }
      return [];
    },
  };
}
