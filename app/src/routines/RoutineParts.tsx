// Routines screen building blocks: state glyph, list row, labelled value rows, the Inbox / Schedules tabs and the
// result card. Shapes carry the state, color only supports it (paused = two bars, attention = triangle, completed =
// check, running = filled dot, active = clock, silent = dash).
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Text } from '../ui/primitives/Text';
import { textStyle, useTheme, Button } from '../ui';
import { Icon } from '../chat/icons';
import { a11yState } from '../ui/lib/a11yState';
import type { RoutineGroup } from './status';
import { badgeCount, type InboxOutcome, type RoutinesTab } from './inbox';

export type GlyphKind = RoutineGroup | 'running' | 'silent';

/** Result outcome → glyph: done = check, failed / blocked / not delivered = triangle, no change = dash. */
export function outcomeGlyph(o: InboxOutcome): GlyphKind {
  return o === 'ok' ? 'completed' : o === 'silent' ? 'silent' : 'attention';
}

export function RoutineGlyph({ kind, size = 20 }: { kind: GlyphKind; size?: number }) {
  const t = useTheme();
  const color = kind === 'attention' ? t.colors.warning : kind === 'paused' || kind === 'completed' || kind === 'silent' ? t.colors.muted : t.colors.accent;
  const p = { stroke: color, strokeWidth: 1.75, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  let body;
  switch (kind) {
    case 'paused':
      body = (
        <>
          <Circle cx={12} cy={12} r={8.5} {...p} />
          <Path d="M10 9v6M14 9v6" {...p} />
        </>
      );
      break;
    case 'attention':
      body = <Path d="M12 4.5l8.5 15h-17zM12 10.5v4M12 17.2v.1" {...p} />;
      break;
    case 'completed':
      body = (
        <>
          <Circle cx={12} cy={12} r={8.5} {...p} />
          <Path d="M8.5 12.3l2.4 2.4 4.6-5" {...p} />
        </>
      );
      break;
    case 'silent':
      body = (
        <>
          <Circle cx={12} cy={12} r={8.5} {...p} />
          <Path d="M8.5 12h7" {...p} />
        </>
      );
      break;
    case 'running':
      body = (
        <>
          <Circle cx={12} cy={12} r={8.5} {...p} />
          <Circle cx={12} cy={12} r={4} fill={color} />
        </>
      );
      break;
    default:
      body = (
        <>
          <Circle cx={12} cy={12} r={8.5} {...p} />
          <Path d="M12 7.5v4.7l3 1.8" {...p} />
        </>
      );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      {body}
    </Svg>
  );
}

export function RoutineRow({
  title,
  schedule,
  when,
  outcome,
  outcomeWarn,
  glyph,
  a11yLabel,
  onPress,
  action,
  last,
  testID,
}: {
  title: string;
  schedule: string;
  /** next run / paused / running; '' for completed jobs */
  when: string;
  outcome: string;
  outcomeWarn?: boolean;
  glyph: GlyphKind;
  a11yLabel: string;
  onPress(): void;
  action?: { label: string; a11y: string; onPress(): void; busy?: boolean };
  last?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <View style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.border }]}>
      <Pressable
        onPress={onPress}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        style={({ pressed }) => [styles.rowMain, pressed && { backgroundColor: t.colors.surfacePressed }]}
      >
        <View style={styles.glyph}>
          <RoutineGlyph kind={glyph} />
        </View>
        <View style={styles.flex}>
          <Text style={[textStyle(t, 'body'), { color: t.colors.text, fontWeight: '600' }]} numberOfLines={2}>
            {title}
          </Text>
          <Text style={[styles.sub, textStyle(t, 'callout'), { color: t.colors.text }]} numberOfLines={2}>
            {schedule}
          </Text>
          {when ? (
            <Text style={[styles.sub, textStyle(t, 'caption'), { color: t.colors.muted }]} numberOfLines={2}>
              {when}
            </Text>
          ) : null}
          <Text style={[textStyle(t, 'caption'), { color: outcomeWarn ? t.colors.warning : t.colors.muted }]} numberOfLines={2}>
            {outcome}
          </Text>
        </View>
        {!action ? <Icon name="chevronRight" size={18} color={t.colors.subtle} /> : null}
      </Pressable>
      {action ? (
        <View style={styles.action}>
          <Button label={action.label} accessibilityLabel={action.a11y} onPress={action.onPress} loading={action.busy} variant="secondary" size="small" />
        </View>
      ) : null}
    </View>
  );
}

/** "Label    value" inside a detail group; long values wrap under the label on narrow screens. */
export function InfoRow({ label, value, tone, last, selectable }: { label: string; value: string; tone?: 'warning' | 'muted'; last?: boolean; selectable?: boolean }) {
  const t = useTheme();
  const color = tone === 'warning' ? t.colors.warning : tone === 'muted' ? t.colors.muted : t.colors.text;
  return (
    <View style={[styles.info, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.border }]} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[styles.infoLabel, textStyle(t, 'caption'), { color: t.colors.muted }]}>{label}</Text>
      <Text style={[styles.flex, textStyle(t, 'body'), { color }]} selectable={selectable}>
        {value}
      </Text>
    </View>
  );
}

/** Small count pill (unread results); decorative: the count is part of the owner's accessibility label. */
export function CountBadge({ count }: { count: number }) {
  const t = useTheme();
  if (count <= 0) return null;
  return (
    <View style={[styles.badge, { backgroundColor: t.colors.accent, borderRadius: t.radii.pill }]} accessible={false} importantForAccessibility="no-hide-descendants">
      <Text style={[textStyle(t, 'caption'), styles.badgeText, { color: t.colors.onAccent }]} numberOfLines={1}>
        {badgeCount(count)}
      </Text>
    </View>
  );
}

/** Inbox / Schedules: a segmented control in the settings look, announced as tabs, unread count on the inbox. */
export function RoutineTabs({
  value,
  onChange,
  unread,
  labels,
}: {
  value: RoutinesTab;
  onChange(v: RoutinesTab): void;
  unread: number;
  labels: { group: string; inbox: string; inboxA11y: string; schedules: string };
}) {
  const t = useTheme();
  const tabs: { v: RoutinesTab; label: string; a11y: string; count: number }[] = [
    { v: 'inbox', label: labels.inbox, a11y: labels.inboxA11y, count: unread },
    { v: 'schedules', label: labels.schedules, a11y: labels.schedules, count: 0 },
  ];
  return (
    <View style={[styles.tabs, { backgroundColor: t.dark ? t.colors.surfaceAlt : t.colors.surfacePressed, borderRadius: t.radii.pill }]} accessibilityRole="tablist" accessibilityLabel={labels.group}>
      {tabs.map((o) => {
        const sel = o.v === value;
        return (
          <Pressable
            key={o.v}
            onPress={() => onChange(o.v)}
            accessibilityRole="tab"
            accessibilityLabel={o.a11y}
            {...a11yState({ selected: sel })}
            testID={`routines-tab-${o.v}`}
            style={[styles.tab, { borderRadius: t.radii.pill }, sel && [{ backgroundColor: t.dark ? t.colors.surfacePressed : t.colors.bg }, t.shadows.sm]]}
          >
            <Text style={[textStyle(t, 'callout'), { color: sel ? t.colors.text : t.colors.muted, fontWeight: sel ? '600' : '500' }]} numberOfLines={1}>
              {o.label}
            </Text>
            <CountBadge count={o.count} />
          </Pressable>
        );
      })}
    </View>
  );
}

/** Filled dot before an unread result's title (the word "unread" is in the accessibility label). */
function UnreadDot() {
  const t = useTheme();
  return <View style={[styles.dot, { backgroundColor: t.colors.accent }]} accessible={false} />;
}

/** One result in the inbox list: glyph, title (bold + dot while unread), time, status, 2–3 lines of summary. */
export function InboxCard({
  title,
  when,
  status,
  outcome,
  summary,
  unread,
  a11yLabel,
  onPress,
  last,
  testID,
}: {
  title: string;
  /** relative time ("vor 3 Stunden") */
  when: string;
  status: string;
  outcome: InboxOutcome;
  summary: string;
  unread: boolean;
  a11yLabel: string;
  onPress(): void;
  last?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  const warn = outcome === 'failed' || outcome === 'blocked' || outcome === 'deliveryFailed';
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      style={({ pressed }) => [styles.card, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.border }, pressed && { backgroundColor: t.colors.surfacePressed }]}
    >
      <View style={styles.glyph}>
        <RoutineGlyph kind={outcomeGlyph(outcome)} />
      </View>
      <View style={styles.flex}>
        <View style={styles.cardHead}>
          {unread ? <UnreadDot /> : null}
          <Text style={[styles.flex, textStyle(t, 'body'), { color: t.colors.text, fontWeight: unread ? '700' : '500' }]} numberOfLines={2}>
            {title}
          </Text>
          <Text style={[textStyle(t, 'caption'), { color: unread ? t.colors.accentText : t.colors.muted }]} numberOfLines={1}>
            {when}
          </Text>
        </View>
        <Text style={[styles.sub, textStyle(t, 'caption'), { color: warn ? t.colors.warning : t.colors.muted }]} numberOfLines={1}>
          {status}
        </Text>
        {summary ? (
          <Text style={[styles.sub, textStyle(t, 'callout'), { color: t.colors.text }]} numberOfLines={3}>
            {summary}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingLeft: 14, paddingRight: 10, paddingVertical: 12, minHeight: 64 },
  glyph: { paddingTop: 2 },
  sub: { marginTop: 2 },
  action: { paddingRight: 12, paddingLeft: 2 },
  info: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 12, rowGap: 2, paddingHorizontal: 14, paddingVertical: 11 },
  infoLabel: { width: 110 },
  badge: { minWidth: 20, minHeight: 20, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontWeight: '700', fontSize: 12, lineHeight: 16 },
  tabs: { flexDirection: 'row', padding: 3, gap: 3 },
  tab: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', minHeight: 36, paddingHorizontal: 8, paddingVertical: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 64 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
