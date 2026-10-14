/**
 * Drawer selection mode chrome: the header ("Fertig", count, filters) and the sticky bottom bar
 * ("Alle auswählen" / "Keine", "Löschen (n)"). Exit animates (reanimated layout animations,
 * reduce-motion aware via ReduceMotion.System + the app's ReducedMotionConfig); entering is plain –
 * reanimated entering animations can strand a view at opacity 0 (ui/lib/entranceGuard.test.ts).
 */
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeOut, ReduceMotion, SlideOutDown } from 'react-native-reanimated';
import { useT } from '../i18n';
import { bestOn, haptic, HText, Icon, PressableScale, useTheme } from '../ui';
import { ConvIcon } from './icons';

export type SelectionFilters = { old: boolean; profile: boolean };

const exitTop = FadeOut.duration(120).reduceMotion(ReduceMotion.System);
const exitBar = SlideOutDown.duration(160).reduceMotion(ReduceMotion.System);

export function SelectionHeader({
  count,
  onDone,
  filters,
  onFilters,
  profileFilter,
}: {
  count: number;
  onDone: () => void;
  filters: SelectionFilters;
  onFilters: (f: SelectionFilters) => void;
  /** offer "Nur dieses Profil" (there is an open chat whose profile can be used) */
  profileFilter: boolean;
}) {
  const t = useTheme();
  const tr = useT();
  return (
    <Animated.View exiting={exitTop} style={styles.header}>
      <View style={styles.headerRow}>
        <HText variant="headline" style={styles.flex} accessibilityRole="header" accessibilityLiveRegion="polite" aria-live="polite">
          {tr('conversations.list.selected', { count })}
        </HText>
        <Pressable
          onPress={onDone}
          accessibilityRole="button"
          accessibilityLabel={tr('conversations.list.done')}
          style={({ pressed }) => [styles.doneBtn, { borderRadius: t.radii.pill, backgroundColor: pressed ? t.colors.surfacePressed : t.colors.surfaceAlt }]}
        >
          <HText variant="callout" weight="600">
            {tr('conversations.list.done')}
          </HText>
        </Pressable>
      </View>
      <View style={styles.chips}>
        <Chip label={tr('conversations.list.filterOld')} on={filters.old} onPress={() => onFilters({ ...filters, old: !filters.old })} />
        {profileFilter ? <Chip label={tr('conversations.list.filterProfile')} on={filters.profile} onPress={() => onFilters({ ...filters, profile: !filters.profile })} /> : null}
      </View>
    </Animated.View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => {
        haptic('selection');
        onPress();
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      hitSlop={{ top: 4, bottom: 4 }}
      style={({ pressed }) => [
        styles.chip,
        {
          borderRadius: t.radii.pill,
          borderColor: on ? t.colors.accent : t.colors.borderStrong,
          backgroundColor: on ? t.colors.accentSoft : pressed ? t.colors.surfacePressed : 'transparent',
        },
      ]}
    >
      {on ? <Icon name="check" size={14} color={t.colors.accent} strokeWidth={2.4} /> : null}
      <HText variant="caption" weight="600" style={{ color: on ? t.colors.accent : t.colors.text }}>
        {label}
      </HText>
    </Pressable>
  );
}

export function SelectionBottomBar({
  count,
  allSelected,
  canSelectAll,
  onSelectAll,
  onSelectNone,
  onDelete,
  onArchive,
  restore,
}: {
  count: number;
  /** every selectable row is ticked → the toggle reads "Keine" */
  allSelected: boolean;
  canSelectAll: boolean;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onDelete: () => void;
  /** "Archivieren (n)" / "Wiederherstellen" (every ticked chat is archived) – local only */
  onArchive?: () => void;
  restore?: boolean;
}) {
  const t = useTheme();
  const onDanger = bestOn(t.colors.danger, ['#FFFFFF', t.colors.bg]);
  const tr = useT();
  const none = allSelected && count > 0;
  return (
    <Animated.View exiting={exitBar} style={[styles.bar, { borderTopColor: t.colors.border, backgroundColor: t.colors.bg }]}>
      <Pressable
        onPress={() => {
          haptic('selection');
          if (none) onSelectNone();
          else onSelectAll();
        }}
        disabled={!none && !canSelectAll}
        accessibilityRole="button"
        accessibilityState={{ disabled: !none && !canSelectAll }}
        style={({ pressed }) => [styles.barBtn, { borderRadius: t.radii.pill, opacity: !none && !canSelectAll ? 0.45 : 1 }, pressed && { backgroundColor: t.colors.surfacePressed }]}
      >
        <HText variant="callout" weight="600" style={{ color: t.colors.accent }}>
          {none ? tr('conversations.list.selectNone') : tr('conversations.list.selectAll')}
        </HText>
      </Pressable>
      {onArchive ? (
        <Pressable
          onPress={onArchive}
          disabled={!count}
          accessibilityRole="button"
          accessibilityState={{ disabled: !count }}
          accessibilityLabel={restore ? tr('menus.archive.bulkRestoreA11y', { count }) : tr('menus.archive.bulkA11y', { count })}
          style={({ pressed }) => [styles.archiveBtn, { borderRadius: t.radii.pill, backgroundColor: pressed ? t.colors.surfacePressed : t.colors.surfaceAlt, opacity: count ? 1 : 0.45 }]}
        >
          <ConvIcon name="archive" size={17} color={t.colors.text} />
          <HText variant="callout" weight="600">
            {restore ? tr('menus.archive.bulkRestore') : tr('menus.archive.bulk')}
          </HText>
        </Pressable>
      ) : null}
      <PressableScale
        onPress={onDelete}
        disabled={!count}
        accessibilityRole="button"
        accessibilityState={{ disabled: !count }}
        accessibilityLabel={tr('conversations.list.deleteSelected', { count })}
        style={[styles.deleteBtn, { borderRadius: t.radii.pill, backgroundColor: t.colors.danger, opacity: count ? 1 : 0.45 }]}
      >
        <ConvIcon name="trash" size={17} color={onDanger} />
        <HText variant="callout" weight="600" style={{ color: onDanger }}>
          {tr('conversations.list.deleteSelected', { count })}
        </HText>
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { gap: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  doneBtn: { minHeight: 44, minWidth: 44, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, paddingHorizontal: 12, borderWidth: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  barBtn: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 16 },
  archiveBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14, marginLeft: 'auto' },
});
