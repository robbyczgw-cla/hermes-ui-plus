/**
 * Node state – persisted per-node interactive state (see INTEGRATION.md).
 *
 *   <NodeStateProvider>                       once near the root (flushes on background)
 *     <NodeScope conversationId messageId>    around each assistant message
 *       … const [s, setS] = useNodeState<T>(nodeId, initial)
 *   deleteConversationState(conversationId)   when a chat is deleted
 */
export { NodeScope, useNodeScope } from './NodeScope';
export type { NodeScopeValue } from './NodeScope';
export { NodeStateProvider, useNodeStateStore } from './NodeStateProvider';
export { useNodeState } from './useNodeState';
export type { NodeStateOptions, NodeStateSetter } from './useNodeState';
export { getNodeStateStore, deleteConversationState, deleteMessageState, exportNodeState, exportAllNodeState } from './defaultStore';
export { NodeStateStore } from './store.ts';
export type { KeyValueStorage, StoreOptions } from './store.ts';
export { nodeKey, splitNodeKey, MAX_NODE_BYTES, MAX_CONVERSATION_BYTES } from './model.ts';
export type { NodeRecord, ConversationRecord } from './model.ts';
