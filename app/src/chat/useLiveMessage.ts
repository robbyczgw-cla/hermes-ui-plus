import { useEffect, useReducer, useRef } from 'react';
import type { ChatMessage } from '../hermes/types';
import { liveMessages } from '../hermes/liveMessages';

/**
 * The newest state of a streaming answer (hermes/liveMessages.ts): `message` as the list committed it, or the newer
 * live tick of it. The calling component re-renders per live tick, its parents (chat view, list, answer frame) do
 * not. A finished answer (and any answer of a backend without the store) is `message` itself.
 *
 * A plain state update, not useSyncExternalStore: that one always renders at sync priority, in a microtask right
 * inside the throttle's animation frame, and made more long frames on device than the list commit it replaces
 * (docs/PERF.md). A state update from the frame callback renders at default priority in its own task, as before.
 * Only this component reads the store, so there is nothing to tear.
 */
export function useLiveMessage(message: ChatMessage): ChatMessage {
  const id = message.id;
  const [, bump] = useReducer(next, 0);
  const live = liveMessages.get(id);
  const shown = useRef(live);
  shown.current = live;
  useEffect(() => {
    const off = liveMessages.subscribe(id, bump);
    // a tick between this render and the subscription
    if (liveMessages.get(id) !== shown.current) bump();
    return off;
  }, [id]);
  // an entry is never older than the committed answer (liveMessages.ts); the length check only guards that rule
  return live && message.status === 'streaming' && live.text.length >= message.text.length ? live : message;
}

const next = (n: number) => n + 1;
