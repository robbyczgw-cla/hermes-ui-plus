import { useEffect, useMemo, useState } from 'react';
import { TextInput, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useT } from '../../../../i18n';
import { useMotionReduced, useTheme, type Theme } from '../../../theme';
import { useHui } from '../../../primitives/context';
import { Badge, FadeIn, HText, InlineText, PressableScale, Surface, textStyle } from '../../../primitives/basics';
import { Icon } from '../../../primitives/Icon';
import { Skeleton } from '../../../primitives/Skeleton';
import { haptic } from '../../../primitives/haptics';
import { useNodeState } from '../../../../nodestate';
import type { HuiPoll } from '../../../types';
import { PrimaryButton, SecondaryButton, useModuleId, useSend } from '../a/shared';
import { C1Icon } from './icons';
import { useSettledAfter } from '../../../lib/useSettledAfter';
import {
  addOption,
  allOptions,
  cancelVoting,
  castBallot,
  finishVoting,
  INITIAL_POLL_STATE,
  MAX_OPTIONS,
  pollReply,
  readPoll,
  removeOption,
  startVoting,
  tally,
  toggleDraft,
  undoLastBallot,
  voterPhase,
  type PollState,
  type TallyRow,
} from './pollModel.ts';

/**
 * `poll` – votes persisted in node state. With `voters`: pass-the-phone (pick your name → vote →
 * hand-off screen for the next person), one editable vote set per voter. Without: anonymous
 * ballots ("Stimme abgeben", undo last). Live animated result bars, optional "Option hinzufügen",
 * "Ergebnis senden" → `[poll:<id>] Pizza 3 · Sushi 1 (4 Stimmen)`, then locked with "Neu abstimmen".
 */
export function Poll({ node }: { node: Partial<HuiPoll> }) {
  const tr = useT();
  const t = useTheme();
  const { streaming } = useHui();
  const id = useModuleId('poll', node as Record<string, unknown>);
  const poll = useMemo(() => readPoll(node), [node]);
  const [st, setSt] = useNodeState<PollState>(id, INITIAL_POLL_STATE);
  const options = useMemo(() => allOptions(poll, st), [poll, st]);
  const res = useMemo(() => tally(options, st.votes, poll.multiple), [options, st.votes, poll.multiple]);
  const named = poll.voters.length > 0;
  const phase = named ? voterPhase(poll.voters, st) : null;
  const [draft, setDraft] = useState<string[]>(() => (st.active ? st.votes[st.active] ?? [] : []));
  const [counted, setCounted] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const send = useSend(id);

  // a new voter starts from their stored vote (or empty)
  useEffect(() => {
    setDraft(st.active ? st.votes[st.active] ?? [] : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.active]);

  if (!poll.question && !poll.options.length) return streaming ? <PollSkeleton /> : null;

  const locked = st.status === 'sent';
  const voting = phase === 'vote' || (!named && !locked);
  const selectable = voting && !streaming && !locked;
  const hideResults = locked ? false : phase === 'vote' && poll.anonymous;
  const tie = res.leaders.length > 1;

  const subtitle = [
    poll.multiple ? tr('ui.poll.multiple') : tr('ui.poll.single'),
    poll.anonymous ? tr('ui.poll.anonymous') : '',
    res.totalVotes ? tr('ui.poll.votes', { count: res.totalVotes }) : tr('ui.poll.noVotes'),
  ]
    .filter(Boolean)
    .join(' · ');

  const tap = (oid: string) => {
    if (!selectable) return;
    haptic('selection');
    setCounted(false);
    setDraft((d) => toggleDraft(d, oid, poll.multiple));
  };

  const commitSend = () => {
    const text = pollReply(id, poll, res);
    if (!send(text)) return; // refused (turn running) → stay open
    setSt((s) => ({ ...s, status: 'sent', active: null, next: null, sentText: text }));
  };

  return (
    <Surface style={{ gap: t.spacing.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.s }}>
        <View style={{ flex: 1, gap: 2 }}>
          {poll.question ? <InlineText variant="headline" text={poll.question} /> : <Skeleton width="60%" height={16} />}
          <HText variant="caption" color="muted" accessibilityLiveRegion="polite">
            {subtitle}
          </HText>
        </View>
      </View>

      {/* pass-the-phone flow */}
      {named && !locked && !streaming ? (
        <VoterPanel
          t={t}
          voters={poll.voters}
          st={st}
          phase={phase!}
          onPick={(name) => {
            haptic('selection');
            setCounted(false);
            setSt((s) => startVoting(s, name));
          }}
          onOther={() => setSt((s) => ({ ...s, next: null }))}
          onCancel={() => setSt((s) => cancelVoting(s))}
        />
      ) : null}

      {selectable ? (
        <HText variant="caption" color="subtle">
          {poll.multiple ? tr('ui.poll.pickHintMultiple') : tr('ui.poll.pickHintSingle')}
        </HText>
      ) : null}

      <View style={{ gap: t.spacing.s }} accessibilityRole={selectable && !poll.multiple ? 'radiogroup' : undefined}>
        {res.rows.map((row, i) => (
          <FadeIn key={row.id} delay={streaming ? 0 : Math.min(i, 6) * 45}>
            <OptionRow
              t={t}
              row={row}
              selectable={selectable}
              selected={draft.includes(row.id)}
              multiple={poll.multiple}
              showResult={!hideResults}
              leader={res.leaders.includes(row.id)}
              tie={tie}
              final={locked}
              voters={named && !poll.anonymous && !hideResults ? row.voters : []}
              allVoters={poll.voters}
              onPress={() => tap(row.id)}
              onRemove={row.added && !locked && !streaming && row.count === 0 ? () => setSt((s) => removeOption(s, row.id)) : undefined}
            />
          </FadeIn>
        ))}
        {streaming ? <Skeleton height={52} radius={t.radii.m} /> : null}
      </View>

      {hideResults ? (
        <HText variant="caption" color="muted" style={{ textAlign: 'center' }}>
          {tr('ui.poll.hiddenWhileVoting')}
        </HText>
      ) : null}

      {poll.allowAdd && !locked && !streaming && phase !== 'handoff' ? <AddOption t={t} poll={poll} st={st} setSt={setSt} onAdded={(oid) => voting && setDraft((d) => toggleDraft(d, oid, poll.multiple))} /> : null}

      {/* actions */}
      {locked ? (
        <View style={{ gap: t.spacing.s }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
            <Icon name="checkCircle" size={18} color={t.colors.success} />
            <HText variant="callout" color="muted" style={{ flex: 1 }}>
              {tr('ui.poll.sent')} · {tr('ui.poll.votes', { count: res.totalVotes })}
            </HText>
          </View>
          <SecondaryButton
            label={tr('ui.poll.revote')}
            onPress={() => {
              setDraft([]);
              setSt((s) => ({ ...s, status: 'open' }));
            }}
          />
        </View>
      ) : streaming ? null : phase === 'vote' ? (
        <View style={{ gap: t.spacing.s }}>
          <PrimaryButton
            label={tr('ui.poll.done')}
            icon="check"
            disabled={!draft.length}
            onPress={() => {
              haptic('success');
              setSt((s) => finishVoting(s, draft, poll, options));
            }}
          />
          {st.active && st.votes[st.active]?.length ? (
            <SecondaryButton label={tr('ui.poll.removeVote')} onPress={() => setSt((s) => finishVoting(s, [], poll, options))} />
          ) : null}
        </View>
      ) : (
        <View style={{ gap: t.spacing.s }}>
          {!named ? (
            <>
              <PrimaryButton
                label={tr('ui.poll.castVote')}
                icon="check"
                disabled={!draft.length}
                onPress={() => {
                  haptic('success');
                  setSt((s) => castBallot(s, draft, options, poll.multiple));
                  setDraft([]);
                  setCounted(true);
                }}
              />
              {counted ? (
                <FadeIn>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, flexWrap: 'wrap', justifyContent: 'center' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Icon name="checkCircle" size={16} color={t.colors.success} />
                      <HText variant="caption" color="success" accessibilityLiveRegion="polite">
                        {tr('ui.poll.voteCounted')}
                      </HText>
                    </View>
                    <PressableScale
                      haptic="selection"
                      onPress={() => {
                        setSt((s) => undoLastBallot(s));
                        setCounted(false);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={tr('ui.poll.undoLast')}
                      style={{ minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                    >
                      <C1Icon name="undo" size={14} color={t.colors.accent} />
                      <HText variant="caption" weight="600" color="accent">
                        {tr('ui.poll.undoLast')}
                      </HText>
                    </PressableScale>
                  </View>
                </FadeIn>
              ) : null}
            </>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, flexWrap: 'wrap' }}>
            {res.totalVotes > 0 ? (
              <PressableScale
                haptic={confirmReset ? 'warning' : 'selection'}
                onPress={() => {
                  if (!confirmReset) {
                    setConfirmReset(true);
                    return;
                  }
                  setConfirmReset(false);
                  setCounted(false);
                  setDraft([]);
                  setSt((s) => ({ ...INITIAL_POLL_STATE, added: s.added }));
                }}
                onBlur={() => setConfirmReset(false)}
                accessibilityRole="button"
                style={{ minHeight: 44, justifyContent: 'center', paddingRight: t.spacing.s }}
              >
                <HText variant="caption" weight="500" style={{ color: confirmReset ? t.colors.danger : t.colors.muted }}>
                  {confirmReset ? tr('ui.poll.resetConfirm') : tr('ui.poll.reset')}
                </HText>
              </PressableScale>
            ) : null}
            <PrimaryButton
              label={tr('ui.poll.send')}
              icon="send"
              disabled={res.totalVotes === 0}
              onPress={commitSend}
              style={{ flexGrow: 1 }}
            />
          </View>
        </View>
      )}
    </Surface>
  );
}

/* ───────────── voter panel (pass the phone) ───────────── */

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const s = parts.length > 1 ? parts[0][0] + parts[1][0] : name.trim().slice(0, 2);
  return s.toUpperCase();
}

function voterColor(t: Theme, voters: readonly string[], name: string): string {
  const i = Math.max(0, voters.indexOf(name));
  return t.colors.chart[i % t.colors.chart.length] ?? t.colors.accent;
}

function Avatar({ t, name, color, size = 28 }: { t: Theme; name: string; color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: color, backgroundColor: t.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
      <HText style={{ fontSize: size * 0.38, lineHeight: size * 0.5, fontWeight: '700', color: t.colors.text }}>{initials(name)}</HText>
    </View>
  );
}

function VoterPanel({
  t,
  voters,
  st,
  phase,
  onPick,
  onOther,
  onCancel,
}: {
  t: Theme;
  voters: string[];
  st: PollState;
  phase: 'pick' | 'handoff' | 'vote' | 'done';
  onPick: (name: string) => void;
  onOther: () => void;
  onCancel: () => void;
}) {
  const tr = useT();
  const done = voters.filter((v) => st.votes[v]?.length).length;

  if (phase === 'vote' && st.active) {
    return (
      <FadeIn key={`vote-${st.active}`}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, padding: t.spacing.s, paddingLeft: t.spacing.m, borderRadius: t.radii.m, backgroundColor: t.colors.accentSoft }}>
          <Avatar t={t} name={st.active} color={voterColor(t, voters, st.active)} size={32} />
          <HText variant="bodyStrong" style={{ flex: 1, color: t.colors.accent }} accessibilityLiveRegion="polite" numberOfLines={1}>
            {tr('ui.poll.votingAs', { name: st.active })}
          </HText>
          <PressableScale
            haptic="selection"
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel={tr('ui.poll.cancel')}
            hitSlop={4}
            style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}
            pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
          >
            <Icon name="x" size={18} color={t.colors.accent} />
          </PressableScale>
        </View>
      </FadeIn>
    );
  }

  if (phase === 'handoff' && st.next) {
    return (
      <FadeIn key={`handoff-${st.next}`}>
        <View style={{ alignItems: 'center', gap: t.spacing.m, padding: t.spacing.l, borderRadius: t.radii.m, backgroundColor: t.colors.surfaceAlt }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
            <C1Icon name="phone" size={22} color={t.colors.accent} />
            <Icon name="arrowRight" size={16} color={t.colors.subtle} />
            <Avatar t={t} name={st.next} color={voterColor(t, voters, st.next)} size={36} />
          </View>
          <HText variant="headline" align="center" accessibilityLiveRegion="polite">
            {tr('ui.poll.passTo', { name: st.next })}
          </HText>
          <HText variant="caption" color="muted">
            {tr('ui.poll.progress', { done, total: voters.length })}
          </HText>
          <View style={{ width: '100%', gap: t.spacing.s }}>
            <PrimaryButton label={tr('ui.poll.iAm', { name: st.next })} onPress={() => onPick(st.next!)} />
            <SecondaryButton label={tr('ui.poll.otherPerson')} onPress={onOther} />
          </View>
        </View>
      </FadeIn>
    );
  }

  return (
    <View style={{ gap: t.spacing.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
        {phase === 'done' ? <Icon name="checkCircle" size={16} color={t.colors.success} /> : <C1Icon name="user" size={16} color={t.colors.muted} />}
        <HText variant="callout" weight="600" style={{ flex: 1, color: phase === 'done' ? t.colors.success : t.colors.text }}>
          {phase === 'done' ? tr('ui.poll.allVoted') : tr('ui.poll.whoVotes')}
        </HText>
        <HText variant="caption" color="muted" tabular>
          {done}/{voters.length}
        </HText>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.s }}>
        {voters.map((v) => {
          const has = !!st.votes[v]?.length;
          const c = voterColor(t, voters, v);
          return (
            <PressableScale
              key={v}
              haptic={false}
              onPress={() => onPick(v)}
              accessibilityRole="button"
              accessibilityLabel={has ? tr('ui.poll.voterVoted', { name: v }) : tr('ui.poll.voterOpen', { name: v })}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                minHeight: 44,
                paddingLeft: 6,
                paddingRight: 14,
                borderRadius: t.radii.pill,
                borderWidth: 1,
                borderColor: has ? t.colors.success : t.colors.borderStrong,
                backgroundColor: has ? t.colors.successSoft : t.colors.surface,
              }}
              pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
            >
              <Avatar t={t} name={v} color={c} size={30} />
              <HText variant="callout" weight="500" numberOfLines={1}>
                {v}
              </HText>
              {has ? <Icon name="check" size={14} color={t.colors.success} strokeWidth={2.6} /> : null}
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

/* ───────────── option row with live bar ───────────── */

function OptionRow({
  t,
  row,
  selectable,
  selected,
  multiple,
  showResult,
  leader,
  tie,
  final,
  voters,
  allVoters,
  onPress,
  onRemove,
}: {
  t: Theme;
  row: TallyRow;
  selectable: boolean;
  selected: boolean;
  multiple: boolean;
  showResult: boolean;
  leader: boolean;
  tie: boolean;
  final: boolean;
  voters: string[];
  allVoters: string[];
  onPress: () => void;
  onRemove?: () => void;
}) {
  const tr = useT();
  const hot = showResult && leader;
  const label = `${showResult ? tr('ui.poll.a11yOption', { label: row.label, count: row.count, percent: row.percent }) : row.label}${selected ? tr('ui.poll.a11ySelected') : ''}`;
  const body = (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
        {selectable ? <Indicator t={t} on={selected} multiple={multiple} /> : null}
        {row.emoji ? <HText style={{ fontSize: 20, lineHeight: 26 }}>{row.emoji}</HText> : null}
        <HText variant={hot ? 'bodyStrong' : 'body'} style={{ flex: 1 }} numberOfLines={2}>
          {row.label}
        </HText>
        {hot && final ? <C1Icon name="trophy" size={16} color={t.colors.accent} /> : null}
        {hot && !final && !tie ? <Badge label={tr('ui.poll.leading')} /> : null}
        {hot && tie && row.count > 0 ? <Badge label={tr('ui.poll.tie')} tone="neutral" /> : null}
        {showResult ? <Count t={t} count={row.count} percent={row.percent} hot={hot} /> : null}
        {onRemove ? (
          <PressableScale
            haptic="selection"
            onPress={onRemove}
            accessibilityRole="button"
            accessibilityLabel={tr('ui.poll.removeOption', { label: row.label })}
            hitSlop={6}
            style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}
            pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
          >
            <Icon name="x" size={14} color={t.colors.muted} />
          </PressableScale>
        ) : null}
      </View>
      {showResult ? <Bar t={t} percent={row.percent} hot={hot} /> : null}
      {voters.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
          {voters.map((v) => (
            <Avatar key={v} t={t} name={v} color={voterColor(t, allVoters, v)} size={22} />
          ))}
        </View>
      ) : null}
    </View>
  );
  const style = {
    paddingHorizontal: t.spacing.m,
    paddingVertical: t.spacing.s + 4,
    borderRadius: t.radii.m,
    borderWidth: selected ? 2 : 1,
    borderColor: selected ? t.colors.accent : t.colors.border,
    backgroundColor: selected ? t.colors.accentSoft : t.colors.surface,
    margin: selected ? 0 : 1,
  };
  if (!selectable) {
    return (
      <View style={style} accessible accessibilityLabel={label}>
        {body}
      </View>
    );
  }
  return (
    <PressableScale
      haptic={false}
      scaleTo={0.985}
      onPress={onPress}
      accessibilityRole={multiple ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: selected, selected }}
      accessibilityLabel={label}
      style={style}
      pressedStyle={{ backgroundColor: selected ? t.colors.accentSoft : t.colors.surfacePressed }}
    >
      {body}
    </PressableScale>
  );
}

function Indicator({ t, on, multiple }: { t: Theme; on: boolean; multiple: boolean }) {
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: multiple ? 6 : 11,
        borderWidth: on ? 0 : 1.5,
        borderColor: t.colors.borderStrong,
        backgroundColor: on ? t.colors.accent : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {on ? multiple ? <Icon name="check" size={14} color={t.colors.onAccent} strokeWidth={2.75} /> : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.colors.onAccent }} /> : null}
    </View>
  );
}

/** Count + percent; pops briefly when the count changes. */
function Count({ t, count, percent, hot }: { t: Theme; count: number; percent: number; hot: boolean }) {
  const reduced = useMotionReduced();
  const s = useSharedValue(1);
  const [prev, setPrev] = useState(count);
  useEffect(() => {
    if (count === prev) return;
    setPrev(count);
    if (!reduced) s.value = withSequence(withTiming(1.22, { duration: 110 }), withSpring(1, { damping: 12, stiffness: 260 }));
  }, [count, prev, reduced, s]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
      <Animated.View style={anim}>
        <HText variant="callout" weight="700" tabular style={{ color: hot ? t.colors.accent : t.colors.text }}>
          {count}
        </HText>
      </Animated.View>
      <HText variant="caption" color="muted" tabular style={{ minWidth: 38, textAlign: 'right' }}>
        {percent} %
      </HText>
    </View>
  );
}

function Bar({ t, percent, hot }: { t: Theme; percent: number; hot: boolean }) {
  const reduced = useMotionReduced();
  const [w, setW] = useState(0);
  const p = useSharedValue(0);
  const target = Math.max(0, Math.min(100, percent)) / 100;
  useEffect(() => {
    if (!w) return;
    p.value = reduced ? target * w : withTiming(target * w, { duration: 520, easing: Easing.out(Easing.cubic) });
  }, [target, w, reduced, p]);
  const anim = useAnimatedStyle(() => ({ width: p.value }));
  // settled: React owns the final width (a dropped animated value would reset the bar to 0)
  const settled = useSettledAfter(reduced ? 0 : 600, [target, reduced]);
  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
      style={{ height: 8, borderRadius: 4, backgroundColor: t.colors.surfaceAlt, overflow: 'hidden' }}
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View style={[{ height: 8, borderRadius: 4, backgroundColor: hot ? t.colors.accent : t.colors.borderStrong }, anim, settled ? { width: target * w } : null]} />
    </View>
  );
}

/* ───────────── add option ───────────── */

function AddOption({ t, poll, st, setSt, onAdded }: { t: Theme; poll: ReturnType<typeof readPoll>; st: PollState; setSt: (s: PollState) => void; onAdded: (id: string) => void }) {
  const tr = useT();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [focus, setFocus] = useState(false);
  const full = allOptions(poll, st).length >= MAX_OPTIONS;

  if (!open) {
    return (
      <PressableScale
        haptic="selection"
        disabled={full}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, alignSelf: 'flex-start', paddingRight: t.spacing.s }}
      >
        <Icon name="plus" size={16} color={t.colors.accent} strokeWidth={2.2} />
        <HText variant="callout" weight="600" color="accent">
          {full ? tr('ui.poll.maxOptions', { max: MAX_OPTIONS }) : tr('ui.poll.addOption')}
        </HText>
      </PressableScale>
    );
  }

  const submit = () => {
    const r = addOption(st, poll, text);
    if (r.error === 'empty') return;
    if (r.error) {
      haptic('warning');
      setErr(r.error === 'exists' ? tr('ui.poll.optionExists') : tr('ui.poll.maxOptions', { max: MAX_OPTIONS }));
      return;
    }
    haptic('success');
    setSt(r.state);
    if (r.id) onAdded(r.id);
    setText('');
    setErr(null);
    setOpen(false);
  };

  return (
    <FadeIn>
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', gap: t.spacing.s, alignItems: 'center' }}>
          <TextInput
            value={text}
            onChangeText={(s) => {
              setText(s);
              setErr(null);
            }}
            placeholder={tr('ui.poll.addPlaceholder')}
            placeholderTextColor={t.colors.subtle}
            accessibilityLabel={tr('ui.poll.addOption')}
            autoFocus
            maxLength={70}
            returnKeyType="done"
            onSubmitEditing={submit}
            onFocus={() => setFocus(true)}
            onBlur={() => setFocus(false)}
            style={[
              textStyle(t, 'body'),
              {
                flex: 1,
                minHeight: 44,
                borderRadius: t.radii.m,
                borderWidth: 1,
                borderColor: err ? t.colors.danger : focus ? t.colors.accent : t.colors.borderStrong,
                paddingHorizontal: t.spacing.m,
                color: t.colors.text,
                backgroundColor: t.colors.surface,
                outlineStyle: 'none',
              } as object,
            ]}
          />
          <PressableScale
            haptic={false}
            disabled={!text.trim()}
            onPress={submit}
            accessibilityRole="button"
            accessibilityLabel={tr('ui.poll.add')}
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: t.colors.accent, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="plus" size={20} color={t.colors.onAccent} strokeWidth={2.4} />
          </PressableScale>
        </View>
        {err ? (
          <HText variant="caption" color="danger" accessibilityLiveRegion="polite">
            {err}
          </HText>
        ) : null}
      </View>
    </FadeIn>
  );
}

function PollSkeleton() {
  const t = useTheme();
  const tr = useT();
  return (
    <Surface style={{ gap: t.spacing.m }}>
      <View accessible accessibilityLabel={tr('ui.poll.loading')} style={{ gap: t.spacing.s }}>
        <Skeleton width="60%" height={16} />
        <Skeleton width="35%" height={10} />
        {[0, 1, 2].map((k) => (
          <Skeleton key={k} height={52} radius={t.radii.m} />
        ))}
        <Skeleton height={44} radius={t.radii.pill} />
      </View>
    </Surface>
  );
}

