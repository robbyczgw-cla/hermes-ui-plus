// Welcome screen: a tiny live preview of an interactive answer (loan calculator card). Auto-plays through a few
// terms; tapping the track picks a term (and stops the auto-play). Reduced motion: static, no timer.
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useLocale, useT } from '../../i18n';
import { HText, Icon, useMotionReduced, useTheme } from '../../ui';

const TERMS = [24, 36, 48, 60, 72] as const;
const PRINCIPAL = 20000;
const RATE_PA = 0.059;

/** monthly annuity payment */
export function monthlyRate(principal: number, ratePa: number, months: number): number {
  const r = ratePa / 12;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

export function MiniDemo() {
  const t = useTheme();
  const tr = useT();
  const { formatNumber } = useLocale();
  const reduced = useMotionReduced();
  const [idx, setIdx] = useState(2);
  const [auto, setAuto] = useState(!reduced);
  const [trackW, setTrackW] = useState(0);
  const pos = useSharedValue(idx / (TERMS.length - 1));

  useEffect(() => {
    if (!auto || reduced) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % TERMS.length), 1700);
    return () => clearInterval(id);
  }, [auto, reduced]);

  useEffect(() => {
    const to = idx / (TERMS.length - 1);
    pos.value = reduced ? to : withTiming(to, { duration: 420, easing: Easing.inOut(Easing.cubic) });
  }, [idx, reduced, pos]);

  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: pos.value * Math.max(0, trackW - 18) }] }), [trackW]);
  const fill = useAnimatedStyle(() => ({ width: 9 + pos.value * Math.max(0, trackW - 18) }), [trackW]);

  const months = TERMS[idx];
  const rate = monthlyRate(PRINCIPAL, RATE_PA, months);
  const interest = rate * months - PRINCIPAL;
  const eur = (n: number) => formatNumber(Math.round(n), { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const share = interest / (PRINCIPAL + interest);

  const pick = (e: { nativeEvent: { locationX: number } }) => {
    if (!trackW) return;
    const i = Math.round((e.nativeEvent.locationX / trackW) * (TERMS.length - 1));
    setAuto(false);
    setIdx(Math.min(TERMS.length - 1, Math.max(0, i)));
  };

  return (
    <View accessible accessibilityLabel={tr('onboarding.guided.welcome.mini.a11y')} style={styles.wrap}>
      <View style={[styles.user, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.l }]}>
        <HText variant="callout">{tr('onboarding.guided.welcome.mini.question')}</HText>
      </View>
      <View style={[styles.card, { borderColor: t.colors.border, backgroundColor: t.dark ? t.colors.surface : t.colors.bg, borderRadius: t.radii.l }]}>
        <View style={styles.cardHead}>
          <View style={[styles.spark, { backgroundColor: t.colors.accentSoft }]}>
            <Icon name="sparkle" size={13} color={t.colors.accent} />
          </View>
          <HText variant="headline" style={{ flex: 1 }}>
            {tr('onboarding.guided.welcome.mini.cardTitle')}
          </HText>
          <HText variant="caption" color="muted" tabular>
            {eur(PRINCIPAL)}
          </HText>
        </View>
        <View style={styles.row}>
          <HText variant="caption" color="muted">
            {tr('onboarding.guided.welcome.mini.term')}
          </HText>
          <HText variant="caption" weight="600" tabular>
            {tr('onboarding.guided.welcome.mini.months', { count: months })}
          </HText>
        </View>
        <Pressable onPress={pick} onLayout={(e: LayoutChangeEvent) => setTrackW(e.nativeEvent.layout.width)} hitSlop={10} style={styles.trackHit} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={[styles.track, { backgroundColor: t.colors.surfaceAlt }]} />
          <Animated.View style={[styles.trackFill, { backgroundColor: t.colors.accent }, fill]} />
          <Animated.View style={[styles.thumb, { backgroundColor: t.colors.bg, borderColor: t.colors.accent }, thumb]} />
        </Pressable>
        <View style={styles.figures}>
          <View style={{ flex: 1 }}>
            <HText variant="micro" color="muted">
              {tr('onboarding.guided.welcome.mini.rate')}
            </HText>
            <HText variant="title" tabular>
              {eur(rate)}
            </HText>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <HText variant="micro" color="muted">
              {tr('onboarding.guided.welcome.mini.total')}
            </HText>
            <HText variant="bodyStrong" tabular>
              {eur(interest)}
            </HText>
          </View>
        </View>
        <View style={[styles.split, { backgroundColor: t.colors.surfaceAlt }]}>
          <View style={{ flex: 1 - share, backgroundColor: t.colors.chart[0] ?? t.colors.accent }} />
          <View style={{ flex: share, backgroundColor: t.colors.chart[1] ?? t.colors.warning }} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  user: { alignSelf: 'flex-end', maxWidth: '86%', paddingHorizontal: 14, paddingVertical: 9 },
  card: { borderWidth: 1, padding: 14, gap: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  spark: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  trackHit: { height: 22, justifyContent: 'center' },
  track: { position: 'absolute', left: 0, right: 0, height: 6, borderRadius: 3 },
  trackFill: { position: 'absolute', left: 0, height: 6, borderRadius: 3 },
  thumb: { position: 'absolute', left: 0, width: 18, height: 18, borderRadius: 9, borderWidth: 3 },
  figures: { flexDirection: 'row', alignItems: 'flex-end' },
  split: { flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden' },
});
