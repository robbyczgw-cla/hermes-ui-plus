import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { useLocale, useT } from '../i18n';
import { BotAvatar } from '../bots/BotAvatar';
import { botApprovalChoices } from '../bots/core';
import { Button, HText, Icon, PressableScale, haptic, useTheme, withAlpha } from '../ui';
import { FADE_IN_SETTLED } from '../ui/lib/fadeIn';
import { scaledLineLimit } from '../ui/lib/fontScaleLayout';
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
  /**
   * The request comes from a bot's chat (bots/): the card names the bot, offers no "for this session" (the Bot Chat
   * never ends) and waits calmly ("{name} wartet auf dich, seit 7:12", a countdown only in the last minute).
   * `scoped`: "Always allow" lands in THIS bot's allowlist only (a non-default Hermes profile), so it is a plain choice;
   * the default bot's "always" stays Hermes' global list behind "More options".
   */
  bot?: BotContext;
  style?: StyleProp<ViewStyle>;
};

export type BotContext = { name: string; bot?: string; color?: string; scoped: boolean };

/** a countdown only this close to Hermes' deadline in a bot chat (before: "waiting since") */
const BOT_COUNTDOWN_S = 60;
/** a category text short enough for the "Always allow" subline */
const CATEGORY_MAX = 48;

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
export function ApprovalSheet({ approval: raw, onRespond, onDismiss, onClose, timeoutSeconds, bot, style }: ApprovalSheetProps) {
  const t = useTheme();
  const tr = useT();
  const { formatDate } = useLocale();
  // a bot chat never offers "for this session" (bots/core.ts botApprovalChoices)
  const botMode = !!bot;
  const approval = useMemo(() => (botMode && raw.choices ? { ...raw, choices: botApprovalChoices(raw.choices) } : raw), [botMode, raw]);
  const reduced = useReducedMotion();
  // Recompute only when the request changes; `now` is captured once so the deadline stays fixed.
  const [view, setView] = useState(() => toApprovalView(approval, { timeoutSeconds }));
  const [state, setState] = useState<SubmitState>(IDLE);
  const [copied, setCopied] = useState(false);
  // high risk + "always": second explicit step (global allowlist, all channels)
  const [confirming, setConfirming] = useState<ApprovalChoiceValue | null>(null);
  // "More options" disclosure (holds "Always allow")
  const [moreOpen, setMoreOpen] = useState(false);
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
    setMoreOpen(false);
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

  const busy = state.phase === 'sending';
  const activeChoice = state.phase === 'idle' ? null : state.choice;
  const done = state.phase === 'sent';
  const failed = state.phase === 'error' ? state : null;
  const close = onClose ?? onDismiss;
  const level = view.risk.level;
  const scoped = !!bot?.scoped;
  const title = bot ? tr(view.smartDenied ? 'approvals.title.blockedBot' : 'approvals.title.requestBot', { name: bot.name }) : tr(view.titleKey);
  // bot chat: "waiting since …" until the last minute, then the usual countdown
  const sinceMs = view.deadlineMs - view.timeoutSeconds * 1000;
  const sinceText = formatDate(new Date(sinceMs), { hour: 'numeric', minute: '2-digit' });
  const showCountdown = !botMode || expired || left <= BOT_COUNTDOWN_S;
  const category = view.description && view.description.length <= CATEGORY_MAX ? view.description : '';
  const alwaysText = (ch: ChoiceView) =>
    ch.value === 'always' && scoped && bot
      ? {
          label: tr('approvals.choice.alwaysBot.label'),
          a11y: tr('approvals.choice.alwaysBot.a11y', { name: bot.name }),
          hint: category ? tr('approvals.choice.alwaysBot.hintCategory', { name: bot.name, category }) : tr('approvals.choice.alwaysBot.hint', { name: bot.name }),
        }
      : undefined;
  const estimatedRisk = level !== 'normal' && !view.smartDenied;
  const c = t.colors;

  // action groups: the main row (the primary + its equal alternatives), Deny as a quiet way out, "always" behind
  // "More options" (Hermes' global allowlist: never one tap away). High risk: Deny is the primary of the main row.
  const main = view.choices.filter((ch) => ch.value !== 'always' && (ch.value !== 'deny' || ch.kind === 'denyPrimary'));
  const quietDeny = view.choices.find((ch) => ch.value === 'deny' && ch.kind !== 'denyPrimary');
  const always = view.choices.find((ch) => ch.value === 'always');
  const showSessionNote = main.some((ch) => ch.value === 'session');
  const moreShown = !!always && (moreOpen || activeChoice === 'always');
  const choiceProps = (ch: ChoiceView) => ({
    choice: ch,
    sending: busy && activeChoice === ch.value,
    retry: failed?.choice === ch.value && failed.error.retryable,
    disabled: expired || (busy && activeChoice !== ch.value) || done || (!!failed && !failed.error.retryable),
    onPress: () => submit(ch.value),
  });

  return (
    <Animated.View
      style={[
        styles.card,
        t.shadows.sm,
        { backgroundColor: c.surface, borderColor: level === 'normal' ? c.border : withAlpha(c.seal, 0.4), borderRadius: t.radii.card },
        enterStyle,
        style,
        enterSettled ? FADE_IN_SETTLED : null,
      ]}
      accessibilityViewIsModal={false}
      accessibilityLabel={tr('approvals.sheet.a11y', { risk: tr(view.risk.labelKey) })}
    >
      {/* header: the approval seal + title; risk as one quiet line (seal mark + text), never a pill */}
      <View style={styles.header}>
        {bot ? (
          // the bot's avatar with the small seal at its corner
          <View accessible={false} importantForAccessibility="no-hide-descendants">
            <BotAvatar name={bot.name} bot={bot.bot} color={bot.color} size={40} />
            <View style={[styles.sealBadge, { backgroundColor: c.seal, borderColor: c.surface }]} />
          </View>
        ) : (
          <View style={[styles.seal, { backgroundColor: c.seal }]} accessible={false} importantForAccessibility="no-hide-descendants">
            {/* an unbroken wax seal (pressed rim, no glyph): a check here would read as "already allowed" */}
            <View style={[styles.sealRim, { borderColor: withAlpha(c.onSeal, 0.6) }]} />
          </View>
        )}
        <View style={styles.headerText}>
          <HText variant="headline" accessibilityRole="header" numberOfLines={4}>
            {title}
          </HText>
          {level !== 'normal' ? (
            <View style={styles.riskRow}>
              <View style={[styles.riskDot, { backgroundColor: c.seal }]} />
              <HText variant="caption" color="muted" style={styles.flex1}>
                {view.smartDenied ? (
                  <HText variant="caption" weight="600">
                    {tr('approvals.risk.flagged')}
                  </HText>
                ) : (
                  <>
                    <HText variant="caption" weight="600">
                      {tr(level === 'high' ? 'approvals.risk.short.high' : 'approvals.risk.short.elevated')}
                    </HText>
                    {estimatedRisk ? ` · ${tr('approvals.risk.byApp')}` : ''}
                  </>
                )}
              </HText>
            </View>
          ) : null}
        </View>
        {onDismiss ? (
          <PressableScale
            onPress={expired && close ? close : onDismiss}
            haptic="selection"
            hitSlop={8}
            disabled={busy}
            accessibilityLabel={expired ? tr('approvals.sheet.close') : tr('approvals.sheet.dismiss')}
            style={[styles.closeBtn, { backgroundColor: c.surfaceAlt }]}
          >
            <Icon name="x" size={16} color={c.muted} />
          </PressableScale>
        ) : null}
      </View>

      {/* command: invisible / control characters are escaped (approvalModel.displayCommand); anything unusual is flagged */}
      {view.command && view.commandUnusual ? (
        <View accessibilityRole="alert" style={[styles.noteBox, { backgroundColor: c.warningSoft, borderRadius: t.radii.control }]}>
          <Icon name="alert" size={16} color={c.warning} />
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
        <View style={[styles.cmdBox, { backgroundColor: c.codeBg, borderColor: c.border, borderRadius: t.radii.control }]}>
          <View style={styles.cmdHead}>
            <HText variant="caption" weight="600" color="muted" style={styles.flex1}>
              {tr('approvals.command.label', { count: view.lineCount })}
            </HText>
            <PressableScale
              onPress={copy}
              haptic={false}
              hitSlop={8}
              accessibilityLabel={copied ? tr('approvals.command.copiedA11y') : tr('approvals.command.copyA11y')}
              style={styles.copyBtn}
            >
              <Icon name={copied ? 'check' : 'copy'} size={14} color={copied ? c.success : c.muted} />
              <HText variant="caption" color={copied ? 'success' : 'muted'}>
                {copied ? tr('approvals.command.copied') : tr('approvals.command.copy')}
              </HText>
            </PressableScale>
          </View>
          {/* long lines wrap (no horizontal scroll); very long commands scroll vertically inside the block */}
          <ScrollView style={[styles.cmdScroll, { maxHeight: Math.round(150 * t.fontScale) }]} nestedScrollEnabled showsVerticalScrollIndicator>
            <HText variant="code" selectable accessibilityLabel={tr('approvals.command.a11y', { command: view.commandDisplay })} style={{ fontFamily: t.fonts.mono, color: c.codeText }}>
              {view.commandDisplay}
            </HText>
          </ScrollView>
        </View>
      ) : null}

      {/* reason (server text) */}
      {view.description ? (
        <View style={styles.reason}>
          <HText variant="caption" color="muted">
            {bot ? tr('approvals.reason.labelBot', { name: bot.name }) : tr('approvals.reason.label')}
          </HText>
          <HText variant="body" selectable>
            {view.description}
          </HText>
        </View>
      ) : null}

      {/* bot chat: calm "waiting since" line instead of a running clock (the countdown below takes over at the end) */}
      {!showCountdown && bot ? (
        <View style={styles.sinceRow} accessible accessibilityLabel={tr('approvals.waiting.sinceA11y', { name: bot.name, time: sinceText })}>
          <Icon name="timer" size={14} color={c.muted} />
          <HText variant="caption" color="muted">
            {tr('approvals.waiting.since', { name: bot.name, time: sinceText })}
          </HText>
        </View>
      ) : null}
      {/* countdown: brass progress (accent = progress), the text turns to danger in the last 30 s */}
      {showCountdown ? (
      <View
        style={styles.countdownRow}
        accessible
        accessibilityLabel={
          expired ? tr('approvals.countdown.expired') : tr('approvals.countdown.spoken', { minutes: Math.floor(left / 60), seconds: left % 60 })
        }
      >
        <View style={[styles.track, { backgroundColor: c.surfaceAlt }]}>
          <View style={[styles.bar, { width: `${Math.round(frac * 100)}%`, backgroundColor: c.accent }]} />
        </View>
        <HText variant="caption" tabular color={expired || left <= 30 ? 'danger' : 'muted'}>
          {expired
            ? tr('approvals.countdown.expired')
            : view.deadlineEstimated
              ? tr('approvals.countdown.left', { time: formatCountdown(left) })
              : tr('approvals.countdown.leftExact', { time: formatCountdown(left) })}
        </HText>
      </View>
      ) : null}
      {expired && !failed ? (
        <View accessibilityRole="alert" style={[styles.noteBox, { backgroundColor: c.dangerSoft, borderRadius: t.radii.control }]}>
          <Icon name="alert" size={16} color={c.danger} />
          <HText variant="callout" color="danger" style={styles.flex1}>
            {bot ? tr('approvals.waiting.expired', { name: bot.name }) : tr('approvals.countdown.expiredNote')}
          </HText>
        </View>
      ) : null}

      {/* error */}
      {failed ? (
        <View
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={[styles.noteBox, { backgroundColor: c.dangerSoft, borderRadius: t.radii.control }]}
        >
          <Icon name="alert" size={16} color={c.danger} />
          <HText variant="callout" color="danger" style={styles.flex1}>
            {tr(failed.error.messageKey)}
          </HText>
        </View>
      ) : null}
      {done ? (
        <View accessibilityLiveRegion="polite" style={styles.sentRow}>
          <Icon name="check" size={16} color={c.success} />
          <HText variant="callout" color="success">
            {tr('approvals.sheet.sent')}
          </HText>
        </View>
      ) : null}

      {/* second step for "always" at high risk: "Back" is the recommended way */}
      {confirming && !expired ? (
        <View accessibilityRole="alert" style={[styles.confirmBox, { borderColor: withAlpha(c.seal, 0.4), backgroundColor: c.sealSoft, borderRadius: t.radii.control }]}>
          <HText variant="bodyStrong" style={{ color: c.seal }}>
            {tr('approvals.confirm.title')}
          </HText>
          <HText variant="callout">{scoped && bot ? tr('approvals.confirm.bodyBot', { name: bot.name }) : tr('approvals.confirm.body')}</HText>
          <View style={styles.actionRow}>
            <Button label={tr('approvals.confirm.back')} variant="primary" haptic="selection" numberOfLines={2} onPress={() => setConfirming(null)} style={styles.flowBtn} />
            <Button
              label={scoped && bot ? tr('approvals.confirm.yesBot', { name: bot.name }) : tr('approvals.confirm.yes')}
              variant="secondary"
              tone="seal"
              haptic="medium"
              numberOfLines={2}
              onPress={() => submit(confirming, true)}
              style={styles.flowBtn}
            />
          </View>
        </View>
      ) : null}

      {/* choices */}
      {confirming && !expired ? null : scoped ? (
        // a non-default bot: "Always allow" only touches this bot's allowlist → one stack of plain choices
        <View style={styles.choices}>
          {view.choices.map((ch) => {
            const text = alwaysText(ch);
            return (
              <View key={ch.value} style={styles.botChoice}>
                <ChoiceButton {...choiceProps(ch)} text={text} variant={ch.kind === 'danger' ? 'secondary' : undefined} block />
                {text?.hint ? (
                  <HText variant="caption" color="muted" align="center">
                    {text.hint}
                  </HText>
                ) : null}
              </View>
            );
          })}
          {(expired || (failed && !failed.error.retryable)) && close ? (
            <Button label={tr('actions.close')} variant="secondary" haptic="selection" onPress={close} />
          ) : null}
        </View>
      ) : (
        <View style={styles.choices}>
          {/* side by side while both labels fit, otherwise stacked (wrap) – never truncated */}
          <View style={styles.actionRow}>
            {main.map((ch) => (
              <ChoiceButton key={ch.value} {...choiceProps(ch)} />
            ))}
          </View>
          {showSessionNote ? (
            <HText variant="caption" color="muted">
              {tr('approvals.choice.session.label')}: {tr('approvals.choice.session.hint')}
            </HText>
          ) : null}
          {quietDeny || always ? (
            <View style={styles.quietRow}>
              {quietDeny ? <ChoiceButton {...choiceProps(quietDeny)} /> : <View />}
              {always ? (
                <Button
                  label={moreShown ? tr('approvals.choice.less') : tr('approvals.choice.more')}
                  variant="tertiary"
                  icon={moreShown ? 'chevronDown' : 'chevronRight'}
                  numberOfLines={2}
                  disabled={activeChoice === 'always' && (busy || done)}
                  onPress={() => setMoreOpen((o) => !o)}
                  accessibilityState={{ expanded: moreShown }}
                />
              ) : null}
            </View>
          ) : null}
          {always && moreShown ? (
            <View style={[styles.more, { borderColor: c.border, borderRadius: t.radii.control }]}>
              <ChoiceButton {...choiceProps(always)} />
              {always.hintKey ? (
                <HText variant="caption" color="muted">
                  {tr(always.hintKey)}
                </HText>
              ) : null}
            </View>
          ) : null}
          {(expired || (failed && !failed.error.retryable)) && close ? (
            <Button label={tr('actions.close')} variant="secondary" haptic="selection" onPress={close} />
          ) : null}
        </View>
      )}
    </Animated.View>
  );
}

/** One answer as a `Button`: primary (the recommended answer), secondary (alternatives), tertiary (quiet Deny). */
function ChoiceButton({
  choice,
  sending,
  retry,
  disabled,
  onPress,
  text,
  variant: forced,
  block,
}: {
  choice: ChoiceView;
  sending: boolean;
  retry: boolean;
  disabled: boolean;
  onPress: () => void;
  /** bot chat: own label / spoken text / hint (the per-bot "Always allow") */
  text?: { label: string; a11y: string; hint?: string };
  variant?: 'primary' | 'secondary' | 'tertiary';
  /** full width (bot chat stack) */
  block?: boolean;
}) {
  const t = useTheme();
  const tr = useT();
  const label = text?.label ?? tr(choice.labelKey);
  const variant = forced ?? (choice.kind === 'primary' || choice.kind === 'denyPrimary' ? 'primary' : choice.kind === 'danger' ? 'tertiary' : 'secondary');
  // the label says what gets allowed ("Always allow (everywhere, …)"): more lines at large text instead of cutting it
  const labelLines = scaledLineLimit(3, t.fontScale * (useWindowDimensions().fontScale || 1));
  return (
    <Button
      label={retry ? tr('approvals.choice.retry', { label }) : label}
      variant={variant}
      onPress={onPress}
      loading={sending}
      disabled={disabled}
      numberOfLines={labelLines}
      haptic={choice.kind === 'danger' || choice.kind === 'denyPrimary' ? 'medium' : 'light'}
      accessibilityLabel={text?.a11y ?? tr(choice.a11yKey)}
      accessibilityHint={text ? text.hint : choice.hintKey ? tr(choice.hintKey) : undefined}
      accessibilityState={{ busy: sending }}
      style={block ? styles.blockBtn : variant === 'tertiary' ? null : styles.flowBtn}
    />
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, padding: 16, gap: 12, alignSelf: 'stretch' },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  // the seal sits on the title's first line (headline 23 px line: (23 - 20) / 2 ≈ 2)
  seal: { width: 20, height: 20, borderRadius: 10, marginTop: 2, alignItems: 'center', justifyContent: 'center' },
  sealRim: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5 },
  sealBadge: { position: 'absolute', right: -3, bottom: -3, width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  sinceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  botChoice: { gap: 4 },
  blockBtn: { alignSelf: 'stretch' },
  headerText: { flex: 1, gap: 2 },
  riskRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  riskDot: { width: 6, height: 6, borderRadius: 3 },
  closeBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginTop: -10, marginRight: -6 },
  countdownRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  track: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  bar: { height: 4, borderRadius: 2 },
  cmdBox: { borderWidth: StyleSheet.hairlineWidth, paddingLeft: 12, paddingRight: 4, paddingBottom: 10, gap: 2 },
  cmdHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, minWidth: 44, paddingHorizontal: 8, justifyContent: 'center' },
  cmdScroll: { flexGrow: 0, paddingRight: 8 },
  reason: { gap: 2 },
  confirmBox: { borderWidth: 1, padding: 12, gap: 8 },
  noteBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 },
  sentRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flex1: { flex: 1 },
  choices: { gap: 8 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // natural width first (both in one row when they fit), then grow; a label too long for half the row wraps the button onto its own line
  flowBtn: { flexGrow: 1, flexBasis: 'auto', maxWidth: '100%' },
  quietRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 4, marginHorizontal: -10 },
  more: { borderWidth: StyleSheet.hairlineWidth, padding: 10, gap: 6 },
});
