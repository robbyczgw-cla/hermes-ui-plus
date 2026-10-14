/**
 * Push notifications + live inbox (owner: push workstream). Server side and setup: docs/SELF-HOSTING.md "Push notifications".
 *
 *   <PushHost>                      once in the root layout (inside Connection + Conversations providers)
 *   <PushSettingsSection profile/>  settings → Benachrichtigungen
 *   useInboxDelivery(convId, chat)  chat sessions with replaceMessages (agent servers)
 *   useInboxHandler(convId, fn)     Hermes chats: complete an interrupted answer from its session's inbox event
 *   useInboxConnected(profileId, fn) the live inbox (re)connected
 *   useApprovalOpener(convId, chat.openApproval, chat.checkApprovals)  notification tap / banner → pending approval card
 *   openPendingApproval(convId, runId)  show that card (adapter to the approval UI, approvalInbox.ts)
 */
export { PushHost } from './PushHost';
export { PushSettingsSection, pushSearchTexts } from './PushSettingsSection';
export { useApprovalOpener, useInboxConnected, useInboxDelivery, useInboxHandler } from './inboxBus';
export { openPendingApproval } from './approvalInbox';
