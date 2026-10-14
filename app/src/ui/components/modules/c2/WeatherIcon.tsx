/**
 * Weather condition icon (react-native-svg) composed from layers (weatherModel.conditionParts):
 * sun / moon (+ stars), cloud (+ back cloud), rain / drizzle / snow / sleet, bolt, fog, wind.
 * `animate` adds subtle UI-thread loops (sun rays turn, cloud drifts, drops fall, stars twinkle,
 * bolt flashes); reduced motion (system or app setting) → static. Purely decorative: hidden from
 * screen readers — the caller provides the text label.
 */
import { memo, useEffect, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, G, Line, Path } from 'react-native-svg';
import { useMotionReduced, useTheme } from '../../../theme';
import type { HuiWeatherCondition } from '../../../types';
import { conditionParts, type CloudTone, type ConditionParts } from './weatherModel.ts';

const CLOUD = 'M7 19a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 9.6a4.7 4.7 0 0 1 .5 9.4z';
const MOON = 'M14.5 4.6A7.6 7.6 0 1 0 19.6 15.4 6.1 6.1 0 0 1 14.5 4.6z';

type Palette = { sun: string; moon: string; star: string; cloud: Record<CloudTone, { fill: string; stroke?: string }>; rain: string; snow: string; bolt: string; line: string };

function usePalette(): Palette {
  const t = useTheme();
  const d = t.dark;
  return {
    sun: '#F4AE2F',
    moon: d ? '#E4DFC6' : '#98A4BE',
    star: d ? '#F3EBC0' : '#B49A3C',
    cloud: {
      light: d ? { fill: '#9AA5B5' } : { fill: '#DCE2EA', stroke: '#9DA8B7' },
      dark: d ? { fill: '#6E7989' } : { fill: '#AEB8C6', stroke: '#7F8A9A' },
    },
    rain: d ? '#62AEF5' : '#2F80D9',
    snow: d ? '#DDEBFA' : '#6FA6DD',
    bolt: '#F2BE22',
    line: t.colors.muted,
  };
}

/** 0→1 loop on the UI thread (yoyo or restart); stays 0 when disabled. */
function useLoop(enabled: boolean, duration: number, yoyo = true, delay = 0): SharedValue<number> {
  const v = useSharedValue(0);
  useEffect(() => {
    if (!enabled) {
      v.value = 0;
      return;
    }
    v.value = 0;
    v.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: yoyo ? Easing.inOut(Easing.sin) : Easing.linear }), -1, yoyo));
    return () => cancelAnimation(v);
  }, [enabled, duration, yoyo, delay, v]);
  return v;
}

function Layer({ size, children, style }: { size: number; children: ReactNode; style?: object }) {
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        {children}
      </Svg>
    </Animated.View>
  );
}

function SunRays({ color }: { color: string }) {
  const rays = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    rays.push(<Line key={i} x1={12 + Math.cos(a) * 6.9} y1={12 + Math.sin(a) * 6.9} x2={12 + Math.cos(a) * 9.2} y2={12 + Math.sin(a) * 9.2} stroke={color} strokeWidth={1.8} strokeLinecap="round" />);
  }
  return <>{rays}</>;
}

/** Full-size sun drawn in a sub-box (`box` = fraction of the icon, centred at cx/cy in 24-grid units). */
function Sun({ size, animate, small, color }: { size: number; animate: boolean; small: boolean; color: string }) {
  const spin = useLoop(animate, 24000, false);
  const k = small ? 0.62 : 1;
  const box = size * k;
  const c = small ? (8.4 / 24) * size : size / 2;
  const rays = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: c - box / 2, top: c - box / 2, width: box, height: box }}>
      <Layer size={box} style={rays}>
        <SunRays color={color} />
      </Layer>
      <Layer size={box}>
        <Circle cx={12} cy={12} r={4.6} fill={color} />
      </Layer>
    </View>
  );
}

function Moon({ size, small, color }: { size: number; small: boolean; color: string }) {
  const k = small ? 0.6 : 1;
  const box = size * k;
  const c = small ? (8.6 / 24) * size : size / 2;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: c - box / 2, top: c - box / 2, width: box, height: box }}>
      <Layer size={box}>
        <Path d={MOON} fill={color} />
      </Layer>
    </View>
  );
}

function Stars({ size, animate, color }: { size: number; animate: boolean; color: string }) {
  const tw = useLoop(animate, 2200, true);
  const st = useAnimatedStyle(() => ({ opacity: 1 - tw.value * 0.65 }));
  const star = (x: number, y: number, r: number) => `M${x} ${y - r}L${x + r * 0.3} ${y - r * 0.3}L${x + r} ${y}L${x + r * 0.3} ${y + r * 0.3}L${x} ${y + r}L${x - r * 0.3} ${y + r * 0.3}L${x - r} ${y}L${x - r * 0.3} ${y - r * 0.3}Z`;
  return (
    <Layer size={size} style={st}>
      <Path d={star(19, 5.2, 1.9)} fill={color} />
      <Path d={star(21.2, 10.4, 1.2)} fill={color} />
    </Layer>
  );
}

function cloudTransform(p: ConditionParts): string {
  const below = !!(p.precip || p.bolt || p.fog);
  const beside = !!(p.sun === 'small' || p.moon === 'small');
  if (below && beside) return 'translate(1.2 -2.4)';
  if (below) return 'translate(0 -3)';
  if (beside) return 'translate(1.4 1)';
  return 'translate(0 -0.5)';
}

function Cloud({ size, animate, parts, pal }: { size: number; animate: boolean; parts: ConditionParts; pal: Palette }) {
  const drift = useLoop(animate, 3800, true);
  const st = useAnimatedStyle(() => ({ transform: [{ translateX: (drift.value - 0.5) * size * 0.05 }] }));
  const tone = pal.cloud[parts.cloud ?? 'light'];
  const tf = cloudTransform(parts);
  return (
    <Layer size={size} style={st}>
      <G transform={tf}>
        {parts.backCloud ? (
          <G transform="translate(8.4 0.6) scale(0.6)" opacity={0.75}>
            <Path d={CLOUD} fill={tone.fill} stroke={tone.stroke} strokeWidth={tone.stroke ? 1.6 : 0} />
          </G>
        ) : null}
        <Path d={CLOUD} fill={tone.fill} stroke={tone.stroke} strokeWidth={tone.stroke ? 1 : 0} strokeLinejoin="round" />
      </G>
    </Layer>
  );
}

function Precip({ size, animate, kind, pal }: { size: number; animate: boolean; kind: NonNullable<ConditionParts['precip']>; pal: Palette }) {
  const snowy = kind === 'snow';
  const fall = useLoop(animate, snowy ? 2000 : 900, false);
  const st = useAnimatedStyle(() => ({
    transform: [{ translateY: fall.value * size * (snowy ? 0.06 : 0.08) }],
    opacity: animate ? 1 - fall.value * 0.7 : 1,
  }));
  const drop = (x: number, y: number, len: number, k: number) => <Line key={k} x1={x} y1={y} x2={x - len * 0.35} y2={y + len} stroke={pal.rain} strokeWidth={1.7} strokeLinecap="round" />;
  const flake = (x: number, y: number, k: number) => <Circle key={k} cx={x} cy={y} r={1.15} fill={pal.snow} />;
  let body: ReactNode;
  if (kind === 'rain') body = [drop(8.6, 17.6, 3, 0), drop(12.6, 17.6, 3, 1), drop(16.6, 17.6, 3, 2)];
  else if (kind === 'drizzle') body = [drop(9.8, 17.8, 1.8, 0), drop(14.2, 17.8, 1.8, 1)];
  else if (kind === 'snow') body = [flake(8.6, 18.4, 0), flake(12.6, 19.6, 1), flake(16.6, 18.4, 2)];
  else body = [drop(9.4, 17.6, 3, 0), flake(14.6, 19, 1)];
  return (
    <Layer size={size} style={st}>
      {body}
    </Layer>
  );
}

function Bolt({ size, animate, color }: { size: number; animate: boolean; color: string }) {
  const f = useSharedValue(1);
  useEffect(() => {
    if (!animate) {
      f.value = 1;
      return;
    }
    f.value = withRepeat(withSequence(withTiming(1, { duration: 2600 }), withTiming(0.25, { duration: 80 }), withTiming(1, { duration: 120 }), withTiming(0.4, { duration: 70 }), withTiming(1, { duration: 160 })), -1, false);
    return () => cancelAnimation(f);
  }, [animate, f]);
  const st = useAnimatedStyle(() => ({ opacity: f.value }));
  return (
    <Layer size={size} style={st}>
      <Path d="M13.2 13.4 9.6 18.6h3.1l-1.3 4.2 4.4-5.9h-3.1l1.6-3.5z" fill={color} />
    </Layer>
  );
}

function Lines({ size, animate, kind, color }: { size: number; animate: boolean; kind: 'fog' | 'wind'; color: string }) {
  const sway = useLoop(animate, kind === 'wind' ? 1600 : 3200, true);
  const st = useAnimatedStyle(() => ({ transform: [{ translateX: (sway.value - 0.5) * size * (kind === 'wind' ? 0.08 : 0.06) }] }));
  const p = { stroke: color, strokeWidth: 1.7, strokeLinecap: 'round' as const, fill: 'none' };
  return (
    <Layer size={size} style={st}>
      {kind === 'fog' ? (
        <>
          <Line x1={5} y1={18.4} x2={16} y2={18.4} {...p} />
          <Line x1={8} y1={21.2} x2={19} y2={21.2} {...p} />
        </>
      ) : (
        <>
          <Path d="M3 9.5h10.5a2.6 2.6 0 1 0-2.6-2.6" {...p} />
          <Path d="M3 13.5h14.5a3 3 0 1 1-3 3" {...p} />
          <Path d="M3 17.5h6.5" {...p} />
        </>
      )}
    </Layer>
  );
}

export const WeatherIcon = memo(function WeatherIcon({ condition, size = 28, animate = false }: { condition: HuiWeatherCondition; size?: number; animate?: boolean }) {
  const pal = usePalette();
  const reduced = useMotionReduced();
  const on = animate && !reduced;
  const p = conditionParts(condition);
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
      {p.sun ? <Sun size={size} animate={on} small={p.sun === 'small'} color={pal.sun} /> : null}
      {p.moon ? <Moon size={size} small={p.moon === 'small'} color={pal.moon} /> : null}
      {p.stars ? <Stars size={size} animate={on} color={pal.star} /> : null}
      {p.precip ? <Precip size={size} animate={on} kind={p.precip} pal={pal} /> : null}
      {p.cloud ? <Cloud size={size} animate={on} parts={p} pal={pal} /> : null}
      {p.bolt ? <Bolt size={size} animate={on} color={pal.bolt} /> : null}
      {p.fog ? <Lines size={size} animate={on} kind="fog" color={pal.line} /> : null}
      {p.wind ? <Lines size={size} animate={on} kind="wind" color={pal.line} /> : null}
    </View>
  );
});
