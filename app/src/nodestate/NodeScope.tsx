import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';

export type NodeScopeValue = {
  conversationId: string;
  messageId: string;
  /** creation time of the message (epoch ms): orders nodes by message, not by first render */
  createdAt?: number;
};

const NodeScopeContext = createContext<NodeScopeValue | null>(null);

/**
 * Wrap each assistant message: nodes below it persist their state under
 * `conversationId` + `messageId:nodeId`. Outside a scope `useNodeState` is in-memory only.
 */
export function NodeScope({ conversationId, messageId, createdAt, children }: NodeScopeValue & { children?: ReactNode }) {
  const value = useMemo(() => ({ conversationId, messageId, createdAt }), [conversationId, messageId, createdAt]);
  return createElement(NodeScopeContext.Provider, { value }, children);
}

export function useNodeScope(): NodeScopeValue | null {
  return useContext(NodeScopeContext);
}
