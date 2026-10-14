/**
 * Composer mic button. Tap → start, tap again → stop + transcribe. Hold (≥ 280 ms) → hold-to-talk:
 * release stops, sliding left cancels. Recording starts on touch-down either way (holdPress.ts): a short press
 * becomes a tap without losing what was said meanwhile (react-native-gesture-handler, root view exists in app/_layout). While recording the button turns into "Fertig" (✓) and pulses
 * with the input level; while transcribing it shows a spinner. Without bridge it stays visible but
 * dimmed and explains on tap (UNAVAILABLE_KEYS message in dictation.error).
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useT } from '../../i18n';
import { bestOn, haptic, useTheme } from '../../ui';
import { createHoldController } from '../holdPress';
import type { Dictation } from '../useDictation';
import { useDictationMeter } from '../useDictation';
import { VoiceIcon } from './icons';

export type MicButtonProps = {
  dictation: Dictation;
  size?: number;
  disabled?: boolean;
  /** enable hold-to-talk (default true) */
  holdToTalk?: boolean;
  holdDelayMs?: number;
  /** px to slide left (while holding) to cancel */
  cancelDistance?: number;
};

export function MicButton({ dictation, size = 36, disabled, holdToTalk = true, holdDelayMs = 280, cancelDistance = 90 }: MicButtonProps) {
  const theme = useTheme();
  const t = useT();
  const [pressed, setPressed] = useState(false);
  const { levels } = useDictationMeter(dictation);
  const level = dictation.phase === 'recording' ? (levels[levels.length - 1] ?? 0) : 0;

  const [ctl] = useState(() => createHoldController(setPressed, () => haptic('warning')));
  useEffect(() => {
    ctl.update({ dictation, disabled, holdToTalk, holdDelayMs, cancelDistance });
  });
  useEffect(() => () => ctl.dispose(), [ctl]);

  // RNGH manual gesture (root GestureHandlerRootView exists in app/_layout): raw touches, activated on
  // touch-down so nothing else steals the finger while holding; a plain tap without movement works too.
  const gesture = Gesture.Manual()
    .runOnJS(true)
    .enabled(!disabled)
    .hitSlop(6)
    .onTouchesDown((e, m) => {
      const x = e.allTouches[0]?.absoluteX ?? 0;
      if (ctl.begin(x)) m.activate();
    })
    .onTouchesMove((e) => {
      const x = e.allTouches[0]?.absoluteX;
      if (typeof x === 'number') ctl.move(x);
    })
    .onTouchesUp((_e, m) => {
      ctl.end(true);
      m.end();
    })
    .onTouchesCancelled((_e, m) => {
      ctl.end(false);
      m.fail();
    });

  const { phase, mode, available } = dictation;
  const recording = phase === 'recording';
  const holdActive = mode === 'hold' && (phase === 'recording' || phase === 'starting');
  const busy = phase === 'transcribing';

  const label = busy
    ? t('voice.mic.transcribing')
    : recording
      ? holdActive
        ? t('voice.mic.holding')
        : t('voice.mic.stop')
      : t('voice.mic.start');
  const hint = !available
    ? t(dictation.unavailable === 'no_bridge' ? 'voice.mic.needsBridge' : 'voice.mic.unavailable')
    : phase === 'idle'
      ? holdToTalk
        ? t('voice.mic.hintHold')
        : t('voice.mic.hintTap')
      : undefined;

  const bg = recording || phase === 'starting' ? (holdActive ? theme.colors.danger : theme.colors.text) : pressed ? theme.colors.surfacePressed : 'transparent';
  const fg = recording || phase === 'starting' ? (holdActive ? bestOn(theme.colors.danger, ['#FFFFFF', theme.colors.bg]) : theme.colors.bg) : available ? theme.colors.text : theme.colors.subtle;
  const scale = holdActive ? 1.18 : 1;

  return (
    <GestureDetector gesture={gesture}>
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ disabled: !!disabled, busy }}
        accessibilityActions={[{ name: 'activate' }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName !== 'activate' || disabled) return;
          const d = dictation;
          if (d.phase === 'idle') void d.start('tap');
          else if (d.phase === 'recording') void d.stop();
        }}
        style={[styles.wrap, { width: size, height: size, opacity: disabled ? 0.45 : 1 }]}
      >
        {recording ? (
          <View
            pointerEvents="none"
            style={[
              styles.halo,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: holdActive ? theme.colors.dangerSoft : theme.colors.surfacePressed,
                transform: [{ scale: scale * (1.08 + level * 0.45) }],
              },
            ]}
          />
        ) : null}
        <View style={[styles.btn, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg, transform: [{ scale }] }]}>
          {busy ? (
            <ActivityIndicator size="small" color={theme.colors.text} />
          ) : recording && !holdActive ? (
            <VoiceIcon name="check" size={20} color={fg} strokeWidth={2.4} />
          ) : (
            <VoiceIcon name="mic" size={21} color={fg} strokeWidth={2} />
          )}
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', marginBottom: 1 },
  btn: { alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute' },
});
