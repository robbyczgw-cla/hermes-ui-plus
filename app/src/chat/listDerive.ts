// Per-tick derivations of the message list (MessageList.tsx) without O(n) JS work on every streaming tick:
//  - `createReversedList`: the inverted FlatList's data as a real reversed array, a NEW array per change (a streaming
//    tick copies the previous one natively and replaces index 0) – FlatList re-renders on the data identity alone;
//  - `createListDerive`: `findEditPairs` / `reformattedSources` computed once for the stable prefix (every message
//    but the last) and only the last message (the streaming answer, or a just-sent request) re-checked per tick.
// The results are identical to running both functions on the whole list (listDerive.test.ts).
import type { Attachment } from '../attachments/types.ts';
import { findEditPairs } from '../imageedit/core.ts';
import { parseReformatKind, reformattedSources } from './reformat.ts';

type Msg = { id: string; role: string; text: string; attachments?: readonly Attachment[] };

/**
 * Memoizing reverser (one per list): `rev(items)` is a REAL array equal to `[...items].reverse()` (no Proxy: FlatList /
 * VirtualizedList may read descriptors, keys or write-check it). Same `items` → the same array; any change → a NEW
 * array, so the FlatList re-renders on `data` alone and needs no `extraData` – that is an argument of FlatList's
 * memoized item renderer: a per-tick `extraData` made a new `renderItem` per tick and re-rendered EVERY mounted row
 * (MessageList.tsx). When only the last item changed (a streaming tick: same length, identical prefix objects) the
 * previous array is copied (`slice`, cheaper than re-reversing element by element) and index 0 replaced.
 */
export function createReversedList<T>(): (items: readonly T[]) => T[] {
  let from: readonly T[] | null = null;
  let rev: T[] = [];
  return (items) => {
    if (items === from) return rev;
    const n = items.length;
    if (from && n > 0 && from.length === n && samePrefix(from, items, n - 1)) {
      rev = rev.slice();
      rev[0] = items[n - 1];
    } else {
      rev = new Array<T>(n);
      for (let i = 0; i < n; i++) rev[i] = items[n - 1 - i];
    }
    from = items;
    return rev;
  };
}

export type ListDerived = { editPairs: Map<string, string>; reformatted: Set<string> };

/** true when `a` and `b` hold the identical message objects at 0..len-1 (pointer compare, no text scans) */
function samePrefix<T>(a: readonly T[], b: readonly T[], len: number): boolean {
  if (a.length < len || b.length < len) return false;
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Memoizing deriver (one per list). `derive(messages)` equals
 * `{ editPairs: findEditPairs(messages), reformatted: reformattedSources(messages) }`; the prefix results keep their
 * identity while only the last message changes.
 */
export function createListDerive<M extends Msg>(): (messages: readonly M[]) => ListDerived {
  let cachedFrom: readonly M[] = [];
  let cachedLen = -1;
  let prefixPairs = new Map<string, string>();
  let prefixReform = new Set<string>();
  /** newest assistant answer with text in the prefix (the target of a reformat request right after it) */
  let lastAnswer: string | null = null;

  return (messages) => {
    const n = messages.length;
    const pl = Math.max(0, n - 1);
    if (pl !== cachedLen || !samePrefix(cachedFrom, messages, pl)) {
      const prefix = messages.slice(0, pl);
      prefixPairs = findEditPairs(prefix);
      prefixReform = reformattedSources(prefix);
      lastAnswer = null;
      for (let i = pl - 1; i >= 0; i--) {
        const m = prefix[i];
        if (m.role === 'assistant' && m.text.trim()) {
          lastAnswer = m.id;
          break;
        }
      }
      cachedLen = pl;
    }
    cachedFrom = messages;
    const tail = messages[n - 1];
    if (!tail) return { editPairs: prefixPairs, reformatted: prefixReform };

    let editPairs = prefixPairs;
    if (tail.role === 'assistant' && n >= 2) {
      const extra = findEditPairs([messages[n - 2], tail]);
      if (extra.size) editPairs = new Map([...prefixPairs, ...extra]);
    }
    let reformatted = prefixReform;
    if (tail.role === 'user' && lastAnswer && !prefixReform.has(lastAnswer) && parseReformatKind(tail.text)) {
      reformatted = new Set(prefixReform).add(lastAnswer);
    }
    return { editPairs, reformatted };
  };
}
