/**
 * `guide` – interactive step-by-step instructions (docs/SPEC-modules-v4.md). One step per page
 * (swipe or Zurück/Weiter), progress bar, "Erledigt" per step (persisted), inline timer when
 * `seconds` is set, overview list with checkmarks, "Ich hänge hier fest" → optional detail →
 * `[guide:<id>] Schritt 3 („…“): Ich hänge fest – …`, finish celebration → `[guide:<id>] Fertig`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useMotionReduced, useTheme, type Theme } from '../../../theme';
import { useHui } from '../../../primitives/context';
import { FadeIn, HText, InlineText, PressableScale, Surface, textStyle } from '../../../primitives/basics';
import { Icon } from '../../../primitives/Icon';
import { haptic } from '../../../primitives/haptics';
import { Skeleton } from '../../../primitives/Skeleton';
import { useNodeState } from '../../../../nodestate';
import { useT } from '../../../../i18n';
import type { HuiGuide } from '../../../types';
import { GuideSkeleton } from '../../../skeletons';
import { Thumb } from '../../imageParts';
import { UndoBar, useModuleId, useNodeStateReady, usePendingCommit, useSend } from '../a/shared';
import { Btn } from '../b/controls';
import { allDone, clampStep, doneCount, finishReply, nextOpen, normalizeGuide, stuckReply, toggleDone, type GuideModel, type GuideStep } from './guideModel.ts';
import { InlineClock } from './InlineClock';
import { Celebration, D2Icon, MarkdownBody, NoteBox, ProgressBar, SoundToggle } from './parts';
import { sanitizeClocks, useClocks, type ClockControls, type ClockMap } from './useClocks';

type GuideState = {
  done: string[];
  step: number;
  view?: 'steps' | 'overview';
  clocks: ClockMap;
  sound?: boolean;
  finished?: boolean;
  reported?: boolean;
  stuck?: string[];
};
const INITIAL: GuideState = { done: [], step: 0, clocks: {} };

export function Guide({ node }: { node: Partial<HuiGuide> }) {
  const t = useTheme();
  const tr = useT();
  const { streaming } = useHui();
  const id = useModuleId('guide', node as Record<string, unknown>);
  const model = useMemo(() => normalizeGuide(node as Record<string, unknown>), [node]);
  const [st, setSt] = useNodeState<GuideState>(id, INITIAL);
  const ready = useNodeStateReady();
  const clocks = useMemo(() => sanitizeClocks(st.clocks), [st.clocks]);
  const send = useSend(id);
  const undo = usePendingCommit();
  const title = model.title || tr('ui.guide.defaultTitle');
  const steps = model.steps;
  const count = steps.length;
  const done = st.done ?? [];
  const nDone = doneCount(steps, done);
  const step = clampStep(st.step ?? 0, count);
  const [alertKey, setAlertKey] = useState<string | null>(null);

  const setClocks = useCallback((fn: (p: ClockMap) => ClockMap) => setSt((s) => ({ ...s, clocks: fn(sanitizeClocks(s.clocks)) })), [setSt]);
  const stepIndex = (key: string) => steps.findIndex((s) => s.key === key);
  const ctl = useClocks({
    clocks,
    setClocks,
    ready,
    sound: st.sound !== false,
    alarm: (key) => ({ title: tr('ui.timer.notifyTitle'), body: tr('ui.guide.timerLabel', { title: steps[stepIndex(key)]?.title ?? title, n: stepIndex(key) + 1 }) }),
    onDone: (key) => setAlertKey(key),
  });

  if (!count) return streaming ? <GuideSkeleton /> : null;

  // while streaming: a calm, growing outline (no interaction yet)
  if (streaming) {
    return (
      <Surface style={{ gap: t.spacing.m }}>
        <Head t={t} title={title} sub={tr('ui.guide.progress', { done: 0, total: count })} />
        <Overview t={t} model={model} done={[]} current={-1} disabled />
        <Skeleton width="60%" height={14} />
      </Surface>
    );
  }

  const view = st.view ?? 'steps';
  const finished = !!st.finished && allDone(steps, done);

  const go = (i: number) => setSt((s) => ({ ...s, step: clampStep(i, count), view: 'steps' }));
  const sendFinish = () => {
    const text = finishReply(id);
    undo.start(tr('ui.guide.sending'), () => {
      if (send(text)) setSt((s) => ({ ...s, reported: true }));
    });
  };
  const finish = (nextDone: string[]) => {
    haptic('success');
    setSt((s) => ({ ...s, done: nextDone, finished: true }));
    if (!st.reported) sendFinish();
  };
  const markDone = (key: string) => {
    const was = done.includes(key);
    const nextDone = toggleDone(done, key);
    if (was) {
      haptic('light');
      setSt((s) => ({ ...s, done: nextDone, finished: false }));
      return;
    }
    if (allDone(steps, nextDone)) {
      finish(nextDone);
      return;
    }
    haptic('selection');
    const i = stepIndex(key);
    const nxt = nextOpen(steps, nextDone, i + 1);
    setSt((s) => ({ ...s, done: nextDone, step: nxt >= 0 ? nxt : s.step }));
  };
  const restart = () => {
    undo.cancel();
    setSt((s) => ({ ...s, done: [], step: 0, finished: false, view: 'steps' }));
  };

  return (
    <Surface style={{ gap: t.spacing.m }}>
      <Head
        t={t}
        title={title}
        sub={tr('ui.guide.progress', { done: nDone, total: count })}
        right={
          finished ? null : (
            <>
              {steps.some((x) => x.seconds) ? <SoundToggle on={st.sound !== false} onToggle={() => setSt((s) => ({ ...s, sound: !(s.sound !== false) }))} t={t} /> : null}
              <ViewToggle t={t} view={view} onChange={(v) => setSt((s) => ({ ...s, view: v }))} />
            </>
          )
        }
      />
      <ProgressBar t={t} frac={count ? nDone / count : 0} color={finished ? t.colors.success : undefined} />
      {finished ? (
        <Finished t={t} count={count} reported={!!st.reported} pending={!!undo.pending} onReport={sendFinish} onRestart={restart} />
      ) : view === 'overview' ? (
        <Overview t={t} model={model} done={done} current={step} onOpen={go} onToggle={markDone} />
      ) : (
        <StepPager
          t={t}
          model={model}
          index={step}
          done={done}
          onGo={go}
          onDone={markDone}
          ctl={ctl}
          clocks={clocks}
          alertKey={alertKey}
          onDismissAlert={() => setAlertKey(null)}
          stuckSent={(st.stuck ?? []).includes(steps[step].key)}
          onStuck={(detail) => {
            const s = steps[step];
            if (!send(stuckReply(id, step, s.title, detail))) return false;
            setSt((x) => ({ ...x, stuck: [...(x.stuck ?? []).filter((k) => k !== s.key), s.key] }));
            return true;
          }}
          stuckLabel={model.stuckLabel}
        />
      )}
      {undo.pending ? <UndoBar label={undo.pending.label} ms={undo.ms} onUndo={undo.cancel} /> : null}
    </Surface>
  );
}

/* ───────────── header ───────────── */

function Head({ t, title, sub, right }: { t: Theme; title: string; sub: string; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <HText variant="headline" accessibilityRole="header" numberOfLines={3}>
          {title}
        </HText>
        <HText variant="caption" color="muted">
          {sub}
        </HText>
      </View>
      {right}
    </View>
  );
}

function ViewToggle({ t, view, onChange }: { t: Theme; view: 'steps' | 'overview'; onChange: (v: 'steps' | 'overview') => void }) {
  const tr = useT();
  const opt = (v: 'steps' | 'overview', icon: 'steps' | 'list', label: string) => {
    const on = view === v;
    return (
      <PressableScale
        haptic="selection"
        onPress={() => onChange(v)}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        accessibilityLabel={label}
        style={{ width: 44, height: 36, borderRadius: t.radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.colors.surface : 'transparent', ...(on ? t.shadows.sm : null) }}
        hitSlop={4}
      >
        <D2Icon name={icon} size={17} color={on ? t.colors.text : t.colors.muted} />
      </PressableScale>
    );
  };
  return (
    <View accessibilityRole="tablist" accessibilityLabel={tr('ui.guide.viewA11y')} style={{ flexDirection: 'row', padding: 3, gap: 2, borderRadius: t.radii.pill, backgroundColor: t.colors.surfaceAlt }}>
      {opt('steps', 'steps', tr('ui.guide.stepView'))}
      {opt('overview', 'list', tr('ui.guide.overview'))}
    </View>
  );
}

/* ───────────── one step per page ───────────── */

function StepPager({
  t,
  model,
  index,
  done,
  onGo,
  onDone,
  ctl,
  clocks,
  alertKey,
  onDismissAlert,
  stuckSent,
  onStuck,
  stuckLabel,
}: {
  t: Theme;
  model: GuideModel;
  index: number;
  done: string[];
  onGo: (i: number) => void;
  onDone: (key: string) => void;
  ctl: ClockControls;
  clocks: ClockMap;
  alertKey: string | null;
  onDismissAlert: () => void;
  stuckSent: boolean;
  onStuck: (detail: string) => boolean;
  stuckLabel?: string;
}) {
  const tr = useT();
  const reduced = useMotionReduced();
  const steps = model.steps;
  const count = steps.length;
  const s = steps[index];
  const isDone = done.includes(s.key);
  const last = index >= count - 1;

  // slide/fade on page change
  const x = useSharedValue(0);
  const o = useSharedValue(1);
  const prev = useRef(index);
  useEffect(() => {
    const dir = index > prev.current ? 1 : index < prev.current ? -1 : 0;
    prev.current = index;
    if (!dir || reduced) return;
    x.value = dir * 28;
    o.value = 0;
    x.value = withTiming(0, { duration: 240, easing: Easing.out(Easing.cubic) });
    o.value = withTiming(1, { duration: 200 });
  }, [index, reduced, x, o]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value, transform: [{ translateX: x.value }] }));

  const swipe = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-24, 24])
    .failOffsetY([-14, 14])
    .onEnd((e) => {
      if ((e.translationX < -60 || e.velocityX < -600) && index < count - 1) {
        haptic('selection');
        onGo(index + 1);
      } else if ((e.translationX > 60 || e.velocityX > 600) && index > 0) {
        haptic('selection');
        onGo(index - 1);
      }
    });

  return (
    <View style={{ gap: t.spacing.m }}>
      <GestureDetector gesture={swipe}>
        <Animated.View style={[{ gap: t.spacing.m }, anim]} accessibilityHint={tr('ui.guide.swipeHint')}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
            <HText variant="micro" color="accent" weight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
              {tr('ui.guide.step', { n: index + 1, total: count })}
            </HText>
            {isDone ? <Icon name="checkCircle" size={14} color={t.colors.success} /> : null}
          </View>
          <InlineText variant="title" text={s.title} accessibilityRole="header" />
          {index === 0 && model.intro ? <InlineText variant="callout" color="muted" text={model.intro} /> : null}
          {s.imageQuery ? <Thumb query={s.imageQuery} size="100%" height={180} label={s.title} /> : null}
          {s.body ? <MarkdownBody text={s.body} t={t} /> : null}
          {s.warning ? <NoteBox kind="warning" text={s.warning} t={t} /> : null}
          {s.tip ? <NoteBox kind="tip" text={s.tip} t={t} /> : null}
          {s.seconds ? (
            <InlineClock
              t={t}
              clockKey={s.key}
              seconds={s.seconds}
              clock={clocks[s.key]}
              ctl={ctl}
              label={tr('ui.guide.timerLabel', { title: s.title, n: index + 1 })}
            />
          ) : null}
          {alertKey ? <AlertLine t={t} text={tr('ui.timer.timesUp', { label: steps.find((x) => x.key === alertKey)?.title ?? '' })} onDismiss={onDismissAlert} /> : null}
        </Animated.View>
      </GestureDetector>

      <DoneButton t={t} done={isDone} onPress={() => onDone(s.key)} />

      <View style={{ flexDirection: 'row', gap: t.spacing.s }}>
        <Btn label={tr('ui.guide.back')} icon="chevronLeft" onPress={() => onGo(index - 1)} disabled={index === 0} style={{ flex: 1 }} />
        {last ? (
          <Btn label={tr('ui.guide.finish')} kind="primary" icon="check" onPress={() => (isDone ? onGo(nextOpenOr(steps, done, index)) : onDone(s.key))} style={{ flex: 1 }} />
        ) : (
          <Btn label={tr('ui.guide.next')} kind="primary" icon="chevronRight" iconRight onPress={() => onGo(index + 1)} style={{ flex: 1 }} />
        )}
      </View>

      <Stuck key={s.key} t={t} stepNo={index + 1} sent={stuckSent} onSend={onStuck} label={stuckLabel} />
    </View>
  );
}

function nextOpenOr(steps: GuideStep[], done: string[], i: number): number {
  const n = nextOpen(steps, done, 0);
  return n >= 0 ? n : i;
}

function DoneButton({ t, done, onPress }: { t: Theme; done: boolean; onPress: () => void }) {
  const tr = useT();
  return (
    <PressableScale
      haptic={false}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done }}
      accessibilityLabel={tr('ui.guide.markDone')}
      accessibilityHint={done ? tr('ui.guide.undoDone') : tr('ui.guide.markDoneHint')}
      style={{ minHeight: 48, borderRadius: t.radii.m, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: done ? t.colors.successSoft : 'transparent', borderWidth: done ? 0 : 1.5, borderColor: t.colors.success }}
      pressedStyle={{ opacity: 0.85 }}
    >
      <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? t.colors.success : 'transparent', borderWidth: done ? 0 : 1.5, borderColor: t.colors.success }}>
        {done ? <Icon name="check" size={14} color={t.colors.onAccent} strokeWidth={2.8} /> : null}
      </View>
      <HText variant="callout" weight="600" style={{ color: t.colors.success }}>
        {done ? tr('ui.guide.isDone') : tr('ui.guide.markDone')}
      </HText>
    </PressableScale>
  );
}

function AlertLine({ t, text, onDismiss }: { t: Theme; text: string; onDismiss: () => void }) {
  const tr = useT();
  return (
    <PressableScale haptic="selection" onPress={onDismiss} accessibilityRole="alert" accessibilityLiveRegion="assertive" accessibilityLabel={`${text}. ${tr('ui.timer.dismiss')}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: t.spacing.m, borderRadius: t.radii.m, backgroundColor: t.colors.successSoft }}>
      <D2Icon name="bell" size={16} color={t.colors.success} />
      <HText variant="callout" weight="600" style={{ flex: 1, color: t.colors.success }}>
        {text}
      </HText>
      <Icon name="x" size={16} color={t.colors.success} />
    </PressableScale>
  );
}

/* ───────────── stuck ───────────── */

function Stuck({ t, stepNo, sent, onSend, label }: { t: Theme; stepNo: number; sent: boolean; onSend: (detail: string) => boolean; label?: string }) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [focus, setFocus] = useState(false);
  if (sent && !open) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44 }}>
        <Icon name="checkCircle" size={15} color={t.colors.muted} />
        <HText variant="callout" color="muted">
          {tr('ui.guide.stuckSent')}
        </HText>
      </View>
    );
  }
  if (!open) {
    return (
      <PressableScale haptic="selection" onPress={() => setOpen(true)} accessibilityLabel={label || tr('ui.guide.stuck')} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'center', paddingHorizontal: t.spacing.m }}>
        <D2Icon name="help" size={16} color={t.colors.accent} />
        <HText variant="callout" weight="500" color="accent">
          {label || tr('ui.guide.stuck')}
        </HText>
      </PressableScale>
    );
  }
  const submit = () => {
    if (onSend(text.trim())) {
      setOpen(false);
      setText('');
    }
  };
  return (
    <FadeIn>
      <View style={{ gap: t.spacing.s, padding: t.spacing.m, borderRadius: t.radii.l, backgroundColor: t.colors.surfaceAlt }}>
        <HText variant="callout" weight="600">
          {tr('ui.guide.stuckTitle', { n: stepNo })}
        </HText>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={tr('ui.guide.stuckPlaceholder')}
          placeholderTextColor={t.colors.subtle}
          accessibilityLabel={tr('ui.guide.stuckPlaceholder')}
          autoFocus
          multiline
          maxLength={500}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={[
            textStyle(t, 'body'),
            { minHeight: 64, borderRadius: t.radii.m, borderWidth: 1, borderColor: focus ? t.colors.accent : t.colors.borderStrong, paddingHorizontal: t.spacing.m, paddingVertical: 10, color: t.colors.text, backgroundColor: t.colors.surface, textAlignVertical: 'top', outlineStyle: 'none' } as object,
          ]}
        />
        <View style={{ flexDirection: 'row', gap: t.spacing.s, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Btn label={tr('ui.guide.stuckCancel')} kind="ghost" onPress={() => setOpen(false)} />
          <Btn label={tr('ui.guide.stuckSend')} kind="primary" icon="send" onPress={submit} />
        </View>
      </View>
    </FadeIn>
  );
}

/* ───────────── overview ───────────── */

function Overview({ t, model, done, current, onOpen, onToggle, disabled }: { t: Theme; model: GuideModel; done: string[]; current: number; onOpen?: (i: number) => void; onToggle?: (key: string) => void; disabled?: boolean }) {
  const tr = useT();
  return (
    <View>
      {model.steps.map((s, i) => {
        const isDone = done.includes(s.key);
        const cur = i === current;
        return (
          <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: i === model.steps.length - 1 ? 0 : 1, borderBottomColor: t.colors.border }}>
            <PressableScale
              haptic={false}
              disabled={disabled}
              dimDisabled={false}
              onPress={() => onToggle?.(s.key)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isDone, disabled }}
              accessibilityLabel={`${tr('ui.guide.markDone')}: ${s.title}`}
              style={{ width: 44, height: 48, alignItems: 'center', justifyContent: 'center' }}
            >
              <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: isDone ? t.colors.success : 'transparent', borderWidth: isDone ? 0 : 1.5, borderColor: cur ? t.colors.accent : t.colors.borderStrong }}>
                {isDone ? <Icon name="check" size={14} color={t.colors.onAccent} strokeWidth={2.8} /> : <HText variant="micro" weight="700" color={cur ? 'accent' : 'muted'} tabular>{String(i + 1)}</HText>}
              </View>
            </PressableScale>
            <PressableScale
              haptic="selection"
              disabled={disabled}
              dimDisabled={false}
              onPress={() => onOpen?.(i)}
              accessibilityRole="button"
              accessibilityLabel={`${tr('ui.guide.goTo', { n: i + 1, title: s.title })}, ${isDone ? tr('ui.guide.stateDone') : tr('ui.guide.stateOpen')}${cur ? `, ${tr('ui.guide.current')}` : ''}`}
              style={{ flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, paddingVertical: 8, paddingRight: 4 }}
            >
              <HText variant="callout" weight={cur ? '600' : '400'} numberOfLines={2} style={{ flex: 1, color: isDone ? t.colors.muted : t.colors.text, textDecorationLine: isDone ? 'line-through' : 'none' }}>
                {s.title}
              </HText>
              {s.seconds ? <D2Icon name="timer" size={15} color={t.colors.subtle} /> : null}
              {onOpen ? <Icon name="chevronRight" size={16} color={t.colors.subtle} /> : null}
            </PressableScale>
          </View>
        );
      })}
    </View>
  );
}

/* ───────────── finished ───────────── */

function Finished({ t, count, reported, pending, onReport, onRestart }: { t: Theme; count: number; reported: boolean; pending: boolean; onReport: () => void; onRestart: () => void }) {
  const tr = useT();
  return (
    <View style={{ alignItems: 'center', gap: t.spacing.s, paddingVertical: t.spacing.s }} accessibilityLiveRegion="polite">
      <Celebration t={t} />
      <HText variant="title" align="center" accessibilityRole="header">
        {tr('ui.guide.finishedTitle')}
      </HText>
      <HText variant="callout" color="muted" align="center">
        {tr('ui.guide.finishedBody', { n: count })}
      </HText>
      <View style={{ flexDirection: 'row', gap: t.spacing.s, marginTop: t.spacing.s, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Btn label={tr('ui.guide.restart')} bicon="reset" kind="ghost" onPress={onRestart} />
        {reported ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: t.spacing.m }}>
            <Icon name="checkCircle" size={15} color={t.colors.success} />
            <HText variant="callout" color="success">
              {tr('ui.guide.reported')}
            </HText>
          </View>
        ) : pending ? null : (
          <Btn label={tr('ui.guide.report')} kind="primary" icon="send" onPress={onReport} />
        )}
      </View>
    </View>
  );
}
