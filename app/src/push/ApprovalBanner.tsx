/**
 * In-app banner "Freigabe nötig" + "Öffnen": Hermes waits for a decision in ANOTHER chat (inbox event `approval`,
 * routed by approvalInbox.routeApproval). Stays until opened, closed, resolved elsewhere or the estimated deadline.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/primitives/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../i18n';
import { textStyle, useTheme } from '../ui';

const MAX_MS = 5 * 60_000;

export function ApprovalBanner({ command, expiresAt, onOpen, onClose }: { command?: string; expiresAt?: number; onOpen(): void; onClose(): void }) {
  const t = useTheme();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const [anim] = useState(() => new Animated.Value(0));
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 180, useNativeDriver: Platform.OS !== 'web' }).start();
    const left = expiresAt ? Math.max(5_000, Math.min(MAX_MS, expiresAt - Date.now() + 10_000)) : MAX_MS;
    const id = setTimeout(() => closeRef.current(), left);
    return () => clearTimeout(id);
  }, [anim, expiresAt]);
  const text = command ? tr('push.approval.bannerFor', { command: command.slice(0, 80) }) : tr('push.approval.banner');
  return (
    <Animated.View
      style={[styles.wrap, { top: insets.top + 8, opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }] }]}
      pointerEvents="box-none"
    >
      <View
        style={[styles.banner, { backgroundColor: t.colors.warningSoft, borderColor: t.colors.warning, borderRadius: t.radii.l }, t.shadows.md]}
        accessibilityLiveRegion="assertive"
        accessibilityRole="alert"
      >
        <Pressable onPress={onOpen} style={styles.textWrap} accessibilityRole="button" accessibilityLabel={`${text}. ${tr('push.approval.open')}`}>
          <Text style={[textStyle(t, 'callout'), { color: t.colors.text, fontWeight: '600' }]} numberOfLines={2}>
            {text}
          </Text>
        </Pressable>
        <Pressable onPress={onOpen} hitSlop={8} accessibilityRole="button" style={({ pressed }) => pressed && { opacity: 0.6 }}>
          <Text style={[textStyle(t, 'callout'), { color: t.colors.accentText, fontWeight: '700' }]}>{tr('push.approval.open')}</Text>
        </Pressable>
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel={tr('push.approval.dismiss')} style={({ pressed }) => pressed && { opacity: 0.6 }}>
          <Text style={[styles.close, textStyle(t, 'body'), { color: t.colors.muted }]}>✕</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, alignItems: 'center', zIndex: 1001, elevation: 13 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14, borderWidth: StyleSheet.hairlineWidth * 2, maxWidth: 560, width: '100%' },
  textWrap: { flex: 1 },
  close: { paddingHorizontal: 2 },
});
