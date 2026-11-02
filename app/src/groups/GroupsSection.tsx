/**
 * The Bots tab's group parts (spec 2.1, 2.6): the "Gruppe" button next to "Neuer Bot" (only when the owner switched
 * groups on and there are at least two bots), and the section "Gruppen" below the contacts. A row opens the group chat
 * (route /group). Calm like the bot rows: a green dot while the group answers, orange only when a bot waits for an
 * approval in its own chat.
 */
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { BotAvatar } from '../bots/BotAvatar';
import type { BotsTab } from '../bots/useBotsTab';
import { useHermesBots } from '../hermes/useHermesBots';
import { useLocale, useT } from '../i18n';
import { useActiveProfile } from '../settings/ConnectionProvider';
import { Button, HText, useTheme } from '../ui';
import { requestCloseDrawer } from './drawer';
import { GroupCreateSheet } from './GroupCreateSheet';
import type { GroupSummary } from './core';
import { useGroups } from './useGroups';

/** Bots of the active connection as group members: key (`default` for Hermes), display name, colour. */
export function useMemberBots() {
  const tr = useT();
  const profile = useActiveProfile() ?? undefined;
  const { bots } = useHermesBots(profile?.kind === 'hermes' ? profile : undefined);
  return useMemo(
    () => bots.map((b) => ({ key: b.default ? 'default' : b.name, label: b.label ?? (b.default ? tr('bots.roster.defaultName') : b.name), color: b.color })),
    [bots, tr],
  );
}

/** "Neuer Bot" and "Gruppe" in one row on top of the Bots tab. */
export function RosterActions({ onNewBot, tab }: { onNewBot?: () => void; tab: BotsTab }) {
  const tr = useT();
  const router = useRouter();
  const profile = useActiveProfile() ?? undefined;
  const groups = useGroups(profile);
  const members = useMemberBots();
  const [creating, setCreating] = useState(false);
  const offer = !tab.demo && !!groups.list?.config.enabled && members.length >= (groups.list?.config.limits.minMembers ?? 2);
  if (!onNewBot && !offer) return null;
  return (
    <View style={styles.actions}>
      {onNewBot ? <Button label={tr('botCreate.newBot')} icon="plus" variant="primary" size="small" onPress={onNewBot} testID="bots-new" /> : null}
      {offer ? <Button label={tr('groups.button')} icon="plus" variant="secondary" size="small" onPress={() => setCreating(true)} testID="groups-new" /> : null}
      {offer && groups.list ? (
        <GroupCreateSheet
          key={creating ? 'open' : 'closed'}
          visible={creating}
          members={members}
          limits={groups.list.config.limits}
          onClose={() => setCreating(false)}
          onCreate={groups.create}
          onCreated={(g) => {
            setCreating(false);
            requestCloseDrawer();
            router.push({ pathname: '/group', params: { id: g.id } });
          }}
        />
      ) : null}
    </View>
  );
}

/** The section "Gruppen" below the bot rows; nothing while there is no group (the button is the way in). */
export function GroupsSection({ tab, now }: { tab: BotsTab; now: number }) {
  const t = useTheme();
  const tr = useT();
  const router = useRouter();
  const profile = useActiveProfile() ?? undefined;
  const { list } = useGroups(profile);
  const members = useMemberBots();
  if (tab.demo || !list?.config.enabled || !list.groups.length) return null;
  const byKey = new Map(members.map((m) => [m.key, m]));
  return (
    <View style={styles.section} testID="groups-section">
      <View style={styles.sectionHead}>
        <HText variant="caption" weight="600" color="muted" accessibilityRole="header">
          {tr('groups.section')}
        </HText>
        <View style={[styles.beta, { borderColor: t.colors.border, borderRadius: t.radii.inline }]}>
          <HText variant="micro" color="muted">
            {tr('groups.beta')}
          </HText>
        </View>
      </View>
      {list.groups.map((g) => (
        <GroupRow
          key={g.id}
          group={g}
          now={now}
          byKey={byKey}
          waiting={list.approvals.filter((a) => a.groupId === g.id).map((a) => byKey.get(a.bot)?.label ?? a.bot)}
          onPress={() => {
            requestCloseDrawer();
            router.push({ pathname: '/group', params: { id: g.id } });
          }}
        />
      ))}
    </View>
  );
}

function GroupRow({ group, byKey, waiting, onPress, now }: { group: GroupSummary; byKey: Map<string, { key: string; label: string; color?: string }>; waiting: string[]; onPress(): void; now: number }) {
  const t = useTheme();
  const tr = useT();
  const { formatDate } = useLocale();
  const nameOf = (k: string) => byKey.get(k)?.label ?? k;
  const membersText = tr('groups.members', { count: group.members.length });
  const last = group.last;
  const line = waiting.length
    ? tr('groups.note.approvalWaiting', { name: waiting[0] })
    : group.running
      ? tr('groups.rowAnswering')
      : last
        ? `${last.kind === 'user' ? tr('groups.you') : nameOf(last.bot ?? '')}: ${last.text}`
        : tr('groups.rowEmpty');
  const time = group.updatedAt && now - group.updatedAt < 86_400_000 ? formatDate(new Date(group.updatedAt), { hour: 'numeric', minute: '2-digit' }) : group.updatedAt ? formatDate(new Date(group.updatedAt), { day: 'numeric', month: 'short' }) : '';
  return (
    <Pressable
      onPress={onPress}
      testID={`group-row-${group.id}`}
      accessibilityRole="button"
      accessibilityLabel={[tr('groups.rowA11y', { name: group.name, members: group.members.map(nameOf).join(', ') }), line].join(', ')}
      style={({ pressed }) => [styles.row, { borderRadius: t.radii.control, backgroundColor: pressed ? t.colors.surfacePressed : 'transparent' }]}
    >
      <AvatarStack keys={group.members} byKey={byKey} />
      <View style={styles.rowText}>
        <View style={styles.titleLine}>
          <HText variant="bodyStrong" numberOfLines={1} style={styles.shrink}>
            {group.name}
          </HText>
          <HText variant="caption" color="subtle">
            {membersText}
          </HText>
          <View style={styles.flex} />
          {time ? <HText variant="caption" color="subtle">{time}</HText> : null}
        </View>
        <View style={styles.lineRow}>
          {waiting.length ? <View style={[styles.dot, { backgroundColor: t.colors.warning }]} /> : group.running ? <View style={[styles.dot, { backgroundColor: t.colors.success }]} /> : null}
          <HText variant="caption" color={last && !group.running && !waiting.length ? 'muted' : 'subtle'} numberOfLines={1} style={styles.flex}>
            {line}
          </HText>
        </View>
      </View>
    </Pressable>
  );
}

/** Up to three member avatars, overlapping; "+n" for the rest. */
export function AvatarStack({ keys, byKey, size = 26 }: { keys: string[]; byKey: Map<string, { label: string; color?: string }>; size?: number }) {
  const t = useTheme();
  const shown = keys.slice(0, 3);
  const more = keys.length - shown.length;
  const box = size + (shown.length - 1) * Math.round(size * 0.55);
  return (
    <View style={{ width: Math.max(42, box + (more > 0 ? 6 : 0)), height: 42, justifyContent: 'center' }} accessible={false} importantForAccessibility="no-hide-descendants">
      <View style={{ flexDirection: 'row' }}>
        {shown.map((k, i) => (
          <View key={k} style={{ marginLeft: i ? -Math.round(size * 0.45) : 0, borderRadius: Math.round(size * 0.3) + 2, borderWidth: 2, borderColor: t.colors.bg }}>
            <BotAvatar name={byKey.get(k)?.label ?? k} bot={k === 'default' ? undefined : k} color={byKey.get(k)?.color} size={size} />
          </View>
        ))}
      </View>
      {more > 0 ? (
        <View style={[styles.more, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.pill }]}>
          <HText variant="micro" color="muted" tabular>{`+${more}`}</HText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginHorizontal: 12, marginBottom: 8, alignItems: 'center' },
  section: { marginTop: 14, gap: 2 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingBottom: 4 },
  beta: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 5, paddingVertical: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 6, paddingHorizontal: 10, paddingVertical: 9, minHeight: 64 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  more: { position: 'absolute', right: 0, bottom: 2, paddingHorizontal: 4 },
});
