import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { webAriaState } from '../lib/ariaState';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useMotionReduced, useTheme, type Theme, type ThemeColors, type Typography } from '../theme';
import { splitPressableStyle } from '../lib/pressableLayout';
import { parseInline } from '../lib/inlineMarkdown';
import { FADE_IN_MS, FADE_IN_SETTLED, fadeInPlan } from '../lib/fadeIn';
import { haptic, type HapticKind } from './haptics';
import { useHui } from './context';

type ColorKey = keyof Omit<ThemeColors, 'chart'>;

export type HTextProps = TextProps & {
  variant?: keyof Typography;
  /** Theme color key or raw color. Default `text`. */
  color?: ColorKey | (string & {});
  weight?: TextStyle['fontWeight'];
  align?: TextStyle['textAlign'];
  tabular?: boolean;
};

export function resolveColor(t: Theme, c: string | undefined, fallback: ColorKey = 'text'): string {
  if (!c) return t.colors[fallback];
  const v = (t.colors as Record<string, unknown>)[c];
  return typeof v === 'string' ? v : c;
}

export function textStyle(t: Theme, variant: keyof Typography = 'body'): TextStyle {
  const ty = t.typography[variant];
  return {
    fontSize: ty.fontSize,
    lineHeight: ty.lineHeight,
    fontWeight: ty.fontWeight,
    letterSpacing: ty.letterSpacing,
    fontFamily: ty.fontFamily ?? t.fonts.sans,
  };
}

/** Themed text. */
export function HText({ variant = 'body', color, weight, align, tabular, style, ...rest }: HTextProps) {
  const t = useTheme();
  return (
    <Text
      {...rest}
      style={[
        textStyle(t, variant),
        { color: resolveColor(t, color) },
        weight ? { fontWeight: weight } : null,
        align ? { textAlign: align } : null,
        tabular ? { fontVariant: ['tabular-nums'] } : null,
        style,
      ]}
    />
  );
}

/** Text with inline markdown (bold/italic/code/strike/links). Links dispatch `open_url`. */
export function InlineText({ text, ...props }: HTextProps & { text: string }) {
  const t = useTheme();
  const { onAction } = useHui();
  const spans = useMemo(() => parseInline(text), [text]);
  const base = textStyle(t, props.variant ?? 'body');
  return (
    <HText {...props}>
      {spans.map((s, i) => {
        const st: TextStyle = {};
        if (s.bold) st.fontWeight = '600';
        if (s.italic) st.fontStyle = 'italic';
        if (s.strike) st.textDecorationLine = 'line-through';
        if (s.code) {
          st.fontFamily = t.fonts.mono;
          st.fontSize = Math.max(11, base.fontSize! - 1.5);
          st.backgroundColor = t.colors.surfaceAlt;
          st.borderRadius = 4;
        }
        if (s.href) {
          st.color = t.colors.accent;
          st.textDecorationLine = s.strike ? 'underline line-through' : 'underline';
          const href = s.href;
          return (
            <Text
              key={i}
              style={st}
              accessibilityRole="link"
              onPress={() => {
                haptic('selection');
                onAction({ type: 'open_url', url: href });
              }}
            >
              {s.text}
            </Text>
          );
        }
        return (
          <Text key={i} style={st}>
            {s.text}
          </Text>
        );
      })}
    </HText>
  );
}

export type PressableScaleProps = Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle>;
  pressedStyle?: StyleProp<ViewStyle>;
  haptic?: HapticKind | false;
  scaleTo?: number;
  /** false: the caller styles the disabled state itself (neutral surfaceAlt + subtle text), no extra fade */
  dimDisabled?: boolean;
  children?: ReactNode;
};

/** Layout props go on the Pressable (so `flex: 1` etc. work in rows); visuals on the animated inner view. */
function splitStyle(style: StyleProp<ViewStyle>): [ViewStyle, ViewStyle] {
  const [outer, inner] = splitPressableStyle((StyleSheet.flatten(style) ?? {}) as Record<string, unknown>);
  return [outer as ViewStyle, inner as ViewStyle];
}

/** Pressable with a restrained press-scale + optional haptic. */
export function PressableScale({ style, pressedStyle, haptic: h = 'light', scaleTo = 0.97, onPress, onPressIn, onPressOut, disabled, dimDisabled = true, children, ...rest }: PressableScaleProps) {
  const [outer, inner] = splitStyle(style);
  const s = useSharedValue(1);
  const reduced = useMotionReduced();
  // inside a still-streaming block, controls are disabled only until the block completes: dim them
  // lightly so the arriving content stays readable (45 % made it look washed out / empty)
  const { streaming } = useHui();
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <Pressable
      {...rest}
      {...(Platform.OS === 'web' ? webAriaState(rest.accessibilityState) : null)}
      style={outer}
      disabled={disabled}
      accessibilityRole={rest.accessibilityRole ?? 'button'}
      accessibilityState={{ disabled: !!disabled, ...(rest.accessibilityState ?? {}) }}
      onPressIn={(e) => {
        if (!reduced) s.value = withTiming(scaleTo, { duration: 90 });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        s.value = withSpring(1, { damping: 18, stiffness: 320 });
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (h) haptic(h);
        onPress?.(e);
      }}
    >
      {({ pressed }) => <Animated.View style={[inner, pressed ? pressedStyle : null, disabled && dimDisabled ? { opacity: streaming ? 0.8 : 0.45 } : null, anim]}>{children}</Animated.View>}
    </Pressable>
  );
}

/**
 * Mount animation: fade + small rise. Once it is over the end state lives in React's own props
 * (`FADE_IN_SETTLED`, ui/lib/fadeIn.ts): Reanimated keeps the animated value only on the UI thread and may
 * drop it after a JS stall, and the next React commit would then write the mount-time opacity 0 back –
 * an invisible block that keeps its height. Reduced motion (also switched on mid-entrance): settled at once.
 */
export function FadeIn({ children, delay = 0, style, rise = 6 }: { children?: ReactNode; delay?: number; style?: StyleProp<ViewStyle>; rise?: number }) {
  const reduced = useMotionReduced();
  const p = useSharedValue(reduced ? 1 : 0);
  const [settled, setSettled] = useState(reduced);
  useEffect(() => {
    if (settled) return;
    const plan = fadeInPlan(delay, reduced);
    const settle = () => {
      p.value = 1;
      setSettled(true);
    };
    if (plan.settleAt <= 0) {
      settle();
      return;
    }
    const start = setTimeout(() => {
      p.value = withTiming(1, { duration: FADE_IN_MS, easing: Easing.out(Easing.cubic) });
    }, plan.startAt);
    // independent of the UI thread: even a fade that never ran ends fully visible
    const end = setTimeout(settle, plan.settleAt);
    return () => {
      clearTimeout(start);
      clearTimeout(end);
    };
  }, [delay, reduced, p, settled]);
  const anim = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: (1 - p.value) * rise }] }), [rise]);
  return <Animated.View style={[style, anim, settled ? FADE_IN_SETTLED : null]}>{children}</Animated.View>;
}

/** Component surface (card shell). Nested surfaces are flatter. */
export function Surface({ children, style, padded = true, depth = 0 }: { children?: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean; depth?: number }) {
  const t = useTheme();
  const nested = depth > 0;
  return (
    <View
      style={[
        {
          backgroundColor: nested ? t.colors.surfaceAlt : t.colors.surface,
          borderRadius: nested ? t.radii.m : t.radii.l,
          borderWidth: nested ? 0 : 1,
          borderColor: t.colors.border,
          padding: padded ? (nested ? t.spacing.m : t.spacing.l) : 0,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Small pill label. */
export function Badge({ label, tone = 'accent' }: { label: string; tone?: 'accent' | 'neutral' | 'success' | 'warning' | 'danger' }) {
  const t = useTheme();
  const map = {
    accent: [t.colors.accentSoft, t.colors.accent],
    neutral: [t.colors.surfaceAlt, t.colors.muted],
    success: [t.colors.successSoft, t.colors.success],
    warning: [t.colors.warningSoft, t.colors.warning],
    danger: [t.colors.dangerSoft, t.colors.danger],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: t.radii.pill, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <HText variant="micro" style={{ color: fg }} numberOfLines={1}>
        {label}
      </HText>
    </View>
  );
}

/** Small header used by components that have an optional title. */
export function BlockTitle({ title, subtitle, right }: { title?: string; subtitle?: string; right?: ReactNode }) {
  const t = useTheme();
  if (!title && !subtitle && !right) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.s, marginBottom: t.spacing.m }}>
      <View style={{ flex: 1, gap: 2 }}>
        {title ? <InlineText variant="headline" text={title} /> : null}
        {subtitle ? <InlineText variant="caption" color="muted" text={subtitle} /> : null}
      </View>
      {right}
    </View>
  );
}
