/**
 * Hermes UI – design system & native HuiNode renderer (owner: design workstream).
 *
 * ── Theme ──────────────────────────────────────────────────────────────────────────
 *   theme.light / theme.dark            token sets (colors, spacing, radii, typography, shadows, fonts)
 *   useTheme(): Theme                   follows the system color scheme (or HuiThemeProvider override)
 *   <HuiThemeProvider scheme="dark">    optional subtree override ('light' | 'dark' | null = system)
 *   <HuiThemeProvider family="nord" accent="teal" fontSize="l" density="compact" reduceMotion="on">
 *                                       app-wide preferences (settings/PreferencesProvider mounts it); nested
 *                                       providers inherit unset props. Registry + contrast math: themes.ts / color.ts
 *   useMotionReduced()                  reduced motion incl. the app override (prefer over reanimated's hook)
 *   cssVariables(theme): string         `--h-*` CSS declarations for the hui-html sandbox:
 *                                       `<style>:root{${cssVariables(t)}}</style>`
 *
 * ── Rendering ─────────────────────────────────────────────────────────────────────
 *   <HuiView node={segment.node} streaming={!segment.complete} onAction={handle} />
 *     node       HuiNode | partial | null | unknown – never crashes; unknown type → JSON fallback card
 *     streaming  shows shimmer skeletons for missing parts + a trailing "more coming" row
 *
 *   onAction: HuiActionHandler = (action, values?, meta?) => void
 *     {type:'send', text}      suggestion chip tapped / button   → send `text` as user message
 *     {type:'submit'}          form submitted; `values` = Record<fieldName, string|number|boolean|null>,
 *                              `meta.formId` = form id           → send `[form:<formId>] ${JSON.stringify(values)}`
 *     {type:'open_url', url}   inline link / button              → open URL
 *     {type:'copy', text}      button                            → copy to clipboard
 *   The code block's own "Kopieren" button copies internally (not forwarded).
 *   `defaultActionHandler` performs copy/open_url (ignores send/submit) – call it from your
 *   handler for those two if you don't need custom behaviour.
 *
 *   <RouteSkeleton format={route.format} />   placeholder shaped like the announced component
 *
 * ── Gallery ───────────────────────────────────────────────────────────────────────
 *   <Gallery />   storybook screen (static + simulated streaming, light/dark toggle); lazy route /gallery
 *                 (import from './Gallery' directly – not part of this barrel)
 */
export * from './theme';
export * from './themes';
export { bestOn, contrast, ensureContrast, normalizeHex, mix, withAlpha } from './color';
export { HuiView } from './HuiView';
export type { HuiViewProps } from './HuiView';
export { defaultActionHandler, HuiContext, useHui } from './primitives/context';
export type { HuiActionHandler, HuiActionMeta, HuiFieldValue, HuiRenderContext } from './primitives/context';
export { RouteSkeleton, NodeSkeleton, ChartSkeleton, TableSkeleton, StatsSkeleton, ListSkeleton, CompareSkeleton, FormSkeleton, ImageSkeleton, CodeSkeleton } from './skeletons';
export type { RouteSkeletonProps } from './skeletons';

// primitives for other workstreams (chat bubbles, settings, …)
export { HText, InlineText, PressableScale, FadeIn, Surface, Badge, BlockTitle, textStyle, resolveColor } from './primitives/basics';
export type { HTextProps, PressableScaleProps } from './primitives/basics';
export { Skeleton, SkeletonLines } from './primitives/Skeleton';
export type { SkeletonProps } from './primitives/Skeleton';
export { Icon } from './primitives/Icon';
export { Toggle } from './primitives/Toggle';
export { Button } from './primitives/Button';
export type { ButtonProps, ButtonTone, ButtonVariant } from './primitives/Button';
export { Text, TextInput } from './primitives/Text';
export { SheetModal, SheetLayer, SheetGrabber, useSheetDialog } from './primitives/Sheet';
export type { SheetModalProps, SheetLayerProps } from './primitives/Sheet';
export { useIsWide, useLayoutClass, useKeyboardShortcuts } from './lib/useLayout';
export * from './lib/layout';
export type { IconName } from './primitives/Icon';
export { haptic, setHapticsEnabled, hapticsEnabled } from './primitives/haptics';
export type { HapticKind } from './primitives/haptics';
export { parseInline } from './lib/inlineMarkdown';
export type { InlineSpan } from './lib/inlineMarkdown';
export { formatNumber, formatCompact } from './lib/format';
export { useCopiedFlash } from './lib/useCopiedFlash';
export { COPIED_MS } from './lib/copiedFlash';
// share-as-image: capture mode (static final state, busy tokens for images still loading)
export { CaptureProvider, useCaptureBusy, useCaptureMode } from './lib/capture';
export { createCaptureTracker } from './lib/captureTracker';
export type { CaptureOutcome, CaptureTracker } from './lib/captureTracker';

// waiting delight: loader library, WaitingIndicator, pure waiting logic (ui/loaders)
export * from './loaders';

// Gallery is NOT re-exported: it is lazy-loaded by its route (app/gallery.tsx) to keep it out of startup.
