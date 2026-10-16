/**
 * `agenda` node (docs/SPEC-modules-v3.md): vertical day timeline with an hour ruler, blocks
 * coloured by kind (theme chart palette), overlapping blocks side by side, now-line when the date
 * is today. Edit mode: select a block, drag it (15-min snap, UI thread via gesture-handler +
 * reanimated) or use the ± steppers (a11y), drag the end handle to resize, delete, add via sheet.
 * Per block "In Kalender" and "Alle in Kalender" dispatch the `calendar` HuiAction through
 * onAction (the chat shell confirms each in its action sheet). After edits "Plan übernehmen"
 * sends `[agenda:<id>] 09:00–10:00 Fokus · …`. The edited plan is persisted per node.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View, type LayoutChangeEvent } from 'react-native';
import { TextInput } from '../../../primitives/Text';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, type Theme } from '../../../theme';
import { mix, normalizeHex, withAlpha } from '../../../color';
import { useHui } from '../../../primitives/context';
import { HText, InlineText, PressableScale, Surface, textStyle } from '../../../primitives/basics';
import { Button } from '../../../primitives/Button';
import { Icon } from '../../../primitives/Icon';
import { Skeleton, SkeletonLines } from '../../../primitives/Skeleton';
import { haptic } from '../../../primitives/haptics';
import { useNodeState } from '../../../../nodestate';
import { useLocale, useT } from '../../../../i18n';
import type { HuiAgenda, HuiAgendaKind } from '../../../types';
import { ExtraIcon } from '../a/ExtraIcon';
import { useModuleId, useNodeStateReady, useSend } from '../a/shared';
import { Btn, Chips, Stepper } from '../b/controls';
import {
  DAY_MIN,
  KIND_ORDER,
  MIN_DURATION,
  SNAP_MIN,
  agendaReply,
  calendarActionFor,
  durationParts,
  formatClock,
  formatHourLabel,
  kindPaletteIndex,
  layoutOverlaps,
  localIsoDate,
  moveBlock,
  nowMinuteIfToday,
  readBlocks,
  readIsoDate,
  resizeBlockEnd,
  samePlan,
  sortBlocks,
  suggestNewStart,
  visibleRange,
  type AgendaBlock,
} from './agendaModel.ts';
import { a11yState } from '../../../lib/a11yState';

const HOUR_PX = 60;
const SNAP_PX = (HOUR_PX * SNAP_MIN) / 60;
const RULER_W = 46;
const GAP = 3;

type AState = { blocks?: AgendaBlock[]; sent?: boolean; sentBlocks?: AgendaBlock[] };

function useNow(active: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    setNow(new Date());
    const iv = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(iv);
  }, [active]);
  return now;
}

export function Agenda({ node }: { node: Partial<HuiAgenda> }) {
  const t = useTheme();
  const tr = useT();
  const { locale, lang, formatDate } = useLocale();
  const { streaming, onAction } = useHui();
  const id = useModuleId('agenda', node as Record<string, unknown>);
  const send = useSend(id);
  const ready = useNodeStateReady();
  const nodeBlocks = useMemo(() => readBlocks(node.blocks), [node.blocks]);
  const date = readIsoDate(node.date);
  const [st, setSt] = useNodeState<AState>(id, {});
  const blocks = st.blocks ?? nodeBlocks;
  const editable = node.editable !== false && !streaming && ready;
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleted, setDeleted] = useState<AgendaBlock | null>(null);
  const [preview, setPreview] = useState<{ id: string; start: number; end: number } | null>(null);
  const [trackW, setTrackW] = useState(0);
  const now = useNow(!!date && date === localIsoDate(new Date()));
  const nowMin = nowMinuteIfToday(date, now);
  const isEditing = editing && editable && !st.sent;
  const range = visibleRange(blocks, { now: nowMin, pad: isEditing ? 1 : 0 });
  const lo = range.startH * 60;
  const hi = range.endH * 60;
  const layout = useMemo(() => layoutOverlaps(blocks), [blocks]);
  const fmt = useCallback((m: number) => formatClock(m, locale, lang), [locale, lang]);
  const changed = !samePlan(blocks, st.sentBlocks ?? nodeBlocks);
  const sel = blocks.find((b) => b.id === selected) ?? null;
  const calDate = date ?? localIsoDate(new Date());

  // auto-hide the "deleted · undo" row
  useEffect(() => {
    if (!deleted) return;
    const to = setTimeout(() => setDeleted(null), 5000);
    return () => clearTimeout(to);
  }, [deleted]);

  if (!nodeBlocks.length && !node.title && !st.blocks) {
    return streaming ? <AgendaSkeleton /> : null;
  }

  const update = (fn: (list: AgendaBlock[]) => AgendaBlock[]) => {
    setSt((s) => ({ ...s, blocks: sortBlocks(fn(s.blocks ?? nodeBlocks)) }));
  };
  const durText = (min: number) => {
    const { h, m } = durationParts(min);
    if (!h) return tr('ui.agenda.minutes', { n: m });
    return m ? tr('ui.agenda.hoursMinutes', { h, m }) : tr('ui.agenda.hours', { h });
  };
  const kindLabel = (k?: HuiAgendaKind) => tr(`ui.agenda.kinds.${k ?? 'other'}`);
  const colorOf = (k?: HuiAgendaKind) => t.colors.chart[kindPaletteIndex(k, t.colors.chart.length)] ?? t.colors.accent;

  const move = (bid: string, delta: number) => {
    if (!delta) return;
    update((list) => list.map((b) => (b.id === bid ? moveBlock(b, delta, isEditing ? lo : 0, isEditing ? hi : DAY_MIN) : b)));
  };
  const resize = (bid: string, delta: number) => {
    if (!delta) return;
    update((list) => list.map((b) => (b.id === bid ? resizeBlockEnd(b, delta, isEditing ? hi : DAY_MIN) : b)));
  };
  const remove = (b: AgendaBlock) => {
    haptic('warning');
    update((list) => list.filter((x) => x.id !== b.id));
    setSelected(null);
    setDeleted(b);
  };
  const undoDelete = () => {
    const b = deleted;
    if (!b) return;
    update((list) => (list.some((x) => x.id === b.id) ? list : [...list, b]));
    setDeleted(null);
    setSelected(b.id);
  };
  const toCalendar = (b: AgendaBlock) => {
    onAction(calendarActionFor(b, calDate), undefined, { nodeId: id });
  };
  const allToCalendar = () => {
    // one confirmation sheet per event (the action runner queues them)
    for (const b of sortBlocks(blocks)) onAction(calendarActionFor(b, calDate), undefined, { nodeId: id });
  };
  const apply = () => {
    if (!send(agendaReply(id, blocks))) return;
    setSt((s) => ({ ...s, sent: true, sentBlocks: blocks }));
    setEditing(false);
    setSelected(null);
  };
  const toggleEdit = () => {
    haptic('selection');
    setEditing((e) => !e);
    setPreview(null);
  };

  const title = node.title || tr('ui.agenda.defaultTitle');
  const subtitle = (() => {
    const parts: string[] = [];
    if (date) {
      const [y, m, d] = date.split('-').map(Number);
      parts.push(formatDate(new Date(y, m - 1, d), { weekday: 'long', day: 'numeric', month: 'long' }));
    }
    parts.push(tr('ui.agenda.blocks', { count: blocks.length }));
    return parts.join(' · ');
  })();

  const height = (range.endH - range.startH) * HOUR_PX;
  const colW = Math.max(0, trackW);
  const onTrackLayout = (e: LayoutChangeEvent) => setTrackW(Math.round(e.nativeEvent.layout.width));
  const hours: number[] = [];
  for (let h = range.startH; h <= range.endH; h++) hours.push(h);

  return (
    <Surface>
      <View style={{ gap: t.spacing.m }}>
        {/* header */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.m }}>
          <View style={{ flex: 1, gap: 2 }}>
            <InlineText variant="headline" text={title} accessibilityRole="header" />
            <HText variant="caption" color="muted">
              {subtitle}
            </HText>
          </View>
          {editable && !st.sent && blocks.length + nodeBlocks.length > 0 ? (
            <Btn label={isEditing ? tr('ui.agenda.done') : tr('ui.agenda.edit')} kind={isEditing ? 'primary' : 'secondary'} compact onPress={toggleEdit} icon={isEditing ? 'check' : undefined} />
          ) : null}
        </View>
        {isEditing ? (
          <HText variant="caption" color="subtle">
            {tr('ui.agenda.editHint')}
          </HText>
        ) : null}

        {/* timeline */}
        {blocks.length ? (
          <View style={{ flexDirection: 'row', height: height + 10, paddingTop: 6 }}>
            <View style={{ width: RULER_W }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {hours.map((h) => (
                <HText key={h} variant="micro" color="subtle" tabular numberOfLines={1} style={{ position: 'absolute', top: (h - range.startH) * HOUR_PX - 7, left: 0, width: RULER_W - 8, textAlign: 'right' }}>
                  {formatHourLabel(h, locale, lang)}
                </HText>
              ))}
            </View>
            <View style={{ flex: 1, height }} onLayout={onTrackLayout}>
              {hours.map((h) => (
                <View key={h} pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: (h - range.startH) * HOUR_PX, height: 1, backgroundColor: t.colors.border }} />
              ))}
              {hours.slice(0, -1).map((h) => (
                <View key={`h${h}`} pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: (h - range.startH) * HOUR_PX + HOUR_PX / 2, height: 1, backgroundColor: t.colors.border, opacity: 0.45 }} />
              ))}
              {colW > 0
                ? blocks.map((b) => {
                    const l = layout[b.id] ?? { col: 0, cols: 1 };
                    const w = colW / l.cols;
                    const pv = preview && preview.id === b.id ? preview : null;
                    return (
                      <BlockView
                        key={b.id}
                        t={t}
                        block={b}
                        top={((b.start - lo) / 60) * HOUR_PX}
                        height={((b.end - b.start) / 60) * HOUR_PX}
                        left={l.col * w}
                        width={w - GAP}
                        color={colorOf(b.kind)}
                        selected={selected === b.id}
                        editing={isEditing}
                        timeText={`${fmt(pv ? pv.start : b.start)}–${fmt(pv ? pv.end : b.end)}`}
                        a11yLabel={`${b.title}, ${tr('ui.agenda.a11yRange', { start: fmt(b.start), end: fmt(b.end) })}, ${kindLabel(b.kind)}${b.location ? `, ${b.location}` : ''}`}
                        a11yHint={isEditing && selected === b.id ? tr('ui.agenda.a11yMoveHint') : tr('ui.agenda.a11ySelectHint')}
                        laterLabel={tr('ui.agenda.later')}
                        earlierLabel={tr('ui.agenda.earlier')}
                        minStep={Math.ceil((lo - b.start) / SNAP_MIN)}
                        maxStep={Math.floor((hi - b.end) / SNAP_MIN)}
                        minResizeStep={Math.ceil((b.start + MIN_DURATION - b.end) / SNAP_MIN)}
                        maxResizeStep={Math.floor((hi - b.end) / SNAP_MIN)}
                        onSelect={() => {
                          haptic('selection');
                          setSelected((s) => (s === b.id ? null : b.id));
                        }}
                        onPreview={(ds, de) => {
                          haptic('selection');
                          setPreview({ id: b.id, start: b.start + ds, end: b.end + de });
                        }}
                        onMove={(d) => {
                          setPreview(null);
                          move(b.id, d);
                        }}
                        onResize={(d) => {
                          setPreview(null);
                          resize(b.id, d);
                        }}
                      />
                    );
                  })
                : null}
              {nowMin != null && nowMin >= lo && nowMin <= hi ? (
                <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', left: -4, right: 0, top: ((nowMin - lo) / 60) * HOUR_PX - 1, height: 2, backgroundColor: t.colors.danger, zIndex: 5 }}>
                  <View style={{ position: 'absolute', left: -1, top: -3, width: 8, height: 8, borderRadius: 4, backgroundColor: t.colors.danger }} />
                </View>
              ) : null}
            </View>
          </View>
        ) : (
          <HText variant="callout" color="muted" style={{ paddingVertical: t.spacing.m, textAlign: 'center' }}>
            {tr('ui.agenda.empty')}
          </HText>
        )}
        {streaming ? <SkeletonLines lines={2} /> : null}

        {/* selected block details */}
        {sel ? (
          <BlockPanel
            t={t}
            block={sel}
            color={colorOf(sel.kind)}
            kindLabel={kindLabel(sel.kind)}
            fmt={fmt}
            durText={durText(sel.end - sel.start)}
            editing={isEditing}
            canEarlier={sel.start > (isEditing ? lo : 0)}
            canLater={sel.end < (isEditing ? hi : DAY_MIN)}
            canShorter={sel.end - sel.start > MIN_DURATION}
            canLonger={sel.end < (isEditing ? hi : DAY_MIN)}
            onMove={(d) => {
              haptic('selection');
              move(sel.id, d);
            }}
            onResize={(d) => {
              haptic('selection');
              resize(sel.id, d);
            }}
            onDelete={() => remove(sel)}
            onCalendar={() => toCalendar(sel)}
            onClose={() => setSelected(null)}
          />
        ) : null}

        {deleted ? (
          <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, paddingLeft: t.spacing.m, minHeight: 44, borderRadius: t.radii.control, backgroundColor: t.colors.surfaceAlt }}>
            <HText variant="callout" style={{ flex: 1 }} numberOfLines={1}>
              {tr('ui.agenda.deleted', { title: deleted.title })}
            </HText>
            <PressableScale haptic="selection" onPress={undoDelete} accessibilityLabel={tr('ui.common.undo')} style={{ height: 44, paddingHorizontal: t.spacing.l, justifyContent: 'center' }}>
              <HText variant="callout" weight="600" color="accent">
                {tr('ui.common.undo')}
              </HText>
            </PressableScale>
          </View>
        ) : null}

        {/* actions */}
        {st.sent ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, flexWrap: 'wrap' }} accessibilityLiveRegion="polite">
            <Icon name="checkCircle" size={18} color={t.colors.success} strokeWidth={2} />
            <HText variant="callout" style={{ color: t.colors.success, flex: 1 }}>
              {tr('ui.agenda.sent')}
            </HText>
            {editable ? (
              <Button label={tr('ui.agenda.editAgain')} variant="tertiary" size="small" onPress={() => { setSt((s) => ({ ...s, sent: false })); setEditing(true); }} />
            ) : null}
          </View>
        ) : null}
        {!streaming ? (
          <View style={{ gap: t.spacing.s }}>
            {isEditing ? <Btn label={tr('ui.agenda.add')} kind="ghost" icon="plus" onPress={() => setAdding(true)} style={{ alignSelf: 'flex-start' }} /> : null}
            {changed && !st.sent && blocks.length && editable ? (
              <Btn label={tr('ui.agenda.apply')} kind="primary" icon="send" onPress={apply} accessibilityHint={tr('ui.agenda.applyHint')} />
            ) : null}
            {blocks.length ? (
              <View style={{ flexDirection: 'row', gap: t.spacing.s, flexWrap: 'wrap' }}>
                <Btn label={tr('ui.agenda.allToCalendar')} icon="calendar" onPress={allToCalendar} style={{ flexGrow: 1 }} />
                {isEditing && st.blocks && !samePlan(st.blocks, nodeBlocks) ? (
                  <Btn
                    label={tr('ui.agenda.reset')}
                    kind="ghost"
                    onPress={() => {
                      haptic('selection');
                      setSt((s) => ({ ...s, blocks: undefined, sent: false }));
                      setSelected(null);
                    }}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {adding ? (
        <AddSheet
          t={t}
          initialStart={suggestNewStart(blocks)}
          fmt={fmt}
          durText={durText}
          kindLabel={kindLabel}
          onClose={() => setAdding(false)}
          onAdd={(b) => {
            haptic('success');
            update((list) => [...list, b].slice(0, 30));
            setSelected(b.id);
            setAdding(false);
          }}
        />
      ) : null}
    </Surface>
  );
}

/* ───────────── block ───────────── */

type BlockViewProps = {
  t: Theme;
  block: AgendaBlock;
  top: number;
  height: number;
  left: number;
  width: number;
  color: string;
  selected: boolean;
  editing: boolean;
  timeText: string;
  a11yLabel: string;
  a11yHint: string;
  laterLabel: string;
  earlierLabel: string;
  minStep: number;
  maxStep: number;
  minResizeStep: number;
  maxResizeStep: number;
  onSelect: () => void;
  onPreview: (dStart: number, dEnd: number) => void;
  onMove: (deltaMin: number) => void;
  onResize: (deltaMin: number) => void;
};

function BlockView(p: BlockViewProps) {
  const { t, block, top, height, left, width, color, selected, editing } = p;
  const baseTop = useSharedValue(top);
  const baseH = useSharedValue(height);
  const dy = useSharedValue(0);
  const dh = useSharedValue(0);
  const step = useSharedValue(0);
  const lifted = useSharedValue(0);
  // new geometry from React (after a commit) → reset the drag offsets in the same frame
  useLayoutEffect(() => {
    baseTop.value = top;
    baseH.value = height;
    dy.value = 0;
    dh.value = 0;
  }, [top, height, baseTop, baseH, dy, dh]);

  const draggable = editing && selected;
  const { minStep, maxStep, minResizeStep, maxResizeStep, onPreview, onMove, onResize, onSelect } = p;
  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(draggable)
      .activeOffsetY([-6, 6])
      .failOffsetX([-24, 24])
      .onStart(() => {
        step.value = 0;
        lifted.value = withTiming(1, { duration: 120 });
      })
      .onUpdate((e) => {
        const s = Math.max(minStep, Math.min(maxStep, Math.round(e.translationY / SNAP_PX)));
        dy.value = Math.max(minStep * SNAP_PX, Math.min(maxStep * SNAP_PX, e.translationY));
        if (s !== step.value) {
          step.value = s;
          runOnJS(onPreview)(s * SNAP_MIN, s * SNAP_MIN);
        }
      })
      .onEnd(() => {
        dy.value = withTiming(step.value * SNAP_PX, { duration: 90 });
        runOnJS(onMove)(step.value * SNAP_MIN);
      })
      .onFinalize(() => {
        lifted.value = withTiming(0, { duration: 160 });
      });
    return pan;
  }, [draggable, minStep, maxStep, onPreview, onMove, dy, step, lifted]);

  const handle = useMemo(
    () =>
      Gesture.Pan()
        .enabled(draggable)
        .activeOffsetY([-4, 4])
        .onStart(() => {
          step.value = 0;
        })
        .onUpdate((e) => {
          const s = Math.max(minResizeStep, Math.min(maxResizeStep, Math.round(e.translationY / SNAP_PX)));
          dh.value = Math.max(minResizeStep * SNAP_PX, Math.min(maxResizeStep * SNAP_PX, e.translationY));
          if (s !== step.value) {
            step.value = s;
            runOnJS(onPreview)(0, s * SNAP_MIN);
          }
        })
        .onEnd(() => {
          dh.value = withTiming(step.value * SNAP_PX, { duration: 90 });
          runOnJS(onResize)(step.value * SNAP_MIN);
        }),
    [draggable, minResizeStep, maxResizeStep, onPreview, onResize, dh, step],
  );

  const anim = useAnimatedStyle(() => ({
    top: baseTop.value + dy.value,
    height: Math.max(SNAP_PX - 1, baseH.value + dh.value - 2),
    zIndex: lifted.value > 0 ? 10 : 1,
    transform: [{ scale: 1 + lifted.value * 0.015 }],
  }));

  // opaque tint (grid lines must not show through the block)
  const a = t.dark ? 0.3 : 0.17;
  const surf = normalizeHex(t.colors.surface);
  const bg = surf && normalizeHex(color) ? mix(surf, color, a) : withAlpha(color, a);
  const compact = height < 34;
  const lines = height >= 70 ? 2 : 1;
  return (
    <Animated.View style={[{ position: 'absolute', left, width: Math.max(0, width) }, anim]}>
      <GestureDetector gesture={gesture}>
        <Pressable
          onPress={onSelect}
          accessible
          accessibilityRole={editing && selected ? 'adjustable' : 'button'}
          accessibilityLabel={p.a11yLabel}
          accessibilityHint={p.a11yHint}
          {...a11yState({ selected }, editing && selected ? 'adjustable' : 'button')}
          accessibilityActions={editing && selected ? [{ name: 'increment', label: p.laterLabel }, { name: 'decrement', label: p.earlierLabel }, { name: 'activate' }] : [{ name: 'activate' }]}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'increment') onMove(SNAP_MIN);
            else if (e.nativeEvent.actionName === 'decrement') onMove(-SNAP_MIN);
            else onSelect();
          }}
          style={{
            flex: 1,
            borderRadius: t.radii.control,
            backgroundColor: bg,
            borderLeftWidth: 3,
            borderLeftColor: color,
            borderWidth: selected ? 1.5 : 0,
            borderColor: color,
            paddingHorizontal: 6,
            paddingVertical: compact ? 0 : 4,
            justifyContent: compact ? 'center' : 'flex-start',
            overflow: 'hidden',
            ...(selected ? t.shadows.md : null),
          }}
        >
          {compact ? (
            <HText variant="micro" weight="600" numberOfLines={1} style={{ color: t.colors.text }}>
              {`${block.title}  `}
              <HText variant="micro" color="muted" tabular>
                {p.timeText}
              </HText>
            </HText>
          ) : (
            <>
              <HText variant="caption" weight="600" numberOfLines={lines} style={{ color: t.colors.text }}>
                {block.title}
              </HText>
              <HText variant="micro" color="muted" tabular numberOfLines={1}>
                {p.timeText}
              </HText>
              {block.location && height >= 56 ? (
                <HText variant="micro" color="muted" numberOfLines={1}>
                  {block.location}
                </HText>
              ) : null}
            </>
          )}
        </Pressable>
      </GestureDetector>
      {draggable ? (
        <GestureDetector gesture={handle}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ position: 'absolute', left: 0, right: 0, bottom: -10, height: 22, alignItems: 'center', justifyContent: 'center' }}
          >
            <View style={{ width: 28, height: 6, borderRadius: 3, backgroundColor: color, borderWidth: 1.5, borderColor: t.colors.surface }} />
          </View>
        </GestureDetector>
      ) : null}
    </Animated.View>
  );
}

/* ───────────── selected block panel ───────────── */

function BlockPanel({
  t,
  block,
  color,
  kindLabel,
  fmt,
  durText,
  editing,
  canEarlier,
  canLater,
  canShorter,
  canLonger,
  onMove,
  onResize,
  onDelete,
  onCalendar,
  onClose,
}: {
  t: Theme;
  block: AgendaBlock;
  color: string;
  kindLabel: string;
  fmt: (m: number) => string;
  durText: string;
  editing: boolean;
  canEarlier: boolean;
  canLater: boolean;
  canShorter: boolean;
  canLonger: boolean;
  onMove: (d: number) => void;
  onResize: (d: number) => void;
  onDelete: () => void;
  onCalendar: () => void;
  onClose: () => void;
}) {
  const tr = useT();
  return (
    <View style={{ gap: t.spacing.m, padding: t.spacing.m, borderRadius: t.radii.control, backgroundColor: t.colors.surfaceAlt }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.s }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color, marginTop: 6 }} />
        <View style={{ flex: 1, gap: 2 }}>
          <HText variant="bodyStrong">{block.title}</HText>
          <HText variant="caption" color="muted" tabular>
            {`${fmt(block.start)}–${fmt(block.end)} · ${durText} · ${kindLabel}`}
          </HText>
          {block.location ? (
            <HText variant="caption" color="muted">
              {block.location}
            </HText>
          ) : null}
          {block.note ? <InlineText variant="caption" text={block.note} /> : null}
        </View>
        <PressableScale haptic="selection" onPress={onClose} accessibilityLabel={tr('ui.agenda.close')} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="x" size={16} color={t.colors.muted} />
        </PressableScale>
      </View>
      {editing ? (
        <View style={{ gap: t.spacing.s }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
            <HText variant="callout" color="muted" style={{ flex: 1 }}>
              {tr('ui.agenda.move')}
            </HText>
            <Stepper value={fmt(block.start)} label={tr('ui.agenda.move')} onDec={() => onMove(-SNAP_MIN)} onInc={() => onMove(SNAP_MIN)} decDisabled={!canEarlier} incDisabled={!canLater} decLabel={tr('ui.agenda.earlier')} incLabel={tr('ui.agenda.later')} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
            <HText variant="callout" color="muted" style={{ flex: 1 }}>
              {tr('ui.agenda.end')}
            </HText>
            <Stepper value={fmt(block.end)} label={tr('ui.agenda.end')} onDec={() => onResize(-SNAP_MIN)} onInc={() => onResize(SNAP_MIN)} decDisabled={!canShorter} incDisabled={!canLonger} decLabel={tr('ui.agenda.shorter')} incLabel={tr('ui.agenda.longer')} />
          </View>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: t.spacing.s, flexWrap: 'wrap' }}>
        <Btn label={tr('ui.agenda.toCalendar')} icon="calendar" compact onPress={onCalendar} style={{ flexGrow: 1 }} />
        {editing ? (
          <Button label={tr('ui.agenda.delete')} variant="secondary" tone="seal" size="small" onPress={onDelete} />
        ) : null}
      </View>
    </View>
  );
}

/* ───────────── add sheet ───────────── */

const DURATIONS = [15, 30, 45, 60, 90, 120];

function AddSheet({
  t,
  initialStart,
  fmt,
  durText,
  kindLabel,
  onClose,
  onAdd,
}: {
  t: Theme;
  initialStart: number;
  fmt: (m: number) => string;
  durText: (m: number) => string;
  kindLabel: (k?: HuiAgendaKind) => string;
  onClose: () => void;
  onAdd: (b: AgendaBlock) => void;
}) {
  const tr = useT();
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [start, setStart] = useState(initialStart);
  const [dur, setDur] = useState(60);
  const [kind, setKind] = useState<HuiAgendaKind | 'other'>('work');
  const seq = useRef(0);
  const end = Math.min(DAY_MIN, start + dur);
  const ok = title.trim().length > 0 && end > start;
  const input = { ...textStyle(t, 'body'), color: t.colors.text, backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.control, paddingHorizontal: t.spacing.m, minHeight: 44 };
  const save = () => {
    if (!ok) return;
    seq.current += 1;
    onAdd({ id: `u${Date.now().toString(36)}${seq.current}`, start, end, title: title.trim().slice(0, 200), location: location.trim() || undefined, kind: kind === 'other' ? undefined : kind });
  };
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: t.colors.overlay }} onPress={onClose} accessibilityRole="button" accessibilityLabel={tr('ui.agenda.cancel')} />
        <View style={{ backgroundColor: t.colors.surface, borderTopLeftRadius: t.radii.card, borderTopRightRadius: t.radii.card, maxHeight: '88%', paddingBottom: insets.bottom + t.spacing.m, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
          <View style={{ alignItems: 'center', paddingTop: t.spacing.s }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: t.colors.borderStrong }} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: t.spacing.l, gap: t.spacing.l }}>
            <HText variant="title" accessibilityRole="header">
              {tr('ui.agenda.addTitle')}
            </HText>
            <View style={{ gap: 6 }}>
              <HText variant="caption" color="muted">
                {tr('ui.agenda.titleLabel')}
              </HText>
              <TextInput value={title} onChangeText={setTitle} placeholder={tr('ui.agenda.titlePlaceholder')} placeholderTextColor={t.colors.subtle} style={input} autoFocus returnKeyType="done" onSubmitEditing={save} accessibilityLabel={tr('ui.agenda.titleLabel')} maxLength={200} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.m }}>
              <HText variant="callout" color="muted" style={{ flex: 1 }}>
                {tr('ui.agenda.start')}
              </HText>
              <Stepper
                value={fmt(start)}
                label={tr('ui.agenda.start')}
                onDec={() => setStart((s) => Math.max(0, s - SNAP_MIN))}
                onInc={() => setStart((s) => Math.min(DAY_MIN - MIN_DURATION, s + SNAP_MIN))}
                decDisabled={start <= 0}
                incDisabled={start >= DAY_MIN - MIN_DURATION}
                decLabel={tr('ui.agenda.earlier')}
                incLabel={tr('ui.agenda.later')}
              />
            </View>
            <View style={{ gap: 6 }}>
              <HText variant="caption" color="muted">
                {`${tr('ui.agenda.duration')} · ${fmt(start)}–${fmt(end)}`}
              </HText>
              <Chips options={DURATIONS.map((d) => ({ label: durText(d), value: d }))} value={dur} onChange={setDur} label={tr('ui.agenda.duration')} />
            </View>
            <View style={{ gap: 6 }}>
              <HText variant="caption" color="muted">
                {tr('ui.agenda.kind')}
              </HText>
              <Chips options={[...KIND_ORDER, 'other' as const].map((k) => ({ label: kindLabel(k === 'other' ? undefined : k), value: k }))} value={kind} onChange={setKind} label={tr('ui.agenda.kind')} />
            </View>
            <View style={{ gap: 6 }}>
              <HText variant="caption" color="muted">
                {tr('ui.agenda.locationLabel')}
              </HText>
              <TextInput value={location} onChangeText={setLocation} placeholder={tr('ui.agenda.locationPlaceholder')} placeholderTextColor={t.colors.subtle} style={input} accessibilityLabel={tr('ui.agenda.locationLabel')} maxLength={200} />
            </View>
            <View style={{ flexDirection: 'row', gap: t.spacing.s }}>
              <Btn label={tr('ui.agenda.cancel')} onPress={onClose} style={{ flex: 1 }} />
              <Btn label={tr('ui.agenda.save')} kind="primary" icon="plus" onPress={save} disabled={!ok} style={{ flex: 1 }} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function AgendaSkeleton() {
  const t = useTheme();
  return (
    <Surface>
      <View style={{ gap: t.spacing.m }}>
        <Skeleton width="45%" height={16} />
        <View style={{ flexDirection: 'row', gap: t.spacing.s }}>
          <View style={{ width: RULER_W - 8, gap: 40 }}>
            <Skeleton width={24} height={10} />
            <Skeleton width={24} height={10} />
            <Skeleton width={24} height={10} />
          </View>
          <View style={{ flex: 1, gap: t.spacing.s }}>
            <Skeleton height={52} radius={t.radii.control} />
            <Skeleton height={30} radius={t.radii.control} width="70%" />
            <Skeleton height={64} radius={t.radii.control} />
          </View>
        </View>
      </View>
    </Surface>
  );
}
