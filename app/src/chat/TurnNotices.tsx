/**
 * Calm per-message notices around background turns (background/):
 *  - CutNotice: the answer was cut while the app was in the background (direct backends) → "Fortsetzen" /
 *    "Neu starten" + a one-time Android battery hint. Partial text, tools and search results stay above it.
 *  - LateMark: "nachgeladen" / "fertig" cue on an answer that arrived late (Hermes recovery) or finished while the
 *    chat was not on screen; flashes briefly when the notice routing asked for it (noticeState.flash).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { batteryHintDone, dismissBatteryHint, loadBatteryHint, openBatterySettings } from '../background/batteryHint';
import { flashStore } from '../background/noticeState';
import { messageErrorText } from '../hermes/chatState';
import type { ChatMessage } from '../hermes/types';
import { useT } from '../i18n';
import { scaledText } from '../settings/preferences';
import { useTheme } from '../ui';
import { Icon } from './icons';
import { useTurnActions } from './turnActions';

const NATIVE = Platform.OS !== 'web';

export function CutNotice({ message, isLast, onRetry }: { message: ChatMessage; isLast: boolean; onRetry: () => void }) {
  const t = useTheme();
  const tr = useT();
  const { continueTurn } = useTurnActions();
  const fs = (size: number, line: number) => scaledText(size, line, t.fontScale);
  const hintDone = useSyncExternalStore(batteryHintDone.subscribe, batteryHintDone.get, batteryHintDone.get);
  useEffect(() => {
    if (Platform.OS === 'android') loadBatteryHint();
  }, []);
  const showHint = Platform.OS === 'android' && isLast && hintDone === false;
  return (
    <View style={[styles.box, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.m }]} accessibilityLiveRegion="polite">
      <View style={styles.row}>
        <Icon name="bolt" size={17} color={t.colors.muted} />
        <Text style={[styles.text, fs(13.5, 19), { color: t.colors.text }]}>{messageErrorText(message, tr)}</Text>
      </View>
      {isLast ? (
        <View style={styles.buttons}>
          {continueTurn ? (
            <Pressable
              onPress={() => void continueTurn()}
              style={({ pressed }) => [styles.btn, styles.primary, { backgroundColor: t.colors.accent }, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityHint={tr('chat.backgroundCut.continueHint')}
            >
              <Text style={[styles.btnText, fs(13, 18), { color: t.colors.onAccent }]}>{tr('chat.backgroundCut.continue')}</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={onRetry}
            style={({ pressed }) => [styles.btn, { borderColor: t.colors.borderStrong, borderWidth: 1 }, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
          >
            <Icon name="retry" size={14} color={t.colors.text} />
            <Text style={[styles.btnText, fs(13, 18), { color: t.colors.text }]}>{tr('chat.backgroundCut.restart')}</Text>
          </Pressable>
        </View>
      ) : null}
      {showHint ? (
        <View style={[styles.hint, { borderTopColor: t.colors.border }]}>
          <Text style={[fs(12.5, 17), { color: t.colors.muted }]}>{tr('chat.backgroundCut.batteryHint')}</Text>
          <View style={styles.buttons}>
            <Pressable onPress={() => void openBatterySettings()} accessibilityRole="button" hitSlop={6} style={({ pressed }) => pressed && { opacity: 0.6 }}>
              <Text style={[styles.link, fs(13, 18), { color: t.colors.accent }]}>{tr('chat.backgroundCut.batteryOpen')}</Text>
            </Pressable>
            <Pressable onPress={dismissBatteryHint} accessibilityRole="button" hitSlop={6} style={({ pressed }) => pressed && { opacity: 0.6 }}>
              <Text style={[styles.link, fs(13, 18), { color: t.colors.muted }]}>{tr('chat.backgroundCut.batteryDismiss')}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** "nachgeladen" (recovered answer) – highlighted for a moment when it just arrived */
export function LateMark({ message }: { message: ChatMessage }) {
  const t = useTheme();
  const tr = useT();
  const flashes = useSyncExternalStore(flashStore.subscribe, flashStore.get, flashStore.get);
  const until = flashes.get(message.id);
  const [anim] = useState(() => new Animated.Value(0));
  // a flash was requested for this message (noticeState.flash): highlight, then fade out
  const active = until !== undefined;
  useEffect(() => {
    if (until === undefined) return;
    const left = until - Date.now();
    if (left <= 0) return;
    anim.setValue(1);
    Animated.timing(anim, { toValue: 0, duration: Math.max(400, left), delay: 600, useNativeDriver: NATIVE }).start();
  }, [until, anim]);
  if (message.recoveredAt === undefined && !active) return null;
  const label = message.recoveredAt !== undefined ? tr('chat.message.recovered') : tr('chat.message.finished');
  return (
    <View style={styles.lateWrap}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.lateFlash, { backgroundColor: t.colors.accentSoft, opacity: anim }]} />
      <Icon name="check" size={12} color={t.colors.muted} strokeWidth={2.2} />
      <Text style={[styles.late, scaledText(12, 16, t.fontScale), { color: t.colors.muted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: 8, padding: 12, gap: 10 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  text: { flex: 1, fontSize: 13.5, lineHeight: 19 },
  buttons: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', alignItems: 'center' },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 },
  primary: {},
  btnText: { fontSize: 13, fontWeight: '600' },
  hint: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, gap: 6 },
  link: { fontSize: 13, fontWeight: '600' },
  lateWrap: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
  lateFlash: { borderRadius: 999 },
  late: { fontSize: 12 },
});
