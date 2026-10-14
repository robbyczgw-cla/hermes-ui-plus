/**
 * "Is this view (nearly) on screen?" – used to start image searches lazily (products / places cards).
 * Web: IntersectionObserver. Native: one shared low-frequency ticker (nearRegistry.ts) that measures the registered
 * views with `measureInWindow` and stops when none are registered. Margin: one extra screen half vertically, a
 * quarter horizontally (cards just outside a rail start early, the rest waits for the scroll).
 * Register only while the caller really needs the signal (`active`): a collapsed slot, a cached / resolved image or
 * an unmounted box must not keep the ticker running. A view that cannot be measured counts as visible after a few
 * ticks (fail-open, nearRegistry.ts), so a waiting image slot never stays a placeholder forever.
 */
import { useEffect, type RefObject } from 'react';
import { Dimensions, Platform, type View } from 'react-native';
import { createNearRegistry, type NearView } from './nearRegistry';

function near(x: number, y: number, w: number, h: number): boolean {
  if (!w && !h) return false; // not laid out yet / collapsed
  const win = Dimensions.get('window');
  const mx = win.width * 0.25;
  const my = win.height * 0.5;
  return x + w > -mx && x < win.width + mx && y + h > -my && y < win.height + my;
}

const registry = createNearRegistry({
  tickMs: 400,
  isNear: near,
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
});

// one shared "right after layout" check for all slots registered together (a burst of mounts must not tick N times
// in a row – every tick counts towards the fail-open of views that cannot be measured yet)
let soon: ReturnType<typeof setTimeout> | null = null;
function tickSoon(): void {
  if (soon) return;
  soon = setTimeout(() => {
    soon = null;
    registry.tick();
  }, 50);
}

/** Calls `onNear` once the view behind `ref` is (nearly) on screen, while `active`. `onNear` should be stable. */
export function useNearViewportWatch(ref: RefObject<View | null>, active: boolean, onNear: () => void): void {
  useEffect(() => {
    if (!active) return;
    if (Platform.OS === 'web') {
      const el = ref.current as unknown as Element | null;
      const IO = (globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
      if (!el || !IO) {
        onNear();
        return;
      }
      const io = new IO(
        (entries) => {
          if (entries.some((x) => x.isIntersecting)) {
            io.disconnect();
            onNear();
          }
        },
        { rootMargin: '50% 25% 50% 25%' },
      );
      io.observe(el);
      return () => io.disconnect();
    }
    const off = registry.add({ view: () => ref.current as unknown as NearView | null, hit: onNear });
    // first check right after layout
    tickSoon();
    return off;
  }, [ref, active, onNear]);
}
