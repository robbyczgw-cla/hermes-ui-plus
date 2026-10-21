/**
 * `vocab` (docs/SPEC-modules-v4.md): language drill with three modes – flip cards with 🔊 (term
 * read in its own language via the voice speaker), multiple choice, typing with tolerant compare.
 * Leitner boxes per item + the running session are persisted per node. The end of a session shows
 * a summary and "Ergebnis senden" → `[vocab:<id>] 18/20 richtig · schwierig: …`.
 * Visuals follow Flashcards (flip faces) and Quiz (option rows, result).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { TextInput } from '../../../primitives/Text';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useLocale, useT } from '../../../../i18n';
import { useMotionReduced, useTheme, type Theme } from '../../../theme';
import { useHui } from '../../../primitives/context';
import { FadeIn, HText, InlineText, PressableScale, Surface, textStyle } from '../../../primitives/basics';
import { Button } from '../../../primitives/Button';
import { Icon } from '../../../primitives/Icon';
import { haptic } from '../../../primitives/haptics';
import { useNodeState } from '../../../../nodestate';
import { VocabSkeleton } from '../../../skeletons';
import type { HuiVocab, HuiVocabMode } from '../../../types';
import { PrimaryButton, SecondaryButton, useModuleId, useSend } from '../a/shared';
import { C1Icon } from '../c1/icons';
import { languageName, type UiLang } from '../c1/languages.ts';
import { useSpeakText } from '../c1/speech';
import { D3Icon, type D3IconName } from './icons';
import {
  BOXES,
  INITIAL_VOCAB_STATE,
  MODES,
  advanceRun,
  answerCurrent,
  boxCounts,
  choiceOptions,
  compareAnswer,
  isAccepted,
  readVocab,
  startRun,
  summarize,
  syncRun,
  vocabReply,
  vocabRoute,
  type VocabItem,
  type VocabModel,
  type VocabState,
  type Verdict,
} from './vocabModel.ts';

const MODE_ICON: Record<HuiVocabMode, D3IconName> = { cards: 'cards', quiz: 'quiz', type: 'type' };

function seedOf(id: string, session: number): number {
  let h = 2166136261 ^ session;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function Vocab({ node }: { node: Partial<HuiVocab> }) {
  const tr = useT();
  const t = useTheme();
  const { lang } = useLocale();
  const { streaming } = useHui();
  const id = useModuleId('vocab', node as Record<string, unknown>);
  const model = useMemo(() => readVocab(node as Record<string, unknown>), [node]);
  const [stored, setSt] = useNodeState<VocabState>(id, INITIAL_VOCAB_STATE);
  const send = useSend(id);
  const items = model.items;
  const canQuiz = items.length >= 2;
  const wanted: HuiVocabMode = stored.mode ?? model.mode;
  const mode: HuiVocabMode = wanted === 'quiz' && !canQuiz ? 'cards' : wanted;

  // Until the first answer the session is only a preview (not persisted) → it follows streaming items.
  const st = useMemo(() => {
    const synced = syncRun(stored, items);
    return synced.run ? synced : startRun(items, synced, mode, seedOf(id, synced.session + 1));
  }, [stored, items, mode, id]);
  const update = (fn: (s: VocabState) => VocabState) =>
    setSt((prev) => {
      const s = syncRun(prev, items);
      return fn(s.run ? s : startRun(items, s, mode, seedOf(id, s.session + 1)));
    });

  if (!items.length) {
    return streaming ? (
      <VocabSkeleton />
    ) : (
      <Surface>
        <HText variant="callout" color="muted">
          {tr('ui.vocab.empty')}
        </HText>
      </Surface>
    );
  }

  const run = st.run!;
  const ui = lang as UiLang;
  const { label: route, codes: routeCodes } = vocabRoute(model.from, model.to);
  const routeA11y = routeCodes.map((c) => languageName(c, ui)).join(' → ');

  const setMode = (m: HuiVocabMode) => {
    haptic('selection');
    setSt((s) => ({ ...s, mode: m, ...(s.run && !s.run.finished ? { run: { ...s.run, mode: m } } : {}) }));
  };

  const header = (
    <View style={{ gap: t.spacing.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
        <View style={{ flex: 1, gap: 2 }}>
          <InlineText variant="headline" text={model.title || tr('ui.vocab.title')} accessibilityRole="header" />
          {route ? (
            <HText variant="caption" weight="600" color="muted" accessibilityLabel={routeA11y}>
              {route}
            </HText>
          ) : null}
        </View>
        <Boxes t={t} counts={boxCounts(items, st)} />
      </View>
      <Segmented t={t} value={mode} onChange={setMode} disabled={{ quiz: !canQuiz }} />
    </View>
  );

  if (run.finished) {
    const sum = summarize(items, run);
    const reply = vocabReply(id, sum);
    return (
      <Surface style={{ gap: t.spacing.l }}>
        {header}
        <Summary
          t={t}
          correct={sum.correct}
          total={sum.total}
          hard={sum.hard}
          sent={run.sent}
          disabled={streaming}
          onAgain={() => {
            haptic('selection');
            setSt((s) => startRun(items, s, mode, seedOf(id, s.session + 1)));
          }}
          onSend={() => {
            if (send(reply)) setSt((s) => (s.run ? { ...s, run: { ...s.run, sent: true } } : s));
          }}
        />
      </Surface>
    );
  }

  const itemId = run.queue[run.i];
  const item = items.find((x) => x.id === itemId) ?? items[0];
  const answered = itemId in run.results;
  const isLast = run.i + 1 >= run.queue.length;
  const next = () => {
    haptic('light');
    update(advanceRun);
  };
  const answer = (ok: boolean) => {
    haptic(ok ? 'success' : 'warning');
    update((s) => answerCurrent(s, ok));
  };

  return (
    <Surface style={{ gap: t.spacing.m }}>
      {header}
      <ProgressBar t={t} i={run.i} total={run.queue.length} results={run.results} queue={run.queue} />
      {mode === 'cards' ? (
        <CardMode key={`c-${run.i}-${itemId}`} t={t} nodeId={id} model={model} item={item} answered={answered} isLast={isLast} onAnswer={(ok) => {
          // cards: grading is the last step → advance right away
          haptic(ok ? 'success' : 'light');
          update((s) => advanceRun(answerCurrent(s, ok)));
        }} />
      ) : mode === 'quiz' ? (
        <QuizMode key={`q-${run.i}-${itemId}`} t={t} nodeId={id} model={model} item={item} seed={run.seed} answered={answered} wasRight={run.results[itemId]} isLast={isLast} onAnswer={answer} onNext={next} />
      ) : (
        <TypeMode key={`t-${run.i}-${itemId}`} t={t} nodeId={id} model={model} item={item} answered={answered} wasRight={run.results[itemId]} isLast={isLast} onAnswer={answer} onNext={next} />
      )}
      {!canQuiz && wanted === 'quiz' ? (
        <HText variant="caption" color="muted">
          {tr('ui.vocab.tooFew')}
        </HText>
      ) : null}
    </Surface>
  );
}

/* ───────────── header parts ───────────── */

function Segmented({ t, value, onChange, disabled }: { t: Theme; value: HuiVocabMode; onChange: (m: HuiVocabMode) => void; disabled: Partial<Record<HuiVocabMode, boolean>> }) {
  const tr = useT();
  const label = (m: HuiVocabMode) => tr(m === 'cards' ? 'ui.vocab.modeCards' : m === 'quiz' ? 'ui.vocab.modeQuiz' : 'ui.vocab.modeType');
  return (
    <View accessibilityRole="tablist" accessibilityLabel={tr('ui.vocab.modeA11y')} style={{ flexDirection: 'row', padding: 3, borderRadius: t.radii.pill, backgroundColor: t.colors.surfaceAlt, gap: 3 }}>
      {MODES.map((m) => {
        const on = m === value;
        const off = !!disabled[m];
        return (
          <PressableScale
            key={m}
            haptic={false}
            disabled={off}
            onPress={() => !on && onChange(m)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on, disabled: off }}
            accessibilityLabel={label(m)}
            style={{ flex: 1, minHeight: 38, borderRadius: t.radii.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: on ? t.colors.surface : 'transparent', ...(on ? t.shadows.sm : null) }}
          >
            <D3Icon name={MODE_ICON[m]} size={15} color={on ? t.colors.accent : t.colors.muted} />
            <HText variant="caption" weight={on ? '600' : '500'} style={{ color: on ? t.colors.text : t.colors.muted }} numberOfLines={1}>
              {label(m)}
            </HText>
          </PressableScale>
        );
      })}
    </View>
  );
}

/** Five mini columns: items per Leitner box (1 = new/hard … 5 = sicher). */
function Boxes({ t, counts }: { t: Theme; counts: number[] }) {
  const tr = useT();
  const max = Math.max(1, ...counts);
  const list = counts.map((c, i) => tr('ui.vocab.boxItem', { n: i + 1, count: c })).join(', ');
  return (
    <View accessible accessibilityLabel={tr('ui.vocab.boxesA11y', { list })} accessibilityHint={tr('ui.vocab.boxHint')} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 34 }}>
      {counts.map((c, i) => {
        const h = c ? 6 + (c / max) * 16 : 3;
        const color = i === BOXES - 1 ? t.colors.success : i === 0 ? t.colors.warning : t.colors.accent;
        return (
          <View key={i} style={{ alignItems: 'center', width: 13, gap: 2 }}>
            <HText variant="micro" color="subtle" tabular>
              {c || ''}
            </HText>
            <View style={{ width: 9, height: h, borderRadius: 2, backgroundColor: c ? color : t.colors.border, opacity: c ? 0.35 + 0.65 * (i / (BOXES - 1)) : 1 }} />
          </View>
        );
      })}
    </View>
  );
}

function ProgressBar({ t, i, total, results, queue }: { t: Theme; i: number; total: number; results: Record<string, boolean>; queue: string[] }) {
  const tr = useT();
  return (
    <View style={{ gap: 6 }}>
      <HText variant="caption" color="muted" tabular>
        {tr('ui.vocab.progress', { i: i + 1, total })}
      </HText>
      <View style={{ flexDirection: 'row', gap: 2, height: 4 }} aria-hidden>
        {queue.map((q, k) => {
          const r = results[q];
          const bg = r === true ? t.colors.success : r === false ? t.colors.danger : k === i ? t.colors.accent : t.colors.surfaceAlt;
          return <View key={q} style={{ flex: 1, borderRadius: 2, backgroundColor: bg }} />;
        })}
      </View>
    </View>
  );
}

/* ───────────── speaker ───────────── */

function SpeakButton({ t, nodeId, item, lang, color }: { t: Theme; nodeId: string; item: VocabItem; lang: string; color?: string }) {
  const tr = useT();
  const { lang: ui } = useLocale();
  const s = useSpeakText(`vocab:${nodeId}:${item.id}`, item.term, lang);
  const active = s.status === 'playing' || s.status === 'paused' || s.status === 'loading';
  const label =
    s.status === 'playing' ? tr('ui.vocab.pause') : s.status === 'loading' ? tr('ui.vocab.preparing') : s.status === 'error' ? tr('ui.vocab.speakFailed') : tr('ui.vocab.speak', { lang: languageName(lang, ui as UiLang) });
  return (
    <PressableScale
      haptic="selection"
      onPress={s.toggle}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: s.status === 'loading' }}
      hitSlop={4}
      style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? t.colors.accent : t.colors.surface, borderWidth: active ? 0 : 1, borderColor: t.colors.border }}
      pressedStyle={{ backgroundColor: active ? t.colors.accent : t.colors.surfacePressed }}
    >
      {s.status === 'loading' ? (
        <ActivityIndicator size="small" color={t.colors.onAccent} />
      ) : s.status === 'error' ? (
        <Icon name="alert" size={18} color={t.colors.danger} />
      ) : (
        <C1Icon name={s.status === 'playing' ? 'pause' : 'speaker'} size={20} color={active ? t.colors.onAccent : color ?? t.colors.accent} />
      )}
    </PressableScale>
  );
}

/** The prompt: term (in its language) large, romanization, 🔊. */
function TermBlock({ t, nodeId, model, item, size = 'title' }: { t: Theme; nodeId: string; model: VocabModel; item: VocabItem; size?: 'title' | 'headline' }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
      <View style={{ flex: 1, gap: 2 }}>
        <HText variant={size} selectable accessibilityLanguage={model.from !== 'und' ? model.from : undefined}>
          {item.term}
        </HText>
        {item.romanization ? (
          <HText variant="callout" color="muted" style={{ fontStyle: 'italic' }}>
            {item.romanization}
          </HText>
        ) : null}
      </View>
      <SpeakButton t={t} nodeId={nodeId} item={item} lang={model.from} />
    </View>
  );
}

function Extras({ t, model, item }: { t: Theme; model: VocabModel; item: VocabItem }) {
  const tr = useT();
  if (!item.example && !item.note) return null;
  return (
    <View style={{ gap: 4 }}>
      {item.example ? (
        <HText variant="callout" color="muted" accessibilityLanguage={model.from !== 'und' ? model.from : undefined}>
          <HText variant="caption" weight="600" color="subtle">
            {`${tr('ui.vocab.example')}  `}
          </HText>
          <HText variant="callout" style={{ fontStyle: 'italic', color: t.colors.text }}>
            {item.example}
          </HText>
        </HText>
      ) : null}
      {item.note ? (
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
          <View style={{ paddingTop: 2 }}>
            <Icon name="info" size={14} color={t.colors.muted} />
          </View>
          <HText variant="caption" color="muted" style={{ flex: 1 }}>
            {item.note}
          </HText>
        </View>
      ) : null}
    </View>
  );
}

/* ───────────── cards ───────────── */

function CardMode({ t, nodeId, model, item, answered, onAnswer }: { t: Theme; nodeId: string; model: VocabModel; item: VocabItem; answered: boolean; isLast: boolean; onAnswer: (ok: boolean) => void }) {
  const tr = useT();
  const reduced = useMotionReduced();
  const [flipped, setFlipped] = useState(false);
  const rot = useSharedValue(0);
  const [h, setH] = useState(170);
  useEffect(() => {
    rot.value = reduced ? (flipped ? 1 : 0) : withTiming(flipped ? 1 : 0, { duration: 300 });
  }, [flipped, reduced, rot]);
  const front = useAnimatedStyle(() => (reduced ? { opacity: rot.value < 0.5 ? 1 : 0 } : { transform: [{ perspective: 900 }, { rotateY: `${interpolate(rot.value, [0, 1], [0, 180])}deg` }], opacity: rot.value < 0.5 ? 1 : 0 }));
  const back = useAnimatedStyle(() => (reduced ? { opacity: rot.value >= 0.5 ? 1 : 0 } : { transform: [{ perspective: 900 }, { rotateY: `${interpolate(rot.value, [0, 1], [180, 360])}deg` }], opacity: rot.value >= 0.5 ? 1 : 0 }));
  const measure = (e: { nativeEvent: { layout: { height: number } } }) => {
    const nh = Math.ceil(e.nativeEvent.layout.height);
    if (nh > h) setH(nh);
  };
  const face = (side: 'front' | 'back') => ({
    position: 'absolute' as const,
    left: 0,
    right: 0,
    top: 0,
    minHeight: h,
    borderRadius: t.radii.card,
    borderWidth: 1,
    borderColor: side === 'back' ? t.colors.accent : t.colors.border,
    backgroundColor: side === 'back' ? t.colors.accentSoft : t.colors.surfaceAlt,
    padding: t.spacing.l,
    paddingTop: t.spacing.xl,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: t.spacing.s,
    backfaceVisibility: 'hidden' as const,
  });
  const lf = model.from !== 'und' ? model.from : undefined;
  const lt = model.to !== 'und' ? model.to : undefined;
  return (
    <FadeIn rise={6} style={{ gap: t.spacing.m }}>
      <View style={{ height: h }}>
        <PressableScale
          haptic="selection"
          scaleTo={0.985}
          onPress={() => setFlipped((f) => !f)}
          accessibilityRole="button"
          accessibilityLabel={flipped ? `${item.translation}. ${item.term}` : item.term}
          accessibilityLanguage={flipped ? lt : lf}
          accessibilityHint={tr('ui.vocab.tapToFlip')}
          style={{ height: h }}
        >
          <Animated.View style={[face('front'), front]} onLayout={measure} pointerEvents="none">
            <HText variant="title" align="center" style={{ fontSize: t.typography.title.fontSize + 4, lineHeight: t.typography.title.lineHeight + 6 }}>
              {item.term}
            </HText>
            {item.romanization ? (
              <HText variant="callout" color="muted" style={{ fontStyle: 'italic' }}>
                {item.romanization}
              </HText>
            ) : null}
            <HText variant="caption" color="subtle">
              {tr('ui.vocab.tapToFlip')}
            </HText>
          </Animated.View>
          <Animated.View style={[face('back'), back]} onLayout={measure} pointerEvents="none">
            <HText variant="caption" weight="600" color="accent">
              {item.term}
            </HText>
            <HText variant="title" align="center">
              {item.translation}
            </HText>
            {item.example ? (
              <HText variant="callout" color="muted" align="center" style={{ fontStyle: 'italic' }}>
                {item.example}
              </HText>
            ) : null}
            {item.note ? (
              <HText variant="caption" color="muted" align="center">
                {item.note}
              </HText>
            ) : null}
          </Animated.View>
        </PressableScale>
        <View style={{ position: 'absolute', top: 8, right: 8 }}>
          <SpeakButton t={t} nodeId={nodeId} item={item} lang={model.from} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: t.spacing.s }}>
        {flipped ? (
          <>
            <SecondaryButton label={tr('ui.vocab.unknown')} disabled={answered} onPress={() => onAnswer(false)} style={{ flex: 1 }} />
            <PrimaryButton label={tr('ui.vocab.known')} icon="check" disabled={answered} onPress={() => onAnswer(true)} style={{ flex: 1 }} />
          </>
        ) : (
          <SecondaryButton label={tr('ui.vocab.flip')} onPress={() => setFlipped(true)} style={{ flex: 1 }} />
        )}
      </View>
    </FadeIn>
  );
}

/* ───────────── multiple choice ───────────── */

function QuizMode({ t, nodeId, model, item, seed, answered, wasRight, isLast, onAnswer, onNext }: { t: Theme; nodeId: string; model: VocabModel; item: VocabItem; seed: number; answered: boolean; wasRight: boolean | undefined; isLast: boolean; onAnswer: (ok: boolean) => void; onNext: () => void }) {
  const tr = useT();
  const { options, answer } = useMemo(() => choiceOptions(model.items, item, seed), [model.items, item, seed]);
  const [chosen, setChosen] = useState<number | null>(null);
  const tap = (k: number) => {
    if (answered) return;
    setChosen(k);
    onAnswer(k === answer);
  };
  const lt = model.to !== 'und' ? model.to : undefined;
  return (
    <FadeIn rise={6} style={{ gap: t.spacing.m }}>
      <View style={{ borderRadius: t.radii.card, backgroundColor: t.colors.surfaceAlt, padding: t.spacing.l, gap: t.spacing.s }}>
        <TermBlock t={t} nodeId={nodeId} model={model} item={item} />
      </View>
      <View style={{ gap: t.spacing.s }} accessibilityRole="radiogroup">
        {options.map((label, k) => {
          const state = !answered ? 'idle' : k === answer ? 'right' : k === chosen ? 'wrong' : 'dim';
          const border = state === 'right' ? t.colors.success : state === 'wrong' ? t.colors.danger : t.colors.border;
          const bg = state === 'right' ? t.colors.successSoft : state === 'wrong' ? t.colors.dangerSoft : t.colors.surface;
          const st = state === 'right' ? tr('ui.vocab.isCorrect') : state === 'wrong' ? tr('ui.vocab.isWrong') : '';
          return (
            <PressableScale
              key={k}
              haptic={false}
              onPress={() => tap(k)}
              accessibilityRole="radio"
              accessibilityState={{ checked: k === chosen, disabled: answered }}
              accessibilityLabel={tr('ui.vocab.optionA11y', { label, state: st })}
              accessibilityLanguage={lt}
              scaleTo={answered ? 1 : 0.985}
              style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.m, minHeight: 48, paddingHorizontal: t.spacing.m, paddingVertical: t.spacing.s + 2, borderRadius: t.radii.control, borderWidth: state === 'idle' || state === 'dim' ? 1 : 1.5, borderColor: border, backgroundColor: bg, opacity: state === 'dim' ? 0.6 : 1 }}
              pressedStyle={answered ? undefined : { backgroundColor: t.colors.surfacePressed }}
            >
              <HText variant="body" style={{ flex: 1 }}>
                {label}
              </HText>
              {state === 'right' ? <Icon name="checkCircle" size={20} color={t.colors.success} strokeWidth={2} /> : state === 'wrong' ? <Icon name="x" size={18} color={t.colors.danger} strokeWidth={2.25} /> : null}
            </PressableScale>
          );
        })}
      </View>
      {answered ? (
        <FadeIn rise={4} style={{ gap: t.spacing.s }}>
          <View style={{ borderRadius: t.radii.control, backgroundColor: t.colors.surfaceAlt, padding: t.spacing.m, gap: 6 }} accessibilityLiveRegion="polite">
            <HText variant="bodyStrong" style={{ color: wasRight ? t.colors.success : t.colors.danger }}>
              {wasRight ? tr('ui.vocab.exact') : tr('ui.vocab.wrong')}
            </HText>
            <Extras t={t} model={model} item={item} />
          </View>
          <PrimaryButton label={isLast ? tr('ui.vocab.finish') : tr('ui.vocab.next')} icon={isLast ? undefined : 'arrowRight'} onPress={onNext} />
        </FadeIn>
      ) : null}
    </FadeIn>
  );
}

/* ───────────── typing ───────────── */

function TypeMode({ t, nodeId, model, item, answered, wasRight, isLast, onAnswer, onNext }: { t: Theme; nodeId: string; model: VocabModel; item: VocabItem; answered: boolean; wasRight: boolean | undefined; isLast: boolean; onAnswer: (ok: boolean) => void; onNext: () => void }) {
  const tr = useT();
  const { lang } = useLocale();
  const [input, setInput] = useState('');
  const [verdict, setVerdict] = useState<Verdict | null>(answered ? (wasRight ? 'exact' : 'wrong') : null);
  const ref = useRef<TextInput>(null);
  const check = () => {
    if (answered || !input.trim()) return;
    const v = compareAnswer(input, item.term, model.from);
    setVerdict(v);
    onAnswer(isAccepted(v));
  };
  const giveUp = () => {
    if (answered) return;
    setVerdict('wrong');
    onAnswer(false);
  };
  const ok = verdict !== null && isAccepted(verdict);
  const fg = verdict === null ? t.colors.text : ok ? t.colors.success : t.colors.danger;
  const msg = verdict === 'exact' ? tr('ui.vocab.exact') : verdict === 'close' ? tr('ui.vocab.close') : verdict === 'typo' ? tr('ui.vocab.typo') : tr('ui.vocab.wrong');
  const target = languageName(model.from, lang as UiLang);
  return (
    <FadeIn rise={6} style={{ gap: t.spacing.m }}>
      <View style={{ borderRadius: t.radii.card, backgroundColor: t.colors.surfaceAlt, padding: t.spacing.l, gap: 4 }}>
        <HText variant="title" accessibilityLanguage={model.to !== 'und' ? model.to : undefined}>
          {item.translation}
        </HText>
        <HText variant="caption" color="muted">
          {tr('ui.vocab.typeLabel', { lang: target })}
        </HText>
      </View>
      <TextInput
        ref={ref}
        value={input}
        onChangeText={setInput}
        editable={!answered}
        placeholder={tr('ui.vocab.typePlaceholder')}
        placeholderTextColor={t.colors.subtle}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        returnKeyType="done"
        onSubmitEditing={check}
        accessibilityLabel={tr('ui.vocab.typeLabel', { lang: target })}
        style={{
          ...textStyle(t, 'body'),
          fontSize: t.typography.headline.fontSize + 1,
          color: fg,
          minHeight: 48,
          paddingHorizontal: t.spacing.m,
          borderRadius: t.radii.control,
          borderWidth: verdict === null ? 1 : 1.5,
          borderColor: verdict === null ? t.colors.borderStrong : ok ? t.colors.success : t.colors.danger,
          backgroundColor: verdict === null ? t.colors.surface : ok ? t.colors.successSoft : t.colors.dangerSoft,
        }}
      />
      {verdict !== null ? (
        <FadeIn rise={4} style={{ gap: t.spacing.s }}>
          <View style={{ borderRadius: t.radii.control, backgroundColor: t.colors.surfaceAlt, padding: t.spacing.m, gap: t.spacing.s }} accessibilityLiveRegion="polite">
            <HText variant="bodyStrong" style={{ color: ok ? t.colors.success : t.colors.danger }}>
              {msg}
            </HText>
            {verdict !== 'exact' ? <TermBlock t={t} nodeId={nodeId} model={model} item={item} size="headline" /> : null}
            <Extras t={t} model={model} item={item} />
          </View>
          <PrimaryButton label={isLast ? tr('ui.vocab.finish') : tr('ui.vocab.next')} icon={isLast ? undefined : 'arrowRight'} onPress={onNext} />
        </FadeIn>
      ) : (
        <View style={{ flexDirection: 'row', gap: t.spacing.s, alignItems: 'center' }}>
          <Button label={tr('ui.vocab.dontKnow')} variant="tertiary" onPress={giveUp} />
          <PrimaryButton label={tr('ui.vocab.check')} disabled={!input.trim()} onPress={check} style={{ flex: 1 }} />
        </View>
      )}
    </FadeIn>
  );
}

/* ───────────── summary ───────────── */

function Summary({ t, correct, total, hard, sent, disabled, onAgain, onSend }: { t: Theme; correct: number; total: number; hard: VocabItem[]; sent: boolean; disabled: boolean; onAgain: () => void; onSend: () => void }) {
  const tr = useT();
  const ratio = total ? correct / total : 0;
  return (
    <>
      <FadeIn style={{ alignItems: 'center', gap: 4 }}>
        <HText variant="caption" weight="600" color="muted">
          {tr('ui.vocab.summaryTitle')}
        </HText>
        <HText variant="display" tabular accessibilityLabel={tr('ui.vocab.score', { correct, total })}>
          {correct}
          <HText variant="title" color="muted">
            {` / ${total}`}
          </HText>
        </HText>
        <View style={{ height: 6, alignSelf: 'stretch', borderRadius: 3, backgroundColor: t.colors.surfaceAlt, overflow: 'hidden', marginTop: 4 }}>
          <View style={{ height: 6, width: `${ratio * 100}%`, backgroundColor: ratio >= 0.8 ? t.colors.success : t.colors.accent }} />
        </View>
      </FadeIn>
      <View style={{ gap: 6 }}>
        {hard.length ? (
          <>
            <HText variant="caption" weight="600" color="muted">
              {tr('ui.vocab.hard')}
            </HText>
            {hard.map((h) => (
              <View key={h.id} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }} accessible accessibilityLabel={`${h.term}: ${h.translation}`}>
                <Icon name="x" size={14} color={t.colors.danger} strokeWidth={2.4} />
                <HText variant="callout" weight="600" style={{ flexShrink: 1 }}>
                  {h.term}
                </HText>
                <HText variant="callout" color="muted" style={{ flex: 1 }} numberOfLines={1}>
                  {`– ${h.translation}`}
                </HText>
              </View>
            ))}
          </>
        ) : (
          <HText variant="callout" color="success" align="center" weight="500">
            {tr('ui.vocab.noneHard')}
          </HText>
        )}
      </View>
      <View style={{ flexDirection: 'row', gap: t.spacing.s, flexWrap: 'wrap' }}>
        <SecondaryButton label={tr('ui.vocab.again')} onPress={onAgain} style={{ flexGrow: 1 }} />
        {sent ? (
          <View style={{ flexGrow: 2, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Icon name="check" size={16} color={t.colors.success} strokeWidth={2.25} />
            <HText variant="callout" weight="500" color="success">
              {tr('ui.vocab.sent')}
            </HText>
          </View>
        ) : (
          <PrimaryButton label={tr('ui.vocab.sendResult')} icon="send" disabled={disabled} onPress={onSend} style={{ flexGrow: 2 }} />
        )}
      </View>
    </>
  );
}
