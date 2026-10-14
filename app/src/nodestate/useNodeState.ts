import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { nodeKey, resolveUpdate } from './model.ts';
import { useNodeScope } from './NodeScope';
import { useNodeStateStore } from './NodeStateProvider';

export type NodeStateOptions = {
  /** Schema version of `T`. Stored state with another version is ignored (→ `initial`). Default 1. */
  version?: number;
};

export type NodeStateSetter<T> = (next: T | ((prev: T) => T)) => void;

const noopSubscribe = () => () => {};

/**
 * Persisted interactive state of one node.
 *
 *   const [checked, setChecked] = useNodeState<Record<string, boolean>>(node.id, {});
 *
 * Inside `<NodeScope conversationId messageId>` the value is stored via the NodeStateStore
 * (AsyncStorage, debounced); outside any scope it is plain in-memory React state.
 * `initial` is only read on the first render / while nothing is stored. State must be
 * JSON-serialisable and ≤ 32 KB (larger writes are refused: value unchanged, warning logged).
 * Treat values as immutable.
 */
export function useNodeState<T>(nodeId: string, initial: T, options?: NodeStateOptions): [T, NodeStateSetter<T>] {
  const version = options?.version ?? 1;
  const scope = useNodeScope();
  const store = useNodeStateStore();
  const [initialValue] = useState(() => initial);
  const conversationId = scope?.conversationId ?? null;
  const key = scope ? nodeKey(scope.messageId, nodeId) : null;

  // in-memory fallback (also keeps hook order constant)
  const [local, setLocal] = useState<T>(initial);

  useEffect(() => {
    if (conversationId) void store.load(conversationId);
  }, [store, conversationId]);

  const subscribe = useCallback(
    (fn: () => void) => (conversationId && key ? store.subscribe(conversationId, key, fn) : noopSubscribe()),
    [store, conversationId, key],
  );
  const getSnapshot = useCallback(() => (conversationId && key ? store.peek(conversationId, key) : undefined), [store, conversationId, key]);
  const rec = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const stored = rec && rec.v === version ? (rec.data as T) : undefined;
  const value: T = conversationId ? (stored !== undefined ? stored : initialValue) : local;

  const setValue = useCallback<NodeStateSetter<T>>(
    (next) => {
      if (!conversationId || !key) {
        setLocal((prev) => resolveUpdate(prev, next));
        return;
      }
      const cur = store.peek(conversationId, key);
      const prev = cur && cur.v === version ? (cur.data as T) : initialValue;
      store.set(conversationId, key, resolveUpdate(prev, next), version);
    },
    [store, conversationId, key, version, initialValue],
  );

  return [value, setValue];
}
