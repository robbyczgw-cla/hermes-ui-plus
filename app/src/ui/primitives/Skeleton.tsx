import { useEffect, useState } from 'react';
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme';

export type SkeletonProps = {
  /** `null` = unset (use flex/style instead). Default '100%'. */
  width?: DimensionValue | null;
  /** `null` = unset. Default 12. */
  height?: number | null;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

/** Shimmering placeholder block. Shimmer is disabled when the OS asks for reduced motion. */
export function Skeleton({ width = '100%', height = 12, radius, style }: SkeletonProps) {
  const t = useTheme();
  const [w, setW] = useState(0);
  const p = useSharedValue(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    p.value = 0;
    p.value = withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.quad) }), -1, false);
    return () => cancelAnimation(p);
  }, [reduced, p]);

  const anim = useAnimatedStyle(() => ({ transform: [{ translateX: -w + p.value * 2 * w }] }), [w]);

  return (
    <View
      // the render sweep (scripts/ux-check/render-sweep.mjs) tells a stuck shimmer from content by this id
      testID="hui-skeleton"
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={[
        { width: width ?? undefined, height: height ?? undefined, borderRadius: radius ?? Math.min(t.radii.inline, (height ?? 24) / 2), backgroundColor: t.colors.skeleton, overflow: 'hidden' },
        style,
      ]}
    >
      {w > 0 && !reduced ? (
        <Animated.View style={[StyleSheet.absoluteFill, anim]} pointerEvents="none">
          <LinearGradient
            colors={[t.colors.skeleton, t.colors.skeletonHighlight, t.colors.skeleton]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

/** A few lines of text placeholder; last line shorter. */
export function SkeletonLines({ lines = 3, gap = 8, lineHeight = 12, lastWidth = '62%' }: { lines?: number; gap?: number; lineHeight?: number; lastWidth?: DimensionValue }) {
  return (
    <View style={{ gap }}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={lineHeight} width={i === lines - 1 && lines > 1 ? lastWidth : '100%'} />
      ))}
    </View>
  );
}
