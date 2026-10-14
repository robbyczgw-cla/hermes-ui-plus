/**
 * React side of images/slot.ts: a group of image slots (the cards of one compare / products / places / choice
 * node) so that siblings decide together whether the image area is kept (aligned fallback) or dropped, plus
 * the capped-shimmer timer and the calm fallback tile.
 */
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useTheme } from '../theme';
import { HText } from '../primitives/basics';
import { IMAGE_SLOT_CAP_MS, groupHasImages, monogram, slotMode, type SlotMode, type SlotStatus } from '../../images/slot';

type Group = { map: Record<string, SlotStatus>; report: (id: string, s: SlotStatus | null) => void };
const GroupCtx = createContext<Group | null>(null);

/** Wrap the cards of one node; slots inside register their status here. */
export function ImageSlotGroup({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Record<string, SlotStatus>>({});
  const report = useCallback((id: string, s: SlotStatus | null) => {
    setMap((prev) => {
      if (s === null) {
        if (!(id in prev)) return prev;
        const { [id]: _drop, ...rest } = prev;
        return rest;
      }
      return prev[id] === s ? prev : { ...prev, [id]: s };
    });
  }, []);
  const value = useMemo(() => ({ map, report }), [map, report]);
  return <GroupCtx.Provider value={value}>{children}</GroupCtx.Provider>;
}

/** Registers this slot's status in the surrounding group (if any) and returns what to render. */
export function useImageSlot(status: SlotStatus): SlotMode {
  const id = useId();
  const g = useContext(GroupCtx);
  const report = g?.report;
  // layout effect: the siblings' decision is settled before the first paint (no collapse → fallback flash)
  useLayoutEffect(() => {
    report?.(id, status);
  }, [report, id, status]);
  useLayoutEffect(() => () => report?.(id, null), [report, id]);
  const peers = g ? Object.keys(g.map).filter((k) => k !== id).map((k) => g.map[k]) : [];
  return slotMode(status, peers);
}

/** Does the surrounding group show any image area (photo or resolving)? Always false outside a group. */
export function useImageGroupHasImages(): boolean {
  const g = useContext(GroupCtx);
  return g ? groupHasImages(Object.values(g.map)) : false;
}

/**
 * True once `pending` has lasted `ms` for the current `resetKey` – then the slot gives up (sticky for that key).
 * No timer runs while nothing is pending (idle / offscreen / done).
 */
export function useSlotCap(pending: boolean, resetKey: string, ms = IMAGE_SLOT_CAP_MS): boolean {
  const [expiredKey, setExpiredKey] = useState<string | null>(null);
  useEffect(() => {
    if (!pending || expiredKey === resetKey) return;
    const id = setTimeout(() => setExpiredKey(resetKey), ms);
    return () => clearTimeout(id);
  }, [pending, resetKey, expiredKey, ms]);
  return expiredKey === resetKey;
}

/**
 * Calm stand-in next to sibling photos: the item's initial on the surface colour (or just the tinted surface
 * when there is no letter). Deliberately not a "picture" glyph.
 */
export function FallbackTile({ height, width = '100%', radius, label, size }: { height: number; width?: number | '100%'; radius: number; label?: string; size?: number }) {
  const t = useTheme();
  const letter = monogram(label);
  const fs = size ?? Math.max(14, Math.min(28, Math.round(height * 0.4)));
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      aria-hidden
      style={{ width, height, borderRadius: radius, backgroundColor: t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
    >
      {letter ? (
        <HText weight="600" style={{ color: t.colors.subtle, fontSize: fs, lineHeight: Math.round(fs * 1.25) }}>
          {letter}
        </HText>
      ) : null}
    </View>
  );
}
