/**
 * `paths` – 2–6 ways / variants / architectures in one card. Each row: bold title left, verdict pill
 * right (wraps under the title when the line is too narrow), a centred chain of node pills with
 * optional icons joined by arrows (wraps onto several lines; every line after the first starts with
 * "→ Node", so arrows always stay between nodes), and one muted note line.
 *
 * `select: true` turns the rows into a single choice: tap highlights the row and – after the usual
 * 1.5 s undo window – sends `[paths:<id>] <title>` (useSend → chat/sendGate, composed = one tap).
 * The pick is persisted per node; "Anders wählen" re-opens. Without `select` it is display-only.
 */
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useTheme, type Theme } from '../../../theme';
import { useHui } from '../../../primitives/context';
import { FadeIn, HText, InlineText, PressableScale, Surface } from '../../../primitives/basics';
import { Icon } from '../../../primitives/Icon';
import { haptic } from '../../../primitives/haptics';
import { NARROW_TEXT_PROPS } from '../../../lib/textWrap';
import { useNodeState } from '../../../../nodestate';
import { useT } from '../../../../i18n';
import type { HuiPaths } from '../../../types';
import { PathRowSkeleton, PathsSkeleton } from '../../../skeletons';
import { ProvenanceChip } from '../ProvenanceChip';
import { UndoBar, useModuleId, usePendingCommit, useSend } from '../a/shared';
import { INITIAL_PATHS_STATE, badgeColorKeys, chainUnits, pathsSelectReply, readPaths, rowA11yLabel, type PathRowModel, type PathStepModel, type PathsState } from './pathsModel.ts';
import { PathIcon } from './icons';

export function Paths({ node }: { node: Partial<HuiPaths> }) {
  const t = useTheme();
  const tr = useT();
  const { streaming } = useHui();
  const id = useModuleId('paths', node as Record<string, unknown>);
  const model = useMemo(() => readPaths(node), [node]);
  const [st, setSt] = useNodeState<PathsState>(id, INITIAL_PATHS_STATE);
  const [draft, setDraft] = useState<string | null>(null);
  const send = useSend(id);
  const undo = usePendingCommit();

  if (!model.items.length) return streaming ? <PathsSkeleton /> : null;

  const select = model.select;
  const answered = select && st.picked !== null && model.items.some((r) => r.key === st.picked);
  const active = answered ? st.picked : select ? draft : null;
  const canTap = select && !streaming && !answered && !undo.pending;

  const pick = (row: PathRowModel) => {
    if (!canTap) return;
    const reply = pathsSelectReply(id, model, row.key);
    if (!reply) return;
    setDraft(row.key);
    undo.start(tr('ui.paths.sending', { title: row.title }), () => {
      if (!send(reply)) return; // a turn is running → stays open, the row stays highlighted
      setSt({ picked: row.key, title: row.title });
    });
  };
  const reopen = () => {
    haptic('selection');
    setDraft(null);
    setSt(INITIAL_PATHS_STATE);
  };

  return (
    <Surface style={{ gap: t.spacing.m }}>
      {model.title ? <InlineText variant="headline" text={model.title} accessibilityRole="header" /> : null}
      <View style={{ gap: select ? t.spacing.s : t.spacing.l }} accessibilityRole={select ? 'radiogroup' : undefined}>
        {model.items.map((row, i) => (
          <FadeIn key={row.key} delay={streaming ? 0 : Math.min(i, 5) * 40}>
            <Row t={t} row={row} select={select} selected={active === row.key} dimmed={answered && active !== row.key} disabled={!canTap} onPress={() => pick(row)} hint={tr('ui.paths.rowHint')} />
          </FadeIn>
        ))}
        {streaming ? <PathRowSkeleton /> : null}
      </View>
      {select && canTap ? (
        <HText variant="caption" color="subtle" align="center">
          {tr('ui.paths.selectHint')}
        </HText>
      ) : null}
      {undo.pending ? (
        <UndoBar
          label={undo.pending.label}
          ms={undo.ms}
          onUndo={() => {
            undo.cancel();
            setDraft(null);
          }}
        />
      ) : null}
      {answered ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: t.spacing.m, rowGap: t.spacing.xs }}>
          <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
            <Icon name="checkCircle" size={16} color={t.colors.success} strokeWidth={2} />
            <HText variant="callout" weight="600" style={{ color: t.colors.success, flexShrink: 1 }}>
              {tr('ui.paths.sent', { title: st.title ?? model.items.find((r) => r.key === st.picked)?.title ?? '' })}
            </HText>
          </View>
          <PressableScale haptic={false} onPress={reopen} accessibilityRole="button" hitSlop={6} style={{ minHeight: 36, justifyContent: 'center' }}>
            <HText variant="caption" color="accent" weight="500">
              {tr('ui.paths.change')}
            </HText>
          </PressableScale>
        </View>
      ) : null}
      <ProvenanceChip basis={model.basis} source={model.source} />
    </Surface>
  );
}

function Row({ t, row, select, selected, dimmed, disabled, onPress, hint }: { t: Theme; row: PathRowModel; select: boolean; selected: boolean; dimmed: boolean; disabled: boolean; onPress: () => void; hint: string }) {
  const label = rowA11yLabel(row);
  const body = (
    <View style={{ gap: t.spacing.s }}>
      <Header t={t} row={row} select={select} selected={selected} />
      {row.path.length ? <Chain t={t} path={row.path} /> : null}
      {row.note ? (
        <HText {...NARROW_TEXT_PROPS} variant="caption" color="muted" align="center">
          {row.note}
        </HText>
      ) : null}
    </View>
  );
  if (!select) {
    return (
      <View accessible accessibilityLabel={label}>
        {body}
      </View>
    );
  }
  return (
    <PressableScale
      haptic="selection"
      scaleTo={0.985}
      disabled={disabled}
      dimDisabled={false}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityHint={disabled ? undefined : hint}
      accessibilityState={{ selected, checked: selected, disabled }}
      style={{
        padding: t.spacing.m,
        borderRadius: t.radii.m,
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? t.colors.accent : t.colors.border,
        backgroundColor: selected ? t.colors.accentSoft : t.colors.surface,
        opacity: dimmed ? 0.55 : 1,
      }}
      pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
    >
      {body}
    </PressableScale>
  );
}

/** Title left, badge right; on a narrow line the badge wraps below the title. */
function Header({ t, row, select, selected }: { t: Theme; row: PathRowModel; select: boolean; selected: boolean }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', columnGap: t.spacing.s, rowGap: t.spacing.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.s, flexGrow: 1, flexShrink: 1 }}>
        {select ? <Radio t={t} on={selected} /> : null}
        <HText {...NARROW_TEXT_PROPS} variant="bodyStrong" style={{ flexShrink: 1 }}>
          {row.title}
        </HText>
      </View>
      {row.badge ? <Badge t={t} text={row.badge.text} tone={row.badge.tone} /> : null}
    </View>
  );
}

function Badge({ t, text, tone }: { t: Theme; text: string; tone: Parameters<typeof badgeColorKeys>[0] }) {
  const c = badgeColorKeys(tone);
  return (
    <View style={{ backgroundColor: t.colors[c.bg], borderRadius: t.radii.pill, paddingHorizontal: 9, paddingVertical: 2, marginTop: 1, maxWidth: '100%' }}>
      <HText variant="micro" weight="600" style={{ color: t.colors[c.fg] }}>
        {text}
      </HText>
    </View>
  );
}

function Radio({ t, on }: { t: Theme; on: boolean }) {
  return (
    <View style={{ width: 18, height: 18, borderRadius: 9, marginTop: 2, borderWidth: on ? 0 : 1.5, borderColor: t.colors.borderStrong, backgroundColor: on ? t.colors.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
      {on ? <Icon name="check" size={12} color={t.colors.onAccent} strokeWidth={2.5} /> : null}
    </View>
  );
}

/** Centred, wrapping chain; arrow + node form one unit so a line never ends with an arrow. */
function Chain({ t, path }: { t: Theme; path: PathStepModel[] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', columnGap: 6, rowGap: 6 }}>
      {chainUnits(path).map((u) => (
        <View key={u.index} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%', flexShrink: 1 }}>
          {u.arrow ? <Icon name="arrowRight" size={14} color={t.colors.subtle} strokeWidth={2} /> : null}
          <StepPill t={t} step={u.step} />
        </View>
      ))}
    </View>
  );
}

function StepPill({ t, step }: { t: Theme; step: PathStepModel }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1, paddingHorizontal: 9, paddingVertical: 4, borderRadius: step.detail ? t.radii.s : t.radii.pill, backgroundColor: t.colors.surfaceAlt }}>
      {step.icon ? <PathIcon name={step.icon} size={14} color={t.colors.muted} /> : null}
      <View style={{ flexShrink: 1 }}>
        <HText {...NARROW_TEXT_PROPS} variant="caption" weight="500">
          {step.label}
        </HText>
        {step.detail ? (
          <HText {...NARROW_TEXT_PROPS} variant="micro" color="muted">
            {step.detail}
          </HText>
        ) : null}
      </View>
    </View>
  );
}
