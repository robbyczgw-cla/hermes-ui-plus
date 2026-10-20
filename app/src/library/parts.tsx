// Small building blocks shared by the Skills and Memory panes.
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../ui/primitives/Text';
import { textStyle, useTheme } from '../ui';
import { Icon, type IconName } from '../chat/icons';

/** Explanation card: a title, a short text and optional actions. `tone` only tints the mark; the title carries the meaning. */
export function Notice({ icon, title, body, tone, children }: { icon: IconName; title: string; body?: string; tone?: 'warning'; children?: ReactNode }) {
  const th = useTheme();
  const markBg = tone === 'warning' ? th.colors.warningSoft : th.colors.accentSoft;
  const markFg = tone === 'warning' ? th.colors.warning : th.colors.accent;
  return (
    <View style={[styles.card, { backgroundColor: th.colors.surface, borderColor: th.colors.border, borderRadius: th.radii.card }]}>
      <View style={styles.head}>
        <View style={[styles.mark, { backgroundColor: markBg }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Icon name={icon} size={18} color={markFg} />
        </View>
        <Text style={[styles.flex, textStyle(th, 'bodyStrong'), { color: th.colors.text }]} accessibilityRole="header">
          {title}
        </Text>
      </View>
      {body ? <Text style={[styles.body, textStyle(th, 'callout'), { color: th.colors.muted }]}>{body}</Text> : null}
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

/** "Aus" / "Off" pill: a word in a frame, readable without colour. */
export function OffPill({ label }: { label: string }) {
  const th = useTheme();
  return (
    <View style={[styles.pill, { borderColor: th.colors.borderStrong }]}>
      <Text style={[textStyle(th, 'micro'), { color: th.colors.muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  card: { borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  mark: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  body: { marginLeft: 44 },
  actions: { marginLeft: 44, marginTop: 6, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  pill: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, alignSelf: 'center' },
});
