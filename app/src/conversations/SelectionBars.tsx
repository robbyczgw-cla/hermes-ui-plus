/**
 * Drawer selection mode chrome: the header ("Fertig", count, filters) and the sticky bottom bar
 * ("Alle auswählen" / "Keine", "Löschen (n)"). Exit animates (reanimated layout animations,
 * reduce-motion aware via ReduceMotion.System + the app's ReducedMotionConfig); entering is plain –
 * reanimated entering animations can strand a view at opacity 0 (ui/lib/entranceGuard.test.ts).
 */
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeOut, ReduceMotion, SlideOutDown } from 'react-native-reanimated';
import { useT } from '../i18n';
import { Button, haptic, HText, Icon, useTheme } from '../ui';
import { ConvIcon } from './icons';
import { a11yState } from '../ui/lib/a11yState';

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
        <Button label={tr('conversations.list.done')} onPress={onDone} />
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
      {...a11yState({ checked: on })}
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
      <HText variant="caption" weight="600" style={{ color: on ? t.colors.accentText : t.colors.text }}>
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
  const tr = useT();
  const none = allSelected && count > 0;
  return (
    <Animated.View exiting={exitBar} style={[styles.bar, { borderTopColor: t.colors.border, backgroundColor: t.colors.bg }]}>
      <Button
        label={none ? tr('conversations.list.selectNone') : tr('conversations.list.selectAll')}
        variant="tertiary"
        disabled={!none && !canSelectAll}
        onPress={() => (none ? onSelectNone() : onSelectAll())}
      />
      {onArchive ? (
        <Button
          label={restore ? tr('menus.archive.bulkRestore') : tr('menus.archive.bulk')}
          icon={(color, size) => <ConvIcon name="archive" size={size} color={color} />}
          accessibilityLabel={restore ? tr('menus.archive.bulkRestoreA11y', { count }) : tr('menus.archive.bulkA11y', { count })}
          disabled={!count}
          onPress={onArchive}
          style={styles.archiveBtn}
        />
      ) : null}
      <Button label={tr('conversations.list.deleteSelected', { count })} icon={(color, size) => <ConvIcon name="trash" size={size} color={color} />} tone="seal" disabled={!count} onPress={onDelete} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { gap: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, paddingHorizontal: 12, borderWidth: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  archiveBtn: { marginLeft: 'auto' },
});
