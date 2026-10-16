/**
 * Empty quick thread: same composition as the chat start screen (mark + two-tone headline near the optical centre,
 * suggestions near the composer), with what quick answers are – and are not – in one plain sentence, three sample
 * questions and where the answers stay.
 */
import { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/primitives/Text';
import { lightHaptic } from '../chat/actions';
import { Icon } from '../chat/icons';
import { useT } from '../i18n';
import { FadeIn, useTheme } from '../ui';

const MAX_WIDTH = 720;

/** `model`: the model that answers (shown like "Hermes ist bereit" on the chat start screen); unknown → the feature name */
export const QuickEmptyState = memo(function QuickEmptyState({ onPick, model }: { onPick(text: string): void; model?: string }) {
  const t = useTheme();
  const tr = useT();
  const [first, second] = tr('quick.empty.title').split('\n');
  const samples = [tr('quick.empty.samples.a'), tr('quick.empty.samples.b'), tr('quick.empty.samples.c')];
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        <FadeIn style={styles.heroInner}>
          <View style={styles.identity}>
            <View style={[styles.mark, { borderColor: t.colors.accent, borderRadius: t.radii.control }]}>
              <Icon name="boltFilled" size={15} color={t.colors.accent} strokeWidth={1.4} />
            </View>
            <Text style={[t.typography.callout, styles.label, { color: t.colors.muted }]} numberOfLines={1}>
              {model ? tr('quick.empty.ready', { model }) : tr('quick.thread.title')}
            </Text>
          </View>
          <Text style={[t.typography.heroCompact, { color: t.colors.text }]} accessibilityRole="header">
            {first}
            {second ? (
              <>
                {'\n'}
                <Text style={{ color: t.colors.subtle }}>{second}</Text>
              </>
            ) : null}
          </Text>
          <Text style={[t.typography.body, styles.lead, { color: t.colors.muted }]}>{tr('quick.empty.lead')}</Text>
        </FadeIn>
      </View>
      <FadeIn delay={70} style={styles.samples}>
        <Text style={[t.typography.caption, styles.samplesLabel, { color: t.colors.subtle }]} accessibilityRole="header">
          {tr('quick.empty.samplesLabel')}
        </Text>
        <View style={[styles.list, { borderRadius: t.radii.card, borderColor: t.colors.border, backgroundColor: t.dark ? t.colors.surface : t.colors.bg }]}>
          {samples.map((q, i) => (
            <Pressable
              key={q}
              onPress={() => {
                lightHaptic();
                onPick(q);
              }}
              accessibilityRole="button"
              accessibilityLabel={tr('quick.empty.sampleA11y', { text: q })}
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                styles.sample,
                i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.colors.border },
                (pressed || hovered) && { backgroundColor: pressed ? t.colors.surfacePressed : t.colors.surfaceAlt },
              ]}
            >
              <Text style={[t.typography.body, styles.sampleText, { color: t.colors.text }]} numberOfLines={2}>
                {q}
              </Text>
              <Icon name="send" size={16} color={t.colors.subtle} strokeWidth={2} />
            </Pressable>
          ))}
        </View>
        <View style={styles.keepRow}>
          <Icon name="history" size={14} color={t.colors.subtle} />
          <Text style={[t.typography.caption, styles.keep, { color: t.colors.subtle }]}>{tr('quick.empty.keep')}</Text>
        </View>
      </FadeIn>
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', paddingBottom: 10 },
  hero: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingTop: 8, paddingBottom: 24, minHeight: 200 },
  heroInner: { gap: 14 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { width: 30, height: 30, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  label: { fontWeight: '500', flexShrink: 1 },
  lead: { maxWidth: 520 },
  samples: { paddingHorizontal: 12, gap: 10 },
  samplesLabel: { fontWeight: '600', paddingHorizontal: 12 },
  list: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  sample: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 15, paddingVertical: 12 },
  sampleText: { flex: 1 },
  keepRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingTop: 2 },
  keep: { flexShrink: 1 },
});
