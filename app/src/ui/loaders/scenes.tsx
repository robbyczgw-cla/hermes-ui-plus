// Pictogram loaders: scan, magnifier, gear, page, pencil, chameleon, bars, grid, pin. Static SVG artwork,
// motion only through Animated.View transforms / opacity / size driven by the UI-thread clock (clock.ts).
import { useMemo } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Ellipse, Line, Path, Rect } from 'react-native-svg';
import { withAlpha } from '../color';
import { useTheme } from '../theme';
import { Box } from './basic';
import { useLoop, type LoaderProps } from './clock';

const TAU = Math.PI * 2;
const abs = { position: 'absolute' as const, left: 0, top: 0 };

/** Faint "text lines" backdrop shared by scan / magnifier / page. */
function Lines({ size, color, x0 = 0.2, x1 = 0.8, ys = [0.36, 0.52, 0.68], widths = [1, 0.75, 0.9] }: { size: number; color: string; x0?: number; x1?: number; ys?: number[]; widths?: number[] }) {
  const sw = Math.max(1.5, size * 0.065);
  return (
    <Svg width={size} height={size} style={abs}>
      {ys.map((y, i) => (
        <Line key={i} x1={size * x0} x2={size * (x0 + (x1 - x0) * (widths[i] ?? 1))} y1={size * y} y2={size * y} stroke={color} strokeWidth={sw} strokeLinecap="round" />
      ))}
    </Svg>
  );
}

// ------------------------------------------------------------------ scan

export function ScanLoader({ size = 28, animate = true }: LoaderProps) {
  const t = useTheme();
  const v = useLoop(1900, animate, 0.35);
  const pad = size * 0.14;
  const inner = size - pad * 2;
  const line = useAnimatedStyle(() => ({ transform: [{ translateY: (0.5 - 0.5 * Math.cos(v.value * TAU)) * (inner - size * 0.16) }] }));
  return (
    <Box size={size}>
      <Svg width={size} height={size} style={abs}>
        <Rect x={pad} y={size * 0.08} width={inner} height={size * 0.84} rx={size * 0.12} stroke={t.colors.muted} strokeWidth={Math.max(1.4, size * 0.06)} fill={t.colors.surface} />
      </Svg>
      <Lines size={size} color={withAlpha(t.colors.muted, 0.45)} x0={0.3} x1={0.7} ys={[0.34, 0.5, 0.66]} />
      <Animated.View style={[{ position: 'absolute', left: pad - size * 0.04, width: inner + size * 0.08, top: size * 0.14, height: size * 0.16, justifyContent: 'center' }, line]}>
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: withAlpha(t.colors.accent, 0.18), borderRadius: 2 }} />
        <View style={{ height: Math.max(2, size * 0.07), borderRadius: 2, backgroundColor: t.colors.accent }} />
      </Animated.View>
    </Box>
  );
}

// ------------------------------------------------------------------ magnifier

export function MagnifierLoader({ size = 28, animate = true }: LoaderProps) {
  const t = useTheme();
  const v = useLoop(2600, animate, 0.1);
  const g = size * 0.78;
  const glass = useAnimatedStyle(() => {
    const p = v.value * TAU;
    return { transform: [{ translateX: Math.cos(p) * size * 0.14 }, { translateY: Math.sin(p * 2) * size * 0.08 }, { rotate: `${Math.sin(p) * 8}deg` }] };
  });
  const sw = Math.max(2, g * 0.11);
  return (
    <Box size={size}>
      <Lines size={size} color={withAlpha(t.colors.muted, 0.35)} x0={0.12} x1={0.88} ys={[0.3, 0.5, 0.7]} widths={[1, 0.7, 0.85]} />
      <Animated.View style={[{ position: 'absolute', left: (size - g) / 2, top: (size - g) / 2, width: g, height: g }, glass]}>
        <Svg width={g} height={g} viewBox="0 0 24 24">
          <Circle cx={10} cy={10} r={6.4} fill={withAlpha(t.colors.accent, 0.16)} stroke={t.colors.accent} strokeWidth={(sw * 24) / g} />
          <Line x1={14.8} y1={14.8} x2={20.5} y2={20.5} stroke={t.colors.accent} strokeWidth={(sw * 1.25 * 24) / g} strokeLinecap="round" />
          <Path d="M7 8.2a3.6 3.6 0 0 1 2.6-2" stroke="rgba(255,255,255,0.75)" strokeWidth={1.4} strokeLinecap="round" fill="none" />
        </Svg>
      </Animated.View>
    </Box>
  );
}

// ------------------------------------------------------------------ gear

/** Gear outline centred in a box of `2 * outer`: trapezoid teeth, centre hole (evenodd). */
export function gearPath(teeth: number, outer: number, inner: number, hole: number): string {
  const c = outer;
  const pts: string[] = [];
  const step = TAU / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const seq: [number, number][] = [
      [a - step * 0.25, inner],
      [a - step * 0.14, outer],
      [a + step * 0.14, outer],
      [a + step * 0.25, inner],
    ];
    for (const [ang, r] of seq) pts.push(`${(c + Math.cos(ang) * r).toFixed(2)} ${(c + Math.sin(ang) * r).toFixed(2)}`);
  }
  const ring = `M${pts.join('L')}Z`;
  const h = `M${c - hole} ${c}a${hole} ${hole} 0 1 0 ${hole * 2} 0a${hole} ${hole} 0 1 0 ${-hole * 2} 0Z`;
  return ring + h;
}

function Gear({ v, cx, cy, outer, teeth, turns, offset, color }: { v: SharedValue<number>; cx: number; cy: number; outer: number; teeth: number; turns: number; offset: number; color: string }) {
  const d = useMemo(() => gearPath(teeth, outer, outer * 0.74, outer * 0.3), [teeth, outer]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${offset + v.value * turns}deg` }] }));
  return (
    <Animated.View style={[{ position: 'absolute', left: cx - outer, top: cy - outer, width: outer * 2, height: outer * 2 }, style]}>
      <Svg width={outer * 2} height={outer * 2}>
        <Path d={d} fill={color} fillRule="evenodd" />
      </Svg>
    </Animated.View>
  );
}

export function GearLoader({ size = 28, animate = true }: LoaderProps) {
  const t = useTheme();
  const v = useLoop(1700, animate, 0);
  // 8:6 teeth; per loop the big gear turns 2 teeth (90°), the small one 2 teeth (−120°) → seamless
  return (
    <Box size={size}>
      <Gear v={v} cx={size * 0.38} cy={size * 0.4} outer={size * 0.33} teeth={8} turns={90} offset={0} color={t.colors.accent} />
      <Gear v={v} cx={size * 0.74} cy={size * 0.74} outer={size * 0.25} teeth={6} turns={-120} offset={15} color={t.colors.chart[3]} />
    </Box>
  );
}

// ------------------------------------------------------------------ page flip

export function PageLoader({ size = 28, animate = true }: LoaderProps) {
  const t = useTheme();
  const v = useLoop(1900, animate, 0.75);
  const top = size * 0.18;
  const h = size * 0.64;
  const half = size * 0.38;
  const spine = size / 2;
  const sw = Math.max(1.2, size * 0.05);
  const flip = useAnimatedStyle(() => {
    const raw = Math.min(1, v.value / 0.7);
    const e = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
    const c = Math.cos(e * Math.PI);
    return {
      opacity: 0.55 + 0.45 * Math.abs(c),
      transform: [{ translateX: -half / 2 }, { scaleX: Math.abs(c) < 0.02 ? 0.02 * Math.sign(c || 1) : c }, { translateX: half / 2 }],
    };
  });
  const page = (fill: string) => (
    <Svg width={half} height={h}>
      <Rect x={sw / 2} y={sw / 2} width={half - sw} height={h - sw} rx={size * 0.05} fill={fill} stroke={t.colors.muted} strokeWidth={sw} />
      {[0.3, 0.5, 0.7].map((y) => (
        <Line key={y} x1={half * 0.2} x2={half * 0.78} y1={h * y} y2={h * y} stroke={withAlpha(t.colors.muted, 0.5)} strokeWidth={sw} strokeLinecap="round" />
      ))}
    </Svg>
  );
  return (
    <Box size={size}>
      <View style={{ position: 'absolute', left: spine - half, top }}>{page(t.colors.surface)}</View>
      <View style={{ position: 'absolute', left: spine, top }}>{page(t.colors.surface)}</View>
      <Animated.View style={[{ position: 'absolute', left: spine, top, width: half, height: h }, flip]}>{page(t.colors.accentSoft)}</Animated.View>
    </Box>
  );
}

// ------------------------------------------------------------------ pencil

/** y (0..1 of box) of the squiggle at x (0..1). */
function squiggle(x: number): number {
  'worklet';
  return 0.72 + 0.1 * Math.sin(x * TAU * 1.5);
}

export function PencilLoader({ size = 28, animate = true }: LoaderProps) {
  const t = useTheme();
  const v = useLoop(2300, animate, 0.62);
  const x0 = 0.1;
  const span = 0.8;
  const d = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i <= 24; i++) {
      const x = i / 24;
      pts.push(`${((x0 + x * span) * size).toFixed(2)} ${(squiggle(x) * size).toFixed(2)}`);
    }
    return `M${pts.join('L')}`;
  }, [size]);
  const progress = (p: number) => {
    'worklet';
    return Math.min(1, p / 0.72);
  };
  const reveal = useAnimatedStyle(() => ({ width: (x0 * size) + progress(v.value) * span * size + 2, opacity: v.value > 0.88 ? 1 - (v.value - 0.88) / 0.12 : 1 }));
  const pencil = useAnimatedStyle(() => {
    const k = progress(v.value);
    const x = (x0 + k * span) * size;
    const y = squiggle(k) * size;
    const lift = v.value > 0.72 ? (v.value - 0.72) * size * 0.4 : 0;
    return { transform: [{ translateX: x }, { translateY: y - lift }] };
  });
  const p = size * 0.62;
  return (
    <Box size={size}>
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, height: size, overflow: 'hidden' }, reveal]}>
        <Svg width={size} height={size}>
          <Path d={d} stroke={t.colors.chart[4]} strokeWidth={Math.max(1.8, size * 0.075)} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </Svg>
      </Animated.View>
      {/* pencil tip sits at the view's origin (0,0) → translate to the drawing point */}
      <Animated.View style={[{ position: 'absolute', left: 0, top: -p, width: p, height: p }, pencil]}>
        <Svg width={p} height={p} viewBox="0 0 24 24">
          <Path d="M0 24 L2.2 17.2 L17.5 1.9 a2.6 2.6 0 0 1 3.7 0 l0.9 0.9 a2.6 2.6 0 0 1 0 3.7 L6.8 21.8 Z" fill={t.colors.accent} />
          <Path d="M0 24 L2.2 17.2 L6.8 21.8 Z" fill={t.colors.surface} stroke={t.colors.accent} strokeWidth={1} strokeLinejoin="round" />
          <Path d="M0 24 L0.9 21.2 L2.8 23.1 Z" fill={t.colors.text} />
          <Path d="M15.6 3.8 L20.2 8.4" stroke={withAlpha(t.colors.onAccent, 0.6)} strokeWidth={1.4} />
        </Svg>
      </Animated.View>
    </Box>
  );
}

// ------------------------------------------------------------------ chameleon

// viewBox 0 0 32 24 – sitting on a branch, curled tail, big eye that looks around.
const CHAM_BODY = 'M9 14.2C9 8.8 13.3 6 18.4 6 21.9 6 24.4 7.1 26.4 9.3L29.9 12.4C30.6 13 30.3 14 29.4 14.1L26 14.7C24.4 16.9 21.8 18 18.4 18H13.2C10.9 18 9 16.4 9 14.2Z';
const CHAM_CREST = 'M12.5 8.6 14 6.4 15.4 7.4 17 5.8 18.4 6.9 20 5.8 21.2 7';
const CHAM_TAIL = 'M10 15.6C6.6 16 4.2 18.4 4.6 20.8 5 22.8 7.9 23 8.5 21.2 8.9 20 7.9 19.2 7.1 19.7';
const CHAM_LEGS = 'M14.2 17.6 13.2 21M21.6 17.6 22.6 21';
const CHAM_SPOTS = [
  [15, 11.5, 1.1],
  [18.6, 9.6, 0.8],
  [19.4, 13.6, 1],
  [12.4, 13.4, 0.7],
] as const;

function ChamLayer({ v, i, n, w, h, color }: { v: SharedValue<number>; i: number; n: number; w: number; h: number; color: string }) {
  // colour i fades in during segment i-1, stays, and the last one fades back to the base colour
  const style = useAnimatedStyle(() => {
    const x = v.value * n;
    const j = Math.floor(x) % n;
    const f0 = x - Math.floor(x);
    const f = f0 * f0 * (3 - 2 * f0);
    let o = 0;
    if (j === i - 1) o = f;
    else if (j >= i && j < n - 1) o = 1;
    else if (i === n - 1 && j === n - 1) o = 1 - f;
    return { opacity: o };
  });
  return (
    <Animated.View style={[abs, style]}>
      <ChamShape w={w} h={h} color={color} />
    </Animated.View>
  );
}

function ChamShape({ w, h, color }: { w: number; h: number; color: string }) {
  return (
    <Svg width={w} height={h} viewBox="0 0 32 24">
      <Path d={CHAM_TAIL} stroke={color} strokeWidth={2.4} strokeLinecap="round" fill="none" />
      <Path d={CHAM_LEGS} stroke={color} strokeWidth={1.9} strokeLinecap="round" />
      <Path d={CHAM_CREST} stroke={color} strokeWidth={1.3} strokeLinejoin="round" strokeLinecap="round" fill="none" />
      <Path d={CHAM_BODY} fill={color} />
      {CHAM_SPOTS.map(([x, y, r]) => (
        <Circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="rgba(255,255,255,0.28)" />
      ))}
    </Svg>
  );
}

export function ChameleonLoader({ size = 28, animate = true }: LoaderProps) {
  const t = useTheme();
  // slow colour cycle (8 s); eye + breathing use integer multiples of the same clock → seamless
  const v = useLoop(8000, animate, 0);
  const w = size * 1.15;
  const h = (w * 24) / 32;
  const u = w / 32;
  const palette = [t.colors.chart[2], t.colors.accent, t.colors.chart[3], t.colors.chart[4]];
  const bob = useAnimatedStyle(() => ({ transform: [{ translateY: Math.sin(v.value * TAU * 4) * u * 0.35 }] }));
  const pupil = useAnimatedStyle(() => {
    const p = v.value * TAU;
    return { transform: [{ translateX: Math.sin(p * 3) * u * 0.75 }, { translateY: Math.sin(p * 5 + 1) * u * 0.55 }] };
  });
  const pr = u * 1.05;
  return (
    <Box size={w} height={size}>
      <View style={{ position: 'absolute', left: 0, top: (size - h) / 2, width: w, height: h }}>
        <Svg width={w} height={h} viewBox="0 0 32 24" style={abs}>
          <Line x1={1.5} y1={21.6} x2={30.5} y2={21.6} stroke={t.colors.muted} strokeWidth={1.4} strokeLinecap="round" />
        </Svg>
        <Animated.View style={[abs, { width: w, height: h }, bob]}>
          <View style={abs}>
            <ChamShape w={w} h={h} color={palette[0]} />
          </View>
          {palette.slice(1).map((c, k) => (
            <ChamLayer key={k} v={v} i={k + 1} n={palette.length} w={w} h={h} color={c} />
          ))}
          <Svg width={w} height={h} viewBox="0 0 32 24" style={abs}>
            <Circle cx={24} cy={10.4} r={2.5} fill={t.colors.surface} stroke={withAlpha(t.colors.text, 0.25)} strokeWidth={0.5} />
          </Svg>
          <Animated.View
            style={[{ position: 'absolute', left: 24 * u - pr, top: 10.4 * u - pr, width: pr * 2, height: pr * 2, borderRadius: pr, backgroundColor: t.colors.text }, pupil]}
          />
        </Animated.View>
      </View>
    </Box>
  );
}

// ------------------------------------------------------------------ bars (chart)

function GrowBar({ v, i, size, color }: { v: SharedValue<number>; i: number; size: number; color: string }) {
  const H = size * 0.7;
  const w = size * 0.15;
  const target = [0.55, 0.85, 0.4, 1][i];
  const style = useAnimatedStyle(() => {
    const p = (v.value - i * 0.08 + 1) % 1;
    // grow (0–0.35), hold, shrink (0.8–1)
    const g = p < 0.35 ? p / 0.35 : p < 0.8 ? 1 : 1 - (p - 0.8) / 0.2;
    const e = 1 - Math.pow(1 - Math.max(0, Math.min(1, g)), 3);
    const k = 0.12 + (target - 0.12) * e;
    return { transform: [{ translateY: (H * (1 - k)) / 2 }, { scaleY: k }] };
  });
  return <Animated.View style={[{ position: 'absolute', bottom: size * 0.14, left: size * 0.12 + i * size * 0.2, width: w, height: H, borderRadius: w * 0.3, backgroundColor: color }, style]} />;
}

export function BarsLoader({ size = 28, animate = true }: LoaderProps) {
  const t = useTheme();
  const v = useLoop(2000, animate, 0.5);
  return (
    <Box size={size}>
      <View style={{ position: 'absolute', left: size * 0.06, right: size * 0.06, bottom: size * 0.1, height: Math.max(1, size * 0.04), backgroundColor: t.colors.muted, borderRadius: 1 }} />
      {[0, 1, 2, 3].map((i) => (
        <GrowBar key={i} v={v} i={i} size={size} color={t.colors.chart[i]} />
      ))}
    </Box>
  );
}

// ------------------------------------------------------------------ grid (table)

function Cell({ v, i, size, color, base }: { v: SharedValue<number>; i: number; size: number; color: string; base: string }) {
  const c = size * 0.24;
  const gap = size * 0.08;
  const r = Math.floor(i / 3);
  const col = i % 3;
  const style = useAnimatedStyle(() => {
    const p = (v.value - (r * 3 + col) / 12 + 1) % 1;
    const k = p < 0.25 ? Math.sin((p / 0.25) * Math.PI) : 0;
    return { opacity: 0.3 + 0.7 * k, transform: [{ scale: 0.85 + 0.15 * k }] };
  });
  return (
    <View style={{ position: 'absolute', left: size * 0.1 + col * (c + gap), top: size * 0.1 + r * (c + gap), width: c, height: c, borderRadius: c * 0.25, backgroundColor: base }}>
      <Animated.View style={[{ flex: 1, borderRadius: c * 0.25, backgroundColor: r === 0 ? color : withAlpha(color, 0.8) }, style]} />
    </View>
  );
}

export function GridLoader({ size = 28, animate = true }: LoaderProps) {
  const t = useTheme();
  const v = useLoop(1800, animate, 0.1);
  return (
    <Box size={size}>
      {Array.from({ length: 9 }, (_, i) => (
        <Cell key={i} v={v} i={i} size={size} color={t.colors.accent} base={t.colors.skeleton} />
      ))}
    </Box>
  );
}

// ------------------------------------------------------------------ pin (map)

export function PinLoader({ size = 28, animate = true }: LoaderProps) {
  const t = useTheme();
  const v = useLoop(2200, animate, 0.5);
  const p = size * 0.5;
  const drop = useAnimatedStyle(() => {
    const x = v.value;
    // fall (0–0.3) with bounce, rest, lift away (0.85–1)
    let y = 0;
    if (x < 0.3) {
      const f = x / 0.3;
      y = -(1 - f * f) * size * 0.4;
    } else if (x < 0.42) {
      y = -Math.sin(((x - 0.3) / 0.12) * Math.PI) * size * 0.06;
    } else if (x > 0.85) y = -((x - 0.85) / 0.15) * size * 0.3;
    const o = x > 0.85 ? 1 - (x - 0.85) / 0.15 : x < 0.06 ? x / 0.06 : 1;
    return { opacity: o, transform: [{ translateY: y }] };
  });
  const shadow = useAnimatedStyle(() => {
    const x = v.value;
    const k = x < 0.3 ? (x / 0.3) : x > 0.85 ? 1 - (x - 0.85) / 0.15 : 1;
    return { opacity: 0.25 * k + 0.05, transform: [{ scaleX: 0.4 + 0.6 * k }] };
  });
  return (
    <Box size={size}>
      <Svg width={size} height={size} style={abs}>
        <Path
          d={`M${size * 0.06} ${size * 0.7} L${size * 0.34} ${size * 0.6} L${size * 0.64} ${size * 0.7} L${size * 0.94} ${size * 0.6} L${size * 0.94} ${size * 0.9} L${size * 0.64} ${size} L${size * 0.34} ${size * 0.9} L${size * 0.06} ${size} Z`}
          fill={t.colors.surfaceAlt}
          stroke={t.colors.muted}
          strokeWidth={Math.max(1, size * 0.04)}
          strokeLinejoin="round"
          transform={`translate(0 ${-size * 0.06})`}
        />
      </Svg>
      <Animated.View style={[{ position: 'absolute', left: size * 0.5 - size * 0.14, top: size * 0.74, width: size * 0.28, height: size * 0.08 }, shadow]}>
        <Svg width={size * 0.28} height={size * 0.08}>
          <Ellipse cx={size * 0.14} cy={size * 0.04} rx={size * 0.14} ry={size * 0.04} fill={t.colors.text} />
        </Svg>
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', left: (size - p) / 2, top: size * 0.78 - p, width: p, height: p }, drop]}>
        <Svg width={p} height={p} viewBox="0 0 24 24">
          <Path d="M12 23C12 23 3.5 14.6 3.5 9a8.5 8.5 0 0 1 17 0C20.5 14.6 12 23 12 23Z" fill={t.colors.danger} />
          <Circle cx={12} cy={9} r={3.2} fill={t.colors.surface} />
        </Svg>
      </Animated.View>
    </Box>
  );
}
