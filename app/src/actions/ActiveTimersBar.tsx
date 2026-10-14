import { memo } from 'react';
import { ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useT, type TFn } from '../i18n';
import { Icon, PressableScale, haptic, useTheme, type Theme } from '../ui';
import { formatClock } from './dates.ts';
import { progress, remainingMs, type TimerRecord } from './timerModel.ts';
import { getTimerStore } from './timers';
import { useTimers } from './useTimers';

export type ActiveTimersBarProps = {
  style?: StyleProp<ViewStyle>;
  /** called when a timer finishes while the app is open (e.g. toast "Timer abgelaufen: Nudeln") */
  onTimerDone?: (timer: TimerRecord) => void;
};

function PauseGlyph({ color }: { color: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 3 }}>
      <View style={{ width: 3.5, height: 12, borderRadius: 1.5, backgroundColor: color }} />
      <View style={{ width: 3.5, height: 12, borderRadius: 1.5, backgroundColor: color }} />
    </View>
  );
}

function PlayGlyph({ color }: { color: string }) {
  return (
    <View
      style={{
        width: 0,
        height: 0,
        marginLeft: 2,
        borderTopWidth: 6,
        borderBottomWidth: 6,
        borderLeftWidth: 10,
        borderTopColor: 'transparent',
        borderBottomColor: 'transparent',
        borderLeftColor: color,
      }}
    />
  );
}

function spoken(tr: TFn, ms: number): string {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? tr('actionRunner.timers.spokenMinutes', { minutes: m, seconds: s % 60 }) : tr('actionRunner.timers.spokenSeconds', { seconds: s });
}

const Pill = memo(function Pill({ timer, now, t }: { timer: TimerRecord; now: number; t: Theme }) {
  const tr = useT();
  const store = getTimerStore();
  const rem = remainingMs(timer, now);
  const isDone = timer.status === 'done';
  const fg = isDone ? t.colors.onAccent : t.colors.text;
  const bg = isDone ? t.colors.success : t.colors.surface;
  const label = timer.label.length > 16 ? `${timer.label.slice(0, 15)}…` : timer.label;
  const toggle = () => {
    if (isDone) void store.remove(timer.id);
    else if (timer.status === 'running') void store.pause(timer.id);
    else void store.resume(timer.id);
  };
  const a11y = isDone
    ? tr('actionRunner.timers.doneA11y', { label: timer.label })
    : tr(timer.status === 'running' ? 'actionRunner.timers.runningA11y' : 'actionRunner.timers.pausedA11y', { label: timer.label, remaining: spoken(tr, rem) });
  return (
    <View style={[styles.pill, { backgroundColor: bg, borderColor: isDone ? t.colors.success : t.colors.border }, t.shadows.sm]}>
      <PressableScale
        onPress={toggle}
        onLongPress={() => {
          haptic('medium');
          void store.reset(timer.id);
        }}
        accessibilityLabel={a11y}
        accessibilityHint={tr('actionRunner.timers.resetHint')}
        style={styles.main}
        scaleTo={0.96}
      >
        <View style={styles.glyph}>
          {isDone ? <Icon name="check" size={16} color={fg} strokeWidth={2.4} /> : timer.status === 'running' ? <PauseGlyph color={t.colors.accent} /> : <PlayGlyph color={t.colors.accent} />}
        </View>
        <Text style={[styles.time, { color: fg }]}>{isDone ? tr('actionRunner.timers.done') : formatClock(rem)}</Text>
        {label ? (
          <Text style={[styles.label, { color: isDone ? fg : t.colors.muted }]} numberOfLines={1}>
            {label}
          </Text>
        ) : null}
      </PressableScale>
      <PressableScale
        onPress={() => void store.remove(timer.id)}
        haptic={false}
        hitSlop={8}
        accessibilityLabel={tr('actionRunner.timers.removeA11y', { label: timer.label })}
        style={styles.close}
      >
        <Icon name="x" size={14} color={isDone ? fg : t.colors.subtle} />
      </PressableScale>
      {!isDone ? (
        <View style={[styles.track, { backgroundColor: t.colors.surfaceAlt }]}>
          <View style={{ width: `${Math.round(progress(timer, now) * 100)}%`, height: 3, backgroundColor: timer.status === 'running' ? t.colors.accent : t.colors.subtle }} />
        </View>
      ) : null}
    </View>
  );
});

/**
 * Compact pills for running / paused / finished timers (tap = pause/resume, long-press = reset,
 * x = remove). Renders nothing without timers. Place it above the message list / composer.
 */
export function ActiveTimersBar({ style, onTimerDone }: ActiveTimersBarProps) {
  const t = useTheme();
  const tr = useT();
  const { timers, now } = useTimers((tm) => {
    haptic('success');
    onTimerDone?.(tm);
  });
  if (!timers.length) return null;
  return (
    <View style={style} accessibilityRole="toolbar" accessibilityLabel={tr('actionRunner.timers.barA11y')}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} keyboardShouldPersistTaps="handled">
        {timers.map((tm) => (
          <Pill key={tm.id} timer={tm} now={now} t={t} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingHorizontal: 12, paddingVertical: 6 },
  pill: { flexDirection: 'row', alignItems: 'center', height: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', paddingLeft: 12 },
  main: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40 },
  glyph: { width: 16, alignItems: 'center', justifyContent: 'center' },
  time: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  label: { fontSize: 13, maxWidth: 110 },
  close: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center' },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3 },
});
