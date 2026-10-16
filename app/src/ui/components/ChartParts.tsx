// Shared building blocks for the native SVG charts (Chart.tsx + ChartV3.tsx): entrance animation,
// tooltip, legend (optionally toggleable), tap layer.

import { useEffect, useState, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useMotionReduced, type Theme } from '../theme';
import { HText, PressableScale } from '../primitives/basics';
import { useHui } from '../primitives/context';
import { clamp } from '../lib/format';
import { FADE_IN_SETTLED } from '../lib/fadeIn';

export const PLOT_H = 180;
export const FONT = 11;

/**
 * Should a chart mounted now play its entrance? Only when its ```hui block is streaming live at mount
 * time. History, remounts after FlatList virtualisation and scrolled-back blocks start final (no
 * animation work at all).
 */
export function useEntranceOnMount(): boolean {
  const { streaming } = useHui();
  const [live] = useState(streaming);
  return live;
}

/**
 * Entrance (fade + slight grow) for a chart body, driven by a reanimated shared value: runs on the
 * UI thread on native, as a style-only rAF loop on web – no per-frame React state / SVG re-render.
 * Starts when `active` turns true (data + width known). `play = false` renders final right away.
 * (Animates the container, never an SVG clipPath: react-native-svg on Android does not re-apply a
 * clipPath whose size changes.)
 */
export function Entrance({
  play,
  active,
  duration = 650,
  scaleFrom = 0.96,
  style,
  children,
}: {
  play: boolean;
  active: boolean;
  duration?: number;
  scaleFrom?: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const reduced = useMotionReduced();
  const animate = play && !reduced;
  const p = useSharedValue(animate ? 0 : 1);
  useEffect(() => {
    if (!active) return;
    p.value = animate ? withTiming(1, { duration, easing: Easing.out(Easing.cubic) }) : 1;
  }, [active, animate, duration, p]);
  const anim = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ scale: scaleFrom + (1 - scaleFrom) * p.value }] }), [scaleFrom]);
  // after the entrance React owns the end state (ui/lib/fadeIn.ts): a dropped animated value must not
  // leave a finished chart at its mount-time opacity 0
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!active || !animate) return;
    const id = setTimeout(() => setSettled(true), duration + 80);
    return () => clearTimeout(id);
  }, [active, animate, duration]);
  if (!animate) return <View style={style}>{children}</View>;
  return <Animated.View style={[style, anim, settled ? { opacity: FADE_IN_SETTLED.opacity, transform: [{ scale: 1 }] } : null]}>{children}</Animated.View>;
}

export function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s;
}

export type TooltipRow = { color: string; name: string; value: string };

export function Tooltip({ t, x, top, label, rows, containerW, showNames }: { t: Theme; x: number; top: number; label: string; rows: TooltipRow[]; containerW: number; showNames?: boolean }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const left = clamp(x - size.w / 2, 0, Math.max(0, containerW - size.w));
  // above the anchor; flips below it when there is no room at the top of the chart
  const y = top - size.h - 10 >= 0 ? top - size.h - 10 : top + 22;
  const names = showNames ?? rows.length > 1;
  return (
    <View
      pointerEvents="none"
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      style={{
        position: 'absolute',
        left,
        top: y,
        opacity: size.w ? 1 : 0,
        maxWidth: 220,
        backgroundColor: t.colors.surface,
        borderRadius: t.radii.control,
        borderWidth: 1,
        borderColor: t.colors.border,
        paddingHorizontal: 10,
        paddingVertical: 8,
        gap: 4,
        ...t.shadows.md,
      }}
    >
      <HText variant="micro" color="muted" numberOfLines={2}>
        {label}
      </HText>
      {rows.map((r, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 10, height: 2.5, borderRadius: 2, backgroundColor: r.color }} />
          <HText variant="callout" weight="600" tabular>
            {r.value}
          </HText>
          {names && r.name ? (
            <HText variant="caption" color="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
              {r.name}
            </HText>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export type LegendItem = { name: string; color: string };

/**
 * Legend for ≥ 2 items (`always` shows it for one). `shape`: square for bars/areas, line for lines,
 * dot for points. With `hidden` + `onToggle` the items are buttons (stacked bars).
 */
export function Legend({
  t,
  items,
  shape = 'line',
  hidden,
  onToggle,
  always,
  toggleLabel,
}: {
  t: Theme;
  items: LegendItem[];
  shape?: 'square' | 'line' | 'dot';
  hidden?: ReadonlySet<number>;
  onToggle?: (i: number) => void;
  always?: boolean;
  toggleLabel?: (name: string, visible: boolean) => string;
}) {
  if (items.length < (always ? 1 : 2)) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: onToggle ? t.spacing.xs : t.spacing.l, rowGap: 6 }}>
      {items.map((it, i) => {
        const off = hidden?.has(i) ?? false;
        const swatch =
          shape === 'square' ? (
            <View style={{ width: 10, height: 10, borderRadius: 2.5, backgroundColor: off ? 'transparent' : it.color, borderWidth: off ? 1.5 : 0, borderColor: it.color }} />
          ) : shape === 'dot' ? (
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: it.color }} />
          ) : (
            <View style={{ width: 14, height: 2.5, borderRadius: 2, backgroundColor: it.color }} />
          );
        const label = (
          <HText variant="caption" color={off ? 'subtle' : 'muted'} numberOfLines={1} style={off ? { textDecorationLine: 'line-through' } : undefined}>
            {it.name}
          </HText>
        );
        if (!onToggle) {
          return (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
              {swatch}
              {label}
            </View>
          );
        }
        return (
          <PressableScale
            key={i}
            haptic="selection"
            scaleTo={0.97}
            onPress={() => onToggle(i)}
            accessibilityRole="switch"
            accessibilityState={{ checked: !off }}
            accessibilityLabel={toggleLabel ? toggleLabel(it.name, !off) : it.name}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, paddingHorizontal: 8, borderRadius: t.radii.pill, borderWidth: 1, borderColor: off ? t.colors.border : t.colors.borderControl, maxWidth: '100%' }}
          >
            {swatch}
            {label}
          </PressableScale>
        );
      })}
    </View>
  );
}

/** Transparent tap layer over an SVG: reports the tap position (no drag, plays well inside ScrollViews). */
export function TapLayer({ width, height, onTap, label, left = 0, top = 0 }: { width: number; height: number; onTap: (x: number, y: number) => void; label: string; left?: number; top?: number }) {
  return (
    <View
      style={{ position: 'absolute', left, top, width, height }}
      onStartShouldSetResponder={() => true}
      onResponderTerminationRequest={() => true}
      onResponderRelease={(e) => onTap(e.nativeEvent.locationX, e.nativeEvent.locationY)}
      accessibilityLabel={label}
    />
  );
}
