// "Waiting delight" for a turn that has no visible answer yet: a context-aware indicator + rotating status
// line (logic: waiting.ts). Two placements:
//   row   – top of the assistant message (first token / tool running); fixed height ≈ one text line, so
//           the first streamed line replaces it without a layout jump; it leaves instantly (no exit fade),
//           the text's own fade-in is the hand-over – a fading row would ghost over the first line
//   badge – floating pill on top of the RouteSkeleton (announced UI format): zero layout impact, the
//           skeleton → component hand-over stays in place
// Only the phrase changes via React state (every 2.5 s); all motion runs on the UI thread (clock.ts).
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeOut, useAnimatedStyle } from 'react-native-reanimated';
import { useT, type TKey } from '../../i18n';
import { scaleFont } from '../themes';
import { useMotionReduced, useTheme } from '../theme';
import { useAppActive, useLoop } from './clock';
import { Loader, loaderWidth } from './Loader';
import {
  PHRASE_ROTATE_MS,
  createPhraseRotator,
  indicatorFor,
  msUntilNextTier,
  statusPool,
  waitStateKey,
  waitTier,
  type LoaderKind,
  type PhraseRotator,
  type WaitMode,
  type WaitState,
  type WaitTier,
} from './waiting';

export type WaitingIndicatorProps = {
  state: WaitState;
  /** effective mode (resolveWaitMode(pref, reducedMotion)) */
  mode: WaitMode;
  /** per message (seedFrom(message.id)): picks the first-token indicator + phrase order */
  seed?: number;
  /** persona loader of the active profile (personaLoader(profile)) */
  persona?: LoaderKind | null;
  /** turn start (ms epoch) for the long-wait tiers; default = mount time */
  startedAt?: number;
  variant?: 'row' | 'badge';
};

export const WAITING_ROW_HEIGHT = 28;

export function WaitingIndicator({ state, mode, seed = 0, persona = null, startedAt, variant = 'row' }: WaitingIndicatorProps) {
  const t = useTheme();
  const tr = useT();
  const reduced = useMotionReduced();
  const appActive = useAppActive();
  const motion = mode !== 'off' && !reduced;
  const [start] = useState(() => startedAt ?? Date.now());
  const t0 = startedAt ?? start;

  // long-wait tier: one timeout per threshold, no polling
  const [tier, setTier] = useState<WaitTier>(() => waitTier(Date.now() - t0));
  useEffect(() => {
    let id: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const e = Date.now() - t0;
      setTier(waitTier(e));
      const ms = msUntilNextTier(e);
      if (ms !== null) id = setTimeout(tick, ms + 20);
    };
    tick();
    return () => clearTimeout(id);
  }, [t0]);

  // phrase rotation: headline first after every state/tier change, then seeded random, never repeating
  const key = waitStateKey(state);
  const poolKey = `${key}|${tier}`;
  const pool = useMemo(() => statusPool(state, tier), [poolKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const rot = useRef<PhraseRotator<TKey> | null>(null);
  if (!rot.current) rot.current = createPhraseRotator<TKey>(seed);
  const lastPool = useRef(poolKey);
  const [phrase, setPhrase] = useState<TKey>(() => rot.current!.next(pool, pool[0]));
  const rotating = mode === 'playful' && appActive && pool.length > 1;
  useEffect(() => {
    if (lastPool.current !== poolKey) {
      lastPool.current = poolKey;
      setPhrase(rot.current!.next(pool, pool[0]));
    }
    if (!rotating) return;
    const id = setInterval(() => setPhrase(rot.current!.next(pool)), PHRASE_ROTATE_MS);
    return () => clearInterval(id);
  }, [poolKey, pool, rotating]);
  const shown = mode === 'playful' ? phrase : pool[0];

  const kind = indicatorFor(state, { mode, persona, seed });
  const badge = variant === 'badge';
  const size = badge ? 20 : 26;
  const text = { ...scaleFont(badge ? 13 : 14, badge ? 18 : 20, t.fontScale), fontFamily: t.fonts.sans };

  const body = (
    <>
      {kind ? (
        <View key={kind} style={[styles.slot, { width: loaderWidth(kind, size), height: size }]}>
          <Loader kind={kind} size={size} animate={motion} />
        </View>
      ) : null}
      <View style={[styles.textCol, badge ? styles.textColBadge : { height: WAITING_ROW_HEIGHT }]}>
        <Animated.Text key={shown} numberOfLines={1} style={[text, { color: t.colors.muted }]}>
          {tr(shown)}
        </Animated.Text>
        {tier > 0 && mode !== 'off' ? <ProgressHint animate={motion} /> : null}
      </View>
    </>
  );

  if (badge) {
    return (
      <Animated.View
        pointerEvents="none"
        exiting={motion ? FadeOut.duration(160) : undefined}
        accessibilityLabel={tr('waiting.a11y')}
        style={[styles.badge, { backgroundColor: t.colors.surface, borderColor: t.colors.border, borderRadius: t.radii.pill }, t.shadows.sm]}
      >
        {body}
      </Animated.View>
    );
  }
  // no exit fade: the first streamed line fades in exactly here; a fading ghost of the row would overlap it
  return (
    <View accessibilityLabel={tr('waiting.a11y')} style={styles.row}>
      {body}
    </View>
  );
}

/** >10 s: thin indeterminate line under the status text (absolute → no layout change). */
function ProgressHint({ animate }: { animate: boolean }) {
  const t = useTheme();
  const v = useLoop(1700, animate, 0.35);
  const W = 96;
  const seg = 30;
  const style = useAnimatedStyle(() => {
    const p = v.value;
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    return { transform: [{ translateX: -seg + e * (W + seg) }] };
  });
  return (
    <View style={[styles.track, { width: W, backgroundColor: t.colors.border }]}>
      <Animated.View style={[{ width: seg, height: 2, borderRadius: 1, backgroundColor: t.colors.accent }, style]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { height: WAITING_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 10 },
  slot: { alignItems: 'center', justifyContent: 'center' },
  textCol: { flexShrink: 1, flexGrow: 1, justifyContent: 'center' },
  textColBadge: { flexGrow: 0, height: 22, maxWidth: 220 },
  track: { position: 'absolute', left: 0, bottom: 0, height: 2, borderRadius: 1, overflow: 'hidden' },
  badge: { position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 7, height: 32, paddingLeft: 8, paddingRight: 12, borderWidth: StyleSheet.hairlineWidth },
});
