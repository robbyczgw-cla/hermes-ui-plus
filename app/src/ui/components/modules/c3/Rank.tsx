/**
 * `rank` – reorder items (docs/SPEC-modules-v3.md). Long-press + drag (gesture-handler, haptic tick
 * per slot, auto-scroll near the screen edges) and up/down buttons + a11y actions that always work.
 * "Reihenfolge senden" → `[rank:<id>] 1. A · 2. B · 3. C`; locked afterwards (persisted), with
 * "Neu beantworten".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useTheme, useMotionReduced, type Theme } from '../../../theme';
import { useHui } from '../../../primitives/context';
import { BlockTitle, HText, InlineText, PressableScale, Surface } from '../../../primitives/basics';
import { Skeleton } from '../../../primitives/Skeleton';
import { haptic } from '../../../primitives/haptics';
import { useNodeState } from '../../../../nodestate';
import { useT } from '../../../../i18n';
import type { HuiRank } from '../../../types';
import { AnsweredSummary, PrimaryButton, useModuleId, useSend } from '../a/shared';
import { dragTargetIndex, moveItem, normalizeRankItems, previewTops, rankReply, reconcileOrder, rowTops, stepItem, type RankItem } from './rankModel.ts';
import { C3Icon, C3Skeleton, useDragScroll } from './parts';

type RankState = { status: 'open' | 'answered'; order?: string[]; labels?: string[] };
const INITIAL: RankState = { status: 'open' };

const GAP = 8;
const EST_H = 56;
const EASE = Easing.out(Easing.cubic);
/** auto-scroll zones (px from the window edges: header / composer) and max speed (px per frame) */
const EDGE_TOP = 120;
const EDGE_BOTTOM = 150;
const MAX_SPEED = 14;

type Drag = { key: string; from: number; to: number };

export function Rank({ node }: { node: Partial<HuiRank> }) {
  const t = useTheme();
  const tr = useT();
  const { streaming } = useHui();
  const id = useModuleId('rank', node as Record<string, unknown>);
  const items = useMemo(() => normalizeRankItems(node.items), [node.items]);
  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items]);
  const keys = useMemo(() => items.map((i) => i.key), [items]);
  const [st, setSt] = useNodeState<RankState>(id, INITIAL);
  const order = useMemo(() => reconcileOrder(st.order, keys), [st.order, keys]);
  const send = useSend(id);
  const prompt = typeof node.prompt === 'string' ? node.prompt.trim() : '';

  if (!items.length && !prompt) return streaming ? <C3Skeleton rows={3} rowHeight={EST_H} /> : null;

  if (st.status === 'answered') {
    const labels = st.labels ?? order.map((k) => byKey.get(k)?.label ?? k);
    return (
      <Surface>
        <AnsweredSummary
          title={prompt || undefined}
          answer={labels.map((l, i) => `${i + 1}. ${l}`).join('\n')}
          onReopen={() => {
            haptic('selection');
            setSt((s) => ({ ...s, status: 'open' }));
          }}
        />
      </Surface>
    );
  }

  const setOrder = (next: string[]) => setSt((s) => ({ ...s, order: next }));
  const submit = () => {
    const labels = order.map((k) => byKey.get(k)?.label ?? k);
    if (!send(rankReply(id, labels))) return;
    setSt({ status: 'answered', order, labels });
  };
  const changed = order.some((k, i) => k !== keys[i]);
  const canSend = !streaming && items.length >= 2;

  return (
    <Surface style={{ gap: t.spacing.m }}>
      {prompt ? <BlockTitle title={prompt} /> : null}
      <HText variant="caption" color="muted" style={{ marginTop: prompt ? -t.spacing.s : 0 }}>
        {tr('ui.rank.hint')}
      </HText>
      <RankList t={t} order={order} byKey={byKey} disabled={streaming} onOrder={setOrder} />
      {streaming ? <Skeleton height={EST_H} radius={t.radii.m} /> : null}
      <View style={{ gap: t.spacing.xs }}>
        <PrimaryButton label={(typeof node.submitLabel === 'string' && node.submitLabel.trim()) || tr('ui.rank.submit')} icon="send" onPress={submit} disabled={!canSend} />
        {changed && !streaming ? (
          <PressableScale haptic="selection" onPress={() => setOrder(keys)} accessibilityRole="button" style={{ alignSelf: 'center', minHeight: 36, paddingHorizontal: t.spacing.m, justifyContent: 'center' }}>
            <HText variant="caption" color="accent" weight="500">
              {tr('ui.rank.reset')}
            </HText>
          </PressableScale>
        ) : null}
      </View>
    </Surface>
  );
}

/* ───────────── list with drag ───────────── */

function RankList({ t, order: propOrder, byKey, disabled, onOrder }: { t: Theme; order: string[]; byKey: Map<string, RankItem>; disabled: boolean; onOrder: (o: string[]) => void }) {
  const tr = useT();
  // a drop commits locally first (same render as ending the drag → no jump), then persists
  const [pending, setPending] = useState<string[] | null>(null);
  const order = pending ?? propOrder;
  useEffect(() => {
    if (!pending) return;
    if (pending.length === propOrder.length && pending.every((k, i) => k === propOrder[i])) setPending(null);
    else onOrder(pending);
  }, [pending, propOrder, onOrder]);
  const anchor = useRef<View>(null);
  const scrollBy = useDragScroll(anchor);
  const { height: winH } = useWindowDimensions();
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [drag, setDrag] = useState<Drag | null>(null);
  const [settle, setSettle] = useState<{ key: string; n: number }>({ key: '', n: 0 });
  const dragY = useSharedValue(0);
  const activeKey = useSharedValue<string | null>(null);

  const measured = order.every((k) => heights[k] > 0);
  const hs = order.map((k) => heights[k] ?? EST_H);
  const rest = rowTops(hs, GAP);
  const preview = drag ? previewTops(hs, GAP, drag.from, drag.to) : rest;
  const total = hs.reduce((a, h) => a + h, 0) + Math.max(0, hs.length - 1) * GAP;

  // live values for the gesture callbacks (they are created per render, but a running gesture keeps
  // the callbacks of the render it started in)
  const live = useRef({ order, hs, rest, total, drag, winH });
  live.current = { order, hs, rest, total, drag, winH };
  const g = useRef({ transY: 0, scroll: 0, absY: 0, raf: 0 as number | ReturnType<typeof setTimeout>, to: 0 });

  const onLayoutRow = useCallback((key: string, h: number) => {
    setHeights((cur) => (Math.abs((cur[key] ?? 0) - h) < 0.5 ? cur : { ...cur, [key]: h }));
  }, []);

  const applyDrag = useCallback(() => {
    const L = live.current;
    const d = L.drag;
    if (!d) return;
    const start = L.rest[d.from] ?? 0;
    const lo = -start;
    const hi = L.total - (L.hs[d.from] ?? 0) - start;
    const dy = Math.max(lo, Math.min(hi, g.current.transY + g.current.scroll));
    dragY.value = dy;
    const to = dragTargetIndex(L.hs, GAP, d.from, dy);
    if (to !== g.current.to) {
      g.current.to = to;
      haptic('selection');
      setDrag((cur) => (cur ? { ...cur, to } : cur));
    }
  }, [dragY]);

  const stopLoop = () => {
    const r = g.current.raf;
    if (r) {
      if (typeof cancelAnimationFrame === 'function' && typeof r === 'number') cancelAnimationFrame(r);
      else clearTimeout(r as ReturnType<typeof setTimeout>);
    }
    g.current.raf = 0;
  };
  const tick = () => {
    const L = live.current;
    const d = L.drag;
    if (!d) return;
    const y = g.current.absY;
    let v = 0;
    if (y < EDGE_TOP) v = -MAX_SPEED * Math.min(1, (EDGE_TOP - y) / EDGE_TOP);
    else if (y > L.winH - EDGE_BOTTOM) v = MAX_SPEED * Math.min(1, (y - (L.winH - EDGE_BOTTOM)) / EDGE_BOTTOM);
    if (v) {
      // don't scroll the chat further than the list can use
      const start = L.rest[d.from] ?? 0;
      const dy = g.current.transY + g.current.scroll;
      const atTop = dy <= -start + 0.5;
      const atBottom = dy >= L.total - (L.hs[d.from] ?? 0) - start - 0.5;
      if ((v < 0 && !atTop) || (v > 0 && !atBottom)) {
        const moved = scrollBy(v);
        if (moved) {
          g.current.scroll += moved;
          applyDrag();
        }
      }
    }
    g.current.raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(tick) : setTimeout(tick, 16);
  };

  const begin = (key: string) => {
    const from = live.current.order.indexOf(key);
    if (from < 0) return;
    g.current = { transY: 0, scroll: 0, absY: g.current.absY, raf: 0, to: from };
    dragY.value = 0;
    activeKey.value = key;
    haptic('medium');
    const d = { key, from, to: from };
    live.current.drag = d;
    setDrag(d);
    stopLoop();
    tick();
  };
  const update = (transY: number, absY: number) => {
    g.current.transY = transY;
    g.current.absY = absY;
    applyDrag();
  };
  const end = () => {
    stopLoop();
    const d = live.current.drag;
    if (!d) return;
    live.current.drag = null;
    const to = g.current.to;
    setDrag(null);
    setSettle((s) => ({ key: d.key, n: s.n + 1 }));
    if (to !== d.from) {
      haptic('light');
      setPending(moveItem(live.current.order, d.from, to));
    }
  };
  useEffect(() => () => stopLoop(), []);

  const step = (index: number, dir: -1 | 1) => {
    const next = stepItem(order, index, dir);
    if (next === order || next.every((k, i) => k === order[i])) return;
    haptic('selection');
    onOrder(next);
    const key = order[index];
    AccessibilityInfo.announceForAccessibility(tr('ui.rank.moved', { label: byKey.get(key)?.label ?? key, n: index + dir + 1 }));
  };

  // number badges follow the live preview while dragging
  const shownOrder = drag ? moveItem(order, drag.from, drag.to) : order;
  return (
    <View ref={anchor} style={measured ? { height: total } : { gap: GAP }}>
      {order.map((key, i) => {
        const item = byKey.get(key);
        if (!item) return null;
        const isDragged = drag?.key === key;
        return (
          <RankRow
            key={key}
            t={t}
            item={item}
            index={i}
            position={shownOrder.indexOf(key)}
            count={order.length}
            absolute={measured}
            // the dragged row rests at its start slot (offset by dragY); the others open the gap
            top={isDragged ? rest[i] : preview[i]}
            dragging={isDragged}
            settleN={settle.key === key ? settle.n : 0}
            dragY={dragY}
            activeKey={activeKey}
            disabled={disabled}
            onLayoutRow={onLayoutRow}
            onStep={step}
            onBegin={begin}
            onUpdate={update}
            onEnd={end}
          />
        );
      })}
    </View>
  );
}

function RankRow({
  t,
  item,
  index,
  position,
  count,
  absolute,
  top,
  dragging,
  settleN,
  dragY,
  activeKey,
  disabled,
  onLayoutRow,
  onStep,
  onBegin,
  onUpdate,
  onEnd,
}: {
  t: Theme;
  item: RankItem;
  index: number;
  /** displayed position (live preview while dragging) */
  position: number;
  count: number;
  absolute: boolean;
  top: number;
  dragging: boolean;
  settleN: number;
  dragY: SharedValue<number>;
  activeKey: SharedValue<string | null>;
  disabled: boolean;
  onLayoutRow: (key: string, h: number) => void;
  onStep: (index: number, dir: -1 | 1) => void;
  onBegin: (key: string) => void;
  onUpdate: (transY: number, absY: number) => void;
  onEnd: () => void;
}) {
  const tr = useT();
  const reduced = useMotionReduced();
  const key = item.key;
  const y = useSharedValue(top);
  const lastSettle = useRef(settleN);

  useEffect(() => {
    if (settleN !== lastSettle.current) {
      lastSettle.current = settleN;
      // dropped: continue from where the finger left the row, then glide into the slot
      y.value = y.value + dragY.value;
      dragY.value = 0;
      activeKey.value = null;
    }
    y.value = reduced ? top : withTiming(top, { duration: 220, easing: EASE });
  }, [top, settleN, reduced, y, dragY, activeKey]);

  const anim = useAnimatedStyle(() => {
    const on = activeKey.value === key;
    return { transform: [{ translateY: on ? y.value + dragY.value : y.value }], zIndex: on ? 10 : 1 };
  });

  const gesture = Gesture.Pan()
    .runOnJS(true)
    .enabled(!disabled && count > 1)
    .activateAfterLongPress(260)
    .onStart((e) => {
      onBegin(key);
      onUpdate(e.translationY, e.absoluteY);
    })
    .onUpdate((e) => onUpdate(e.translationY, e.absoluteY))
    .onFinalize(() => onEnd());

  const label = item.label;
  const a11yLabel = tr('ui.rank.rowA11y', { n: index + 1, total: count, label }) + (item.description ? `. ${item.description}` : '');
  const first = index === 0;
  const last = index === count - 1;

  return (
    <Animated.View
      onLayout={(e: LayoutChangeEvent) => onLayoutRow(key, e.nativeEvent.layout.height)}
      style={[absolute ? { position: 'absolute', left: 0, right: 0, top: 0 } : null, absolute ? anim : null]}
    >
      <GestureDetector gesture={gesture}>
        <View
          accessible
          accessibilityLabel={a11yLabel}
          accessibilityHint={tr('ui.rank.dragHint')}
          accessibilityActions={[
            ...(first ? [] : [{ name: 'moveUp', label: tr('ui.rank.up') }]),
            ...(last ? [] : [{ name: 'moveDown', label: tr('ui.rank.down') }]),
          ]}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'moveUp') onStep(index, -1);
            if (e.nativeEvent.actionName === 'moveDown') onStep(index, 1);
          }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: t.spacing.s,
            minHeight: 52,
            paddingLeft: t.spacing.s + 2,
            paddingRight: 4,
            paddingVertical: 6,
            borderRadius: t.radii.m,
            borderWidth: dragging ? 1.5 : 1,
            borderColor: dragging ? t.colors.accent : t.colors.border,
            backgroundColor: dragging ? t.colors.surface : t.colors.surface,
            ...(dragging ? t.shadows.lg : null),
            transform: dragging && !reduced ? [{ scale: 1.02 }] : undefined,
          }}
        >
          <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: position === 0 ? t.colors.accent : t.colors.accentSoft }}>
            <HText variant="caption" weight="700" tabular style={{ color: position === 0 ? t.colors.onAccent : t.colors.accent }}>
              {String(position + 1)}
            </HText>
          </View>
          <C3Icon name="grip" size={16} color={dragging ? t.colors.accent : t.colors.subtle} />
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <InlineText variant="callout" weight="500" text={label} />
            {item.description ? <InlineText variant="caption" color="muted" text={item.description} numberOfLines={2} /> : null}
          </View>
          <StepBtn t={t} dir="up" label={tr('ui.rank.moveUp', { label })} disabled={disabled || first} onPress={() => onStep(index, -1)} />
          <StepBtn t={t} dir="down" label={tr('ui.rank.moveDown', { label })} disabled={disabled || last} onPress={() => onStep(index, 1)} />
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

function StepBtn({ t, dir, label, disabled, onPress }: { t: Theme; dir: 'up' | 'down'; label: string; disabled: boolean; onPress: () => void }) {
  return (
    <PressableScale
      haptic={false}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
      style={{ width: 36, height: 40, borderRadius: t.radii.s, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.3 : 1 }}
      pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
    >
      <C3Icon name={dir} size={20} color={t.colors.text} strokeWidth={2.1} />
    </PressableScale>
  );
}
