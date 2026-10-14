/**
 * "Vorlesen" button for the assistant action row (same size as Kopieren/Teilen: 17 px icon, 6 px padding).
 * Tap: start → pause → resume; a stop button appears next to it while active. A thin ring shows the
 * progress. Only one message plays at a time (global speaker); starting here stops any other.
 */
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useLocale, useT } from '../../i18n';
import { haptic, useTheme } from '../../ui';
import { stopSpeaking, toggleSpeaking, useSpeaker } from '../speaker';
import { voiceErrorText } from '../types';
import type { VoiceConn } from '../types';
import { VoiceIcon } from './icons';

export type SpeakButtonProps = {
  /** the assistant message (markdown incl. ```hui blocks; they are summarised, not read) */
  message: { id: string; text: string };
  /** UI bridge (voiceConnFromProfile(profile)); null → on-device voice */
  conn: VoiceConn | null;
  iconSize?: number;
  /** e.g. show a toast */
  onError?(message: string): void;
};

export function SpeakButton({ message, conn, iconSize = 17, onError }: SpeakButtonProps) {
  const theme = useTheme();
  const t = useT();
  const { locale } = useLocale();
  const s = useSpeaker(message.id);
  const active = s.status === 'playing' || s.status === 'paused' || s.status === 'loading';

  useEffect(() => {
    if (s.status === 'error' && s.error) onError?.(voiceErrorText(s.error, t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.status, s.error]);

  const label =
    s.status === 'playing'
      ? t('voice.speak.pause')
      : s.status === 'paused'
        ? t('voice.speak.resume')
        : s.status === 'loading'
          ? t('voice.speak.preparing')
          : s.status === 'error'
            ? t('voice.speak.failed', { error: s.error ? voiceErrorText(s.error, t) : '' })
            : t('voice.speak.read');

  const ring = iconSize + 8;
  const r = ring / 2 - 1.25;
  const circ = 2 * Math.PI * r;

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => {
          haptic('selection');
          toggleSpeaking({ id: message.id, text: message.text, conn, t, locale });
        }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy: s.status === 'loading' }}
        accessibilityValue={active ? { min: 0, max: 100, now: Math.round(s.progress * 100) } : undefined}
        style={({ pressed }) => [styles.btn, pressed && { backgroundColor: theme.colors.surfacePressed }]}
      >
        <View style={{ width: iconSize, height: iconSize, alignItems: 'center', justifyContent: 'center' }}>
          {active && s.status !== 'loading' ? (
            <Svg width={ring} height={ring} style={[styles.ring, { left: -4, top: -4 }]} pointerEvents="none">
              <Circle cx={ring / 2} cy={ring / 2} r={r} stroke={theme.colors.border} strokeWidth={1.5} fill="none" />
              <Circle
                cx={ring / 2}
                cy={ring / 2}
                r={r}
                stroke={theme.colors.accent}
                strokeWidth={1.5}
                fill="none"
                strokeDasharray={`${circ} ${circ}`}
                strokeDashoffset={circ * (1 - Math.max(0.02, s.progress))}
                strokeLinecap="round"
                transform={`rotate(-90 ${ring / 2} ${ring / 2})`}
              />
            </Svg>
          ) : null}
          {s.status === 'loading' ? (
            <ActivityIndicator size="small" color={theme.colors.muted} style={{ transform: [{ scale: 0.8 }] }} />
          ) : s.status === 'playing' ? (
            <VoiceIcon name="pause" size={iconSize - 5} color={theme.colors.accent} />
          ) : s.status === 'paused' ? (
            <VoiceIcon name="play" size={iconSize - 5} color={theme.colors.accent} />
          ) : s.status === 'error' ? (
            <VoiceIcon name="alert" size={iconSize} color={theme.colors.danger} />
          ) : (
            <VoiceIcon name="speaker" size={iconSize} color={theme.colors.muted} />
          )}
        </View>
      </Pressable>
      {active ? (
        <Pressable
          onPress={() => {
            haptic('selection');
            stopSpeaking();
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('voice.speak.stop')}
          style={({ pressed }) => [styles.btn, pressed && { backgroundColor: theme.colors.surfacePressed }]}
        >
          <VoiceIcon name="stop" size={iconSize} color={theme.colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  btn: { padding: 6, borderRadius: 8 },
  ring: { position: 'absolute' },
});
