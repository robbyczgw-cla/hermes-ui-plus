/**
 * Shared UI building blocks for the modules-a components: stable ids, "store loaded" gate,
 * send helper with undo window, answered/locked summary, buttons, child-node renderer context.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTheme } from '../../../theme';
import { useHui } from '../../../primitives/context';
import { HText, InlineText, PressableScale } from '../../../primitives/basics';
import { Button } from '../../../primitives/Button';
import { Icon, type IconName } from '../../../primitives/Icon';
import { haptic } from '../../../primitives/haptics';
import { useNodeScope, useNodeStateStore } from '../../../../nodestate';
import { commitOnUnmount } from '../../../../actions/activeConversation.ts';
import { moduleNodeId } from './misc.ts';
import { useS } from '../useS';
import { useCaptureMode } from '../../../lib/capture';

/* ───────────── child rendering (tabs / accordion) ───────────── */

/** Renders a nested HuiNode one level deeper. Provided by HuiView (avoids an import cycle). */
export type ChildRenderer = (node: unknown, opts: { key: string | number; last: boolean }) => ReactNode;

export const ChildRendererContext = createContext<ChildRenderer | null>(null);

export function useChildRenderer(): ChildRenderer {
  const r = useContext(ChildRendererContext);
  return r ?? (() => null);
}

/* ───────────── ids / persistence ───────────── */

/** The node's stable id (explicit, or a content hash as a last resort). */
export function useModuleId(type: string, node: Record<string, unknown>): string {
  const explicit = typeof node.id === 'string' ? node.id : '';
  // hash only when there's no id; recompute when the node object changes
  return useMemo(() => moduleNodeId(type, node), [type, explicit || node]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * True once persisted node state has been read (immediately outside a chat scope). Use before
 * writing initial state on mount, otherwise the write would shadow what is stored.
 */
export function useNodeStateReady(): boolean {
  const scope = useNodeScope();
  const store = useNodeStateStore();
  const conv = scope?.conversationId ?? null;
  const [loaded, setLoaded] = useState<string | null>(null);
  const ready = !conv || loaded === conv || store.isLoaded(conv);
  useEffect(() => {
    if (!conv || store.isLoaded(conv)) return;
    let alive = true;
    void store.load(conv).then(() => {
      if (alive) setLoaded(conv);
    });
    return () => {
      alive = false;
    };
  }, [conv, store]);
  return ready;
}

/* ───────────── sending ───────────── */

/**
 * Send a user message through the existing chat path (`{type:'send', text}`).
 * Returns false when the chat shell refused it (a turn is still running) → keep the node open.
 */
export function useSend(nodeId: string): (text: string) => boolean {
  const { onAction } = useHui();
  return useCallback(
    (text: string) => {
      // composed by the module from the user's own picks / input → one tap (chat/sendGate.ts)
      const ok = onAction({ type: 'send', text }, undefined, { nodeId, composed: true }) !== false;
      haptic(ok ? 'success' : 'warning');
      return ok;
    },
    [onAction, nodeId],
  );
}

/**
 * Commit after a short undo window (~1.5 s). The commit is bound to the chat it started in: if the
 * component unmounts while pending because its row was virtualised away (same chat still open), the
 * commit happens immediately so the answer is never lost; if the user left that chat (switch, new
 * chat, delete), the pending send is cancelled – it must never start a turn in a chat nobody sees.
 */
export function usePendingCommit(ms = 1500) {
  const scope = useNodeScope();
  const origin = scope?.conversationId ?? null;
  const [pending, setPending] = useState<{ label: string } | null>(null);
  const job = useRef<{ fn: () => void; timer: ReturnType<typeof setTimeout>; origin: string | null } | null>(null);
  const fire = useCallback(() => {
    const j = job.current;
    job.current = null;
    if (!j) return;
    clearTimeout(j.timer);
    setPending(null);
    j.fn();
  }, []);
  const start = useCallback(
    (label: string, fn: () => void) => {
      if (job.current) clearTimeout(job.current.timer);
      job.current = { fn, timer: setTimeout(fire, ms), origin };
      setPending({ label });
    },
    [fire, ms, origin],
  );
  const cancel = useCallback(() => {
    if (job.current) clearTimeout(job.current.timer);
    job.current = null;
    setPending(null);
  }, []);
  useEffect(
    () => () => {
      const j = job.current;
      if (j) {
        clearTimeout(j.timer);
        job.current = null;
        if (commitOnUnmount(j.origin)) j.fn();
      }
    },
    [],
  );
  return { pending, start, cancel, commitNow: fire, ms };
}

/** "Sende „Pizza“ … · Rückgängig" with a draining progress line. */
export function UndoBar({ label, ms, onUndo }: { label: string; ms: number; onUndo: () => void }) {
  const S = useS();
  const t = useTheme();
  const reduced = useReducedMotion();
  const p = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    p.value = 1;
    p.value = withTiming(0, { duration: ms, easing: Easing.linear });
    return () => cancelAnimation(p);
  }, [label, ms, reduced, p]);
  const bar = useAnimatedStyle(() => ({ transform: [{ scaleX: p.value }] }));
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ borderRadius: t.radii.control, backgroundColor: t.colors.accentSoft, overflow: 'hidden' }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, paddingLeft: t.spacing.m, minHeight: 44 }}>
        <HText variant="callout" style={{ flex: 1, color: t.colors.accentText }} numberOfLines={1}>
          {label}
        </HText>
        <PressableScale
          haptic="selection"
          onPress={onUndo}
          accessibilityLabel={S.common.undo}
          style={{ height: 44, paddingHorizontal: t.spacing.l, justifyContent: 'center' }}
        >
          <HText variant="callout" weight="600" color="accent">
            {S.common.undo}
          </HText>
        </PressableScale>
      </View>
      <Animated.View style={[{ height: 2, backgroundColor: t.colors.accent, transformOrigin: 'left' } as ViewStyle, bar]} />
    </View>
  );
}

/* ───────────── answered / locked ───────────── */

/** Read-only summary of a sent answer + optional "Geändert? Neu beantworten". */
export function AnsweredSummary({
  title,
  answer,
  onReopen,
  icon = 'checkCircle',
  tone = 'success',
  children,
}: {
  title?: string;
  answer: string;
  onReopen?: () => void;
  icon?: IconName;
  tone?: 'success' | 'muted' | 'danger';
  children?: ReactNode;
}) {
  const S = useS();
  const t = useTheme();
  const fg = tone === 'success' ? t.colors.success : tone === 'danger' ? t.colors.danger : t.colors.muted;
  return (
    <View style={{ gap: t.spacing.s }} accessible accessibilityLabel={`${title ? `${title}. ` : ''}${S.common.yourAnswer}: ${answer}`}>
      {title ? <InlineText variant="callout" color="muted" text={title} /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.s }}>
        <View style={{ paddingTop: 2 }}>
          <Icon name={icon} size={18} color={fg} strokeWidth={2} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <HText variant="caption" weight="600" color="muted">
            {S.common.yourAnswer}
          </HText>
          <HText variant="bodyStrong">{answer}</HText>
        </View>
      </View>
      {children}
      {onReopen ? (
        <Button label={S.common.reopen} variant="tertiary" size="small" onPress={onReopen} style={{ alignSelf: 'flex-start' }} />
      ) : null}
    </View>
  );
}

/* ───────────── buttons ───────────── */

/**
 * Card buttons on top of the one `Button`: the single main action of a card is primary (ink), the alternatives secondary.
 * `tone`: 'danger' → seal red (destructive moments only);
 */
export function PrimaryButton({
  label,
  onPress,
  disabled,
  tone = 'accent',
  icon,
  style,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'accent' | 'danger';
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}) {
  return <Button label={label} variant="primary" tone={tone === 'danger' ? 'seal' : 'default'} icon={icon} disabled={disabled} onPress={onPress} accessibilityHint={accessibilityHint} style={style} />;
}

export function SecondaryButton({
  label,
  onPress,
  disabled,
  icon,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  return <Button label={label} variant="secondary" icon={icon} disabled={disabled} onPress={onPress} style={style} />;
}

/** Round icon-only button (≥ 44 px hit area). */
function IconButtonInner({ icon, label, onPress, color, size = 18, disabled, active }: { icon: IconName; label: string; onPress: () => void; color?: string; size?: number; disabled?: boolean; active?: boolean }) {
  const t = useTheme();
  return (
    <PressableScale
      haptic="selection"
      disabled={disabled}
      onPress={onPress}
      accessibilityLabel={label}
      hitSlop={6}
      style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? t.colors.accentSoft : 'transparent' }}
      pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
    >
      <Icon name={icon} size={size} color={color ?? (active ? t.colors.accent : t.colors.muted)} />
    </PressableScale>
  );
}

/** share-as-image (capture mode): an app-only control, not part of the picture */
export function IconButton(props: Parameters<typeof IconButtonInner>[0]) {
  return useCaptureMode() ? null : <IconButtonInner {...props} />;
}
