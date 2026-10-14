import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from '../theme';
import { sparklinePath, sparkValues } from '../lib/chartMath3';
import { Entrance, useEntranceOnMount } from './ChartParts';

/**
 * Tiny trend line for `stats.items[].sparkline` (2..60 finite numbers; anything else renders nothing).
 * 2px line, dot on the last point, fades in while streamed live (no clipPath – Android-safe). Decorative: the stat value
 * and delta carry the information, so it is hidden from screen readers.
 */
export function Sparkline({ values, color, height = 28 }: { values: unknown; color?: string; height?: number }) {
  const t = useTheme();
  const [w, setW] = useState(0);
  const vals = sparkValues(values);
  // fades in only when mounted inside a live-streaming block (UI-thread animation, no per-frame state)
  const play = useEntranceOnMount();
  if (!vals.length) return null;
  const c = color ?? t.colors.accent;
  const path = sparklinePath(vals, w, height, 4);
  return (
    <View
      style={{ height, marginTop: 2 }}
      onLayout={(e) => setW(Math.floor(e.nativeEvent.layout.width))}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {path ? (
        <Entrance play={play} active duration={500} scaleFrom={1}>
          <Svg width={w} height={height}>
            <Path d={path.d} stroke={c} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            <Circle cx={path.last.x} cy={path.last.y} r={3} fill={c} stroke={t.colors.surface} strokeWidth={1.5} />
          </Svg>
        </Entrance>
      ) : null}
    </View>
  );
}
