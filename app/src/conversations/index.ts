/**
 * Conversations (owner: conversations workstream). See INTEGRATION.md for wiring.
 *
 *   <ConversationsProvider>            once in the root layout
 *   useConversations()                 list / create / remove / rename / pin / search / get / activeId
 *   useConversation(id)                messages (initialMessages) / meta / save / setSessionId
 *   <ConversationDrawer/>, <ConversationList/>
 */
export { ConversationsProvider, useConversations, useConversation, useStorageFullNotice, useStorageFullToast } from './ConversationsProvider';
export type { ConversationsApi, UseConversation } from './ConversationsProvider';
export { ConversationDrawer } from './ConversationDrawer';
export type { ConversationDrawerProps } from './ConversationDrawer';
export { ConversationList } from './ConversationList';
export { BulkDeleteDialog } from './BulkDeleteDialog';
export type { BulkDeleteDialogProps } from './BulkDeleteDialog';
export { useBulkDelete } from './ConversationsProvider';
export type { ConversationListProps } from './ConversationList';
export type { ConversationMeta, ProfileRef, ProfileKind, SearchHit } from './types';
export type { StorageLike } from './repo';
export { makeTitle } from './title';
export { groupConversations } from './group';
// Hermes sessions as source of truth (see INTEGRATION.md "Hermes-Sitzungen")
export { useHermesSessionSync, useRemoteTranscript, useApplyRemoteTranscript, useRemotePrefetch, syncEnabled, syncFilterOf } from './hermesSync';
export type { HermesSessionSync, OlderSessions, RemoteActions, RemoteTranscript, SessionSyncOptions, SyncProfile, SyncStatus } from './hermesSync';
export { DEFAULT_SYNC_SOURCES, sourceLabel, mergeRemoteSessions, reconcileTranscript, needsRemoteLoad, syncSources, sessionAllowed, isAppConversation, type SyncFilter } from './remoteSync';
export type { RemoteInfo } from './types';
export { ConversationSidebar } from './ConversationSidebar';
export type { ConversationSidebarProps } from './ConversationSidebar';
export { setSidebarPrefs, toggleSidebar, useSidebarPrefs } from './sidebarState';
