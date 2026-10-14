import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { useT } from '../i18n';
import { HText, Icon, PressableScale, haptic, useTheme, type IconName, type Theme } from '../ui';
import { bestOn } from '../ui/color';
import { FADE_IN_SETTLED } from '../ui/lib/fadeIn';
import { useSettledAfter } from '../ui/lib/useSettledAfter';
import {
  beginSubmit,
  failSubmit,
  formatCountdown,
  IDLE,
  isLateTap,
  LATE_TAP_ERROR,
  needsConfirm,
  remainingFraction,
  remainingSeconds,
  succeedSubmit,
  toApprovalView,
  type ApprovalChoiceValue,
  type ApprovalInput,
  type ChoiceView,
  type RiskLevel,
  type SubmitState,
} from './approvalModel';

export type ApprovalSheetProps = {
  /** `approval` from useHermesChat (an `ApprovalRequest`) */
  approval: ApprovalInput;
  /** Send the answer. Reject/throw on failure: the sheet shows the error and offers a retry. */
  onRespond: (choice: ApprovalChoiceValue) => Promise<void>;
  /** Hide the sheet without answering (Hermes keeps waiting). Omit to hide the close button. */
  onDismiss?: () => void;
  /** Remove a card that can no longer be answered (expired / gone). Defaults to `onDismiss`. */
  onClose?: () => void;
  /** Server `approvals.timeout` if known (default 300 s; the event carries no deadline). */
  timeoutSeconds?: number;
  style?: StyleProp<ViewStyle>;
};

function riskColors(t: Theme, level: RiskLevel) {
  switch (level) {
    case 'high':
      return { fg: t.colors.danger, bg: t.colors.dangerSoft, icon: 'alertOctagon' as IconName };
    case 'elevated':
      return { fg: t.colors.warning, bg: t.colors.warningSoft, icon: 'alert' as IconName };
    default:
      return { fg: t.colors.accent, bg: t.colors.accentSoft, icon: 'info' as IconName };
  }
}

function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return now;
}

/**
 * Prominent card shown above the composer while Hermes waits for an `approval.request` answer.
 * One answer only: taps are ignored while sending or after success; a failed send can be retried.
 */
export function ApprovalSheet({ approval, onRespond, onDismiss, onClose, timeoutSeconds, style }: ApprovalSheetProps) {
  const t = useTheme();
  const tr = useT();
  const reduced = useReducedMotion();
  // Recompute only when the request changes; `now` is captured once so the deadline stays fixed.
  const [view, setView] = useState(() => toApprovalView(approval, { timeoutSeconds }));
  const [state, setState] = useState<SubmitState>(IDLE);
  const [copied, setCopied] = useState(false);
  // high risk + "always": second explicit step (global allowlist, all channels)
  const [confirming, setConfirming] = useState<ApprovalChoiceValue | null>(null);
  const lock = useRef(false); // synchronous guard: two taps in the same frame
  const mounted = useRef(true);
  const stateRef = useRef<SubmitState>(IDLE);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const requestKey = toApprovalView(approval, { timeoutSeconds }).key;
  const shownKey = useRef(view.key);
  useEffect(() => {
    if (shownKey.current === requestKey) return;
    shownKey.current = requestKey;
    lock.current = false;
    stateRef.current = IDLE;
    setState(IDLE);
    setCopied(false);
    setConfirming(null);
    setView(toApprovalView(approval, { timeoutSeconds }));
  }, [requestKey, approval, timeoutSeconds]);

  // ---- entrance --------------------------------------------------------------------------
  const enter = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    haptic('warning');
    AccessibilityInfo.announceForAccessibility?.(tr('approvals.sheet.announce', { text: view.description || view.commandDisplay }).slice(0, 200));
    if (reduced) {
      enter.value = 1;
      return;
    }
    enter.value = 0;
    enter.value = withSpring(1, { damping: 20, stiffness: 220, mass: 0.9 });
  }, [view.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const enterStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, enter.value * 1.4), transform: [{ translateY: (1 - enter.value) * 28 }] }));
  // the sheet re-renders every countdown second: once the spring is done, React must own the visible end
  // state, or a dropped animated value would write opacity 0 back on the next tick (ui/lib/fadeIn.ts)
  const enterSettled = useSettledAfter(reduced ? 0 : 800, [view.key, reduced]);

  // ---- countdown -------------------------------------------------------------------------
  const expiredFlag = approval.expired === true;
  const ticking = state.phase !== 'sent' && !expiredFlag;
  const now = useNow(ticking);
  const left = expiredFlag ? 0 : remainingSeconds(view.deadlineMs, now);
  const frac = expiredFlag ? 0 : remainingFraction(view.deadlineMs, view.timeoutSeconds, now);
  const expired = left === 0;
  useEffect(() => {
    if (expired) AccessibilityInfo.announceForAccessibility?.(tr('approvals.countdown.expired'));
  }, [expired]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- answering -------------------------------------------------------------------------
  const submit = useCallback(
    async (choice: ApprovalChoiceValue, confirmed = false) => {
      if (lock.current) return;
      // late tap: the deadline passed (Hermes already denied) → explain, send nothing
      if (isLateTap(view, expiredFlag, Date.now())) {
        if (stateRef.current.phase === 'idle' || stateRef.current.phase === 'error') {
          stateRef.current = { phase: 'error', choice, error: LATE_TAP_ERROR };
          setState(stateRef.current);
          setConfirming(null);
          haptic('warning');
        }
        return;
      }
      if (!confirmed && needsConfirm(choice, view.risk.level)) {
        if (stateRef.current.phase === 'idle' || (stateRef.current.phase === 'error' && stateRef.current.error.retryable)) setConfirming(choice);
        return;
      }
      setConfirming(null);
      const next = beginSubmit(stateRef.current, choice);
      if (!next) return;
      lock.current = true;
      stateRef.current = next;
      setState(next);
      try {
        await onRespond(choice);
        stateRef.current = succeedSubmit(stateRef.current);
        if (mounted.current) {
          setState(stateRef.current);
          haptic(choice === 'deny' ? 'medium' : 'success');
        }
        // stays locked: the answer is final; the shell unmounts us when `approval` becomes null
      } catch (e) {
        stateRef.current = failSubmit(stateRef.current, e);
        lock.current = false;
        if (mounted.current) {
          setState(stateRef.current);
          haptic('warning');
        }
      }
    },
    [onRespond, view, expiredFlag]
  );

  const copy = useCallback(() => {
    Clipboard.setStringAsync(view.command).catch(() => {});
    haptic('success');
    setCopied(true);
  }, [view.command]);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  const rc = riskColors(t, view.risk.level);
  const busy = state.phase === 'sending';
  const done = state.phase === 'sent';
  const failed = state.phase === 'error' ? state : null;
  const barColor = left <= 30 ? t.colors.danger : rc.fg;
  const close = onClose ?? onDismiss;
  const estimatedRisk = view.risk.level !== 'normal' && !view.smartDenied;

  return (
    <Animated.View
      style={[
        styles.card,
        t.shadows.md,
        { backgroundColor: t.colors.surface, borderColor: view.risk.level === 'normal' ? t.colors.borderStrong : rc.fg, borderRadius: t.radii.xl },
        enterStyle,
        style,
        enterSettled ? FADE_IN_SETTLED : null,
      ]}
      accessibilityViewIsModal={false}
      accessibilityLabel={tr('approvals.sheet.a11y', { risk: tr(view.risk.labelKey) })}
    >
      {/* header */}
      <View style={styles.header}>
        <View style={[styles.iconWrap, { backgroundColor: rc.bg }]}>
          <Icon name={rc.icon} size={20} color={rc.fg} />
        </View>
        <View style={styles.headerText}>
          <HText variant="headline" accessibilityRole="header" numberOfLines={2}>
            {tr(view.titleKey)}
          </HText>
          <View style={[styles.riskPill, { backgroundColor: rc.bg }]}>
            <HText variant="micro" style={{ color: rc.fg }}>
              {tr(view.risk.labelKey).toUpperCase()}
            </HText>
          </View>
        </View>
        {onDismiss ? (
          <PressableScale
            onPress={expired && close ? close : onDismiss}
            haptic="selection"
            hitSlop={8}
            disabled={busy}
            accessibilityLabel={expired ? tr('approvals.sheet.close') : tr('approvals.sheet.dismiss')}
            style={[styles.closeBtn, { backgroundColor: t.colors.surfaceAlt }]}
          >
            <Icon name="x" size={16} color={t.colors.muted} />
          </PressableScale>
        ) : null}
      </View>

      {/* countdown */}
      <View
        style={styles.countdownRow}
        accessible
        accessibilityLabel={
          expired ? tr('approvals.countdown.expired') : tr('approvals.countdown.spoken', { minutes: Math.floor(left / 60), seconds: left % 60 })
        }
      >
        <View style={[styles.track, { backgroundColor: t.colors.surfaceAlt }]}>
          <View style={[styles.bar, { width: `${Math.round(frac * 100)}%`, backgroundColor: barColor }]} />
        </View>
        <HText variant="caption" tabular color={expired ? 'danger' : left <= 30 ? 'danger' : 'muted'}>
          {expired
            ? tr('approvals.countdown.expired')
            : view.deadlineEstimated
              ? tr('approvals.countdown.left', { time: formatCountdown(left) })
              : tr('approvals.countdown.leftExact', { time: formatCountdown(left) })}
        </HText>
      </View>
      {expired && !failed ? (
        <View accessibilityRole="alert" style={[styles.errorBox, { backgroundColor: t.colors.dangerSoft, borderRadius: t.radii.m }]}>
          <Icon name="alert" size={16} color={t.colors.danger} />
          <HText variant="callout" color="danger" style={styles.flex1}>
            {tr('approvals.countdown.expiredNote')}
          </HText>
        </View>
      ) : null}

      {/* reason (server text) + risk source */}
      {view.description ? (
        <View style={styles.reason}>
          <HText variant="micro" color="subtle">
            {tr('approvals.reason.label')}
          </HText>
          <HText variant="body" selectable>
            {view.description}
          </HText>
        </View>
      ) : null}
      {estimatedRisk ? (
        <HText variant="caption" color="muted">
          {tr('approvals.risk.estimateNote')}
        </HText>
      ) : null}

      {/* command: invisible / control characters are escaped (approvalModel.displayCommand); anything unusual is flagged */}
      {view.command && view.commandUnusual ? (
        <View accessibilityRole="alert" style={[styles.errorBox, { backgroundColor: t.colors.warningSoft, borderRadius: t.radii.m }]}>
          <Icon name="alert" size={16} color={t.colors.warning} />
          <View style={styles.flex1}>
            <HText variant="callout" weight="600">
              {tr('approvals.command.unusual')}
            </HText>
            <HText variant="caption" color="muted">
              {tr('approvals.command.unusualHint')}
            </HText>
          </View>
        </View>
      ) : null}
      {view.command ? (
        <View style={[styles.cmdBox, { backgroundColor: t.colors.codeBg, borderColor: t.colors.border, borderRadius: t.radii.m }]}>
          <View style={styles.cmdHead}>
            <HText variant="micro" color="subtle">
              {tr('approvals.command.label', { count: view.lineCount })}
            </HText>
            <PressableScale
              onPress={copy}
              haptic={false}
              hitSlop={8}
              accessibilityLabel={copied ? tr('approvals.command.copiedA11y') : tr('approvals.command.copyA11y')}
              style={styles.copyBtn}
            >
              <Icon name={copied ? 'check' : 'copy'} size={14} color={copied ? t.colors.success : t.colors.muted} />
              <HText variant="caption" color={copied ? 'success' : 'muted'}>
                {copied ? tr('approvals.command.copied') : tr('approvals.command.copy')}
              </HText>
            </PressableScale>
          </View>
          <ScrollView style={styles.cmdScroll} nestedScrollEnabled showsVerticalScrollIndicator>
            <HText variant="mono" selectable accessibilityLabel={tr('approvals.command.a11y', { command: view.commandDisplay })} style={{ fontFamily: t.fonts.mono }}>
              {view.commandDisplay}
            </HText>
          </ScrollView>
        </View>
      ) : null}

      {/* error */}
      {failed ? (
        <View
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={[styles.errorBox, { backgroundColor: t.colors.dangerSoft, borderRadius: t.radii.m }]}
        >
          <Icon name="alert" size={16} color={t.colors.danger} />
          <HText variant="callout" color="danger" style={styles.flex1}>
            {tr(failed.error.messageKey)}
          </HText>
        </View>
      ) : null}
      {done ? (
        <View accessibilityLiveRegion="polite" style={styles.sentRow}>
          <Icon name="check" size={16} color={t.colors.success} />
          <HText variant="callout" color="success">
            {tr('approvals.sheet.sent')}
          </HText>
        </View>
      ) : null}

      {/* second step for "always" at high risk */}
      {confirming && !expired ? (
        <View accessibilityRole="alert" style={[styles.confirmBox, { borderColor: t.colors.danger, backgroundColor: t.colors.dangerSoft, borderRadius: t.radii.m }]}>
          <HText variant="bodyStrong" color="danger">
            {tr('approvals.confirm.title')}
          </HText>
          <HText variant="callout">{tr('approvals.confirm.body')}</HText>
          <PressableScale
            onPress={() => setConfirming(null)}
            haptic="selection"
            accessibilityLabel={tr('approvals.confirm.back')}
            style={[styles.btn, { backgroundColor: t.colors.danger, borderColor: t.colors.danger }]}
          >
            <HText variant="bodyStrong" style={{ color: bestOn(t.colors.danger) }}>
              {tr('approvals.confirm.back')}
            </HText>
          </PressableScale>
          <PressableScale
            onPress={() => submit(confirming, true)}
            haptic="medium"
            accessibilityLabel={tr('approvals.confirm.yes')}
            style={[styles.btn, { backgroundColor: t.colors.surfaceAlt, borderColor: t.colors.border }]}
          >
            <HText variant="bodyStrong">{tr('approvals.confirm.yes')}</HText>
          </PressableScale>
        </View>
      ) : null}

      {/* choices */}
      {confirming && !expired ? null : (
        <View style={styles.choices}>
          {view.choices.map((c) => (
            <ChoiceButton
              key={c.value}
              choice={c}
              sending={busy && state.choice === c.value}
              retry={failed?.choice === c.value && failed.error.retryable}
              disabled={expired || (busy && state.choice !== c.value) || done || (!!failed && !failed.error.retryable)}
              onPress={() => submit(c.value)}
            />
          ))}
          {(expired || (failed && !failed.error.retryable)) && close ? (
            <PressableScale onPress={close} haptic="selection" accessibilityLabel={tr('actions.close')} style={[styles.btn, { backgroundColor: t.colors.surfaceAlt }]}>
              <HText variant="bodyStrong">{tr('actions.close')}</HText>
            </PressableScale>
          ) : null}
        </View>
      )}
    </Animated.View>
  );
}

function ChoiceButton({ choice, sending, retry, disabled, onPress }: { choice: ChoiceView; sending: boolean; retry: boolean; disabled: boolean; onPress: () => void }) {
  const t = useTheme();
  const tr = useT();
  const c = t.colors;
  const [bg, fg, border] =
    choice.kind === 'primary'
      ? [c.accent, c.onAccent, c.accent]
      : choice.kind === 'denyPrimary'
        ? [c.danger, bestOn(c.danger), c.danger]
        : choice.kind === 'danger'
          ? [c.dangerSoft, c.danger, c.danger]
          : [c.surfaceAlt, c.text, c.border];
  const label = tr(choice.labelKey);
  const shownLabel = retry ? tr('approvals.choice.retry', { label }) : label;
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      haptic={choice.kind === 'danger' || choice.kind === 'denyPrimary' ? 'medium' : 'light'}
      accessibilityLabel={tr(choice.a11yKey)}
      accessibilityHint={choice.hintKey ? tr(choice.hintKey) : undefined}
      accessibilityState={{ busy: sending, disabled }}
      style={[styles.btn, { backgroundColor: bg, borderColor: border }]}
    >
      <View style={styles.btnInner}>
        {sending ? <ActivityIndicator size="small" color={fg} /> : null}
        <View style={styles.btnText}>
          <HText variant="bodyStrong" style={{ color: fg }} numberOfLines={2}>
            {shownLabel}
          </HText>
          {choice.hintKey && !sending ? (
            <HText variant="micro" style={{ color: fg, opacity: 0.75 }} numberOfLines={1}>
              {tr(choice.hintKey)}
            </HText>
          ) : null}
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1.5, padding: 16, gap: 12, alignSelf: 'stretch' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerText: { flex: 1, gap: 4, alignItems: 'flex-start' },
  iconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  riskPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  closeBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  countdownRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  track: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  bar: { height: 4, borderRadius: 2 },
  cmdBox: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10, gap: 6 },
  cmdHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, minWidth: 44, paddingHorizontal: 6, justifyContent: 'center' },
  reason: { gap: 2 },
  confirmBox: { borderWidth: 1, padding: 12, gap: 8 },
  cmdScroll: { maxHeight: 150, flexGrow: 0 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 },
  sentRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flex1: { flex: 1 },
  choices: { gap: 8 },
  btn: { minHeight: 52, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 8, justifyContent: 'center' },
  btnInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  btnText: { alignItems: 'center', flexShrink: 1 },
});
