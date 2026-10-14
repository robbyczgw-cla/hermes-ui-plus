/**
 * Timing + end state of the `<FadeIn>` mount animation (ui/primitives/basics.tsx).
 *
 * Why React has to own the end state: Reanimated 4 keeps a `useAnimatedStyle` value only on the UI thread.
 * React's own props of the animated view keep the mount-time style (opacity 0) for its whole life
 * (createAnimatedComponent/PropsFilter: `initial` values cached per style handle). A settled value is handed
 * back to React by a JS interval (PropsRegistryGarbageCollector, every 500 ms) only while it is 1–2 s old;
 * older entries are deleted from the props registry whether they were handed back or not
 * (ReanimatedModuleProxy::getSettledUpdates → AnimatedPropsRegistry::getUpdatesOlderThanTimestamp). After a
 * JS-thread stall of more than a second (turn end, long render, app paused) the entry is gone, and the next
 * React commit of that view – every streaming tick re-renders the answer – writes opacity 0 back to it: the
 * block keeps its layout height but is invisible (real device: the first paragraph of an answer missing,
 * an empty gap of its height above the second block).
 *
 * So once the entrance is over, FadeIn puts the end state into React's props itself (`FADE_IN_SETTLED`),
 * well before Reanimated's hand-back window starts. Pure TS (erasable syntax only) so `node --test` can run it.
 */

/** duration of the UI-thread fade + rise */
export const FADE_IN_MS = 260;
/** margin after the fade before React takes over the end state (a late first frame still finishes) */
export const FADE_IN_SETTLE_SLACK_MS = 60;
/** Reanimated hands a settled value back to React only once it is this old (and drops it at twice that) */
export const REANIMATED_HANDBACK_MS = 1000;

export type FadeInStyle = { opacity: number; transform: [{ translateY: number }] };

export type FadeInPlan = {
  /** ms after mount: the UI-thread fade starts */
  startAt: number;
  /** ms after mount: the end state goes into React's props (no animated value needed to stay visible) */
  settleAt: number;
};

/** When the fade starts and when React takes over its end state. Reduced motion: settled from the start. */
export function fadeInPlan(delay: number, reduced: boolean): FadeInPlan {
  if (reduced) return { startAt: 0, settleAt: 0 };
  const d = Number.isFinite(delay) && delay > 0 ? delay : 0;
  return { startAt: d, settleAt: d + FADE_IN_MS + FADE_IN_SETTLE_SLACK_MS };
}

/** The mount-time style (what React's props say until the entrance has settled). */
export function fadeInFrom(rise: number): FadeInStyle {
  return { opacity: 0, transform: [{ translateY: Number.isFinite(rise) ? rise : 0 }] };
}

/** Fully visible, in place: React's props after the entrance – never depends on an animated value. */
export const FADE_IN_SETTLED: Readonly<FadeInStyle> = Object.freeze({ opacity: 1, transform: [{ translateY: 0 }] as [{ translateY: number }] });

/**
 * The wrapper's look as React commits it (Reanimated's UI-thread value not applied): the mount-time style
 * overlaid by the settled style once the entrance is over. This is what the view shows when Reanimated's
 * registry no longer holds a value for it.
 */
export function fadeInReactStyle(rise: number, settled: boolean): FadeInStyle {
  return settled ? { opacity: FADE_IN_SETTLED.opacity, transform: [{ translateY: FADE_IN_SETTLED.transform[0].translateY }] } : fadeInFrom(rise);
}
