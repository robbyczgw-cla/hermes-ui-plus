/**
 * `mindmap` (docs/SPEC-modules-v4.md): SVG edges + native label boxes in a pannable / pinch-zoomable
 * canvas (gesture-handler + reanimated, UI thread; web: drag + Ctrl/⌘-wheel or trackpad pinch),
 * per-node collapse/expand, zoom buttons + fit-to-screen. The layout (two-sided or one-sided tree,
 * whichever reads larger in the viewport) is a pure function (mindmapModel.ts). Tap a node → sheet
 * with its note + "Vertiefen" (`[mindmap] Erkläre „<label>“ genauer`). Outline view as fallback;
 * it is the default while a screen reader runs. No clipPath (RN-svg on Android) – only paths.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useT } from '../../../../i18n';
import { useMotionReduced, useTheme, type Theme } from '../../../theme';
import { withAlpha } from '../../../color';
import { useHui } from '../../../primitives/context';
import { HText, InlineText, PressableScale, Surface } from '../../../primitives/basics';
import { Icon } from '../../../primitives/Icon';
import { haptic } from '../../../primitives/haptics';
import { useNodeState } from '../../../../nodestate';
import { MindmapSkeleton } from '../../../skeletons';
import type { HuiMindmap } from '../../../types';
import { PrimaryButton, SecondaryButton, useModuleId, useSend } from '../a/shared';
import { D3Icon, useScreenReader, type D3IconName } from './icons';
import {
  MAX_SCALE,
  MIN_SCALE,
  deepenReply,
  findNode,
  fitView,
  hiddenCount,
  isCollapsed,
  layoutMindmap,
  outlineRows,
  pickLayout,
  readMindmap,
  viewportHeight,
  zoomAt,
  type BoxMetrics,
  type Collapse,
  type LaidNode,
  type Layout,
  type MindNode,
  type View as Vp,
} from './mindmapModel.ts';
import { useKeyboardHints } from '../../../lib/useKeyboardHints';

type MindState = { c: Collapse; view?: 'map' | 'outline' };
const INITIAL: MindState = { c: {} };
const MIN_H = 220;
const MAX_H = 440;
const TOOLBAR_W = 44;

/** Branch colour from the theme's categorical palette (root / >8 branches: accent / muted). */
export function branchColor(t: Theme, branch: number): string {
  if (branch < 0) return t.colors.accent;
  return t.colors.chart[branch % t.colors.chart.length] ?? t.colors.muted;
}

function useMetrics(t: Theme): (depth: number) => BoxMetrics {
  return useMemo(() => {
    const ty = t.typography;
    const m0: BoxMetrics = { fontSize: ty.headline.fontSize, lineHeight: ty.headline.lineHeight, maxChars: 18, maxLines: 3, padX: 14, padY: 9, minW: 72, charW: 0.7 };
    const m1: BoxMetrics = { fontSize: ty.callout.fontSize, lineHeight: ty.callout.lineHeight, maxChars: 18, maxLines: 2, padX: 12, padY: 7, minW: 56, charW: 0.7 };
    const m2: BoxMetrics = { fontSize: ty.caption.fontSize, lineHeight: ty.caption.lineHeight, maxChars: 20, maxLines: 2, padX: 10, padY: 5, minW: 44 };
    return (d: number) => (d === 0 ? m0 : d === 1 ? m1 : m2);
  }, [t]);
}

export function Mindmap({ node }: { node: Partial<HuiMindmap> }) {
  const tr = useT();
  const keyboardHints = useKeyboardHints(); // mouse/keyboard hint only on desktop web, never the phone layout
  const t = useTheme();
  const { streaming } = useHui();
  const id = useModuleId('mindmap', node as Record<string, unknown>);
  const { title, root, count } = useMemo(() => readMindmap(node as Record<string, unknown>), [node]);
  const [st, setSt] = useNodeState<MindState>(id, INITIAL);
  const screenReader = useScreenReader();
  const view = st.view ?? (screenReader ? 'outline' : 'map');
  const [sheet, setSheet] = useState<string | null>(null);
  const [vw, setVw] = useState(0);
  const metrics = useMetrics(t);
  const send = useSend(id);

  const collapsed = useCallback((n: MindNode) => isCollapsed(n, st.c, count), [st.c, count]);
  const layouts = useMemo(() => {
    if (!root) return null;
    const base = { metrics, hGap: 26, vGap: 10, margin: 14, collapsed };
    return [layoutMindmap(root, { ...base, mode: 'balanced' }), layoutMindmap(root, { ...base, mode: 'right' })];
  }, [root, metrics, collapsed]);

  if (!root || !layouts) return streaming ? <MindmapSkeleton /> : null;

  const layout = vw ? pickLayout(layouts, vw - TOOLBAR_W, MAX_H) : layouts[0];
  const vh = vw ? viewportHeight(layout, vw - TOOLBAR_W, MIN_H, MAX_H) : MIN_H;
  const toggle = (nid: string) => {
    const n = findNode(root, nid);
    if (!n || !n.children.length) return;
    haptic('selection');
    const now = isCollapsed(n, st.c, count);
    setSt((s) => ({ ...s, c: { ...s.c, [nid]: !now } }));
  };
  const sheetNode = sheet ? findNode(root, sheet) : null;

  return (
    <Surface style={{ gap: t.spacing.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
        <D3Icon name="mindmap" size={18} color={t.colors.muted} />
        <InlineText variant="headline" text={title || root.label || tr('ui.mindmap.title')} style={{ flex: 1 }} numberOfLines={2} accessibilityRole="header" />
        <ViewSwitch t={t} value={view} onChange={(v) => setSt((s) => ({ ...s, view: v }))} />
      </View>
      {view === 'outline' ? (
        <Outline t={t} root={root} collapsed={collapsed} onOpen={setSheet} onToggle={toggle} />
      ) : (
        <View onLayout={(e: LayoutChangeEvent) => setVw(Math.round(e.nativeEvent.layout.width))}>
          {vw ? <Canvas t={t} layout={layout} vw={vw} vh={vh} onOpen={setSheet} onToggle={toggle} /> : <View style={{ height: MIN_H }} />}
          <HText variant="micro" color="subtle" align="center" style={{ marginTop: 6 }}>
            {keyboardHints ? tr('ui.mindmap.hintWeb') : tr('ui.mindmap.hintTouch')}
          </HText>
        </View>
      )}
      {sheetNode ? (
        <NodeSheet
          t={t}
          node={sheetNode}
          parentLabel={sheetNode.depth > 0 ? parentOf(root, sheetNode.id)?.label : undefined}
          collapsed={collapsed(sheetNode)}
          disabled={streaming}
          onToggle={() => toggle(sheetNode.id)}
          onClose={() => setSheet(null)}
          onDeepen={() => {
            if (send(deepenReply(sheetNode.label))) setSheet(null);
          }}
        />
      ) : null}
    </Surface>
  );
}

function parentOf(root: MindNode, id: string): MindNode | null {
  let hit: MindNode | null = null;
  const go = (n: MindNode) => {
    for (const c of n.children) {
      if (c.id === id) hit = n;
      else go(c);
    }
  };
  go(root);
  return hit;
}

/* ───────────── view switch ───────────── */

function ViewSwitch({ t, value, onChange }: { t: Theme; value: 'map' | 'outline'; onChange: (v: 'map' | 'outline') => void }) {
  const tr = useT();
  const opts: { v: 'map' | 'outline'; icon: D3IconName; label: string }[] = [
    { v: 'map', icon: 'mindmap', label: tr('ui.mindmap.viewMap') },
    { v: 'outline', icon: 'outline', label: tr('ui.mindmap.viewOutline') },
  ];
  return (
    <View accessibilityRole="tablist" accessibilityLabel={tr('ui.mindmap.viewA11y')} style={{ flexDirection: 'row', padding: 3, gap: 2, borderRadius: t.radii.pill, backgroundColor: t.colors.surfaceAlt }}>
      {opts.map((o) => {
        const on = o.v === value;
        return (
          <PressableScale
            key={o.v}
            haptic="selection"
            onPress={() => !on && onChange(o.v)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
            hitSlop={4}
            style={{ width: 40, height: 34, borderRadius: t.radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.colors.surface : 'transparent', ...(on ? t.shadows.sm : null) }}
          >
            <D3Icon name={o.icon} size={17} color={on ? t.colors.accent : t.colors.muted} />
          </PressableScale>
        );
      })}
    </View>
  );
}

/* ───────────── canvas ───────────── */

function Canvas({ t, layout, vw, vh, onOpen, onToggle }: { t: Theme; layout: Layout; vw: number; vh: number; onOpen: (id: string) => void; onToggle: (id: string) => void }) {
  const tr = useT();
  const reduced = useMotionReduced();
  const s = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const W = layout.width;
  const H = layout.height;

  const animateTo = useCallback(
    (v: Vp, animate: boolean) => {
      const cfg = { duration: 260 };
      if (animate && !reduced) {
        s.value = withTiming(v.s, cfg);
        tx.value = withTiming(v.tx, cfg);
        ty.value = withTiming(v.ty, cfg);
      } else {
        s.value = v.s;
        tx.value = v.tx;
        ty.value = v.ty;
      }
    },
    [reduced, s, tx, ty],
  );
  // keep the zoom toolbar (right edge) clear when fitting
  const fit = useCallback((animate: boolean) => animateTo(fitView(W, H, vw - TOOLBAR_W, vh), animate), [animateTo, W, H, vw, vh]);

  // (re)fit when the visible tree or the viewport changes (first time without animation)
  const first = useRef(true);
  useEffect(() => {
    fit(!first.current);
    first.current = false;
  }, [fit]);

  const zoom = (factor: number) => {
    haptic('selection');
    animateTo(zoomAt({ s: s.value, tx: tx.value, ty: ty.value }, factor, vw / 2, vh / 2), true);
  };

  // gesture start values live in shared values (worklet closures are copied, not shared)
  const g0 = { x: useSharedValue(0), y: useSharedValue(0), s: useSharedValue(1), fx: useSharedValue(0), fy: useSharedValue(0) };
  const gesture = useMemo(() => makeGesture(s, tx, ty, g0), [s, tx, ty]); // eslint-disable-line react-hooks/exhaustive-deps

  const content = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value - (W / 2) * (1 - s.value) }, { translateY: ty.value - (H / 2) * (1 - s.value) }, { scale: s.value }],
  }));

  // web: Ctrl/⌘ + wheel (also trackpad pinch) zooms around the pointer; plain wheel keeps scrolling the chat
  const viewport = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = viewport.current as unknown as HTMLElement | null;
    if (!el || typeof el.addEventListener !== 'function') return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const v = zoomAt({ s: s.value, tx: tx.value, ty: ty.value }, Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      s.value = v.s;
      tx.value = v.tx;
      ty.value = v.ty;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [s, tx, ty]);

  const nodes = layout.nodes;
  return (
    <View ref={viewport} style={{ height: vh, borderRadius: t.radii.m, backgroundColor: t.colors.surfaceAlt, overflow: 'hidden' }}>
      <GestureDetector gesture={gesture}>
        <View style={{ flex: 1 }} collapsable={false}>
          <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: W, height: H }, content]}>
            <Svg width={W} height={H} style={{ position: 'absolute', left: 0, top: 0 }}>
              {layout.edges.map((e) => (
                <Path key={`${e.from}>${e.to}`} d={e.d} stroke={branchColor(t, e.branch)} strokeOpacity={e.depth === 1 ? 0.9 : 0.7} strokeWidth={e.depth === 1 ? 2.5 : e.depth === 2 ? 1.8 : 1.3} fill="none" strokeLinecap="round" />
              ))}
            </Svg>
            {nodes.map((n) => (
              <NodeBox key={n.id} t={t} n={n} onOpen={onOpen} onToggle={onToggle} />
            ))}
          </Animated.View>
        </View>
      </GestureDetector>
      <View style={{ position: 'absolute', right: 6, top: 6, gap: 6 }}>
        <ToolBtn t={t} icon="zoomIn" label={tr('ui.mindmap.zoomIn')} onPress={() => zoom(1.3)} />
        <ToolBtn t={t} icon="zoomOut" label={tr('ui.mindmap.zoomOut')} onPress={() => zoom(1 / 1.3)} />
        <ToolBtn
          t={t}
          icon="fit"
          label={tr('ui.mindmap.fit')}
          onPress={() => {
            haptic('selection');
            fit(true);
          }}
        />
      </View>
    </View>
  );
}

type G0 = { x: SharedValue<number>; y: SharedValue<number>; s: SharedValue<number>; fx: SharedValue<number>; fy: SharedValue<number> };

/** One-finger pan + two-finger pinch (focal point stays put; moving both fingers pans too). */
function makeGesture(s: SharedValue<number>, tx: SharedValue<number>, ty: SharedValue<number>, g0: G0) {
  const pan = Gesture.Pan()
    .maxPointers(1)
    .minDistance(6)
    .onStart(() => {
      g0.x.value = tx.value;
      g0.y.value = ty.value;
    })
    .onUpdate((e) => {
      tx.value = g0.x.value + e.translationX;
      ty.value = g0.y.value + e.translationY;
    });
  const pinch = Gesture.Pinch()
    .onStart((e) => {
      g0.s.value = s.value;
      g0.x.value = tx.value;
      g0.y.value = ty.value;
      g0.fx.value = e.focalX;
      g0.fy.value = e.focalY;
    })
    .onUpdate((e) => {
      const ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, g0.s.value * e.scale));
      const k = ns / g0.s.value;
      s.value = ns;
      tx.value = e.focalX - (g0.fx.value - g0.x.value) * k;
      ty.value = e.focalY - (g0.fy.value - g0.y.value) * k;
    });
  return Gesture.Simultaneous(pan, pinch);
}

function ToolBtn({ t, icon, label, onPress }: { t: Theme; icon: D3IconName; label: string; onPress: () => void }) {
  return (
    <PressableScale
      haptic={false}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.border, ...t.shadows.sm }}
      pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
    >
      <D3Icon name={icon} size={17} color={t.colors.text} />
    </PressableScale>
  );
}

function NodeBox({ t, n, onOpen, onToggle }: { t: Theme; n: LaidNode; onOpen: (id: string) => void; onToggle: (id: string) => void }) {
  const tr = useT();
  const color = branchColor(t, n.branch);
  const root = n.depth === 0;
  const lvl1 = n.depth === 1;
  const ty = root ? t.typography.headline : lvl1 ? t.typography.callout : t.typography.caption;
  const bg = root ? t.colors.accent : lvl1 ? withAlpha(color, t.dark ? 0.24 : 0.14) : t.colors.surface;
  const border = root ? t.colors.accent : lvl1 ? color : withAlpha(color, 0.6);
  const fg = root ? t.colors.onAccent : t.colors.text;
  const showToggle = n.hasChildren && !root;
  const a11y = `${tr('ui.mindmap.nodeA11y', { label: n.label, level: n.depth + 1 })}${n.collapsed ? `, ${tr('ui.mindmap.hidden', { count: n.hidden })}` : ''}`;
  return (
    <>
      <Pressable
        onPress={() => {
          haptic('selection');
          onOpen(n.id);
        }}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        accessibilityHint={tr('ui.mindmap.nodeHint')}
        style={({ pressed }) => ({
          position: 'absolute',
          left: n.x,
          top: n.y,
          width: n.w,
          height: n.h,
          borderRadius: root ? Math.min(n.h / 2, 18) : lvl1 ? 12 : 9,
          backgroundColor: bg,
          borderWidth: root ? 0 : lvl1 ? 1.5 : 1,
          borderColor: border,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 4,
          opacity: pressed ? 0.75 : 1,
        })}
      >
        <HText
          allowFontScaling={false}
          numberOfLines={n.lines.length}
          align="center"
          style={{ fontSize: ty.fontSize, lineHeight: ty.lineHeight, fontWeight: root || lvl1 ? '600' : '500', color: fg }}
        >
          {n.lines.join('\n')}
        </HText>
      </Pressable>
      {showToggle ? (
        <Pressable
          onPress={() => onToggle(n.id)}
          accessibilityRole="button"
          accessibilityLabel={`${n.label}: ${n.collapsed ? tr('ui.mindmap.expand') : tr('ui.mindmap.collapse')}`}
          accessibilityState={{ expanded: !n.collapsed }}
          hitSlop={11}
          style={({ pressed }) => ({
            position: 'absolute',
            top: n.y + n.h / 2 - 11,
            left: n.side === 1 ? n.x + n.w - 6 : n.x - (n.collapsed ? toggleW(n) : 22) + 6,
            minWidth: 22,
            height: 22,
            paddingHorizontal: n.collapsed ? 5 : 0,
            borderRadius: 11,
            backgroundColor: n.collapsed ? color : t.colors.surface,
            borderWidth: 1.5,
            borderColor: color,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          {n.collapsed ? (
            <HText allowFontScaling={false} style={{ fontSize: 11, lineHeight: 13, fontWeight: '700', color: t.dark ? '#111' : '#FFF' }} tabular>
              {`+${n.hidden}`}
            </HText>
          ) : (
            <Icon name="minus" size={12} color={color} strokeWidth={2.6} />
          )}
        </Pressable>
      ) : null}
    </>
  );
}

function toggleW(n: LaidNode): number {
  return 22 + Math.max(0, String(n.hidden).length - 1) * 7;
}

/* ───────────── outline ───────────── */

function Outline({ t, root, collapsed, onOpen, onToggle }: { t: Theme; root: MindNode; collapsed: (n: MindNode) => boolean; onOpen: (id: string) => void; onToggle: (id: string) => void }) {
  const tr = useT();
  const rows = outlineRows(root, collapsed);
  return (
    <View style={{ gap: 2 }}>
      {rows.map((r) => {
        const color = branchColor(t, r.branch);
        const isRoot = r.depth === 0;
        const n = findNode(root, r.id);
        return (
          <View key={r.id} style={{ flexDirection: 'row', alignItems: 'stretch', paddingLeft: Math.max(0, r.depth - 1) * 16 }}>
            {!isRoot ? <View style={{ width: 3, borderRadius: 2, backgroundColor: color, opacity: r.depth === 1 ? 1 : 0.55, marginVertical: 4 }} /> : null}
            <PressableScale
              haptic="selection"
              scaleTo={0.99}
              onPress={() => onOpen(r.id)}
              accessibilityRole="button"
              accessibilityLabel={`${r.path ? `${r.path} ` : ''}${r.label}${r.note ? `. ${r.note}` : ''}`}
              accessibilityHint={tr('ui.mindmap.nodeHint')}
              style={{ flex: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: t.spacing.s, paddingVertical: 6, borderRadius: t.radii.s }}
              pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                {r.path ? (
                  <HText variant="caption" tabular style={{ color, fontWeight: '700' }}>
                    {r.path}
                  </HText>
                ) : null}
                <HText variant={isRoot ? 'headline' : r.depth === 1 ? 'bodyStrong' : 'callout'} style={{ flex: 1 }}>
                  {r.label}
                </HText>
              </View>
              {r.note && !isRoot ? (
                <HText variant="caption" color="muted" numberOfLines={2}>
                  {r.note}
                </HText>
              ) : null}
            </PressableScale>
            {r.hasChildren && !isRoot ? (
              <PressableScale
                haptic="selection"
                onPress={() => onToggle(r.id)}
                accessibilityRole="button"
                accessibilityLabel={`${r.label}: ${r.collapsed ? tr('ui.mindmap.expand') : tr('ui.mindmap.collapse')}`}
                accessibilityState={{ expanded: !r.collapsed }}
                style={{ minWidth: 44, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 }}
                pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
              >
                {r.collapsed && n ? (
                  <HText variant="micro" color="muted" tabular>
                    {`+${hiddenCount(n)}`}
                  </HText>
                ) : null}
                <View style={{ transform: [{ rotate: r.collapsed ? '-90deg' : '0deg' }] }}>
                  <Icon name="chevronDown" size={16} color={t.colors.muted} />
                </View>
              </PressableScale>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/* ───────────── sheet ───────────── */

function NodeSheet({ t, node, parentLabel, collapsed, disabled, onToggle, onClose, onDeepen }: { t: Theme; node: MindNode; parentLabel?: string; collapsed: boolean; disabled: boolean; onToggle: () => void; onClose: () => void; onDeepen: () => void }) {
  const tr = useT();
  const insets = useSafeAreaInsets();
  const color = branchColor(t, node.branch);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: t.colors.overlay }} onPress={onClose} accessibilityRole="button" accessibilityLabel={tr('ui.mindmap.close')} />
        <View style={{ backgroundColor: t.colors.surface, borderTopLeftRadius: t.radii.xl, borderTopRightRadius: t.radii.xl, maxHeight: '80%', paddingBottom: insets.bottom + t.spacing.m, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
          <View style={{ alignItems: 'center', paddingTop: t.spacing.s }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: t.colors.borderStrong }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: t.spacing.l, gap: t.spacing.m }}>
            {parentLabel ? (
              <HText variant="micro" color="muted" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }} numberOfLines={1}>
                {parentLabel}
              </HText>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: color }} />
              <HText variant="title" style={{ flex: 1 }} accessibilityRole="header">
                {node.label}
              </HText>
            </View>
            <HText variant="body" color={node.note ? 'text' : 'muted'} selectable>
              {node.note || tr('ui.mindmap.noNote')}
            </HText>
            {node.children.length ? (
              <HText variant="caption" color="muted">
                {tr('ui.mindmap.hidden', { count: hiddenCount(node) })}
              </HText>
            ) : null}
            <View style={{ flexDirection: 'row', gap: t.spacing.s, flexWrap: 'wrap' }}>
              {node.children.length && node.depth > 0 ? (
                <SecondaryButton label={collapsed ? tr('ui.mindmap.expand') : tr('ui.mindmap.collapse')} onPress={onToggle} style={{ flexGrow: 1 }} />
              ) : (
                <SecondaryButton label={tr('ui.mindmap.close')} onPress={onClose} style={{ flexGrow: 1 }} />
              )}
              <PrimaryButton label={tr('ui.mindmap.deepen')} icon="sparkle" disabled={disabled} accessibilityHint={tr('ui.mindmap.deepenHint')} onPress={onDeepen} style={{ flexGrow: 2 }} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
