/**
 * Capture mode: the subtree is being rendered for a still image (share-as-image, chat/answers/ShareFrame.tsx).
 * Components read it to draw their final, static state:
 *  - motion is off (the provider sets the theme's reduceMotion: fades and bars render settled), the text size is the
 *    default one (the image is for other people; the reader's own size setting stays in the app)
 *  - rails become grids, scroll hints and map controls disappear, maps draw a static sketch instead of tiles
 *  - anything still loading holds a busy token (`useCaptureBusy`) until it is drawn; past the deadline it gets
 *    `expired` and shows its fallback, so the capture never contains a shimmer
 * Outside a capture frame every hook here is a no-op.
 */
import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { HuiThemeProvider } from '../theme';
import type { CaptureTracker } from './captureTracker.ts';

const CaptureContext = createContext<CaptureTracker | null>(null);
const subscribeNone = () => () => {};

export function CaptureProvider({ tracker, children }: { tracker: CaptureTracker; children?: ReactNode }) {
  return (
    <CaptureContext.Provider value={tracker}>
      <HuiThemeProvider reduceMotion="on" fontSize="m">{children}</HuiThemeProvider>
    </CaptureContext.Provider>
  );
}

/** true inside a capture frame */
export function useCaptureMode(): boolean {
  return useContext(CaptureContext) !== null;
}

/**
 * Inside a capture frame: hold a busy token while `busy` (a photo or lookup that will still change what is drawn).
 * Returns true once the capture deadline passed: draw the fallback instead of waiting. Always false outside.
 */
export function useCaptureBusy(busy: boolean): boolean {
  const tracker = useContext(CaptureContext);
  const expired = useSyncExternalStore(tracker ? tracker.onExpire : subscribeNone, () => tracker?.expired() ?? false);
  const hold = !!tracker && busy && !expired;
  useEffect(() => {
    if (!hold || !tracker) return;
    return tracker.hold();
  }, [hold, tracker]);
  return expired;
}
