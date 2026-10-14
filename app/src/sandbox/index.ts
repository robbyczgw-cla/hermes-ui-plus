export { HtmlBlock, STREAM_THROTTLE_MS } from './HtmlBlock';
export type { HtmlBlockProps } from './HtmlBlock';
export type { HtmlBlockTheme } from './theme';
export type { HtmlBlockAction, SandboxMessage } from './messages';
export { parseSandboxMessage, normalizeOpenUrl, isAllowedNavigation, LIMITS as SANDBOX_LIMITS } from './messages';
export { processHtml } from './partialHtml';
export type { ProcessedHtml, SandboxScript } from './partialHtml';
export { buildCsp, CDN_ORIGINS, IMAGE_ORIGINS } from './shell';
// Not re-exported (startup bundle): the ~19 KB demo samples and the simulated stream – import
// './sandboxSamples' / './useSimulatedStream' directly where needed (gallery, tests).
