/**
 * `workout` – training session view (docs/SPEC-modules-v4.md). Exercise cards with tappable set
 * bubbles (each completed set starts the rest countdown + a scheduled notification), editable
 * reps/weight per set, warm-up/cool-down, elapsed session time (stopwatch), "Training beenden" →
 * summary → `[workout:<id>] 18/20 Sätze · 42 min · Kniebeuge 3×10 @ 60 kg …`. Progress persisted.
 */
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { TextInput } from '../../../primitives/Text';
import { noOutline } from '../../../lib/webStyle';
import { useTheme, type Theme } from '../../../theme';
import { useHui } from '../../../primitives/context';
import { FadeIn, HText, InlineText, PressableScale, Surface, textStyle } from '../../../primitives/basics';
import { Icon } from '../../../primitives/Icon';
import { haptic } from '../../../primitives/haptics';
import { Skeleton } from '../../../primitives/Skeleton';
import { useNodeState } from '../../../../nodestate';
import { useT } from '../../../../i18n';
import type { HuiWorkout } from '../../../types';
import { WorkoutSkeleton } from '../../../skeletons';
import { Thumb } from '../../imageParts';
import { useModuleId, useNodeStateReady, useSend } from '../a/shared';
import { Btn } from '../b/controls';
import { ClockRing, D2Icon, DoneAlert, IconBtn, ProgressBar, SectionLabel, SoundToggle } from './parts';
import { countdown, elapsedMs, formatCountdown, formatElapsed, progress, remainingMs, stopwatch, wholeMinutes } from './timerEngine.ts';
import { sanitizeClocks, useClocks, type ClockControls, type ClockMap } from './useClocks';
import { normalizeWorkout, patchSet, setReps, setsOf, setWeight, summaryRows, toggleSet, totals, workoutReply, type Exercise, type SetsState, type WorkoutModel } from './workoutModel.ts';

type WorkoutState = {
  sets: SetsState;
  clocks: ClockMap;
  /** exercise whose set started the current rest (for the "next up" text) */
  restFor?: string;
  sound?: boolean;
  phase?: 'active' | 'summary';
  sent?: string;
  warm?: boolean;
  cool?: boolean;
};
const INITIAL: WorkoutState = { sets: {}, clocks: {} };
const SESSION = 'session';
const REST = 'rest';

export function Workout({ node }: { node: Partial<HuiWorkout> }) {
  const t = useTheme();
  const tr = useT();
  const { streaming } = useHui();
  const id = useModuleId('workout', node as Record<string, unknown>);
  const model = useMemo(() => normalizeWorkout(node as Record<string, unknown>), [node]);
  const [st, setSt] = useNodeState<WorkoutState>(id, INITIAL);
  const ready = useNodeStateReady();
  const clocks = useMemo(() => sanitizeClocks(st.clocks), [st.clocks]);
  const sets = st.sets ?? {};
  const send = useSend(id);
  const [restAlert, setRestAlert] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const nextUp = useCallback(() => {
    const open = model.exercises.find((e) => setsOf(e, sets).some((s) => !s.done));
    return open?.name ?? '';
  }, [model, sets]);
  const setClocks = useCallback((fn: (p: ClockMap) => ClockMap) => setSt((s) => ({ ...s, clocks: fn(sanitizeClocks(s.clocks)) })), [setSt]);
  const ctl = useClocks({
    clocks,
    setClocks,
    ready,
    sound: st.sound !== false,
    alarm: () => ({ title: tr('ui.workout.restNotifyTitle'), body: nextUp() ? tr('ui.workout.restNotifyBody', { name: nextUp() }) : undefined }),
    onDone: (key) => key === REST && setRestAlert(true),
  });

  if (!model.exercises.length) return streaming ? <WorkoutSkeleton /> : null;

  const title = model.title || tr('ui.workout.defaultTitle');
  const { done, total } = totals(model, sets);
  const session = clocks[SESSION];
  const started = !!session && session.status !== 'idle';
  const elapsed = session ? elapsedMs(session, ctl.now) : 0;
  const phase = st.phase ?? 'active';
  const disabled = streaming;

  const ensureSession = () => {
    if (!session || session.status === 'idle') ctl.start(SESSION, stopwatch());
  };
  const tapSet = (ex: Exercise, i: number) => {
    const r = toggleSet(sets, ex, i);
    setSt((s) => ({ ...s, sets: r.state, ...(r.done ? { restFor: ex.key } : null) }));
    if (!r.done) {
      haptic('light');
      return;
    }
    haptic('success');
    ensureSession();
    setRestAlert(false);
    const t2 = totals(model, r.state);
    if (t2.done >= t2.total || ex.restSeconds <= 0) {
      ctl.remove(REST);
      return;
    }
    ctl.remove(REST);
    ctl.start(REST, countdown(ex.restSeconds));
  };
  const finish = () => {
    haptic('medium');
    ctl.remove(REST);
    setRestAlert(false);
    if (session?.status === 'running') ctl.pause(SESSION);
    setSt((s) => ({ ...s, phase: 'summary' }));
  };
  const resume = () => {
    if (session?.status === 'paused') ctl.start(SESSION, stopwatch());
    setSt((s) => ({ ...s, phase: 'active' }));
  };
  const reply = workoutReply(id, model, sets, elapsed);
  const sent = st.sent === reply;
  const submit = () => {
    if (!send(reply)) return;
    setSt((s) => ({ ...s, sent: reply }));
  };

  return (
    <Surface style={{ gap: t.spacing.m }}>
      {/* header */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.s }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
          <D2Icon name="dumbbell" size={19} color={t.colors.accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <HText variant="headline" accessibilityRole="header" numberOfLines={3}>
            {title}
          </HText>
          <HText variant="caption" color="muted" accessibilityLabel={tr('ui.workout.progressA11y', { done, total })}>
            {tr('ui.workout.sets', { done, total })}
            {model.kind ? ` · ${kindLabel(model.kind, tr)}` : ''}
          </HText>
          {model.note ? (
            <HText variant="caption" color="muted">
              {model.note}
            </HText>
          ) : null}
        </View>
        <SoundToggle on={st.sound !== false} onToggle={() => setSt((s) => ({ ...s, sound: !(s.sound !== false) }))} t={t} />
      </View>

      <SessionBar t={t} started={started} running={session?.status === 'running'} elapsed={elapsed} disabled={disabled || phase === 'summary'} onStart={ensureSession} onToggle={() => (session?.status === 'running' ? ctl.pause(SESSION) : ctl.start(SESSION, stopwatch()))} />
      <ProgressBar t={t} frac={total ? done / total : 0} color={done === total ? t.colors.success : undefined} />

      {phase === 'summary' ? (
        <Summary t={t} model={model} sets={sets} elapsed={elapsed} sent={sent} onSend={submit} onResume={resume} disabled={disabled} />
      ) : (
        <>
          {clocks[REST] && clocks[REST].status !== 'idle' && clocks[REST].status !== 'done' ? (
            <RestPanel t={t} ctl={ctl} clock={clocks[REST]} next={nextUp()} />
          ) : null}
          {restAlert ? <DoneAlert t={t} text={tr('ui.workout.restDone')} onDismiss={() => setRestAlert(false)} /> : null}

          {model.warmup ? <Phase t={t} label={tr('ui.workout.warmup')} icon="flame" text={model.warmup} done={!!st.warm} onToggle={() => setSt((s) => ({ ...s, warm: !s.warm }))} /> : null}

          <View style={{ gap: t.spacing.s }}>
            {model.exercises.map((ex, i) => (
              <ExerciseCard
                key={ex.key}
                t={t}
                ex={ex}
                sets={sets}
                disabled={disabled}
                partial={streaming && i === model.exercises.length - 1}
                editing={editing === ex.key}
                onEdit={() => setEditing((k) => (k === ex.key ? null : ex.key))}
                onTap={(k) => tapSet(ex, k)}
                onPatch={(k, patch) => setSt((s) => ({ ...s, sets: patchSet(s.sets ?? {}, ex, k, patch) }))}
              />
            ))}
            {streaming ? <Skeleton height={84} radius={t.radii.card} /> : null}
          </View>

          {model.cooldown ? <Phase t={t} label={tr('ui.workout.cooldown')} icon="leaf" text={model.cooldown} done={!!st.cool} onToggle={() => setSt((s) => ({ ...s, cool: !s.cool }))} /> : null}

          <Btn label={tr('ui.workout.finish')} kind={done > 0 ? 'primary' : 'secondary'} icon="check" onPress={finish} disabled={disabled} />
        </>
      )}
    </Surface>
  );
}

function kindLabel(k: NonNullable<WorkoutModel['kind']>, tr: ReturnType<typeof useT>): string {
  return k === 'strength' ? tr('ui.workout.kindStrength') : k === 'cardio' ? tr('ui.workout.kindCardio') : k === 'mobility' ? tr('ui.workout.kindMobility') : tr('ui.workout.kindMixed');
}

/* ───────────── session time ───────────── */

function SessionBar({ t, started, running, elapsed, disabled, onStart, onToggle }: { t: Theme; started: boolean; running: boolean; elapsed: number; disabled: boolean; onStart: () => void; onToggle: () => void }) {
  const tr = useT();
  if (!started) {
    return <Btn label={tr('ui.workout.start')} kind="primary" bicon="play" onPress={onStart} disabled={disabled} />;
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, paddingLeft: t.spacing.m, borderRadius: t.radii.card, backgroundColor: t.colors.surfaceAlt, minHeight: 52 }}>
      <D2Icon name="stopwatch" size={18} color={running ? t.colors.accent : t.colors.muted} />
      <View style={{ flex: 1 }} accessible accessibilityRole="timer" accessibilityLabel={`${tr('ui.workout.elapsed')}: ${formatElapsed(elapsed)}`}>
        <HText variant="micro" color="muted">
          {tr('ui.workout.elapsed')}
        </HText>
        <HText variant="headline" tabular>
          {formatElapsed(elapsed)}
        </HText>
      </View>
      <PressableScale haptic="selection" disabled={disabled} onPress={onToggle} accessibilityLabel={running ? tr('ui.workout.pauseSession') : tr('ui.workout.resumeSession')} style={{ width: 52, height: 52, alignItems: 'center', justifyContent: 'center' }}>
        <D2Icon name={running ? 'pause' : 'play'} size={16} color={t.colors.muted} />
      </PressableScale>
    </View>
  );
}

/* ───────────── rest ───────────── */

function RestPanel({ t, ctl, clock, next }: { t: Theme; ctl: ClockControls; clock: NonNullable<ClockMap[string]>; next: string }) {
  const tr = useT();
  const rem = remainingMs(clock, ctl.now);
  const time = formatCountdown(rem);
  return (
    <FadeIn>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.m, padding: t.spacing.m, borderRadius: t.radii.card, backgroundColor: t.colors.accentSoft }}>
        <ClockRing size={52} stroke={5} frac={progress(clock, ctl.now)} color={t.colors.accent} track={t.colors.surface}>
          <D2Icon name="timer" size={18} color={t.colors.accent} />
        </ClockRing>
        <View style={{ flex: 1, minWidth: 0 }} accessible accessibilityRole="timer" accessibilityLabel={tr('ui.workout.restA11y', { time })} accessibilityLiveRegion="none">
          <HText variant="caption" weight="600" color="accent">
            {tr('ui.workout.rest')}
          </HText>
          <HText variant="title" tabular>
            {time}
          </HText>
          {next ? (
            <HText variant="caption" color="muted" numberOfLines={1}>
              {tr('ui.workout.restNotifyBody', { name: next })}
            </HText>
          ) : null}
        </View>
        <PressableScale haptic="selection" onPress={() => ctl.adjust(REST, 30_000)} accessibilityLabel={tr('ui.workout.restMoreA11y')} style={{ minHeight: 44, minWidth: 52, paddingHorizontal: 8, borderRadius: t.radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.surface }}>
          <HText variant="caption" weight="600" tabular>
            {tr('ui.workout.restMore')}
          </HText>
        </PressableScale>
        <IconBtn t={t} icon="skip" label={tr('ui.workout.skipRest')} onPress={() => ctl.remove(REST)} />
      </View>
    </FadeIn>
  );
}

/* ───────────── warm-up / cool-down ───────────── */

function Phase({ t, label, icon, text, done, onToggle }: { t: Theme; label: string; icon: 'flame' | 'leaf'; text: string; done: boolean; onToggle: () => void }) {
  const tr = useT();
  return (
    <View style={{ flexDirection: 'row', gap: t.spacing.s, alignItems: 'flex-start', padding: t.spacing.m, borderRadius: t.radii.card, borderWidth: 1, borderColor: t.colors.border }}>
      <View style={{ paddingTop: 2 }}>
        <D2Icon name={icon} size={18} color={done ? t.colors.success : t.colors.muted} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <SectionLabel t={t} text={label} />
        <InlineText variant="callout" text={text} color={done ? 'muted' : undefined} />
      </View>
      <PressableScale
        haptic="selection"
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={`${label}: ${tr('ui.workout.markDone')}`}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: -6, marginRight: -6 }}
      >
        <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? t.colors.success : 'transparent', borderWidth: done ? 0 : 1.5, borderColor: t.colors.borderControl }}>
          {done ? <Icon name="check" size={15} color={t.colors.onAccent} strokeWidth={2.8} /> : null}
        </View>
      </PressableScale>
    </View>
  );
}

/* ───────────── exercise card ───────────── */

function planText(ex: Exercise, tr: ReturnType<typeof useT>): string {
  const parts: string[] = [];
  const per = ex.reps ? tr('ui.workout.reps', { n: ex.reps }) : ex.seconds ? tr('ui.workout.seconds', { n: ex.seconds }) : '';
  parts.push(per ? `${ex.sets} × ${per}` : `${ex.sets} ×`);
  if (ex.weight) parts.push(ex.weight);
  return parts.join(' · ');
}

function ExerciseCard({
  t,
  ex,
  sets,
  disabled,
  partial,
  editing,
  onEdit,
  onTap,
  onPatch,
}: {
  t: Theme;
  ex: Exercise;
  sets: SetsState;
  disabled: boolean;
  partial: boolean;
  editing: boolean;
  onEdit: () => void;
  onTap: (i: number) => void;
  onPatch: (i: number, patch: { reps?: string; weight?: string }) => void;
}) {
  const tr = useT();
  const list = setsOf(ex, sets);
  const nDone = list.filter((s) => s.done).length;
  const complete = nDone === list.length;
  const nextIdx = list.findIndex((s) => !s.done);
  return (
    <View style={{ padding: t.spacing.m, gap: t.spacing.m, borderRadius: t.radii.card, backgroundColor: t.colors.surfaceAlt }}>
      <View style={{ flexDirection: 'row', gap: t.spacing.m, alignItems: 'center' }}>
        {ex.imageQuery ? <Thumb query={ex.imageQuery} size={52} label={ex.name} enabled={!partial} /> : null}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <HText variant="bodyStrong" numberOfLines={2} style={{ flexShrink: 1 }}>
              {ex.name}
            </HText>
            {complete ? <Icon name="checkCircle" size={16} color={t.colors.success} /> : null}
          </View>
          <HText variant="caption" color="muted">
            {planText(ex, tr)}
          </HText>
        </View>
        <IconBtn t={t} icon="edit" label={editing ? tr('ui.workout.editClose') : tr('ui.workout.edit')} onPress={onEdit} filled={editing} tone="muted" size={40} disabled={disabled} />
      </View>
      {ex.note ? <InlineText variant="caption" color="muted" text={ex.note} /> : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {list.map((s, i) => {
          const reps = setReps(ex, s);
          const w = setWeight(ex, s);
          const label = reps ?? (ex.seconds ? `${ex.seconds}s` : String(i + 1));
          const isNext = i === nextIdx;
          const detail = [reps ? tr('ui.workout.reps', { n: reps }) : ex.seconds ? tr('ui.workout.seconds', { n: ex.seconds }) : '', w ?? ''].filter(Boolean).join(', ');
          return (
            <PressableScale
              key={i}
              haptic={false}
              disabled={disabled}
              onPress={() => onTap(i)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: !!s.done, disabled }}
              accessibilityLabel={tr('ui.workout.setA11y', { n: i + 1, total: list.length, detail: detail || '–', state: s.done ? tr('ui.workout.setDone') : tr('ui.workout.setOpen') })}
              scaleTo={0.9}
              style={{
                minWidth: 48,
                height: 48,
                paddingHorizontal: 6,
                borderRadius: t.radii.pill,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: s.done ? t.colors.success : t.colors.surface,
                borderWidth: s.done ? 0 : isNext ? 2 : 1,
                borderColor: isNext ? t.colors.accent : t.colors.borderStrong,
              }}
            >
              {s.done ? (
                <Icon name="check" size={18} color={t.colors.onAccent} strokeWidth={2.8} />
              ) : (
                <HText variant="callout" weight="600" tabular numberOfLines={1} maxFontSizeMultiplier={1.4} style={{ color: isNext ? t.colors.accentText : t.colors.text }}>
                  {label}
                </HText>
              )}
            </PressableScale>
          );
        })}
      </View>

      {editing ? (
        <FadeIn>
          <View style={{ gap: 6 }}>
            {list.map((s, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
                <HText variant="caption" color="muted" style={{ width: 54 }} numberOfLines={1}>
                  {tr('ui.workout.setN', { n: i + 1 })}
                </HText>
                <SmallField t={t} value={s.reps ?? ''} placeholder={ex.reps ?? tr('ui.workout.repsLabel')} label={tr('ui.workout.repsA11y', { n: i + 1 })} onChange={(v) => onPatch(i, { reps: v })} numeric />
                <HText variant="callout" color="subtle">
                  ×
                </HText>
                <SmallField t={t} value={s.weight ?? ''} placeholder={ex.weight ?? tr('ui.workout.weightLabel')} label={tr('ui.workout.weightA11y', { n: i + 1 })} onChange={(v) => onPatch(i, { weight: v })} grow />
              </View>
            ))}
          </View>
        </FadeIn>
      ) : null}
    </View>
  );
}

function SmallField({ t, value, placeholder, label, onChange, numeric, grow }: { t: Theme; value: string; placeholder: string; label: string; onChange: (v: string) => void; numeric?: boolean; grow?: boolean }) {
  const [focus, setFocus] = useState(false);
  return (
    <TextInput
      value={value}
      onChangeText={(v) => onChange(v.slice(0, 24))}
      placeholder={placeholder}
      placeholderTextColor={t.colors.subtle}
      accessibilityLabel={label}
      keyboardType={numeric ? 'number-pad' : 'default'}
      inputMode={numeric ? 'numeric' : 'text'}
      returnKeyType="done"
      selectTextOnFocus
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={[
        textStyle(t, 'callout'),
        { flex: grow ? 1 : undefined, width: grow ? undefined : 68, minWidth: 0, minHeight: 44, borderRadius: t.radii.control, borderWidth: 1, borderColor: focus ? t.colors.accent : t.colors.borderStrong, paddingHorizontal: 10, color: t.colors.text, backgroundColor: t.colors.surface, fontVariant: ['tabular-nums'], ...noOutline } as object,
      ]}
    />
  );
}

/* ───────────── summary ───────────── */

function Summary({ t, model, sets, elapsed, sent, onSend, onResume, disabled }: { t: Theme; model: WorkoutModel; sets: SetsState; elapsed: number; sent: boolean; onSend: () => void; onResume: () => void; disabled: boolean }) {
  const tr = useT();
  const { done, total } = totals(model, sets);
  const rows = summaryRows(model, sets);
  const min = wholeMinutes(elapsed);
  return (
    <FadeIn>
      <View style={{ gap: t.spacing.m }}>
        <SectionLabel t={t} text={tr('ui.workout.summaryTitle')} />
        <View style={{ flexDirection: 'row', gap: t.spacing.s }}>
          <Stat t={t} value={`${done}/${total}`} label={tr('ui.workout.statSets')} a11y={tr('ui.workout.summarySets', { done, total })} />
          <Stat t={t} value={String(min)} label={tr('ui.workout.statMinutes', { n: min })} a11y={tr('ui.workout.summaryMinutes', { n: min })} />
        </View>
        <View>
          {rows.map((r, i) => (
            <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, paddingVertical: 10, borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderBottomColor: t.colors.border }}>
              {r.done === r.total ? <Icon name="checkCircle" size={16} color={t.colors.success} /> : r.done ? <Icon name="dot" size={16} color={t.colors.warning} /> : <Icon name="minus" size={16} color={t.colors.subtle} />}
              <HText variant="callout" style={{ flex: 1 }} numberOfLines={2}>
                {r.name}
              </HText>
              <HText variant="callout" color={r.line ? 'text' : 'subtle'} tabular style={{ flexShrink: 1, textAlign: 'right' }}>
                {r.line || tr('ui.workout.skipped')}
              </HText>
            </View>
          ))}
        </View>
        {sent ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44 }}>
            <Icon name="checkCircle" size={16} color={t.colors.success} />
            <HText variant="callout" color="success">
              {tr('ui.workout.sent')}
            </HText>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: t.spacing.s, flexWrap: 'wrap' }}>
            <Btn label={tr('ui.workout.continue')} kind="secondary" onPress={onResume} style={{ flexGrow: 1 }} />
            <Btn label={tr('ui.workout.send')} kind="primary" icon="send" onPress={onSend} disabled={disabled} style={{ flexGrow: 1 }} />
          </View>
        )}
      </View>
    </FadeIn>
  );
}

function Stat({ t, value, label, a11y }: { t: Theme; value: string; label: string; a11y: string }) {
  return (
    <View accessible accessibilityLabel={a11y} style={{ flex: 1, padding: t.spacing.m, borderRadius: t.radii.card, backgroundColor: t.colors.surfaceAlt, gap: 2 }}>
      <HText variant="stat" tabular>
        {value}
      </HText>
      <HText variant="caption" color="muted" numberOfLines={1}>
        {label}
      </HText>
    </View>
  );
}

