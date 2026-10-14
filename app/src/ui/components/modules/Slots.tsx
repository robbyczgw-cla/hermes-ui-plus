import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useTheme, type Theme } from '../../theme';
import { useHui } from '../../primitives/context';
import { BlockTitle, FadeIn, HText, PressableScale, Surface } from '../../primitives/basics';
import { Icon } from '../../primitives/Icon';
import { Skeleton } from '../../primitives/Skeleton';
import { haptic } from '../../primitives/haptics';
import { asOptString } from '../../lib/format';
import { useNodeState } from '../../../nodestate';
import type { HuiSlots } from '../../types';
import { groupSlotsByDay, readSlots, type SlotView } from './a/slotsModel.ts';
import { slotNoneReply, slotReply } from './a/replies.ts';
import { AnsweredSummary, UndoBar, useModuleId, usePendingCommit, useSend } from './a/shared';
import { ExtraIcon } from './a/ExtraIcon';
import { useS } from './useS';
import { useLocale } from '../../../i18n';
import { SlotsSkeleton } from '../../skeletons';

const NONE = '__none__';

type SlotsState = { answer: string | null; label?: string };

/**
 * `slots` – time/slot picker (OIUI meeting-time-picker). Tap a slot → 1.5 s undo → sends
 * `[slot:<id>] <label>`; the always-present "Keiner passt" row sends `[slot:<id>] keiner passt`.
 * Locks after answering (persisted).
 */
export function Slots({ node }: { node: Partial<HuiSlots> }) {
  const t = useTheme();
  const S = useS();
  const { locale } = useLocale();
  const { streaming } = useHui();
  const id = useModuleId('slots', node as Record<string, unknown>);
  const slots = useMemo(() => readSlots(node.slots, new Date(), S, locale), [node.slots, S, locale]);
  const groups = useMemo(() => groupSlotsByDay(slots), [slots]);
  const [st, setSt] = useNodeState<SlotsState>(id, { answer: null });
  const [picked, setPicked] = useState<string | null>(null);
  const send = useSend(id);
  const undo = usePendingCommit();
  const title = asOptString(node.title) ?? S.slots.defaultTitle;
  const noneLabel = asOptString(node.noneLabel) ?? S.slots.none;
  const tz = asOptString(node.timezone);

  if (!slots.length && streaming) {
    return <SlotsSkeleton />;
  }

  if (st.answer) {
    const declined = st.answer === NONE;
    return (
      <Surface>
        <AnsweredSummary
          title={title}
          answer={declined ? S.slots.declined : st.label ?? st.answer}
          icon={declined ? 'x' : 'calendar'}
          tone={declined ? 'muted' : 'success'}
          onReopen={() => {
            haptic('selection');
            setPicked(null);
            setSt({ answer: null });
          }}
        />
      </Surface>
    );
  }

  const choose = (key: string, label: string, display: string = label) => {
    if (streaming || undo.pending) return;
    haptic('selection');
    setPicked(key);
    undo.start(key === NONE ? `${noneLabel} …` : S.choice.sendingAnswer(display), () => {
      if (!send(key === NONE ? slotNoneReply(id) : slotReply(id, label))) {
        setPicked(null); // refused (turn running) → stay open
        return;
      }
      setSt({ answer: key, label: display });
    });
  };

  let row = 0;
  return (
    <Surface style={{ gap: t.spacing.m }}>
      <BlockTitle title={title} subtitle={[S.slots.proposed, tz ? S.slots.timezone(tz) : ''].filter(Boolean).join(' · ')} />
      <View style={{ gap: t.spacing.m, marginTop: -t.spacing.s }}>
        {groups.map((g, gi) => (
          <View key={gi} style={{ gap: 6 }}>
            {g.day ? (
              <HText variant="micro" color="muted" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }} accessibilityRole="header">
                {g.day}
              </HText>
            ) : null}
            {g.slots.map((s) => (
              <FadeIn key={s.key} delay={streaming ? 0 : Math.min(row++, 6) * 60}>
                <SlotRow t={t} slot={s} on={picked === s.key} disabled={streaming || (!!undo.pending && picked !== s.key)} onPress={() => choose(s.key, s.label, s.display)} />
              </FadeIn>
            ))}
          </View>
        ))}
        {streaming ? <Skeleton height={52} radius={t.radii.m} /> : null}
        {!streaming ? (
          <PressableScale
            haptic={false}
            disabled={!!undo.pending && picked !== NONE}
            onPress={() => choose(NONE, noneLabel)}
            accessibilityRole="button"
            accessibilityState={{ selected: picked === NONE }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: t.spacing.m,
              minHeight: 48,
              paddingHorizontal: t.spacing.m,
              borderRadius: t.radii.m,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: picked === NONE ? t.colors.accent : t.colors.borderStrong,
              backgroundColor: picked === NONE ? t.colors.accentSoft : 'transparent',
            }}
            pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
          >
            <Icon name="x" size={16} color={t.colors.muted} />
            <HText variant="callout" color="muted" weight="500">
              {noneLabel}
            </HText>
          </PressableScale>
        ) : null}
      </View>
      {undo.pending ? (
        <UndoBar
          label={undo.pending.label}
          ms={undo.ms}
          onUndo={() => {
            undo.cancel();
            setPicked(null);
          }}
        />
      ) : null}
    </Surface>
  );
}

function SlotRow({ t, slot, on, disabled, onPress }: { t: Theme; slot: SlotView; on: boolean; disabled: boolean; onPress: () => void }) {
  const S = useS();
  const main = slot.time ?? slot.title ?? slot.display;
  const sub = [slot.time ? slot.title : undefined, slot.note].filter(Boolean).join(' · ');
  return (
    <PressableScale
      haptic={false}
      scaleTo={0.985}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on, disabled }}
      accessibilityLabel={S.slots.a11ySlot(slot.display + (slot.note ? `, ${slot.note}` : ''))}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.m,
        minHeight: 52,
        paddingHorizontal: t.spacing.m,
        paddingVertical: t.spacing.s,
        borderRadius: t.radii.m,
        borderWidth: on ? 1.5 : 1,
        borderColor: on ? t.colors.accent : t.colors.border,
        backgroundColor: on ? t.colors.accentSoft : t.colors.surface,
      }}
      pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
    >
      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: on ? t.colors.accent : t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
        {on ? <Icon name="check" size={16} color={t.colors.onAccent} strokeWidth={2.5} /> : <ExtraIcon name="clock" size={16} color={t.colors.muted} />}
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <HText variant="bodyStrong" tabular numberOfLines={2}>
          {main}
        </HText>
        {sub ? (
          <HText variant="caption" color="muted" numberOfLines={2}>
            {sub}
          </HText>
        ) : null}
      </View>
      <Icon name="chevronRight" size={16} color={t.colors.subtle} />
    </PressableScale>
  );
}
