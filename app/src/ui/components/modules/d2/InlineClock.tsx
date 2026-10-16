/**
 * Compact countdown row on the shared engine (guide step timers): small ring, digits,
 * start/pause, reset, ±1 min while running. Controlled by the parent's useClocks.
 */
import { View } from 'react-native';
import type { Theme } from '../../../theme';
import { HText, PressableScale } from '../../../primitives/basics';
import { Icon } from '../../../primitives/Icon';
import { haptic } from '../../../primitives/haptics';
import { useT } from '../../../../i18n';
import { ClockRing, D2Icon, IconBtn } from './parts';
import { ADJUST_STEP_MS, countdown, formatCountdown, progress, remainingMs, type Clock } from './timerEngine.ts';
import type { ClockControls } from './useClocks';
import { spokenDuration } from './TimerV2';

export function InlineClock({
  t,
  clockKey,
  seconds,
  clock,
  ctl,
  label,
  disabled,
}: {
  t: Theme;
  clockKey: string;
  seconds: number;
  clock: Clock | undefined;
  ctl: ClockControls;
  label: string;
  disabled?: boolean;
}) {
  const tr = useT();
  const c = clock ?? countdown(seconds);
  const now = ctl.now;
  const rem = remainingMs(c, now);
  const running = c.status === 'running';
  const done = c.status === 'done';
  const stateText = done ? tr('ui.timer.done') : running ? tr('ui.timer.running') : c.status === 'paused' ? tr('ui.timer.paused') : tr('ui.timer.notStarted');
  const color = done ? t.colors.success : running ? t.colors.accent : t.colors.borderStrong;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.m, padding: t.spacing.m, borderRadius: t.radii.card, backgroundColor: t.colors.surfaceAlt }}>
      <ClockRing size={48} stroke={4} frac={done ? 0 : progress(c, now)} color={color} track={t.colors.border}>
        {done ? <Icon name="check" size={20} color={t.colors.success} strokeWidth={2.4} /> : <D2Icon name="timer" size={18} color={color} />}
      </ClockRing>
      <View style={{ flex: 1, minWidth: 0 }} accessible accessibilityRole="timer" accessibilityLabel={tr('ui.timer.a11yClock', { label, spoken: spokenDuration(rem / 1000, tr), state: stateText })} accessibilityLiveRegion={done ? 'assertive' : 'none'}>
        <HText variant="title" tabular numberOfLines={1} adjustsFontSizeToFit style={{ color: done ? t.colors.success : t.colors.text }}>
          {done ? tr('ui.timer.done') : formatCountdown(rem)}
        </HText>
        <HText variant="caption" color="muted" numberOfLines={1}>
          {stateText}
        </HText>
      </View>
      {running ? (
        <PressableScale haptic="selection" onPress={() => ctl.adjust(clockKey, ADJUST_STEP_MS)} accessibilityLabel={tr('ui.timer.plusMinuteA11y')} hitSlop={4} style={{ minHeight: 40, minWidth: 52, paddingHorizontal: 8, borderRadius: t.radii.pill, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.colors.borderControl }}>
          <HText variant="caption" weight="600" tabular>
            {tr('ui.timer.plusMinute')}
          </HText>
        </PressableScale>
      ) : c.status !== 'idle' ? (
        <IconBtn t={t} icon="reset" label={tr('ui.timer.reset')} onPress={() => ctl.reset(clockKey)} tone="muted" size={40} />
      ) : null}
      <IconBtn
        t={t}
        icon={running ? 'pause' : 'play'}
        filled={!running}
        disabled={disabled}
        label={running ? tr('ui.timer.pause') : done ? tr('ui.timer.restart') : c.status === 'paused' ? tr('ui.timer.resume') : tr('ui.timer.start')}
        onPress={() => {
          haptic(running ? 'light' : 'medium');
          if (running) ctl.pause(clockKey);
          else ctl.start(clockKey, countdown(seconds));
        }}
      />
    </View>
  );
}
