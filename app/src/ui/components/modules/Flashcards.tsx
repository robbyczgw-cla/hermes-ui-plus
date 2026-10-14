import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useTheme, type Theme } from '../../theme';
import { useHui } from '../../primitives/context';
import { FadeIn, HText, InlineText, PressableScale, Surface } from '../../primitives/basics';
import { Icon } from '../../primitives/Icon';
import { haptic } from '../../primitives/haptics';
import { asOptString } from '../../lib/format';
import { useNodeState } from '../../../nodestate';
import type { HuiFlashcards } from '../../types';
import { answerCard, deckRounds, initDeck, readCards, shuffled, syncDeck, type DeckState, type Flashcard } from './a/learnModel.ts';
import { ExtraIcon } from './a/ExtraIcon';
import { PrimaryButton, SecondaryButton, useModuleId } from './a/shared';
import { useS } from './useS';
import { FlashcardsSkeleton } from '../../skeletons';

const SWIPE = 90;

/** `flashcards` – tap to flip, "Gewusst" / "Nochmal" (or swipe right / left); progress persisted. */
export function Flashcards({ node }: { node: Partial<HuiFlashcards> }) {
  const S = useS();
  const t = useTheme();
  const { streaming } = useHui();
  const id = useModuleId('flashcards', node as Record<string, unknown>);
  const cards = useMemo(() => readCards(node.cards), [node.cards]);
  const [stored, setStored] = useNodeState<DeckState>(id, initDeck(0));
  const deck = syncDeck(stored, cards.length);
  const [flipped, setFlipped] = useState(false);
  const title = asOptString(node.title);
  const current = deck.queue[0];

  if (!cards.length) {
    return streaming ? (
      <FlashcardsSkeleton />
    ) : (
      <Surface>
        <HText variant="callout" color="muted">
          {S.flashcards.empty}
        </HText>
      </Surface>
    );
  }

  const ratio = deck.total ? deck.known.length / deck.total : 0;
  const header = (
    <View style={{ gap: 6 }}>
      {title ? <InlineText variant="headline" text={title} /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
        <HText variant="caption" color="muted" style={{ flex: 1 }} tabular>
          {S.flashcards.progress(deck.known.length, deck.total)}
        </HText>
        {deck.queue.length ? (
          <HText variant="caption" color="subtle" tabular>
            {S.flashcards.remaining(deck.queue.length)}
          </HText>
        ) : null}
      </View>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: t.colors.surfaceAlt, overflow: 'hidden' }}>
        <View style={{ height: 4, width: `${ratio * 100}%`, backgroundColor: ratio >= 1 ? t.colors.success : t.colors.accent }} />
      </View>
    </View>
  );

  if (current === undefined) {
    return (
      <Surface style={{ gap: t.spacing.l }}>
        {header}
        <FadeIn style={{ alignItems: 'center', gap: 6, paddingVertical: t.spacing.m }}>
          <HText style={{ fontSize: 34, lineHeight: 42 }}>🎉</HText>
          <HText variant="headline">{S.flashcards.doneTitle}</HText>
          <HText variant="callout" color="muted" align="center">
            {S.flashcards.doneText(deck.total, deckRounds(deck))}
          </HText>
        </FadeIn>
        <View style={{ flexDirection: 'row', gap: t.spacing.s }}>
          <SecondaryButton label={S.flashcards.shuffle} icon={undefined} onPress={() => setStored(initDeck(cards.length, shuffled(cards.length)))} style={{ flex: 1 }} />
          <PrimaryButton label={S.flashcards.restart} onPress={() => setStored(initDeck(cards.length))} style={{ flex: 1 }} />
        </View>
      </Surface>
    );
  }

  const verdict = (v: 'known' | 'again') => {
    haptic(v === 'known' ? 'success' : 'light');
    setFlipped(false);
    setStored((s) => answerCard(syncDeck(s, cards.length), v));
  };

  return (
    <Surface style={{ gap: t.spacing.m }}>
      {header}
      <Card key={`${current}-${deck.known.length}-${deck.queue.length}-${deck.misses[current] ?? 0}`} t={t} card={cards[current]} flipped={flipped} onFlip={() => setFlipped((f) => !f)} onVerdict={verdict} />
      <View style={{ flexDirection: 'row', gap: t.spacing.s }}>
        {flipped ? (
          <>
            <SecondaryButton label={S.flashcards.again} onPress={() => verdict('again')} style={{ flex: 1 }} />
            <PrimaryButton label={S.flashcards.known} tone="success" icon="check" onPress={() => verdict('known')} style={{ flex: 1 }} />
          </>
        ) : (
          <SecondaryButton label={S.flashcards.flip} onPress={() => setFlipped(true)} style={{ flex: 1 }} />
        )}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
        <ExtraIcon name="flip" size={12} color={t.colors.subtle} />
        <HText variant="micro" color="subtle">
          {S.flashcards.swipeHint}
        </HText>
      </View>
    </Surface>
  );
}

function Card({ t, card, flipped, onFlip, onVerdict }: { t: Theme; card: Flashcard; flipped: boolean; onFlip: () => void; onVerdict: (v: 'known' | 'again') => void }) {
  const S = useS();
  const reduced = useReducedMotion();
  const rot = useSharedValue(flipped ? 1 : 0);
  const dx = useSharedValue(0);
  const [h, setH] = useState(180);
  useEffect(() => {
    rot.value = reduced ? (flipped ? 1 : 0) : withTiming(flipped ? 1 : 0, { duration: 320 });
  }, [flipped, reduced, rot]);

  const pan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-14, 14])
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      dx.set(e.translationX);
    })
    .onEnd((e) => {
      if (Math.abs(e.translationX) > SWIPE) {
        const v = e.translationX > 0 ? 'known' : 'again';
        if (reduced) onVerdict(v);
        else {
          dx.set(withTiming(e.translationX > 0 ? 420 : -420, { duration: 180 }));
          setTimeout(() => onVerdict(v), 170);
        }
      } else dx.set(withSpring(0, { damping: 18, stiffness: 220 }));
    });

  const wrap = useAnimatedStyle(() => ({ transform: [{ translateX: dx.value }, { rotateZ: `${dx.value / 30}deg` }] }));
  const front = useAnimatedStyle(() =>
    reduced
      ? { opacity: rot.value < 0.5 ? 1 : 0 }
      : { transform: [{ perspective: 900 }, { rotateY: `${interpolate(rot.value, [0, 1], [0, 180])}deg` }], opacity: rot.value < 0.5 ? 1 : 0 },
  );
  const back = useAnimatedStyle(() =>
    reduced
      ? { opacity: rot.value >= 0.5 ? 1 : 0 }
      : { transform: [{ perspective: 900 }, { rotateY: `${interpolate(rot.value, [0, 1], [180, 360])}deg` }], opacity: rot.value >= 0.5 ? 1 : 0 },
  );
  const hintKnown = useAnimatedStyle(() => ({ opacity: Math.max(0, Math.min(1, dx.value / SWIPE)) }));
  const hintAgain = useAnimatedStyle(() => ({ opacity: Math.max(0, Math.min(1, -dx.value / SWIPE)) }));

  const face = (side: 'front' | 'back') => ({
    position: 'absolute' as const,
    left: 0,
    right: 0,
    top: 0,
    minHeight: h,
    borderRadius: t.radii.l,
    borderWidth: 1,
    borderColor: side === 'back' ? t.colors.accent : t.colors.border,
    backgroundColor: side === 'back' ? t.colors.accentSoft : t.colors.surfaceAlt,
    padding: t.spacing.xl,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: t.spacing.s,
    backfaceVisibility: 'hidden' as const,
  });
  const measure = (e: { nativeEvent: { layout: { height: number } } }) => {
    const nh = Math.ceil(e.nativeEvent.layout.height);
    if (nh > h) setH(nh);
  };

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ height: h }, wrap]}>
        <PressableScale
          haptic="selection"
          scaleTo={0.985}
          onPress={onFlip}
          accessibilityRole="button"
          accessibilityLabel={flipped ? S.flashcards.cardA11y(S.flashcards.back, card.back || '–') : S.flashcards.cardA11y(S.flashcards.front, card.front)}
          accessibilityHint={S.flashcards.tapToFlip}
          accessibilityActions={[{ name: 'activate' }, { name: 'known', label: S.flashcards.known }, { name: 'again', label: S.flashcards.again }]}
          onAccessibilityAction={(e) => {
            const a = e.nativeEvent.actionName;
            if (a === 'known' || a === 'again') onVerdict(a);
            else onFlip();
          }}
          style={{ height: h }}
        >
          <Animated.View style={[face('front'), front]} onLayout={measure} pointerEvents="none">
            <HText variant="micro" color="subtle" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
              {S.flashcards.front}
            </HText>
            <InlineText variant="title" text={card.front} style={{ textAlign: 'center' }} />
            <HText variant="caption" color="subtle">
              {S.flashcards.tapToFlip}
            </HText>
          </Animated.View>
          <Animated.View style={[face('back'), back]} onLayout={measure} pointerEvents="none">
            <HText variant="micro" color="accent" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
              {S.flashcards.back}
            </HText>
            <InlineText variant="headline" text={card.back || '–'} style={{ textAlign: 'center' }} />
          </Animated.View>
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 12, left: 12, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: t.colors.successSoft, borderRadius: t.radii.pill, paddingHorizontal: 10, paddingVertical: 4 }, hintKnown]}>
            <Icon name="check" size={14} color={t.colors.success} strokeWidth={2.4} />
            <HText variant="caption" weight="600" style={{ color: t.colors.success }}>
              {S.flashcards.known}
            </HText>
          </Animated.View>
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: t.colors.warningSoft, borderRadius: t.radii.pill, paddingHorizontal: 10, paddingVertical: 4 }, hintAgain]}>
            <ExtraIcon name="reset" size={13} color={t.colors.warning} strokeWidth={2} />
            <HText variant="caption" weight="600" style={{ color: t.colors.warning }}>
              {S.flashcards.again}
            </HText>
          </Animated.View>
        </PressableScale>
      </Animated.View>
    </GestureDetector>
  );
}
