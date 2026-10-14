/**
 * Loader library + "waiting delight" (owner: waiting-delight workstream).
 *   <Loader kind="orbit" size={28} />            any of LOADER_KINDS, theme-coloured, UI-thread animation
 *   <WaitingIndicator state mode seed persona startedAt variant="row|badge" />
 *                                                context-aware indicator + rotating status line
 *   waiting.ts                                   pure logic (state → indicator, phrase pools, rotation, tiers)
 */
export { Loader, LOADERS, loaderWidth } from './Loader';
export { WaitingIndicator, WAITING_ROW_HEIGHT } from './WaitingIndicator';
export type { WaitingIndicatorProps } from './WaitingIndicator';
export { useAppActive, useLoop } from './clock';
export type { LoaderProps } from './clock';
export * from './waiting';
