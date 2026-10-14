/**
 * Meta: automatic chat titles and follow-up suggestions via POST /bridge/meta (Claude Haiku on the bridge).
 * Integration guide: ./INTEGRATION.md
 *
 * Hooks  useAutoTitle(messages, {bridge, conversationKey, hasTitle, onTitle}) · useFollowups(messages, {bridge, conversationKey}) → HuiNode | null
 * Client fetchMeta(bridge, messages, want) · metaConnFromProfile(profile)
 * Pure   buildMetaMessages, hasInteractiveHui, planMeta, newlyFinished, followupsNode, parseMetaResponse
 */
export { fetchMeta } from './bridge';
export { useAutoTitle, useFollowups } from './hooks';
export {
  bridgeOrigin, buildMetaMessages, cleanFollowups, followupsNode, hasInteractiveHui, INTERACTIVE_HUI_TYPES, META_LIMITS,
  MetaError, metaConnFromProfile, metaErrorText, metaUrl, newlyFinished, parseMetaResponse, planMeta, plainText, statusMapOf,
} from './core';
export type { MetaConn, MetaMessage, MetaPlan, MetaResult, MetaTurn, MetaWant, ProfileLike } from './core';
