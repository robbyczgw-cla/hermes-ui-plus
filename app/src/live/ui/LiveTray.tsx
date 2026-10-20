/**
 * Tray under the chat header (mockup 01): one row per pinned open live card (icon tile per card type, title with a
 * brass dot for a version you have not looked at, one-line status per type, progress ring for checklists and trips,
 * chevron), at most three; more → the list sheet. While the user reads older messages it folds to one 40 pt row of
 * the most recently changed card (design §3.1); back at the newest message, or on "Alle zeigen", it opens again.
 */
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocale, useT } from '../../i18n';
import { HText, PressableScale } from '../../ui/primitives/basics';
import { Icon } from '../../chat/icons';
import { useTheme, type Theme } from '../../ui/theme';
import { useLive } from '../LiveProvider';
import { trayCards, type LiveCardModel } from '../derive.ts';
import { formatClock, toMinutes } from '../../ui/components/modules/c2/agendaModel.ts';
import { dayLabel, dayOf, freshPerDay, nextOpenBlock, tripDays } from '../trip.ts';
import { pricesAt, watchCounts } from '../watch.ts';
import { ListTile, ProgressRing, useTimeLabel } from './parts';

export const LiveTray = memo(function LiveTray({ maxWidth, collapsed, onExpand }: { maxWidth?: number; collapsed?: boolean; onExpand?: () => void }) {
  const live = useLive();
  const t = useTheme();
  const tr = useT();
  if (!live || !live.cards.length) return null;
  const { rows, more } = trayCards(live.cards);
  const hidden = live.cards.length - rows.length;
  if (!rows.length && !hidden) return null;
  if (collapsed && rows.length) {
    return (
      <View style={{ paddingHorizontal: t.spacing.s, paddingTop: t.spacing.xs, paddingBottom: t.spacing.xs, alignItems: 'center' }} accessibilityRole="summary" accessibilityLabel={tr('live.tray.region')}>
        <View style={[styles.box, t.shadows.sm, { maxWidth: maxWidth ?? 760, borderRadius: t.radii.card + 4, borderColor: t.colors.border, backgroundColor: t.dark ? t.colors.surface : t.colors.bg }]}>
          <CollapsedRow t={t} model={rows[0]} others={rows.length - 1 + more} onPress={() => live.openSheet({ kind: 'card', id: rows[0].id })} onExpand={onExpand} />
        </View>
      </View>
    );
  }
  return (
    <View style={{ paddingHorizontal: t.spacing.s, paddingTop: t.spacing.xs, paddingBottom: t.spacing.xs, alignItems: 'center' }} accessibilityRole="summary" accessibilityLabel={tr('live.tray.region')}>
      <View style={[styles.box, t.shadows.sm, { maxWidth: maxWidth ?? 760, borderRadius: t.radii.card + 4, borderColor: t.colors.border, backgroundColor: t.dark ? t.colors.surface : t.colors.bg }]}>
        {rows.map((c, i) => (
          <TrayRow key={c.id} t={t} model={c} first={i === 0} onPress={() => live.openSheet({ kind: 'card', id: c.id })} />
        ))}
        {more > 0 || (!rows.length && hidden) ? (
          <PressableScale
            haptic="selection"
            onPress={() => live.openSheet({ kind: 'list' })}
            accessibilityRole="button"
            style={{ minHeight: 40, paddingHorizontal: t.spacing.l, flexDirection: 'row', alignItems: 'center', borderTopWidth: rows.length ? StyleSheet.hairlineWidth : 0, borderTopColor: t.colors.border }}
          >
            <HText variant="caption" weight="600" color="muted" style={{ flex: 1 }}>
              {more > 0 ? tr('live.tray.more', { count: more }) : tr('live.list.open')}
            </HText>
            <Icon name="chevronRight" size={16} color={t.colors.muted} />
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
});

/** The folded tray: one 40 pt row (small tile, title, status), "+2" for the other pinned cards, a button to open it. */
function CollapsedRow({ t, model, others, onPress, onExpand }: { t: Theme; model: LiveCardModel; others: number; onPress: () => void; onExpand?: () => void }) {
  const tr = useT();
  const status = useTrayStatus(model);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 40 }}>
      <PressableScale
        haptic="selection"
        scaleTo={0.99}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={tr('live.tray.rowA11y', { title: model.title, status, unread: model.unread ? 1 : 0 })}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, minHeight: 40, paddingLeft: t.spacing.m, paddingVertical: 4 }}
        pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
      >
        <ListTile t={t} type={model.type} size={24} />
        <HText variant="callout" weight="600" numberOfLines={1} style={{ flexShrink: 1 }}>
          {model.title}
        </HText>
        {model.unread ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.colors.accent }} /> : null}
        <HText variant="caption" color={model.openConflicts ? 'warning' : model.pendingCount ? 'info' : 'muted'} numberOfLines={1} tabular style={{ flex: 1 }}>
          {status}
        </HText>
      </PressableScale>
      {onExpand ? (
        <PressableScale
          haptic="selection"
          onPress={onExpand}
          accessibilityRole="button"
          accessibilityLabel={tr('live.tray.expand', { count: others })}
          style={{ minWidth: 44, minHeight: 40, paddingHorizontal: t.spacing.m, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}
        >
          {others > 0 ? (
            <HText variant="caption" weight="600" color="muted" tabular>
              {tr('live.tray.others', { count: others })}
            </HText>
          ) : null}
          <Icon name="chevronDown" size={16} color={t.colors.muted} />
        </PressableScale>
      ) : null}
    </View>
  );
}

/** The row's status line ("5 von 14 · Hermes, 12:41", "1 Änderung wartet", the trip's next block …). */
function useTrayStatus(model: LiveCardModel): string {
  const tr = useT();
  const time = useTimeLabel();
  const progress = useTrayBase(model);
  const who = tr(model.head.author === 'hermes' ? 'live.who.hermes' : 'live.who.you');
  return model.openConflicts
    ? tr('live.tray.conflict', { progress, count: model.openConflicts })
    : model.pendingCount
      ? tr('live.tray.waiting', { progress, count: model.pendingCount })
      : model.type === 'trip'
        ? progress
        : tr('live.tray.status', { progress, who: model.type === 'products' ? tr('live.who.hermes') : who, time: time(model.type === 'products' ? (pricesAt(model.card) ?? model.head.at) : model.head.at) });
}

function TrayRow({ t, model, first, onPress }: { t: Theme; model: LiveCardModel; first: boolean; onPress: () => void }) {
  const tr = useT();
  const { done, total } = model.progress;
  // a trip's line is about the plan itself ("Sa 14. · 2 Änderungen", the next open block), not who changed it last
  const status = useTrayStatus(model);
  return (
    <PressableScale
      haptic="selection"
      scaleTo={0.99}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={tr('live.tray.rowA11y', { title: model.title, status, unread: model.unread ? 1 : 0 })}
      style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.m, minHeight: 64, paddingHorizontal: t.spacing.m, paddingVertical: t.spacing.s, borderTopWidth: first ? 0 : StyleSheet.hairlineWidth, borderTopColor: t.colors.border }}
      pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
    >
      <ListTile t={t} type={model.type} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <HText variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
            {model.title}
          </HText>
          {model.unread ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: t.colors.accent }} /> : null}
        </View>
        <HText variant="caption" color={model.openConflicts ? 'warning' : model.pendingCount ? 'info' : 'muted'} numberOfLines={1} tabular>
          {status}
        </HText>
      </View>
      {model.type === 'products' ? null : <ProgressRing done={done} total={total} />}
      <Icon name="chevronDown" size={18} color={t.colors.muted} />
    </PressableScale>
  );
}

/**
 * The status line's first part per card type: checklist "5 von 14"; trip "Sa 14. · 2 Änderungen" (the first day with
 * changes since you looked), else the next open block "Sa 14. 11:00 Vatikanische Museen"; watchlist
 * "1 unter Wunschpreis" / "3 Produkte".
 */
function useTrayBase(model: LiveCardModel): string {
  const tr = useT();
  const { locale, lang } = useLocale();
  const state = model.view.state;
  if (model.type === 'trip') {
    const days = tripDays(state);
    const per = freshPerDay(state, model.fresh, days);
    const changed = days.find((d) => per.get(d.id));
    if (changed) return tr('live.trip.changes', { day: changed.label, count: per.get(changed.id) ?? 0 });
    const next = nextOpenBlock(state);
    if (!next) return tr('live.trip.allDone');
    const m = toMinutes(next.start);
    return tr('live.trip.next', { day: dayLabel(days, dayOf(next, days)), time: m === undefined ? '' : formatClock(m, locale, lang), title: next.text }).replace(/\s+/g, ' ').trim();
  }
  if (model.type === 'products') {
    const c = watchCounts(state);
    return c.under ? tr('live.watch.underCount', { count: c.under }) : tr('live.watch.count', { count: c.shown });
  }
  return tr('live.progress', { done: model.progress.done, total: model.progress.total });
}

const styles = StyleSheet.create({
  box: { width: '100%', borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
});
