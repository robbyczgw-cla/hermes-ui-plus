/**
 * The drawer's "Chats | Bots" switch and the Bots tab (bots/useBotsTab.ts): "Wartet auf dich" while an approval is open,
 * then one row per bot (avatar, name, time, last line, one badge). Calm: orange only for "needs you", a small green
 * dot for "working", brass for unread. No search, no "new chat": one thread per bot.
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocale, useT } from '../i18n';
import { localizePreview } from '../conversations/messages';
import { HText, Icon, useTheme } from '../ui';
import { Loader } from '../ui/loaders';
import { a11yState } from '../ui/lib/a11yState';
import { BotAvatar } from './BotAvatar';
import { BotCreateSheet } from './create/BotCreateSheet';
import { BotsEmptyBox, NewBotButton } from './create/RosterCreate';
import type { RosterRow } from './core';
import type { DrawerTab } from './state';
import type { BotsTab } from './useBotsTab';

const DAY = 86_400_000;

/** "7:31" today, "Gestern", "Do" this week, "12. Okt." before */
function useRowTime() {
  const { formatDate } = useLocale();
  const tr = useT();
  return (ms: number | undefined, now: number): string => {
    if (!ms) return '';
    const d = new Date(ms);
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const t0 = start.getTime();
    if (ms >= t0) return formatDate(d, { hour: 'numeric', minute: '2-digit' });
    if (ms >= t0 - DAY) return tr('bots.roster.yesterday');
    if (ms >= t0 - 6 * DAY) return formatDate(d, { weekday: 'short' });
    return formatDate(d, { day: 'numeric', month: 'short' });
  };
}

export function DrawerTabs({ tab, onTab, attention }: { tab: DrawerTab; onTab(tab: DrawerTab): void; attention: boolean }) {
  const t = useTheme();
  const tr = useT();
  const seg = (value: DrawerTab, label: string) => {
    const on = tab === value;
    return (
      <Pressable
        key={value}
        onPress={() => onTab(value)}
        testID={`drawer-tab-${value}`}
        accessibilityRole="tab"
        {...a11yState({ selected: on }, 'tab')}
        accessibilityLabel={value === 'bots' && attention ? tr('bots.tabs.botsAttention') : label}
        style={[styles.seg, { borderRadius: t.radii.control - 2 }, on && [{ backgroundColor: t.colors.surface }, t.shadows.sm]]}
      >
        <HText variant="callout" weight="600" color={on ? undefined : 'muted'} numberOfLines={1}>
          {label}
        </HText>
        {value === 'bots' && attention ? <View style={[styles.segDot, { backgroundColor: t.colors.warning }]} /> : null}
      </Pressable>
    );
  };
  return (
    <View accessibilityRole="tablist" style={[styles.tabs, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.control }]}>
      {seg('chats', tr('bots.tabs.chats'))}
      {seg('bots', tr('bots.tabs.bots'))}
    </View>
  );
}

export function BotRoster({ tab, activeId, now }: { tab: BotsTab; activeId?: string; now: number }) {
  const t = useTheme();
  const tr = useT();
  const rowTime = useRowTime();
  const w = tab.waiting;
  const [creating, setCreating] = useState(false);
  const onlyDefault = !tab.rows.some((r) => !r.bot.default);
  return (
    <>
    <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {w.count > 0 && w.first ? (
        <Pressable
          onPress={tab.openWaiting}
          testID="bots-waiting"
          accessibilityRole="button"
          accessibilityLabel={tr('bots.waiting.a11y', { count: w.count, names: w.names.join(', ') })}
          style={({ pressed }) => [styles.waiting, { backgroundColor: pressed ? t.colors.surfacePressed : t.colors.surface, borderColor: t.colors.border, borderRadius: t.radii.card }]}
        >
          <BotAvatar name={w.names[0] ?? ''} bot={w.first.bot} size={32} color={undefined} />
          <View style={styles.flex}>
            <HText variant="bodyStrong" numberOfLines={1}>
              {tr('bots.waiting.title')}
            </HText>
            <HText variant="caption" color="muted" numberOfLines={1}>
              {tr('bots.waiting.sub', { names: w.names.join(', '), count: w.count })}
            </HText>
          </View>
          <View style={[styles.countPill, { backgroundColor: t.colors.warningSoft, borderRadius: t.radii.pill }]}>
            <HText variant="caption" weight="700" tabular style={{ color: t.colors.warning }}>
              {w.count > 99 ? '99+' : String(w.count)}
            </HText>
          </View>
          <Icon name="chevronRight" size={16} color={t.colors.subtle} />
        </Pressable>
      ) : null}

      {tab.notice ? (
        <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.control }]}>
          <Icon name="alert" size={16} color={t.colors.muted} />
          <HText variant="caption" color="muted" style={styles.flex}>
            {tab.notice.text}
          </HText>
          <Pressable onPress={tab.dismissNotice} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr('bots.roster.dismiss')}>
            <Icon name="x" size={14} color={t.colors.subtle} />
          </Pressable>
        </View>
      ) : null}

      {tab.create?.kind === 'create' ? <NewBotButton onPress={() => setCreating(true)} /> : null}

      {tab.rows.map((row) => (
        <BotRow
          key={row.key}
          row={row}
          name={tab.nameOf(row.key)}
          active={!!row.chat && row.chat.id === activeId}
          opening={tab.opening === row.key}
          unreachable={tab.unreachable.has(row.key)}
          time={rowTime(row.time, now)}
          onPress={() => tab.open(row.key)}
        />
      ))}

      {onlyDefault ? <BotsEmptyBox offer={tab.create} onCreate={() => setCreating(true)} /> : null}

      <HText variant="caption" color="subtle" style={styles.footnote}>
        {tab.demo ? tr('bots.roster.demoFoot') : tab.create?.kind === 'create' ? tr('botCreate.rosterFoot') : tr('bots.roster.footnote')}
      </HText>
    </ScrollView>
    {tab.create?.kind === 'create' ? (
      <BotCreateSheet
        visible={creating}
        onClose={() => setCreating(false)}
        onCreate={tab.createBot}
        demo={tab.demo}
        onCreated={(bot) => {
          setCreating(false);
          tab.created(bot);
        }}
      />
    ) : null}
    </>
  );
}

function BotRow({ row, name, active, opening, unreachable, time, onPress }: { row: RosterRow; name: string; active: boolean; opening: boolean; unreachable: boolean; time: string; onPress(): void }) {
  const t = useTheme();
  const tr = useT();
  const isDefault = row.bot.default;
  const chat = row.chat;
  const hasContent = !!chat && (chat.messageCount > 0 || chat.preview !== '');
  const preview = hasContent && chat.preview && chat.preview !== '…' ? localizePreview(chat.preview, tr) : '';
  // last line: working > not connected > last message > the bot's description > a hint
  const line = row.working
    ? tr('bots.status.working')
    : unreachable
      ? tr('bots.roster.notConnected')
      : preview || row.bot.description || (isDefault ? tr('bots.roster.defaultHint') : tr('bots.roster.noChat'));
  const unread = row.badge === 'unread' && !active;
  const a11y = [
    name,
    isDefault ? tr('bots.roster.standard') : '',
    row.badge === 'approval' ? tr('bots.roster.approvalA11y') : '',
    unread ? tr('chat.background.unread') : '',
    line,
  ].filter(Boolean).join(', ');
  return (
    <Pressable
      onPress={onPress}
      disabled={opening}
      testID={`bot-row-${row.key}`}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      {...a11yState({ busy: opening, selected: active }, 'button')}
      style={({ pressed }) => [styles.row, { borderRadius: t.radii.control, backgroundColor: active ? t.colors.surfaceAlt : pressed ? t.colors.surfacePressed : 'transparent' }]}
    >
      <BotAvatar name={name} bot={isDefault ? undefined : row.bot.name} color={row.bot.color} />
      <View style={styles.rowText}>
        <View style={styles.titleLine}>
          <HText variant="bodyStrong" numberOfLines={1} style={[styles.shrink, unread && { fontWeight: '700' }]}>
            {name}
          </HText>
          {isDefault ? (
            <View style={[styles.chip, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.inline }]}>
              <HText variant="micro" color="muted">
                {tr('bots.roster.standard')}
              </HText>
            </View>
          ) : null}
          <View style={styles.flex} />
          {opening ? <Loader kind="dots" size={14} /> : time ? <HText variant="caption" color="subtle">{time}</HText> : null}
        </View>
        <View style={styles.lineRow}>
          {row.working ? <View style={[styles.dot, { backgroundColor: t.colors.success }]} /> : null}
          {unreachable && !row.working ? <Icon name="alert" size={13} color={t.colors.subtle} /> : null}
          <HText variant="caption" color={hasContent && !row.working && !unreachable ? 'muted' : 'subtle'} numberOfLines={1} style={styles.flex}>
            {line}
          </HText>
          {row.badge === 'approval' ? (
            <View style={[styles.pill, { backgroundColor: t.colors.warningSoft, borderRadius: t.radii.pill }]}>
              <View style={[styles.sealDot, { backgroundColor: t.colors.warning }]} />
              <HText variant="micro" weight="600" style={{ color: t.colors.warning }}>
                {tr('bots.roster.approval')}
              </HText>
            </View>
          ) : unread ? (
            <View style={[styles.unread, { backgroundColor: t.colors.accent }]} />
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  tabs: { flexDirection: 'row', padding: 3, gap: 3 },
  seg: { flex: 1, minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 8 },
  segDot: { width: 7, height: 7, borderRadius: 4 },
  content: { paddingTop: 10, paddingBottom: 24, gap: 2 },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 12, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 10, borderWidth: StyleSheet.hairlineWidth, minHeight: 56 },
  countPill: { minWidth: 26, height: 22, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center' },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginHorizontal: 12, marginBottom: 8, padding: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 6, paddingHorizontal: 10, paddingVertical: 9, minHeight: 64 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chip: { paddingHorizontal: 6, paddingVertical: 1 },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2 },
  sealDot: { width: 6, height: 6, borderRadius: 3 },
  unread: { width: 9, height: 9, borderRadius: 5 },
  footnote: { paddingHorizontal: 20, paddingTop: 18 },
});
