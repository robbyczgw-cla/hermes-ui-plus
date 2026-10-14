/**
 * Undo toast of a bulk delete ("12 Chats gelöscht · Rückgängig"). Lives as long as the deleter's undo window
 * (bulkDelete.ts, ~6 s); afterwards the data is removed and Hermes deletes go out. Also shows a short notice
 * when some Hermes deletes failed. Mounted once by ConversationsProvider.
 */
import { useEffect } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeOutDown, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../i18n';
import { haptic, HText, useTheme } from '../ui';
import { useBulkDelete } from './ConversationsProvider';

export function BulkDeleteToast() {
  const t = useTheme();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const { deleter, pending, report } = useBulkDelete();

  const text = pending ? tr('conversations.bulk.deleted', { count: pending.count }) : report ? tr('conversations.bulk.remoteFailed', { count: report.remoteFailed }) : null;

  useEffect(() => {
    if (text && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(text);
  }, [text]);

  // the failure notice goes away on its own
  useEffect(() => {
    if (!report || pending) return;
    const h = setTimeout(() => deleter.dismissReport(), 6000);
    return () => clearTimeout(h);
  }, [report, pending, deleter]);

  if (!text) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.wrap]} pointerEvents="box-none">
      <Animated.View
        key={pending ? `p${pending.batch}` : 'r'}
        exiting={FadeOutDown.duration(160).reduceMotion(ReduceMotion.System)}
        accessibilityLiveRegion="polite"
        role="status"
        aria-live="polite"
        style={[styles.toast, { marginBottom: insets.bottom + 24, backgroundColor: t.colors.text }, t.shadows.md]}
      >
        <HText variant="callout" weight="500" style={[styles.text, { color: t.colors.bg }]}>
          {text}
        </HText>
        {pending ? (
          <Pressable
            onPress={() => {
              if (deleter.undo()) haptic('success');
            }}
            accessibilityRole="button"
            accessibilityLabel={tr('conversations.bulk.undoA11y', { count: pending.count })}
            hitSlop={6}
            style={styles.action}
          >
            <HText variant="callout" weight="700" style={{ color: t.colors.bg }}>
              {tr('conversations.bulk.undo')}
            </HText>
          </Pressable>
        ) : (
          <Pressable onPress={() => deleter.dismissReport()} accessibilityRole="button" accessibilityLabel={tr('actions.ok')} hitSlop={6} style={styles.action}>
            <HText variant="callout" weight="700" style={{ color: t.colors.bg }}>
              {tr('actions.ok')}
            </HText>
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { justifyContent: 'flex-end', alignItems: 'center' },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 520, marginHorizontal: 16, paddingLeft: 16, paddingRight: 4, borderRadius: 22, minHeight: 48 },
  text: { flexShrink: 1, paddingVertical: 10 },
  action: { minHeight: 44, minWidth: 44, paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center' },
});
