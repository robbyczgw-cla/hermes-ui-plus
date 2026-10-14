/**
 * Shared bits for the c3 modules (decision, rank, scale): small svg icons, a compact skeleton and the
 * drag auto-scroll bridge.
 */
import { createContext, useCallback, useContext, type RefObject } from 'react';
import { Platform, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from '../../../theme';
import { Surface } from '../../../primitives/basics';
import { Skeleton } from '../../../primitives/Skeleton';

/* ───────────── icons ───────────── */

export type C3IconName = 'star' | 'starOutline' | 'grip' | 'up' | 'down' | 'crown' | 'reset';

export function C3Icon({ name, size = 18, color, strokeWidth = 1.9 }: { name: C3IconName; size?: number; color: string; strokeWidth?: number }) {
  const p = { stroke: color, strokeWidth, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const star = 'M12 2.8l2.75 5.6 6.15.9-4.45 4.35 1.05 6.13L12 16.9l-5.5 2.88 1.05-6.13L3.1 9.3l6.15-.9L12 2.8z';
  let body;
  switch (name) {
    case 'star':
      body = <Path d={star} fill={color} stroke={color} strokeWidth={1.2} strokeLinejoin="round" />;
      break;
    case 'starOutline':
      body = <Path d={star} {...p} />;
      break;
    case 'grip':
      body = (
        <>
          {[7, 12, 17].map((y) => (
            <Circle key={`a${y}`} cx={9} cy={y} r={1.5} fill={color} />
          ))}
          {[7, 12, 17].map((y) => (
            <Circle key={`b${y}`} cx={15} cy={y} r={1.5} fill={color} />
          ))}
        </>
      );
      break;
    case 'up':
      body = <Path d="M6 14.5l6-6 6 6" {...p} />;
      break;
    case 'down':
      body = <Path d="M6 9.5l6 6 6-6" {...p} />;
      break;
    case 'crown':
      body = <Path d="M4 17.5h16M4.5 15l-1-8 5 3.5L12 5l3.5 5.5 5-3.5-1 8h-15z" {...p} />;
      break;
    case 'reset':
      body = <Path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4v5h5" {...p} />;
      break;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {body}
    </Svg>
  );
}

/* ───────────── skeleton ───────────── */

/** Shown while a c3 node has streamed nothing usable yet. */
export function C3Skeleton({ rows = 3, rowHeight = 44 }: { rows?: number; rowHeight?: number }) {
  const t = useTheme();
  return (
    <Surface style={{ gap: t.spacing.m }}>
      <Skeleton width="55%" height={16} />
      <View style={{ gap: t.spacing.s }}>
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} height={rowHeight} radius={t.radii.m} />
        ))}
      </View>
    </Surface>
  );
}

/* ───────────── drag auto-scroll ───────────── */

/**
 * Lets a dragged row scroll its surrounding list. `scrollBy(dy)`: dy > 0 reveals content further
 * DOWN the screen; returns the distance actually scrolled (0 at the edges).
 *
 * Native: the chat list provides it (inverted FlatList → `scrollToOffset(offset - dy)`); without a
 * provider dragging still works, it just does not scroll. Web: falls back to the nearest scrollable
 * DOM ancestor (handles the inverted list's scaleY(-1)).
 */
export type DragScroll = { scrollBy(dy: number): number };

export const DragScrollContext = createContext<DragScroll | null>(null);

type DomEl = { parentElement: DomEl | null; scrollTop: number; scrollHeight: number; clientHeight: number };

function webScrollParent(node: unknown): { el: DomEl; inverted: boolean } | null {
  const g = globalThis as unknown as { getComputedStyle?: (e: unknown) => { overflowY: string; transform: string }; document?: { scrollingElement?: DomEl | null } };
  if (!g.getComputedStyle) return null;
  let el = (node as DomEl | null)?.parentElement ?? null;
  while (el) {
    const cs = g.getComputedStyle(el);
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
      // RN-web inverted lists flip the scroller vertically: matrix(1, 0, 0, -1, 0, 0)
      const inverted = /matrix\(\s*1,\s*0,\s*0,\s*-1/.test(cs.transform);
      return { el, inverted };
    }
    el = el.parentElement;
  }
  const root = g.document?.scrollingElement ?? null;
  return root ? { el: root, inverted: false } : null;
}

/** The scroll bridge for a component anchored at `anchor` (context first, web DOM fallback). */
export function useDragScroll(anchor: RefObject<View | null>): (dy: number) => number {
  const ctx = useContext(DragScrollContext);
  return useCallback(
    (dy: number) => {
      if (ctx) return ctx.scrollBy(dy);
      if (Platform.OS !== 'web') return 0;
      const sp = webScrollParent(anchor.current);
      if (!sp) return 0;
      const before = sp.el.scrollTop;
      sp.el.scrollTop = before + (sp.inverted ? -dy : dy);
      const moved = sp.el.scrollTop - before;
      return sp.inverted ? -moved : moved;
    },
    [ctx, anchor],
  );
}
