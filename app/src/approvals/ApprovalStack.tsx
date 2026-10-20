import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { ApprovalChoice, ApprovalRequest } from '../hermes/types';
import { useT } from '../i18n';
import { HText, Icon, PressableScale, haptic, useTheme } from '../ui';
import { ApprovalSheet, type BotContext } from './ApprovalSheet';
import { stackKey } from './stackModel';

export type ApprovalStackProps = {
  /** all pending requests of the chat, oldest first (useHermesChat `approvals`) */
  approvals: readonly ApprovalRequest[];
  /** answer ONE request (rejects on failure, see useHermesChat respondApprovalFor) */
  onRespond: (approval: ApprovalRequest, choice: ApprovalChoice) => Promise<void>;
  /** remove an expired / gone request (no answer is sent) */
  onClose?: (approval: ApprovalRequest) => void;
  /** notification tap (openPendingApproval): reveal the stack and show this run's card */
  focus?: { runId?: string; at: number } | null;
  /** the chat is a bot's Bot Chat (bots/): cards name the bot, see ApprovalSheet `bot` */
  bot?: BotContext;
  style?: StyleProp<ViewStyle>;
};

/**
 * Queue of approval cards above the composer: one card at a time with "Freigabe 1 von 3" + ‹ › and a count badge;
 * each card is answered independently (own request id, own double-tap lock). Hidden → a chip with the count re-opens it.
 * A new request reveals the stack again and is announced to screen readers.
 */
export const ApprovalStack = memo(function ApprovalStack({ approvals, onRespond, onClose, focus, bot, style }: ApprovalStackProps) {
  const t = useTheme();
  const tr = useT();
  const keys = useMemo(() => approvals.map(stackKey), [approvals]);
  const [current, setCurrent] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  // new requests: reveal + announce (the shown card announces itself; others need a hint)
  const seen = useRef<Set<string>>(new Set(keys));
  useEffect(() => {
    const fresh = keys.filter((k) => !seen.current.has(k));
    seen.current = new Set(keys);
    if (!fresh.length) return;
    setHidden(false);
    if (keys.length > 1) {
      haptic('warning');
      AccessibilityInfo.announceForAccessibility?.(tr('approvals.stack.announceNew', { count: keys.length }));
    }
  }, [keys, tr]);

  // notification tap: reveal + show the requested run's card (derived during render, once per focus request). A card
  // restored a moment later by GET /v1/runs is revealed by the "new request" effect above.
  const [focusDone, setFocusDone] = useState<number | undefined>(undefined);
  if (focus && focus.at !== focusDone) {
    setFocusDone(focus.at);
    setHidden(false);
    const hit = approvals.find((a) => !focus.runId || a.runId === focus.runId);
    if (hit) setCurrent(stackKey(hit));
  }

  if (!approvals.length) return null;
  const idx = Math.max(0, current ? keys.indexOf(current) : 0);
  const ap = approvals[idx] ?? approvals[0];
  const key = stackKey(ap);
  const total = approvals.length;
  const live = approvals.filter((a) => !a.expired).length;

  if (hidden) {
    return (
      <Pressable
        onPress={() => setHidden(false)}
        accessibilityRole="button"
        accessibilityLabel={tr('approvals.stack.chipA11y', { count: Math.max(1, live) })}
        style={({ pressed }) => [styles.chip, { backgroundColor: t.colors.surface, borderColor: t.colors.borderControl }, pressed && { backgroundColor: t.colors.surfacePressed }]}
      >
        {/* the approval seal, small */}
        <View style={[styles.sealDot, { backgroundColor: t.colors.seal }]} />
        <HText variant="callout">{tr('approvals.stack.chip', { count: Math.max(1, live) })}</HText>
      </Pressable>
    );
  }

  const go = (d: number) => setCurrent(keys[(idx + d + total) % total]);
  return (
    <View style={[styles.wrap, style]}>
      {total > 1 ? (
        <View style={styles.pager}>
          <PressableScale onPress={() => go(-1)} haptic="selection" accessibilityLabel={tr('approvals.stack.prev')} style={[styles.navBtn, { backgroundColor: t.colors.surfaceAlt }]}>
            <Icon name="chevronLeft" size={18} color={t.colors.text} />
          </PressableScale>
          <View style={styles.pagerText} accessible accessibilityLiveRegion="polite">
            <HText variant="caption" color="muted">
              {tr('approvals.stack.position', { index: idx + 1, total })}
            </HText>
            <View style={[styles.badge, { backgroundColor: t.colors.sealSoft }]}>
              <HText variant="micro" style={{ color: t.colors.seal }}>
                {tr('approvals.stack.badge', { count: live })}
              </HText>
            </View>
          </View>
          <PressableScale onPress={() => go(1)} haptic="selection" accessibilityLabel={tr('approvals.stack.next')} style={[styles.navBtn, { backgroundColor: t.colors.surfaceAlt }]}>
            <Icon name="chevronRight" size={18} color={t.colors.text} />
          </PressableScale>
        </View>
      ) : null}
      {/* large system text (1.3+ on a phone, or the keyboard open) makes the card taller than the space above the
          composer: the stack shrinks (ChatView approval column) and the card scrolls, so every choice stays reachable */}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
        <ApprovalSheet
          key={key}
          approval={ap}
          onRespond={(choice) => onRespond(ap, choice)}
          onDismiss={() => setHidden(true)}
          onClose={onClose ? () => onClose(ap) : () => setHidden(true)}
          bot={bot}
        />
      </ScrollView>
    </View>
  );
});

const SHADOW_PAD = 8;

const styles = StyleSheet.create({
  wrap: { gap: 6, flexShrink: 1 },
  // the scroll box reaches SHADOW_PAD past the card on every side (padding cancels the negative margin), so the
  // card's shadow is not cut by the scroll clip; the layout box is unchanged
  scroll: { flexGrow: 0, flexShrink: 1, margin: -SHADOW_PAD },
  scrollContent: { padding: SHADOW_PAD },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  pagerText: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  navBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  sealDot: { width: 8, height: 8, borderRadius: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },
});
