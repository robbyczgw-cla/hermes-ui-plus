/**
 * `studyplan` (docs/SPEC-modules-v4.md): overall ring + "Heute", week accordion (ring + x/y per
 * week) → day rows → checkable tasks with kind icon and minutes. Progress is persisted per node;
 * "Fortschritt senden" sends `[studyplan:<id>] Woche 1: 9/12 erledigt · …`.
 */
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useT } from '../../../../i18n';
import { useTheme, type Theme } from '../../../theme';
import { withAlpha } from '../../../color';
import { useHui } from '../../../primitives/context';
import { HText, InlineText, PressableScale, Surface } from '../../../primitives/basics';
import { Button } from '../../../primitives/Button';
import { Icon } from '../../../primitives/Icon';
import { haptic } from '../../../primitives/haptics';
import { useNodeState } from '../../../../nodestate';
import { StudyPlanSkeleton } from '../../../skeletons';
import type { HuiStudyPlan, HuiStudyTaskKind } from '../../../types';
import { PrimaryButton, useModuleId, useSend } from '../a/shared';
import { D3Icon, Ring } from './icons';
import {
  INITIAL_STUDY_STATE,
  formatMinutes,
  planTasks,
  isDone,
  progressOf,
  readStudyPlan,
  studyReply,
  todayTarget,
  toggleDay,
  toggleTask,
  weekTasks,
  type DayRef,
  type StudyDay,
  type StudyState,
  type StudyTask,
  type StudyWeek,
} from './studyplanModel.ts';

const KIND_INDEX: Record<HuiStudyTaskKind, number> = { learn: 0, practice: 1, review: 2, test: 3 };

export function kindColor(t: Theme, kind: HuiStudyTaskKind | undefined): string {
  return kind ? t.colors.chart[KIND_INDEX[kind]] ?? t.colors.muted : t.colors.subtle;
}

export function StudyPlan({ node }: { node: Partial<HuiStudyPlan> }) {
  const tr = useT();
  const t = useTheme();
  const { streaming } = useHui();
  const id = useModuleId('studyplan', node as Record<string, unknown>);
  const plan = useMemo(() => readStudyPlan(node as Record<string, unknown>), [node]);
  const [st, setSt] = useNodeState<StudyState>(id, INITIAL_STUDY_STATE);
  const done = st.done;
  const send = useSend(id);
  const target = useMemo(() => todayTarget(plan, done, new Date()), [plan, done]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [focus, setFocus] = useState<DayRef | null>(null);

  if (!plan.weeks.length) {
    if (streaming) return <StudyPlanSkeleton />;
    return (
      <Surface>
        {plan.title ? <InlineText variant="headline" text={plan.title} /> : null}
        <HText variant="callout" color="muted">
          {tr('ui.studyplan.empty')}
        </HText>
      </Surface>
    );
  }

  const all = progressOf(planTasks(plan), done);
  const pct = Math.round(all.ratio * 100);
  const reply = studyReply(id, plan, done);
  const sentNow = st.sent === reply;
  // default: only the current week is open
  const isOpen = (w: StudyWeek, i: number) => open[w.id] ?? (target ? target.week === i : i === 0);

  const jumpToday = () => {
    if (!target) return;
    haptic('selection');
    const w = plan.weeks[target.week];
    setOpen(Object.fromEntries(plan.weeks.map((x) => [x.id, x.id === w.id])));
    setFocus(target);
  };

  return (
    <Surface style={{ gap: t.spacing.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.m }}>
        <View accessible accessibilityLabel={`${tr('ui.studyplan.overall')}: ${tr('ui.studyplan.ringA11y', { percent: pct })}`} style={{ width: 60, height: 60, alignItems: 'center', justifyContent: 'center' }}>
          <Ring ratio={all.ratio} size={60} stroke={6} color={all.ratio >= 1 ? t.colors.success : t.colors.accent} track={t.colors.surfaceAlt} />
          <View style={{ position: 'absolute', alignItems: 'center' }}>
            <HText variant="callout" weight="700" tabular>
              {`${pct}%`}
            </HText>
          </View>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <InlineText variant="headline" text={plan.title || tr('ui.studyplan.title')} accessibilityRole="header" />
          <HText variant="caption" color="muted" tabular>
            {tr('ui.studyplan.tasksDone', { done: all.done, total: all.total })}
            {all.minutes ? ` · ${tr('ui.studyplan.timeTotal', { time: formatMinutes(all.minutes) })}` : ''}
          </HText>
        </View>
      </View>
      {plan.goal ? <InlineText variant="callout" color="muted" text={plan.goal} /> : null}

      {target && !streaming ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.m, flexWrap: 'wrap' }}>
          <Button label={tr('ui.studyplan.today')} accessibilityLabel={tr('ui.studyplan.todayA11y')} size="small" onPress={jumpToday} />
          <Legend t={t} />
        </View>
      ) : null}

      <View style={{ borderRadius: t.radii.control, borderWidth: 1, borderColor: t.colors.border, overflow: 'hidden' }}>
        {plan.weeks.map((w, wi) => (
          <Week
            key={w.id}
            t={t}
            week={w}
            index={wi}
            done={done}
            open={isOpen(w, wi)}
            onToggleOpen={() => setOpen((o) => ({ ...o, [w.id]: !isOpen(w, wi) }))}
            today={target && target.week === wi ? target.day : -1}
            focus={focus && focus.week === wi ? focus.day : -1}
            onTask={(task) => {
              haptic(isDone(done, task.id) ? 'light' : 'success');
              setSt((s) => toggleTask(s, task.id));
            }}
            onDay={(day) => {
              haptic('success');
              setSt((s) => toggleDay(s, day));
            }}
          />
        ))}
      </View>

      {all.total > 0 && all.ratio >= 1 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' }} accessibilityLiveRegion="polite">
          <Icon name="checkCircle" size={18} color={t.colors.success} strokeWidth={2} />
          <HText variant="callout" weight="600" color="success">
            {tr('ui.studyplan.allDone')}
          </HText>
        </View>
      ) : null}

      {sentNow ? (
        <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }} accessibilityLiveRegion="polite">
          <Icon name="check" size={16} color={t.colors.success} strokeWidth={2.25} />
          <HText variant="callout" weight="500" color="success">
            {tr('ui.studyplan.sent')}
          </HText>
        </View>
      ) : (
        <PrimaryButton
          label={tr('ui.studyplan.send')}
          icon="send"
          disabled={streaming || all.total === 0}
          onPress={() => {
            if (send(reply)) setSt((s) => ({ ...s, sent: reply }));
          }}
        />
      )}
    </Surface>
  );
}

function Legend({ t }: { t: Theme }) {
  const tr = useT();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4, flexBasis: '100%' }} aria-hidden>
      {(['learn', 'practice', 'review', 'test'] as const).map((k) => (
        <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <D3Icon name={k} size={13} color={kindColor(t, k)} />
          <HText variant="micro" color="muted">
            {tr(`ui.studyplan.${k}`)}
          </HText>
        </View>
      ))}
    </View>
  );
}

function Week({
  t,
  week,
  index,
  done,
  open,
  onToggleOpen,
  today,
  focus,
  onTask,
  onDay,
}: {
  t: Theme;
  week: StudyWeek;
  index: number;
  done: Record<string, 1>;
  open: boolean;
  onToggleOpen: () => void;
  today: number;
  focus: number;
  onTask: (task: StudyTask) => void;
  onDay: (day: StudyDay) => void;
}) {
  const tr = useT();
  const p = progressOf(weekTasks(week), done);
  const label = week.label || tr('ui.studyplan.week', { n: index + 1 });
  const complete = p.total > 0 && p.done === p.total;
  return (
    <View style={{ borderTopWidth: index ? 1 : 0, borderColor: t.colors.border }}>
      <PressableScale
        haptic="selection"
        scaleTo={0.995}
        onPress={onToggleOpen}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={tr('ui.studyplan.weekA11y', { label, done: p.done, total: p.total })}
        accessibilityHint={open ? tr('ui.studyplan.collapse') : tr('ui.studyplan.expand')}
        style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.m, minHeight: 52, paddingHorizontal: t.spacing.m, paddingVertical: t.spacing.s, backgroundColor: open ? t.colors.surfaceAlt : 'transparent' }}
        pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
      >
        <View style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
          <Ring ratio={p.ratio} size={30} stroke={3.5} color={complete ? t.colors.success : t.colors.accent} track={t.colors.border} />
          {complete ? (
            <View style={{ position: 'absolute' }}>
              <Icon name="check" size={14} color={t.colors.success} strokeWidth={2.6} />
            </View>
          ) : null}
        </View>
        <InlineText variant="bodyStrong" text={label} style={{ flex: 1 }} numberOfLines={2} />
        <HText variant="caption" color={complete ? 'success' : 'muted'} tabular weight="600">
          {`${p.done}/${p.total}`}
        </HText>
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
          <Icon name="chevronDown" size={16} color={t.colors.muted} />
        </View>
      </PressableScale>
      {open ? (
        <View style={{ paddingHorizontal: t.spacing.s, paddingBottom: t.spacing.s, gap: 2 }}>
          {week.days.map((d, di) => (
            <Day key={d.id} t={t} day={d} index={di} done={done} today={today === di} focused={focus === di} onTask={onTask} onDay={onDay} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Day({ t, day, index, done, today, focused, onTask, onDay }: { t: Theme; day: StudyDay; index: number; done: Record<string, 1>; today: boolean; focused: boolean; onTask: (task: StudyTask) => void; onDay: (day: StudyDay) => void }) {
  const tr = useT();
  const p = progressOf(day.tasks, done);
  const label = day.label || tr('ui.studyplan.day', { n: index + 1 });
  const complete = p.total > 0 && p.done === p.total;
  return (
    <View
      style={{
        marginTop: t.spacing.s,
        borderRadius: t.radii.control,
        paddingVertical: 2,
        backgroundColor: focused ? withAlpha(t.colors.accent, t.dark ? 0.14 : 0.08) : 'transparent',
        borderWidth: focused ? 1 : 0,
        borderColor: withAlpha(t.colors.accent, 0.5),
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, paddingLeft: t.spacing.s, minHeight: 36 }}>
        <HText variant="caption" weight="600" style={{ color: today ? t.colors.accentText : t.colors.muted }} accessibilityRole="header">
          {label}
        </HText>
        {today ? (
          <View style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: t.radii.pill, backgroundColor: t.colors.accent }}>
            <HText variant="micro" weight="700" style={{ color: t.colors.onAccent }}>
              {tr('ui.studyplan.todayBadge')}
            </HText>
          </View>
        ) : null}
        <HText variant="micro" color="subtle" tabular style={{ flex: 1 }}>
          {p.minutes ? formatMinutes(p.minutes) : ''}
        </HText>
        {p.total > 1 ? (
          <PressableScale
            haptic={false}
            onPress={() => onDay(day)}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${complete ? tr('ui.studyplan.unmarkDay') : tr('ui.studyplan.markDay')}`}
            hitSlop={6}
            style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }}
            pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
          >
            <Icon name="checkCircle" size={18} color={complete ? t.colors.success : t.colors.subtle} strokeWidth={complete ? 2.2 : 1.75} />
          </PressableScale>
        ) : null}
      </View>
      {day.tasks.map((task) => (
        <TaskRow key={task.id} t={t} task={task} checked={isDone(done, task.id)} onPress={() => onTask(task)} />
      ))}
    </View>
  );
}

function TaskRow({ t, task, checked, onPress }: { t: Theme; task: StudyTask; checked: boolean; onPress: () => void }) {
  const tr = useT();
  const kc = kindColor(t, task.kind);
  const a11y = [task.text, task.kind ? tr(`ui.studyplan.${task.kind}`) : '', task.minutes ? formatMinutes(task.minutes) : ''].filter(Boolean).join(', ');
  return (
    <PressableScale
      haptic={false}
      scaleTo={0.99}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={a11y}
      style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s + 2, minHeight: 44, paddingHorizontal: t.spacing.s, paddingVertical: 6, borderRadius: t.radii.control }}
      pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          borderWidth: checked ? 0 : 1.5,
          borderColor: t.colors.borderControl,
          backgroundColor: checked ? t.colors.success : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? <Icon name="check" size={14} color={t.dark ? '#111' : '#FFF'} strokeWidth={2.8} /> : null}
      </View>
      {task.kind ? (
        <View style={{ width: 26, height: 26, borderRadius: t.radii.inline, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(kc, t.dark ? 0.2 : 0.12) }}>
          <D3Icon name={task.kind} size={15} color={kc} strokeWidth={1.9} />
        </View>
      ) : null}
      <InlineText
        variant="callout"
        text={task.text}
        style={[{ flex: 1 }, checked ? { color: t.colors.muted, textDecorationLine: 'line-through' } : null]}
      />
      {task.minutes ? (
        <HText variant="caption" color="subtle" tabular>
          {formatMinutes(task.minutes)}
        </HText>
      ) : null}
    </PressableScale>
  );
}
