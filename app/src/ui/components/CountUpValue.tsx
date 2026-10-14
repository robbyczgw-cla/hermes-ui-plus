/**
 * A5 stats count-up (docs/SPEC-modules-v4.md): a stat value counts up once when it first appears in a
 * newly streamed answer (never in history). No per-frame React state:
 *  - native: a read-only TextInput whose `text` prop is driven by a reanimated shared value (UI thread)
 *  - web: requestAnimationFrame writes the DOM text directly
 * The real value is laid out underneath (invisible) so size, auto-shrink and a11y stay those of the
 * final text; one state update at the end swaps back to the plain text.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTheme } from '../theme';
import { HText, textStyle } from '../primitives/basics';
import { formatCountUp, parseCountUp, type CountUpTemplate } from '../lib/countUp';

const DURATION = 900;
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

type Props = { value: string; animate: boolean };

export function StatValue({ value, animate }: Props) {
  const tpl = useMemo(() => (animate ? parseCountUp(value) : null), [animate, value]);
  const [done, setDone] = useState(false);
  // the plain final text must come back even when the count-up never reports finished (interrupted
  // UI-thread animation, paused rAF): a JS timer, independent of both drivers, ends the hand-off
  useEffect(() => {
    if (!tpl || done) return;
    const id = setTimeout(() => setDone(true), DURATION + 300);
    return () => clearTimeout(id);
  }, [tpl, done]);
  const plain = (
    <HText variant="stat" tabular numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
      {value}
    </HText>
  );
  if (!tpl || done) return plain;
  return (
    <View>
      <View style={{ opacity: 0 }}>{plain}</View>
      <View style={StyleSheet.absoluteFill} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
        {Platform.OS === 'web' ? <WebCount tpl={tpl} onDone={() => setDone(true)} /> : <NativeCount tpl={tpl} onDone={() => setDone(true)} />}
      </View>
    </View>
  );
}

function useStatStyle() {
  const t = useTheme();
  return [textStyle(t, 'stat'), { color: t.colors.text, fontVariant: ['tabular-nums' as const] }];
}

function NativeCount({ tpl, onDone }: { tpl: CountUpTemplate; onDone(): void }) {
  const style = useStatStyle();
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming(tpl.value, { duration: DURATION, easing: Easing.out(Easing.cubic) }, (fin) => {
      if (fin) runOnJS(onDone)();
    });
  }, [tpl, p]); // eslint-disable-line react-hooks/exhaustive-deps
  const animatedProps = useAnimatedProps(() => ({ text: formatCountUp(tpl, p.value) }) as unknown as Record<string, unknown>);
  return (
    <AnimatedTextInput
      editable={false}
      underlineColorAndroid="transparent"
      defaultValue={formatCountUp(tpl, 0)}
      style={[style, { padding: 0, margin: 0 }]}
      animatedProps={animatedProps}
    />
  );
}

function WebCount({ tpl, onDone }: { tpl: CountUpTemplate; onDone(): void }) {
  const style = useStatStyle();
  const ref = useRef<Text>(null);
  useEffect(() => {
    const el = ref.current as unknown as { textContent: string } | null;
    const t0 = Date.now();
    let raf = 0;
    const step = () => {
      const k = Math.min(1, (Date.now() - t0) / DURATION);
      const eased = 1 - Math.pow(1 - k, 3);
      if (el) el.textContent = formatCountUp(tpl, tpl.value * eased);
      if (k < 1) raf = requestAnimationFrame(step);
      else onDone();
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [tpl]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Text ref={ref} style={style} numberOfLines={1}>
      {formatCountUp(tpl, 0)}
    </Text>
  );
}
