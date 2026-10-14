export { streamChat, respondApproval, checkHealth, listModels, HermesError, isHermesError } from './client';
export { describeError as describeHermesError } from './stream';
export type { StreamChatParams, StreamChatResult, HealthResult } from './client';
export { useHermesChat, newSessionId } from './useHermesChat';
export type { UseHermesChat, UseHermesChatOptions } from './useHermesChat';
export { createSseParser, createUtf8Decoder } from './sse';
export type { SseFrame, SseParser } from './sse';
export { mapFrame } from './events';
export { applyEvent, finalize, createUserMessage, createAssistantMessage } from './chatState';
export type * from './types';
export { recordApprovalAnswer, compactDetails, sanitize, capPayload, thinkingRange, DETAIL_MAX_BYTES } from './trace';
// sessions API, capabilities, per-chat model options (sessions workstream)
export { hermesSessions, fetchCapabilities, fetchModelOptions } from './client';
export { createSessionsClient, apiRoot, isUnsupportedError, isNotFoundError, sessionErrorText } from './sessions';
export type { RemoteSession, RemoteMessage, RemoteToolCall, SessionsClient, SessionPage, MessagesPage } from './sessions';
export { mapRemoteMessages, enrichTurn, mergeAssistantDetails, needsDetails } from './sessionMapping';
export {
  parseCapabilities,
  parseModelOptions,
  modelCapsFor,
  modelOptionsBody,
  effectiveChatOptions,
  sanitizeChatOptions,
  chatOptionsSummary,
  hasFeature,
  REASONING_EFFORTS,
  REASONING_LABELS,
} from './capabilities';
export type { HermesCapabilities, ModelCaps, ModelOptionsCatalog, HermesChatOptions, HermesReasoning, HermesReasoningEffort } from './capabilities';
export { sessionsSupported } from './support';
export { useHermesCapabilities } from './useHermesCapabilities';
export type { UseHermesCapabilities } from './useHermesCapabilities';
export { HermesOptionsSheet } from './ui/HermesOptionsSheet';
export type { HermesOptionsSheetProps } from './ui/HermesOptionsSheet';
