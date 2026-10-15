/**
 * Quick answers ("Schnellfrage", ⚡): one-off questions answered in ~1.5–2 s by a fast model of the user's Hermes,
 * without the agent (no memory, tools, live data or session). Server side: bridge/src/quick.mjs → the optional Hermes
 * plugin (docs/HERMES-PLUGIN.md); the offline demo has a canned backend (demo.ts).
 *
 *   core.ts          pure: URLs, config parsing, request/history (≤ 6 turns), 24 h expiry, stamps, errors, hand-off
 *   availability.ts  pure cache of GET /bridge/quick/config per bridge (markOff on 404 feature_off)
 *   stream.ts        SSE through hermes/stream.ts (shared parser, errors, abort)
 *   demo.ts          canned answers (calc + table cards) for the demo
 *   store.ts         local thread per connection + quick settings (AsyncStorage)
 *   nav.ts           chat ⇄ quick thread switch, draft hand-over
 *   hooks.ts         useQuickAvailability (app instance, foreground re-check)
 *   useQuickChat.ts  useHermesChat-compatible hook → ChatView renders the thread
 *   QuickSession.tsx lazy: the thread (ChatView `quick` mode) + "Mit Hermes weitermachen"
 *   QuickHeader / QuickEmptyState / QuickMeta / QuickSettings  UI
 *
 * Wiring: ChatScreen (QuickSlot, chat covered while the thread shows), ChatView (`quick` prop, composer ⚡,
 * start-screen pill), Composer (⚡ switch, long-press Send), MessageItem (⚡ meta line, hand-off), SettingsScreen.
 * Only Hermes connections via the UI bridge whose /bridge/quick/config says available (or the demo) show anything.
 */
export { useQuickAvailability, refreshQuickAvailability } from './hooks';
export { closeQuick, openQuick, useQuickOpen } from './nav';
export { useQuickSettings } from './store';
export { quickBackendFor, quickConversationId } from './core';
export type { QuickBackend, QuickConfig, QuickModel, QuickSettings } from './core';
