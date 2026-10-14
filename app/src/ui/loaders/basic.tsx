// Abstract loaders: dots, pulse, orbit, sparkle, wave, ring, blob. Built from Animated.Views (+ tiny static
// SVG shapes) whose transforms/opacity are derived from one UI-thread clock (clock.ts).
import { View } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from '../theme';
import { useLoop, type LoaderProps } from './clock';

const TAU = Math.PI * 2;

/** Square box, children positioned absolutely. */
export function Box({ size, children, height }: { size: number; height?: number; children: React.ReactNode }) {
  return <View style={{ width: size, height: height ?? size, position: 'relative' }}>{children}</View>;
}

// ------------------------------------------------------------------ dots (morphing)

function MorphDot({ v, i, size, color }: { v: SharedValue<number>; i: number; size: number; color: string }) {
  const d = size * 0.2;
  const amp = size * 0.2;
  const style = useAnimatedStyle(() => {
    const p = (v.value - i * 0.14 + 1) % 1;
    const y = Math.sin(p * TAU);
    const up = Math.max(0, y);
    const squash = Math.max(0, -y);
    return {
      opacity: 0.55 + 0.45 * up,
      transform: [{ translateY: -up * amp + squash * size * 0.04 }, { scaleX: 1 + 0.32 * squash - 0.08 * up }, { scaleY: 1 - 0.28 * squash + 0.1 * up }],
    };
  });
  return (
    <Animated.View
      style={[{ position: 'absolute', width: d, height: d, borderRadius: d / 2, backgroundColor: color, left: size * 0.1 + i * size * 0.3, top: size * 0.55 - d / 2 }, style]}
    />
  );
}

export function DotsLoader({ size = 28, animate = true }: LoaderProps) {
  const t = useTheme();
  const v = useLoop(1100, animate, 0.2);
  return (
    <Box size={size}>
      {[0, 1, 2].map((i) => (
        <MorphDot key={i} v={v} i={i} size={size} color={t.colors.accent} />
      ))}
    </Box>
  );
}

// ------------------------------------------------------------------ pulse (Dezent: simple dots)

function PulseDot({ v, i, size, color, animate }: { v: SharedValue<number>; i: number; size: number; color: string; animate: boolean }) {
  const d = size * 0.17;
  const style = useAnimatedStyle(() => {
    if (!animate) return { opacity: 0.55 };
    const p = (v.value - i * 0.18 + 1) % 1;
    return { opacity: 0.3 + 0.7 * Math.max(0, Math.sin(p * TAU)) };
  });
  return <Animated.View style={[{ position: 'absolute', width: d, height: d, borderRadius: d / 2, backgroundColor: color, left: size * 0.12 + i * size * 0.29, top: (size - d) / 2 }, style]} />;
}

export function PulseLoader({ size = 28, animate = true }: LoaderProps) {
  const t = useTheme();
  const v = useLoop(1400, animate);
  return (
    <Box size={size}>
      {[0, 1, 2].map((i) => (
        <PulseDot key={i} v={v} i={i} size={size} color={t.colors.muted} animate={animate} />
      ))}
    </Box>
  );
}

// ------------------------------------------------------------------ orbit

function Orbiter({ v, size, r, d, speed, offset, color }: { v: SharedValue<number>; size: number; r: number; d: number; speed: number; offset: number; color: string }) {
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${(v.value * speed + offset) * 360}deg` }] }));
  return (
    <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: size, height: size }, style]}>
      <View style={{ position: 'absolute', width: d, height: d, borderRadius: d / 2, backgroundColor: color, left: (size - d) / 2, top: size / 2 - r - d / 2 }} />
    </Animated.View>
  );
}

export function OrbitLoader({ size = 28, animate = true }: LoaderProps) {
  const t = useTheme();
  const v = useLoop(2600, animate, 0.15);
  const c = t.colors.chart;
  const core = size * 0.24;
  const coreStyle = useAnimatedStyle(() => ({ transform: [{ scale: 0.85 + 0.15 * Math.sin(v.value * TAU * 2) }] }));
  return (
    <Box size={size}>
      <View style={{ position: 'absolute', left: size * 0.08, top: size * 0.08, width: size * 0.84, height: size * 0.84, borderRadius: size, borderWidth: 1, borderColor: t.colors.border }} />
      <Animated.View style={[{ position: 'absolute', width: core, height: core, borderRadius: core / 2, backgroundColor: t.colors.accent, left: (size - core) / 2, top: (size - core) / 2 }, coreStyle]} />
      <Orbiter v={v} size={size} r={size * 0.42} d={size * 0.16} speed={1} offset={0} color={c[1]} />
      <Orbiter v={v} size={size} r={size * 0.42} d={size * 0.12} speed={1} offset={0.5} color={c[2]} />
      <Orbiter v={v} size={size} r={size * 0.26} d={size * 0.1} speed={-2} offset={0.25} color={c[4]} />
    </Box>
  );
}

// ------------------------------------------------------------------ sparkle

const STAR = 'M12 0C12.9 7.1 16.9 11.1 24 12 16.9 12.9 12.9 16.9 12 24 11.1 16.9 7.1 12.9 0 12 7.1 11.1 11.1 7.1 12 0Z';

function Star({ v, x, y, d, offset, min, color }: { v: SharedValue<number>; x: number; y: number; d: number; offset: number; min: number; color: string }) {
  const style = useAnimatedStyle(() => {
    const p = (v.value + offset) % 1;
    const s = Math.sin(p * Math.PI);
    const k = min + (1 - min) * s * s;
    return { opacity: 0.25 + 0.75 * k, transform: [{ rotate: `${p * 90}deg` }, { scale: k }] };
  });
  return (
    <Animated.View style={[{ position: 'absolute', left: x - d / 2, top: y - d / 2, width: d, height: d }, style]}>
      <Svg width={d} height={d} viewBox="0 0 24 24">
        <Path d={STAR} fill={color} />
      </Svg>
    </Animated.View>
  );
}

export function SparkleLoader({ size = 28, animate = true }: LoaderProps) {
  const t = useTheme();
  const v = useLoop(1900, animate, 0.45);
  return (
    <Box size={size}>
      <Star v={v} x={size * 0.4} y={size * 0.56} d={size * 0.66} offset={0} min={0.55} color={t.colors.accent} />
      <Star v={v} x={size * 0.8} y={size * 0.22} d={size * 0.34} offset={0.38} min={0} color={t.colors.chart[3]} />
      <Star v={v} x={size * 0.84} y={size * 0.8} d={size * 0.24} offset={0.7} min={0} color={t.colors.chart[4]} />
    </Box>
  );
}

// ------------------------------------------------------------------ wave (typing equalizer)

function WaveBar({ v, i, size, color }: { v: SharedValue<number>; i: number; size: number; color: string }) {
  const w = size * 0.11;
  const h = size * 0.72;
  const style = useAnimatedStyle(() => {
    const k = 0.5 + 0.5 * Math.sin((v.value - i * 0.13) * TAU);
    return { transform: [{ scaleY: 0.28 + 0.72 * k }], opacity: 0.55 + 0.45 * k };
  });
  return <Animated.View style={[{ position: 'absolute', width: w, height: h, borderRadius: w / 2, backgroundColor: color, left: size * 0.09 + i * size * 0.18, top: (size - h) / 2 }, style]} />;
}

export function WaveLoader({ size = 28, animate = true }: LoaderProps) {
  const t = useTheme();
  const v = useLoop(1150, animate, 0.1);
  return (
    <Box size={size}>
      {[0, 1, 2, 3, 4].map((i) => (
        <WaveBar key={i} v={v} i={i} size={size} color={i % 2 ? t.colors.chart[0] : t.colors.accent} />
      ))}
    </Box>
  );
}

// ------------------------------------------------------------------ ring (breathing + ripple)

export function RingLoader({ size = 28, animate = true }: LoaderProps) {
  const t = useTheme();
  const v = useLoop(2600, animate, 0.5);
  const sw = Math.max(2, size * 0.09);
  const breathe = useAnimatedStyle(() => {
    const k = 0.5 - 0.5 * Math.cos(v.value * TAU);
    return { opacity: 0.6 + 0.4 * k, transform: [{ scale: 0.74 + 0.2 * k }] };
  });
  const ripple = useAnimatedStyle(() => {
    const p = v.value;
    return { opacity: 0.55 * (1 - p), transform: [{ scale: 0.75 + 0.55 * p }] };
  });
  const ring = (color: string, width: number) => (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle cx={size / 2} cy={size / 2} r={size * 0.34} stroke={color} strokeWidth={width} fill="none" />
    </Svg>
  );
  return (
    <Box size={size}>
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0 }, ripple]}>{ring(t.colors.accent, sw * 0.5)}</Animated.View>
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0 }, breathe]}>{ring(t.colors.accent, sw)}</Animated.View>
    </Box>
  );
}

// ------------------------------------------------------------------ blob (liquid)

export function BlobLoader({ size = 28, animate = true }: LoaderProps) {
  const t = useTheme();
  const v = useLoop(4200, animate, 0.2);
  const b = size * 0.72;
  const a = t.colors.accent;
  const c2 = t.colors.chart[4];
  const style = useAnimatedStyle(() => {
    const p = v.value * TAU;
    const r = (k: number) => b * (0.32 + 0.2 * Math.sin(p * 2 + k * 1.7));
    return {
      backgroundColor: interpolateColor(0.5 - 0.5 * Math.cos(p), [0, 1], [a, c2]),
      borderTopLeftRadius: r(0),
      borderTopRightRadius: r(1),
      borderBottomRightRadius: r(2),
      borderBottomLeftRadius: r(3),
      transform: [{ rotate: `${v.value * 360}deg` }, { scale: 0.92 + 0.08 * Math.sin(p * 3) }],
    };
  });
  const shine = useAnimatedStyle(() => ({ transform: [{ translateX: Math.sin(v.value * TAU) * size * 0.04 }, { translateY: Math.cos(v.value * TAU * 2) * size * 0.03 }] }));
  const hl = size * 0.16;
  return (
    <Box size={size}>
      <Animated.View style={[{ position: 'absolute', width: b, height: b, left: (size - b) / 2, top: (size - b) / 2 }, style]} />
      <Animated.View
        style={[{ position: 'absolute', width: hl, height: hl, borderRadius: hl / 2, left: size * 0.3, top: size * 0.28, backgroundColor: 'rgba(255,255,255,0.45)' }, shine]}
      />
    </Box>
  );
}
