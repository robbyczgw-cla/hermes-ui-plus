/**
 * Shared visuals for the d2 modules (timer v2, guide, workout): stroke icons, progress ring, thin
 * progress bar, in-app "time is up" alert, sound toggle, small celebration and markdown body.
 */
import { useEffect, useMemo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useMotionReduced, useTheme, type Theme } from '../../../theme';
import { HText, InlineText, PressableScale } from '../../../primitives/basics';
import { Icon } from '../../../primitives/Icon';
import { useT } from '../../../../i18n';
import { bodyBlocks } from './guideModel.ts';

/* ───────────── icons ───────────── */

export type D2IconName = 'play' | 'pause' | 'reset' | 'bell' | 'bellOff' | 'sound' | 'soundOff' | 'stopwatch' | 'timer' | 'list' | 'steps' | 'help' | 'flag' | 'dumbbell' | 'flame' | 'leaf' | 'edit' | 'skip' | 'lightbulb';

export function D2Icon({ name, size = 18, color, strokeWidth = 1.9 }: { name: D2IconName; size?: number; color: string; strokeWidth?: number }) {
  const p = { stroke: color, strokeWidth, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  let body;
  switch (name) {
    case 'play':
      body = <Path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.4-7.2a.8.8 0 0 0 0-1.4L8.2 4.1A.8.8 0 0 0 7 4.8z" fill={color} stroke={color} strokeWidth={1} strokeLinejoin="round" />;
      break;
    case 'pause':
      body = (
        <>
          <Rect x={6} y={4.5} width={4} height={15} rx={1.2} fill={color} />
          <Rect x={14} y={4.5} width={4} height={15} rx={1.2} fill={color} />
        </>
      );
      break;
    case 'reset':
      body = <Path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4v5h5" {...p} />;
      break;
    case 'bell':
      body = <Path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 1.5h-15L6 16.5zM10 20.5a2 2 0 0 0 4 0" {...p} />;
      break;
    case 'bellOff':
      body = <Path d="M8.5 5.6A6 6 0 0 1 18 11v4M6 11v5.5L4.5 18H17M10 20.5a2 2 0 0 0 4 0M3 3l18 18" {...p} />;
      break;
    case 'sound':
      body = <Path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" {...p} />;
      break;
    case 'soundOff':
      body = <Path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5zM16 9.5l5 5M21 9.5l-5 5" {...p} />;
      break;
    case 'stopwatch':
      body = <Path d="M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 1.5M10 2.5h4M18.5 5.5l1.5-1.5" {...p} />;
      break;
    case 'timer':
      body = <Path d="M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4M10 2.5h4" {...p} />;
      break;
    case 'list':
      body = <Path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" {...p} strokeWidth={strokeWidth + 0.3} />;
      break;
    case 'steps':
      body = <Path d="M4 18h5v-5h5V8h5V4" {...p} />;
      break;
    case 'help':
      body = <Path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.3 9.3a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.4-2.7 4M12 17.5h.01" {...p} />;
      break;
    case 'flag':
      body = <Path d="M5 21V4.5M5 4.5h11l-2 4 2 4H5" {...p} />;
      break;
    case 'dumbbell':
      body = <Path d="M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11" {...p} strokeWidth={strokeWidth + 0.2} />;
      break;
    case 'flame':
      body = <Path d="M12 21c3.6 0 6-2.4 6-5.8 0-3.6-2.6-5.4-3.6-8.7-1.9 1.5-2.4 3.4-2.4 4.9-1-.6-1.7-1.8-1.9-3.2C8 10 6 12.3 6 15.2 6 18.6 8.4 21 12 21z" {...p} />;
      break;
    case 'leaf':
      body = <Path d="M5 19c0-8 5.5-13.5 14-14 .2 8.6-5.4 14-13 14M5 19l7-7" {...p} />;
      break;
    case 'edit':
      body = <Path d="M14.5 5.5l4 4M4 20l1-4.5L15.8 4.7a1.4 1.4 0 0 1 2 0l1.5 1.5a1.4 1.4 0 0 1 0 2L8.5 19 4 20z" {...p} />;
      break;
    case 'skip':
      body = <Path d="M5 5.5l9 6.5-9 6.5v-13zM18.5 5.5v13" {...p} />;
      break;
    case 'lightbulb':
      body = <Path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" {...p} />;
      break;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {body}
    </Svg>
  );
}

/* ───────────── ring ───────────── */

/**
 * Progress ring. `frac` = elapsed share 0..1: the remaining part stays coloured and drains
 * clockwise (countdown); with `fill` the coloured arc grows instead (stopwatch sweep).
 */
export function ClockRing({ size, stroke, frac, color, track, fill, children }: { size: number; stroke: number; frac: number; color: string; track: string; fill?: boolean; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const f = Math.min(1, Math.max(0, frac));
  const visible = fill ? f : 1 - f;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        {visible > 0.001 ? (
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - visible)} />
        ) : null}
      </Svg>
      {children}
    </View>
  );
}

/* ───────────── progress bar ───────────── */

export function ProgressBar({ frac, t, height = 6, color }: { frac: number; t: Theme; height?: number; color?: string }) {
  const reduced = useMotionReduced();
  const w = useSharedValue(Math.min(1, Math.max(0, frac)));
  useEffect(() => {
    const v = Math.min(1, Math.max(0, frac));
    w.value = reduced ? v : withTiming(v, { duration: 260, easing: Easing.out(Easing.cubic) });
  }, [frac, reduced, w]);
  const st = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: t.colors.surfaceAlt, overflow: 'hidden' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[{ height, borderRadius: height / 2, backgroundColor: color ?? t.colors.accent }, st]} />
    </View>
  );
}

/* ───────────── small controls ───────────── */

/** 44 pt round icon button (outline or filled). */
export function IconBtn({ icon, label, onPress, filled, disabled, size = 44, t, tone }: { icon: D2IconName; label: string; onPress: () => void; filled?: boolean; disabled?: boolean; size?: number; t: Theme; tone?: 'accent' | 'muted' }) {
  const fg = filled ? t.colors.onAccent : tone === 'muted' ? t.colors.muted : t.colors.text;
  return (
    <PressableScale
      haptic="selection"
      disabled={disabled}
      onPress={onPress}
      accessibilityLabel={label}
      hitSlop={Math.max(0, (44 - size) / 2)}
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: filled ? t.colors.accent : 'transparent', borderWidth: filled ? 0 : 1, borderColor: t.colors.borderStrong }}
      pressedStyle={{ backgroundColor: filled ? t.colors.accent : t.colors.surfacePressed, opacity: filled ? 0.86 : 1 }}
    >
      <D2Icon name={icon} size={Math.round(size * 0.4)} color={fg} />
    </PressableScale>
  );
}

/** Sound/vibration toggle (persisted by the caller). */
export function SoundToggle({ on, onToggle, t }: { on: boolean; onToggle: () => void; t: Theme }) {
  const tr = useT();
  return (
    <PressableScale
      haptic="selection"
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={tr('ui.timer.sound')}
      hitSlop={6}
      style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}
      pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
    >
      <D2Icon name={on ? 'sound' : 'soundOff'} size={18} color={on ? t.colors.muted : t.colors.subtle} />
    </PressableScale>
  );
}

/** Calm in-app "time is up" alert (fallback for missing system notifications and for when the card is in view). */
export function DoneAlert({ text, onDismiss, t }: { text: string; onDismiss: () => void; t: Theme }) {
  const tr = useT();
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, paddingLeft: t.spacing.m, borderRadius: t.radii.m, backgroundColor: t.colors.successSoft, minHeight: 44 }}
    >
      <D2Icon name="bell" size={16} color={t.colors.success} />
      <HText variant="callout" weight="600" style={{ flex: 1, color: t.colors.success, paddingVertical: 8 }}>
        {text}
      </HText>
      <PressableScale haptic="selection" onPress={onDismiss} accessibilityLabel={tr('ui.timer.dismiss')} style={{ minWidth: 52, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: t.spacing.m }}>
        <HText variant="callout" weight="600" style={{ color: t.colors.success }}>
          {tr('ui.timer.dismiss')}
        </HText>
      </PressableScale>
    </View>
  );
}

/** Uppercase micro label for sections. */
export function SectionLabel({ text, t, style }: { text: string; t: Theme; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style}>
      <HText variant="micro" color="muted" weight="600" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }} accessibilityRole="header">
        {text}
      </HText>
    </View>
  );
}

/** Tip / warning box. */
export function NoteBox({ kind, text, t }: { kind: 'tip' | 'warning'; text: string; t: Theme }) {
  const tr = useT();
  const fg = kind === 'warning' ? t.colors.warning : t.colors.accent;
  const bg = kind === 'warning' ? t.colors.warningSoft : t.colors.accentSoft;
  return (
    <View style={{ flexDirection: 'row', gap: t.spacing.s, padding: t.spacing.m, borderRadius: t.radii.m, backgroundColor: bg }}>
      <View style={{ paddingTop: 2 }}>{kind === 'warning' ? <Icon name="alert" size={16} color={fg} /> : <D2Icon name="lightbulb" size={16} color={fg} />}</View>
      <View style={{ flex: 1, gap: 2 }}>
        <HText variant="caption" weight="700" style={{ color: fg }}>
          {kind === 'warning' ? tr('ui.guide.warning') : tr('ui.guide.tip')}
        </HText>
        <InlineText variant="callout" text={text} />
      </View>
    </View>
  );
}

/** Step body: paragraphs and lists with inline markdown. */
export function MarkdownBody({ text, t }: { text: string; t: Theme }) {
  const blocks = useMemo(() => bodyBlocks(text), [text]);
  return (
    <View style={{ gap: t.spacing.s }}>
      {blocks.map((b, i) =>
        b.kind === 'p' ? (
          <InlineText key={i} variant="body" text={b.text} />
        ) : (
          <View key={i} style={{ gap: 4 }}>
            {b.items.map((it, k) => (
              <View key={k} style={{ flexDirection: 'row', gap: t.spacing.s }}>
                <HText variant="body" color="muted" tabular style={{ minWidth: b.kind === 'ol' ? 18 : 10 }}>
                  {b.kind === 'ol' ? `${k + 1}.` : '•'}
                </HText>
                <InlineText variant="body" text={it} style={{ flex: 1 }} />
              </View>
            ))}
          </View>
        ),
      )}
    </View>
  );
}

/* ───────────── celebration ───────────── */

const BURST = 12;

/** Small radial burst around a check mark; static check with reduce-motion. */
export function Celebration({ t, size = 72 }: { t: Theme; size?: number }) {
  const reduced = useMotionReduced();
  const colors = [t.colors.accent, t.colors.success, t.colors.warning, t.colors.info];
  return (
    <View style={{ width: size * 2, height: size * 1.6, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {reduced ? null : Array.from({ length: BURST }, (_, i) => <Spark key={i} i={i} color={colors[i % colors.length]} radius={size * 0.85} />)}
      <Pop reduced={reduced}>
        <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.colors.successSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="check" size={Math.round(size * 0.46)} color={t.colors.success} strokeWidth={2.6} />
        </View>
      </Pop>
    </View>
  );
}

function Pop({ reduced, children }: { reduced: boolean; children: React.ReactNode }) {
  const s = useSharedValue(reduced ? 1 : 0.6);
  useEffect(() => {
    if (!reduced) s.value = withTiming(1, { duration: 380, easing: Easing.out(Easing.back(2)) });
  }, [reduced, s]);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return <Animated.View style={st}>{children}</Animated.View>;
}

function Spark({ i, color, radius }: { i: number; color: string; radius: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay((i % 3) * 40, withTiming(1, { duration: 720, easing: Easing.out(Easing.cubic) }));
  }, [i, p]);
  const angle = (i / BURST) * Math.PI * 2;
  const dist = radius * (i % 2 ? 0.8 : 1);
  const st = useAnimatedStyle(() => ({
    opacity: p.value < 0.7 ? 1 : 1 - (p.value - 0.7) / 0.3,
    transform: [{ translateX: Math.cos(angle) * dist * p.value }, { translateY: Math.sin(angle) * dist * p.value }, { scale: 1 - p.value * 0.4 }],
  }));
  const dot = i % 3 === 0 ? 8 : 6;
  return <Animated.View style={[{ position: 'absolute', width: dot, height: dot, borderRadius: i % 4 === 1 ? 1.5 : dot / 2, backgroundColor: color }, st]} />;
}
