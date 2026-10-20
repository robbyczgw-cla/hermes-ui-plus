/**
 * The open live card (mockups 02, 03, 05, 06): drops down from the tray over the chat. Title, Live seal, version
 * chip, a status line per card type (checklist "5 von 14" + progress, trip "3 Tage · 2 erledigt", watchlist "Preise
 * von heute 09:28"), conflicts that need a choice before the next message, the body of the card type, and a footer
 * that always says honestly where the edits are ("Auf allen Geräten · über Hermes" / "1 Änderung noch nicht bei
 * Hermes …" / offline). The watchlist's footer has "+ Produkt" and "Preise prüfen" (= "Hermes fragen").
 */
import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Share, StyleSheet, View, useWindowDimensions } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../../i18n';
import { HText, PressableScale } from '../../ui/primitives/basics';
import { Button } from '../../ui/primitives/Button';
import { Icon } from '../../chat/icons';
import { useTheme, type Theme } from '../../ui/theme';
import { useEscapeToClose } from '../../ui/lib/useEscapeToClose';
import { ExtraIcon } from '../../ui/components/modules/a/ExtraIcon';
import { ProgressLine } from '../../ui/components/modules/Checklist';
import { asKind, checklistShareText, shouldGroup, type CItem } from '../../ui/components/modules/a/checklistModel.ts';
import { useS } from '../../ui/components/modules/useS';
import { useLive } from '../LiveProvider';
import type { LiveCardModel } from '../derive.ts';
import type { Conflict } from '../pending.ts';
import { tripDays } from '../trip.ts';
import { watchCounts } from '../watch.ts';
import { LiveChecklistBody } from './LiveChecklistBody';
import { LiveTripBody } from './LiveTripBody';
import { LiveWatchBody } from './LiveWatchBody';
import { LiveSeal, Tag, VersionChip, useTimeLabel } from './parts';

export function LiveCardSheet({ offline, onAsk }: { offline: boolean; onAsk: () => void }) {
  const live = useLive();
  const sheet = live?.sheet;
  const model = sheet?.kind === 'card' ? live?.byId.get(sheet.id) : undefined;
  const open = !!model;
  const close = () => {
    if (model) live?.markSeen(model.id);
    live?.openSheet(null);
  };
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={close} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      {model && live ? <CardPanel model={model} offline={offline} onClose={close} onAsk={onAsk} /> : null}
    </Modal>
  );
}

function CardPanel({ model, offline, onClose, onAsk }: { model: LiveCardModel; offline: boolean; onClose: () => void; onAsk: () => void }) {
  const t = useTheme();
  const tr = useT();
  const S = useS();
  const live = useLive()!;
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  useEscapeToClose(true, onClose);
  const state = model.view.state;
  const { done, total } = model.progress;
  const [note, setNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (!note) return;
    const h = setTimeout(() => setNote(null), 1800);
    return () => clearTimeout(h);
  }, [note]);
  const kind = asKind(state.kind);
  const share = async () => {
    const items = state.items.map((i) => ({ ...i, checked: !!i.checked }) as CItem);
    const text = checklistShareText(model.title, items, { kind, grouped: shouldGroup(kind, state.groupBy, items) }, S);
    try {
      if (Platform.OS === 'web') throw new Error('web');
      await Share.share({ message: text, title: model.title });
    } catch {
      await Clipboard.setStringAsync(text).catch(() => {});
      setNote(tr('live.card.shared'));
    }
  };
  const showConflicts = model.openConflicts > 0;
  const count = model.pendingCount;
  const status = count ? tr(offline ? 'live.sync.offline' : 'live.sync.pending', { count }) : tr(live.demo ? 'live.sync.demo' : 'live.sync.synced');
  const wide = width >= 900;
  const edit = (op: Parameters<typeof live.edit>[1]) => live.edit(model.id, op);
  const ask = () => {
    live.markSeen(model.id);
    live.setFocus(model.id);
    live.openSheet(null);
    onAsk();
  };
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.overlay }]} onPress={onClose} accessibilityRole="button" accessibilityLabel={tr('live.card.collapse')} />
      <View
        accessibilityViewIsModal
        aria-modal
        accessibilityLabel={model.title}
        onAccessibilityEscape={onClose}
        style={[
          styles.panel,
          t.shadows.lg,
          {
            top: insets.top + (wide ? 64 : 56),
            maxHeight: height - insets.top - insets.bottom - (wide ? 96 : 72),
            width: wide ? 560 : width - 16,
            alignSelf: 'center',
            backgroundColor: t.dark ? t.colors.surface : t.colors.bg,
            borderColor: t.colors.border,
            borderRadius: t.radii.card + 6,
          },
        ]}
      >
        {/* header */}
        <View style={{ paddingHorizontal: t.spacing.l, paddingTop: t.spacing.l, paddingBottom: t.spacing.s, gap: t.spacing.s }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.s }}>
            <HText variant="title" style={{ flex: 1 }} accessibilityRole="header" numberOfLines={2}>
              {model.title}
            </HText>
            <HeaderButton t={t} label={tr('live.card.history')} onPress={() => live.openSheet({ kind: 'history', id: model.id })}>
              <Icon name="history" size={20} color={t.colors.muted} />
            </HeaderButton>
            <HeaderButton t={t} label={tr('live.card.share')} onPress={() => void share()}>
              <ExtraIcon name="share" size={19} color={t.colors.muted} />
            </HeaderButton>
            <HeaderButton t={t} label={tr('live.card.collapse')} onPress={onClose}>
              <View style={{ transform: [{ rotate: '180deg' }] }}>
                <Icon name="chevronDown" size={20} color={t.colors.muted} />
              </View>
            </HeaderButton>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
            <LiveSeal t={t} />
            <VersionChip n={model.head.n} t={t} />
            <StatusLine model={model} />
          </View>
          {model.type === 'checklist' ? <ProgressLine t={t} ratio={total ? done / total : 0} /> : null}
        </View>

        <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: t.spacing.m }} keyboardShouldPersistTaps="handled">
          {showConflicts ? <Conflicts t={t} model={model} /> : null}
          {model.closed ? (
            <HText variant="callout" color="muted" style={{ paddingHorizontal: t.spacing.l, paddingVertical: t.spacing.s }}>
              {tr('live.card.closed')}
            </HText>
          ) : null}
          {model.type === 'trip' ? (
            <LiveTripBody model={model} t={t} onEdit={edit} />
          ) : model.type === 'products' ? (
            <LiveWatchBody model={model} t={t} onEdit={edit} adding={adding} onAddDone={() => setAdding(false)} />
          ) : (
            <LiveChecklistBody model={model} t={t} onEdit={edit} />
          )}
          {note ? (
            <HText variant="caption" color="accent" weight="500" style={{ paddingHorizontal: t.spacing.l, paddingTop: t.spacing.s }} accessibilityLiveRegion="polite">
              {note}
            </HText>
          ) : null}
        </ScrollView>

        {/* footer: where the edits are, honestly */}
        <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.colors.border, paddingHorizontal: t.spacing.l, paddingTop: t.spacing.m, paddingBottom: t.spacing.l, gap: t.spacing.m }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }} accessibilityLiveRegion="polite">
            <SyncIcon t={t} synced={!count} />
            <HText variant="caption" color="muted" style={{ flex: 1 }}>
              {status}
            </HText>
          </View>
          {showConflicts ? (
            <View style={{ flexDirection: 'row', gap: t.spacing.s }}>
              <View style={{ flex: 1 }}>
                <Button label={tr('live.conflict.later')} variant="secondary" onPress={onClose} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label={tr('live.conflict.apply')} variant="primary" onPress={() => live.confirmConflicts(model.id)} />
              </View>
            </View>
          ) : model.closed ? null : model.type === 'products' ? (
            <View style={{ flexDirection: 'row', gap: t.spacing.s }}>
              <Button label={tr('live.watch.add')} accessibilityLabel={tr('live.watch.addA11y')} variant="secondary" icon="plus" grow accessibilityState={{ expanded: adding }} onPress={() => setAdding((v) => !v)} />
              <Button label={tr('live.watch.check')} variant="primary" icon={(color, size) => <Icon name="retry" size={size} color={color} strokeWidth={2.1} />} grow onPress={ask} />
            </View>
          ) : (
            <Button label={tr('live.card.ask')} variant="primary" icon="send" onPress={ask} />
          )}
        </View>
      </View>
    </View>
  );
}

/** The header's status per card type (live region: it changes when Hermes' next version arrives). */
function StatusLine({ model }: { model: LiveCardModel }) {
  const tr = useT();
  const time = useTimeLabel();
  const state = model.view.state;
  let text: string;
  // trip: "3 Tage · 2 erledigt"; nothing done yet: who changed it last, like the mockup ("3 Tage · Hermes, 12:41")
  if (model.type === 'trip') {
    const days = tripDays(state).length;
    text = model.progress.done
      ? tr('live.trip.status', { days, done: model.progress.done })
      : tr('live.trip.statusWho', { days, who: tr(model.head.author === 'hermes' ? 'live.who.hermes' : 'live.who.you'), time: time(model.head.at) });
  }
  else if (model.type === 'products') {
    const under = watchCounts(state).under;
    const today = new Date(model.head.at).toDateString() === new Date().toDateString();
    text =
      model.head.author === 'hermes'
        ? tr('live.watch.prices', { today: today ? 1 : 0, time: time(model.head.at) })
        : under
          ? tr('live.watch.underCount', { count: under })
          : tr('live.watch.count', { count: watchCounts(state).shown });
  } else text = tr('live.progress', { done: model.progress.done, total: model.progress.total });
  return (
    <HText variant="callout" color="muted" tabular style={{ flexShrink: 1 }} numberOfLines={1} accessibilityLiveRegion="polite">
      {text}
    </HText>
  );
}

function HeaderButton({ t, label, onPress, children }: { t: Theme; label: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <PressableScale haptic="selection" onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={4} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }}>
      {children}
    </PressableScale>
  );
}

/** Cloud with a check (synced, sage) or a plain cloud (waiting, blue). */
function SyncIcon({ t, synced }: { t: Theme; synced: boolean }) {
  return (
    <View aria-hidden style={{ width: 22, alignItems: 'center' }}>
      <Icon name={synced ? 'cloudCheck' : 'cloud'} size={20} color={synced ? t.colors.success : t.colors.info} />
    </View>
  );
}

function Conflicts({ t, model }: { t: Theme; model: LiveCardModel }) {
  const tr = useT();
  const live = useLive()!;
  const time = useTimeLabel();
  const conflicts = model.view.conflicts;
  const ticked = model.view.outgoing.some((op) => 'check' in op);
  return (
    <View style={{ paddingHorizontal: t.spacing.l, gap: t.spacing.m, paddingBottom: t.spacing.s }}>
      <View style={{ flexDirection: 'row', gap: t.spacing.m, padding: t.spacing.l, borderRadius: t.radii.card, backgroundColor: t.colors.warningSoft }} accessibilityRole="alert">
        <Icon name="alert" size={20} color={t.colors.warning} />
        <View style={{ flex: 1, gap: 4 }}>
          <HText variant="bodyStrong">{tr('live.conflict.title')}</HText>
          <HText variant="callout">{tr(ticked ? 'live.conflict.bodyTicks' : 'live.conflict.body', { count: conflicts.length })}</HText>
        </View>
      </View>
      {conflicts.map((c) => (
        <ConflictCard key={c.key} t={t} c={c} time={time} onChoose={(choice) => live.setChoice(model.id, c.key, choice)} />
      ))}
    </View>
  );
}

const CONFLICT_FIELDS = ['text', 'qty', 'unit', 'category', 'note', 'start', 'end', 'location', 'day', 'target', 'userNote'] as const;
/** The conflict line's field ("Beide haben die Menge geändert."), the rest share one line. */
function conflictField(f: string): (typeof CONFLICT_FIELDS)[number] | 'other' {
  return (CONFLICT_FIELDS as readonly string[]).includes(f) ? (f as (typeof CONFLICT_FIELDS)[number]) : 'other';
}

/** A field value as the choice shows it ("2 l"; an emptied field says so). */
function valueText(c: Extract<Conflict, { kind: 'field' }>, v: unknown, tr: ReturnType<typeof useT>): string {
  if (v === undefined || v === null || v === '') return tr('live.conflict.empty');
  return c.field === 'qty' && c.unit ? `${String(v)} ${c.unit}` : String(v);
}

function ConflictCard({ t, c, time, onChoose }: { t: Theme; c: Conflict; time: (at: number) => string; onChoose: (choice: 'mine' | 'theirs' | 'drop' | 'keep') => void }) {
  const tr = useT();
  const who = tr(c.theirsBy === 'hermes' ? 'live.who.hermes' : 'live.who.you');
  return (
    <View style={{ borderWidth: 1, borderColor: t.colors.border, borderRadius: t.radii.card, padding: t.spacing.l, gap: t.spacing.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
        <HText variant="headline">{c.text}</HText>
        {c.kind === 'deleted' ? <Tag label={tr('live.conflict.removedTag')} tone="danger" t={t} /> : null}
      </View>
      <HText variant="callout" color="muted">
        {c.kind === 'field' ? tr(`live.conflict.field.${conflictField(c.field)}`) : tr(c.checked ? 'live.conflict.removedTicked' : 'live.conflict.removedEdited')}
      </HText>
      <View style={{ flexDirection: 'row', gap: t.spacing.s }} accessibilityRole="radiogroup">
        {c.kind === 'field' ? (
          <>
            <Choice t={t} selected={c.choice === 'theirs'} title={valueText(c, c.theirs, tr)} sub={tr('live.conflict.theirs', { who, time: time(c.theirsAt) })} onPress={() => onChoose('theirs')} />
            <Choice t={t} selected={c.choice === 'mine'} title={valueText(c, c.mine, tr)} sub={tr('live.conflict.mine')} onPress={() => onChoose('mine')} />
          </>
        ) : (
          <>
            <Choice t={t} selected={c.choice === 'drop'} title={tr('live.conflict.drop')} onPress={() => onChoose('drop')} />
            <Choice t={t} selected={c.choice === 'keep'} title={tr(c.checked ? 'live.conflict.keepDone' : 'live.conflict.keep')} onPress={() => onChoose('keep')} />
          </>
        )}
      </View>
    </View>
  );
}

function Choice({ t, selected, title, sub, onPress }: { t: Theme; selected: boolean; title: string; sub?: string; onPress: () => void }) {
  return (
    <PressableScale
      haptic="selection"
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={sub ? `${title}, ${sub}` : title}
      style={{
        flex: 1,
        minHeight: 52,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: t.spacing.s,
        paddingVertical: t.spacing.s,
        borderRadius: t.radii.control + 4,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? t.colors.accent : t.colors.borderControl,
        backgroundColor: selected ? t.colors.accentSoft : 'transparent',
      }}
    >
      <HText variant="bodyStrong" align="center">
        {title}
      </HText>
      {sub ? (
        <HText variant="caption" color="muted" align="center">
          {sub}
        </HText>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
});
