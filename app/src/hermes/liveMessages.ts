/**
 * Live text store: the newest state of a streaming answer, keyed by message id, outside React state.
 *
 * useHermesChat applies every stream event to its ref at once and mirrors the ref into React state on a throttle
 * (throttle.ts). Most of those ticks only grow the answer's text or reasoning. Committing them re-rendered the chat
 * view, the message list and the whole answer frame per tick (~60 % of the JS time while an answer streams,
 * docs/PERF.md). Such ticks go here instead: only the answer's live part subscribes (chat/useLiveMessage.ts) and
 * re-renders. The list state is committed at the turn's boundaries (`liveOnlyTick`): every change that is not text or
 * reasoning (start, tools, approvals, status / connection notes, finish, error, stop), the first text and reasoning,
 * every code / interactive block fence, a replaced text, and at least every CHECKPOINT_MS (partial persistence, find,
 * the auto-read join check run on the committed list).
 *
 * An entry is never older than the committed message of its id: a commit sets it to the committed object (silently,
 * the committing render reads it), a live tick to the newer ref state; a commit of a finished answer drops it.
 */
import type { ChatMessage } from './types';
import { textAppendRun } from './chatState.ts';

type Listener = () => void;

const latest = new Map<string, ChatMessage>();
const listeners = new Map<string, Set<Listener>>();

export const liveMessages = {
  get(id: string): ChatMessage | undefined {
    return latest.get(id);
  },
  subscribe(id: string, fn: Listener): () => void {
    let set = listeners.get(id);
    if (!set) listeners.set(id, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
      if (!set.size && listeners.get(id) === set) listeners.delete(id);
    };
  },
  /** a live-only tick: the newest state of a streaming answer; its subscribers re-render */
  publish(m: ChatMessage): void {
    if (latest.get(m.id) === m) return;
    latest.set(m.id, m);
    const set = listeners.get(m.id);
    if (set) for (const fn of [...set]) fn();
  },
  /**
   * The list was committed to React state. `tracked`: the id this list's owner keeps an entry for (or null); returns
   * the id to track now. The entry follows the committed streaming answer without notifying (the commit re-renders
   * it anyway); a finished, replaced or removed answer loses its entry.
   */
  commit(tracked: string | null, list: readonly ChatMessage[]): string | null {
    const last = list[list.length - 1];
    const streaming = last && last.role === 'assistant' && last.status === 'streaming' ? last : null;
    if (tracked !== null && tracked !== streaming?.id) latest.delete(tracked);
    if (!streaming) return null;
    latest.set(streaming.id, streaming);
    return streaming.id;
  },
  /** the owner is gone (chat hook unmounted) */
  drop(id: string | null): void {
    if (id !== null) latest.delete(id);
  },
};

/** `m`, or the newer live state of the same streaming answer (consumers that mix committed and live states) */
export function freshest<M extends { id: string; status: string }>(m: M): M | ChatMessage {
  if (m.status !== 'streaming') return m;
  return latest.get(m.id) ?? m;
}

/** a streaming answer is committed to the list at least this often, also when only its text grew */
export const CHECKPOINT_MS = 1000;

/** fields a live-only tick may change; any other change of the streaming answer is a commit boundary */
const LIVE_FIELDS = new Set<string>(['text', 'reasoning', 'trace', 'metrics']);

/**
 * May the throttled tick from `committed` (the list React has) to `next` (the hook's ref) go to the live store alone?
 * Only when nothing but the streaming last answer's text / reasoning (and their trace / metrics) grew, no fence
 * (```) arrived in the new text, the first text / reasoning is not the change, and the last commit is younger than
 * CHECKPOINT_MS.
 */
export function liveOnlyTick(committed: readonly ChatMessage[], next: readonly ChatMessage[], msSinceCommit: number): boolean {
  const n = next.length;
  if (committed === next || n === 0 || committed.length !== n || msSinceCommit >= CHECKPOINT_MS) return false;
  for (let i = 0; i < n - 1; i++) if (committed[i] !== next[i]) return false;
  const a = committed[n - 1];
  const b = next[n - 1];
  if (a === b) return false;
  if (a.id !== b.id || b.role !== 'assistant' || a.status !== 'streaming' || b.status !== 'streaming') return false;
  for (const k in b) if (!LIVE_FIELDS.has(k) && (a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) return false;
  for (const k in a) if (!LIVE_FIELDS.has(k) && !(k in b) && (a as Record<string, unknown>)[k] !== undefined) return false;
  if (b.text !== a.text) {
    // the first text, or a replaced one (textReplace starts a new append run; without a run: shorter or a changed tail)
    const run = textAppendRun(b);
    if (!a.text || b.text.length < a.text.length || run !== textAppendRun(a) || (!run && !extendsTail(a.text, b.text))) return false;
    // a code / interactive block opens or closes (its fence may straddle two ticks)
    if (b.text.indexOf('```', Math.max(0, a.text.length - 2)) !== -1) return false;
  }
  if (!a.reasoning && b.reasoning) return false; // the reasoning row appears
  return true;
}

/** `next` still ends `prev`'s last 64 chars at the same place (cheap per tick; the append run is the exact check) */
function extendsTail(prev: string, next: string): boolean {
  const k = Math.max(0, prev.length - 64);
  return next.startsWith(prev.slice(k), k);
}
