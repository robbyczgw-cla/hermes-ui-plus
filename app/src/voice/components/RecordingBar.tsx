/**
 * Replaces the composer's text input while dictating: × (verwerfen) · ● Timer · live waveform
 * (· optional ✓ when the MicButton is not next to it). Hold-to-talk shows "‹ Zum Abbrechen wischen",
 * which follows the finger. While transcribing: spinner + "Wird erkannt …" (× aborts).
 * On-device recognition: the live transcript replaces the waveform as soon as words arrive. Before the first
 * iOS 26 SpeechAnalyzer dictation in a language: spinner + "Sprachmodell wird geladen … x %".
 */
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../ui/primitives/Text';
import type { StyleProp, ViewStyle } from 'react-native';
import { useT } from '../../i18n';
import { useTheme } from '../../ui';
import { modelProgressPercent } from '../engine';
import { formatElapsed } from '../format';
import type { Dictation } from '../useDictation';
import { useDictationMeter } from '../useDictation';
import { VoiceIcon } from './icons';

export type RecordingBarProps = {
  dictation: Dictation;
  /** show an own ✓ stop button (default false: the MicButton next to it acts as stop) */
  showStop?: boolean;
  /** waveform bars (default 40) */
  bars?: number;
  style?: StyleProp<ViewStyle>;
};

const BAR_W = 3;
const BAR_GAP = 2;
const MAX_H = 26;

export function RecordingBar({ dictation, showStop = false, bars = 40, style }: RecordingBarProps) {
  const theme = useTheme();
  const t = useT();
  const { elapsedMs, levels, partial, modelProgress } = useDictationMeter(dictation);
  const { phase, mode, holdDragX, maxMs } = dictation;
  const loadingModel = modelProgress !== null && phase === 'starting';
  const transcribing = phase === 'transcribing';
  const hold = mode === 'hold' && phase === 'recording';
  const remaining = Math.max(0, maxMs - elapsedMs);
  const nearLimit = phase === 'recording' && remaining <= 15_000;

  const shown = levels.slice(-bars);
  const pad = Math.max(0, bars - shown.length);

  return (
    <View style={[styles.row, style]} accessibilityLabel={transcribing ? t('voice.mic.transcribing') : t('voice.recording.label')}>
      <Pressable
        onPress={dictation.cancel}
        accessibilityRole="button"
        accessibilityLabel={transcribing ? t('voice.recording.cancelRecognition') : t('voice.recording.discard')}
        hitSlop={8}
        style={({ pressed }) => [styles.iconBtn, { backgroundColor: pressed ? theme.colors.surfacePressed : theme.colors.surfaceAlt }]}
      >
        <VoiceIcon name="close" size={17} color={theme.colors.text} strokeWidth={2.2} />
      </Pressable>

      {loadingModel ? (
        <View style={styles.center} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={theme.colors.muted} />
          <Text style={[theme.typography.body, { color: theme.colors.muted }]} numberOfLines={1}>
            {t('voice.recording.modelLoading', { percent: modelProgressPercent(modelProgress) })}
          </Text>
        </View>
      ) : transcribing ? (
        <View style={styles.center} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={theme.colors.muted} />
          <Text style={[theme.typography.body, { color: partial ? theme.colors.text : theme.colors.muted }]} numberOfLines={1} ellipsizeMode="head">
            {partial || t('voice.recording.recognizing')}
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.timerWrap} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <View style={[styles.dot, { backgroundColor: theme.colors.danger, opacity: phase === 'recording' && Math.floor(elapsedMs / 600) % 2 === 0 ? 1 : 0.35 }]} />
            <Text style={[theme.typography.body, styles.timer, { color: nearLimit ? theme.colors.warning : theme.colors.text }]}>
              {nearLimit ? t('voice.recording.remaining', { seconds: Math.ceil(remaining / 1000) }) : formatElapsed(elapsedMs)}
            </Text>
          </View>
          <View style={styles.waveWrap} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            {partial ? (
              <Text style={[theme.typography.body, { color: theme.colors.text, opacity: hold ? Math.max(0.15, 1 + holdDragX / 90) : 1 }]} numberOfLines={1} ellipsizeMode="head">
                {partial}
              </Text>
            ) : (
            <View style={[styles.wave, { opacity: hold ? Math.max(0.15, 1 + holdDragX / 90) : 1 }]}>
              {Array.from({ length: pad }, (_, i) => (
                <View key={`p${i}`} style={[styles.bar, { height: 3, backgroundColor: theme.colors.borderStrong }]} />
              ))}
              {shown.map((lv, i) => (
                <View key={i} style={[styles.bar, { height: Math.max(3, Math.round(3 + lv * (MAX_H - 3))), backgroundColor: theme.colors.text }]} />
              ))}
            </View>
            )}
            {hold && !partial ? (
              <View pointerEvents="none" style={[styles.hintWrap, { transform: [{ translateX: holdDragX * 0.5 }] }]}>
                <Text style={[theme.typography.caption, styles.hint, { color: theme.colors.muted, backgroundColor: theme.dark ? theme.colors.surface : theme.colors.bg }]} numberOfLines={1}>
                  {t('voice.recording.swipeToCancel')}
                </Text>
              </View>
            ) : null}
          </View>
        </>
      )}

      {showStop && !transcribing ? (
        <Pressable
          onPress={() => void dictation.stop()}
          disabled={phase !== 'recording'}
          accessibilityRole="button"
          accessibilityLabel={t('voice.mic.stop')}
          hitSlop={6}
          style={({ pressed }) => [styles.iconBtn, { backgroundColor: theme.colors.text, opacity: pressed ? 0.7 : 1 }]}
        >
          <VoiceIcon name="check" size={18} color={theme.colors.bg} strokeWidth={2.4} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 },
  iconBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  timerWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  timer: { fontVariant: ['tabular-nums'], minWidth: 36 },
  waveWrap: { flex: 1, height: MAX_H + 4, justifyContent: 'center', overflow: 'hidden' },
  wave: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: BAR_GAP, height: MAX_H },
  bar: { width: BAR_W, borderRadius: BAR_W / 2 },
  hintWrap: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  hint: { paddingHorizontal: 6 },
});
