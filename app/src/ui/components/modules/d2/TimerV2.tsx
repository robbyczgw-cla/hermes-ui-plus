/**
 * `timer` v2 (docs/SPEC-modules-v4.md), backward compatible with v1 {id, label, seconds, autostart}.
 * Countdown · countdown to a date/time (`until`) · stopwatch · multi-timer (≤ 6). Big ring + digits,
 * ±1 min, pause/reset, sound/vibration toggle. State = absolute timestamps in useNodeState (survives
 * restarts); a local notification is scheduled on start and cancelled on pause/reset (useClocks).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useTheme, type Theme } from '../../../theme';
import { scaleFont } from '../../../themes';
import { useHui } from '../../../primitives/context';
import { HText, PressableScale, Surface } from '../../../primitives/basics';
import { Button } from '../../../primitives/Button';
import { Icon } from '../../../primitives/Icon';
import { haptic } from '../../../primitives/haptics';
import { useNodeState } from '../../../../nodestate';
import { useLocale, useT } from '../../../../i18n';
import type { HuiTimer } from '../../../types';
import { TimerSkeleton } from '../../../skeletons';
import { useModuleId, useNodeStateReady } from '../a/shared';
import { setSilentChannelName } from './alarm';
import { ClockRing, D2Icon, DoneAlert, IconBtn, SoundToggle } from './parts';
import { ADJUST_STEP_MS, countdown, elapsedMs, formatCountdown, formatElapsed, progress, remainingMs, splitDuration, stopwatch, type Clock } from './timerEngine.ts';
import { normalizeTimer, timerIsEmpty, timerSubtitle, type TimerItem, type TimerSpec } from './timerModel.ts';
import { sanitizeClocks, useClocks, type ClockControls, type ClockMap } from './useClocks';

type TimerState = { clocks: ClockMap; sound?: boolean; auto?: boolean; since?: number };
const INITIAL: TimerState = { clocks: {} };
const STATE_VERSION = 2; // v1 stored {autostarted}

const MAIN = 'main';
const RING = 184;

export function Timer({ node }: { node: Partial<HuiTimer> }) {
  const t = useTheme();
  const tr = useT();
  const { streaming } = useHui();
  const id = useModuleId('timer', node as Record<string, unknown>);
  const spec = useMemo(() => normalizeTimer(node as Record<string, unknown>), [node]);
  const [st, setSt] = useNodeState<TimerState>(id, INITIAL, { version: STATE_VERSION });
  const ready = useNodeStateReady();
  const clocks = useMemo(() => sanitizeClocks(st.clocks), [st.clocks]);
  const sound = st.sound !== false;
  const [alert, setAlert] = useState<string | null>(null);

  useEffect(() => setSilentChannelName(tr('ui.timer.silentChannel')), [tr]);

  const setClocks = useCallback((fn: (p: ClockMap) => ClockMap) => setSt((s) => ({ ...s, clocks: fn(sanitizeClocks(s.clocks)) })), [setSt]);
  const labelOf = useCallback((key: string) => (spec.kind === 'multi' ? spec.items.find((i) => i.key === key)?.label ?? spec.label : spec.label), [spec]);
  const ctl = useClocks({
    clocks,
    setClocks,
    ready,
    sound,
    alarm: (key) => ({ title: tr('ui.timer.notifyTitle'), body: labelOf(key) }),
    onDone: (key) => setAlert(tr('ui.timer.timesUp', { label: labelOf(key) })),
  });

  // countdown to a date: remember when we first saw it (ring baseline)
  useEffect(() => {
    if (spec.kind === 'until' && ready && !streaming && !st.since) setSt((s) => (s.since ? s : { ...s, since: Date.now() }));
  }, [spec.kind, ready, streaming, st.since, setSt]);

  // autostart once (never again after a reset)
  useEffect(() => {
    if (!ready || streaming || st.auto || spec.kind === 'until' || !('autostart' in spec) || !spec.autostart) return;
    if (spec.kind === 'countdown' && !spec.seconds) return;
    setSt((s) => ({ ...s, auto: true }));
    if (spec.kind === 'multi') spec.items.forEach((i) => ctl.start(i.key, countdown(i.seconds)));
    else ctl.start(MAIN, spec.kind === 'stopwatch' ? stopwatch() : countdown(spec.seconds ?? 0));
  }, [ready, streaming, st.auto, spec, ctl, setSt]);

  if (timerIsEmpty(spec) && streaming) return <TimerSkeleton />;

  const toggleSound = () => setSt((s) => ({ ...s, sound: !(s.sound !== false) }));
  const common = { t, ctl, clocks, sound, toggleSound, streaming, alert, dismiss: () => setAlert(null) };

  if (spec.kind === 'multi') return <MultiTimer spec={spec} {...common} />;
  if (spec.kind === 'until') return <UntilTimer spec={spec} since={st.since} {...common} />;
  return <SingleTimer spec={spec} {...common} />;
}

type CommonProps = { t: Theme; ctl: ClockControls; clocks: ClockMap; sound: boolean; toggleSound: () => void; streaming: boolean; alert: string | null; dismiss: () => void };

/* ───────────── header ───────────── */

function Header({ t, icon, title, subtitle, sound, toggleSound, right }: { t: Theme; icon: 'timer' | 'stopwatch' | 'bell'; title: string; subtitle?: string; sound?: boolean; toggleSound?: () => void; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s }}>
      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <D2Icon name={icon} size={17} color={t.colors.accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <HText variant="headline" numberOfLines={2} accessibilityRole="header">
          {title}
        </HText>
        {subtitle ? (
          <HText variant="caption" color="muted" numberOfLines={1}>
            {subtitle}
          </HText>
        ) : null}
      </View>
      {right}
      {toggleSound ? <SoundToggle on={!!sound} onToggle={toggleSound} t={t} /> : null}
    </View>
  );
}

/* ───────────── single countdown / stopwatch ───────────── */

function SingleTimer({ spec, t, ctl, clocks, sound, toggleSound, streaming, alert, dismiss }: CommonProps & { spec: Extract<TimerSpec, { kind: 'countdown' | 'stopwatch' }> }) {
  const tr = useT();
  const isWatch = spec.kind === 'stopwatch';
  const seconds = spec.kind === 'countdown' ? spec.seconds ?? 0 : 0;
  const base = useMemo(() => (isWatch ? stopwatch() : countdown(seconds)), [isWatch, seconds]);
  const c: Clock = clocks[MAIN] ?? base;
  const now = ctl.now;
  const status = c.status;
  const done = status === 'done';
  const running = status === 'running';
  const ms = isWatch ? elapsedMs(c, now) : remainingMs(c, now);
  const digits = isWatch ? formatElapsed(ms) : seconds > 0 || clocks[MAIN] ? formatCountdown(ms) : '–';
  const touched = isWatch ? ms > 0 : c.status !== 'idle' || c.totalMs !== base.totalMs;
  const stateText = done ? tr('ui.timer.done') : running ? (isWatch ? tr('ui.timer.elapsed') : tr('ui.timer.running')) : status === 'paused' ? tr('ui.timer.paused') : tr('ui.timer.notStarted');
  const disabled = streaming || (!isWatch && c.totalMs <= 0);
  const color = done ? t.colors.success : running ? t.colors.accent : t.colors.borderStrong;
  const subtitle = isWatch ? tr('ui.timer.stopwatch') : c.totalMs > 0 ? timerSubtitle(spec.label, spoken(c.totalMs / 1000, tr), tr('ui.timer.countdown')) : tr('ui.timer.noDuration');

  const primary = () => {
    if (running) {
      haptic('light');
      ctl.pause(MAIN);
    } else {
      haptic('medium');
      ctl.start(MAIN, base);
    }
  };
  const primaryLabel = running ? tr('ui.timer.pause') : done ? tr('ui.timer.restart') : status === 'paused' ? tr('ui.timer.resume') : tr('ui.timer.start');

  return (
    <Surface style={{ gap: t.spacing.l }}>
      <Header t={t} icon={isWatch ? 'stopwatch' : 'timer'} title={spec.label} subtitle={subtitle} sound={sound} toggleSound={isWatch ? undefined : toggleSound} />
      <View style={{ alignItems: 'center' }}>
        <View accessible accessibilityRole="timer" accessibilityLabel={tr('ui.timer.a11yClock', { label: spec.label, spoken: spoken(ms / 1000, tr), state: stateText })} accessibilityLiveRegion={done ? 'assertive' : 'none'}>
          <ClockRing size={RING} stroke={10} frac={isWatch ? progress(c, now) : done ? 0 : progress(c, now)} fill={isWatch} color={color} track={t.colors.surfaceAlt}>
            <View style={{ alignItems: 'center', paddingHorizontal: 18 }}>
              {done ? (
                <Icon name="check" size={46} color={t.colors.success} strokeWidth={2.4} />
              ) : (
                <HText variant="display" tabular numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.3} style={{ ...(ms >= 3600_000 ? scaleFont(36, 44, t.fontScale) : scaleFont(44, 52, t.fontScale)), fontWeight: '400', letterSpacing: -0.5 }}>
                  {digits}
                </HText>
              )}
              <HText variant="caption" color={done ? 'success' : running ? 'accent' : 'muted'} weight="600" style={{ marginTop: 2 }}>
                {stateText}
              </HText>
            </View>
          </ClockRing>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: t.spacing.m }}>
        {isWatch ? (
          <IconBtn t={t} icon="reset" label={tr('ui.timer.reset')} onPress={() => ctl.reset(MAIN)} disabled={!touched} />
        ) : (
          <AdjustChip label={tr('ui.timer.minusMinute')} a11y={tr('ui.timer.minusMinuteA11y')} onPress={() => ctl.adjust(MAIN, -ADJUST_STEP_MS)} disabled={streaming || done || remainingMs(c, now) <= ADJUST_STEP_MS} />
        )}
        <PlayButton t={t} running={running} label={primaryLabel} onPress={primary} disabled={disabled} />
        {isWatch ? (
          <View style={{ width: 44 }} />
        ) : (
          <AdjustChip label={tr('ui.timer.plusMinute')} a11y={tr('ui.timer.plusMinuteA11y')} onPress={() => ctl.adjust(MAIN, ADJUST_STEP_MS)} disabled={streaming} />
        )}
      </View>
      {!isWatch && touched ? (
        <View style={{ alignItems: 'center', marginTop: -t.spacing.s }}>
          <Button label={tr('ui.timer.reset')} variant="tertiary" icon="reset" onPress={() => ctl.reset(MAIN)} />
        </View>
      ) : null}
      {alert ? <DoneAlert text={alert} onDismiss={dismiss} t={t} /> : running && !isWatch ? (
        <HText variant="micro" color="subtle" align="center">
          {tr('ui.timer.notifyHint')}
        </HText>
      ) : null}
    </Surface>
  );
}

function PlayButton({ t, running, label, onPress, disabled, size = 68 }: { t: Theme; running: boolean; label: string; onPress: () => void; disabled?: boolean; size?: number }) {
  return (
    <PressableScale
      haptic={false}
      disabled={disabled}
      onPress={onPress}
      accessibilityLabel={label}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: running ? t.colors.surfaceAlt : t.colors.accent, alignItems: 'center', justifyContent: 'center' }}
      pressedStyle={{ opacity: 0.86 }}
    >
      <View style={{ marginLeft: running ? 0 : size * 0.04 }}>
        <D2Icon name={running ? 'pause' : 'play'} size={Math.round(size * 0.36)} color={running ? t.colors.text : t.colors.onAccent} />
      </View>
    </PressableScale>
  );
}

function AdjustChip({ label, a11y, onPress, disabled }: { label: string; a11y: string; onPress: () => void; disabled?: boolean }) {
  return <Button label={label} accessibilityLabel={a11y} onPress={onPress} disabled={disabled} style={{ minWidth: 76 }} />;
}

/* ───────────── countdown to a date/time ───────────── */

const REMIND = 'remind';

function UntilTimer({ spec, since, t, ctl, clocks, sound, toggleSound, streaming, alert, dismiss }: CommonProps & { spec: Extract<TimerSpec, { kind: 'until' }>; since?: number }) {
  const tr = useT();
  const { formatDate } = useLocale();
  const [now, setNow] = useState(() => Date.now());
  const left = Math.max(0, spec.until - now);
  const reached = left <= 0;
  const farOff = left > 86_400_000;
  // own ticker (the reminder clock may be off)
  useEffect(() => {
    if (reached) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [reached, farOff]);
  const remind = clocks[REMIND];
  const reminding = !!remind && remind.status === 'running';
  const parts = splitDuration(left);
  const total = since && spec.until > since ? spec.until - since : 0;
  const frac = reached ? 1 : total > 0 ? Math.min(1, Math.max(0, 1 - left / total)) : 0;
  const date = formatDate(spec.until, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const clockText = formatCountdown(left - parts.days * 86_400_000);

  const toggleRemind = () => {
    ctl.remove(REMIND);
    if (!reminding) ctl.start(REMIND, countdown(left / 1000)); // ends at `until` → scheduled alarm
  };

  return (
    <Surface style={{ gap: t.spacing.l }}>
      <Header t={t} icon="bell" title={spec.label} subtitle={tr('ui.timer.until', { date })} sound={sound} toggleSound={toggleSound} />
      <View style={{ alignItems: 'center' }}>
        <View accessible accessibilityRole="timer" accessibilityLabel={reached ? `${spec.label}: ${tr('ui.timer.reached')}` : `${spec.label}: ${parts.days ? `${tr('ui.timer.days', { n: parts.days })}, ` : ''}${spoken((left % 86_400_000) / 1000, tr)}`}>
          <ClockRing size={RING} stroke={10} frac={frac} fill color={reached ? t.colors.success : t.colors.accent} track={t.colors.surfaceAlt}>
            <View style={{ alignItems: 'center', paddingHorizontal: 18 }}>
              {reached ? (
                <>
                  <Icon name="check" size={46} color={t.colors.success} strokeWidth={2.4} />
                  <HText variant="caption" color="success" weight="600" align="center">
                    {tr('ui.timer.reached')}
                  </HText>
                </>
              ) : (
                <>
                  {parts.days ? (
                    <HText variant="headline" color="accent" weight="700">
                      {tr('ui.timer.days', { n: parts.days })}
                    </HText>
                  ) : null}
                  <HText variant="display" tabular numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.3} style={{ ...(parts.days ? scaleFont(32, 40, t.fontScale) : scaleFont(40, 48, t.fontScale)), fontWeight: '400' }}>
                    {clockText}
                  </HText>
                  <HText variant="caption" color="muted" weight="600">
                    {tr('ui.timer.countdownTo')}
                  </HText>
                </>
              )}
            </View>
          </ClockRing>
        </View>
      </View>
      {!reached ? (
        <View style={{ alignItems: 'center' }}>
          <PressableScale
            haptic="selection"
            disabled={streaming}
            onPress={toggleRemind}
            accessibilityRole="switch"
            accessibilityState={{ checked: reminding }}
            accessibilityLabel={tr('ui.timer.remind')}
            accessibilityHint={tr('ui.timer.remindHint')}
            style={{ minHeight: 44, paddingHorizontal: t.spacing.l, borderRadius: t.radii.pill, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: reminding ? t.colors.accentSoft : 'transparent', borderWidth: reminding ? 0 : 1, borderColor: t.colors.borderControl }}
            pressedStyle={{ opacity: 0.85 }}
          >
            <D2Icon name={reminding ? 'bell' : 'bellOff'} size={16} color={reminding ? t.colors.accent : t.colors.muted} />
            <HText variant="callout" weight="600" style={{ color: reminding ? t.colors.accentText : t.colors.text }}>
              {reminding ? tr('ui.timer.reminding') : tr('ui.timer.remind')}
            </HText>
          </PressableScale>
        </View>
      ) : null}
      {alert ? <DoneAlert text={alert} onDismiss={dismiss} t={t} /> : null}
    </Surface>
  );
}

/* ───────────── multi-timer ───────────── */

function MultiTimer({ spec, t, ctl, clocks, sound, toggleSound, streaming, alert, dismiss }: CommonProps & { spec: Extract<TimerSpec, { kind: 'multi' }> }) {
  const tr = useT();
  const anyRunning = spec.items.some((i) => clocks[i.key]?.status === 'running');
  const allAction = () => {
    haptic('medium');
    if (anyRunning) spec.items.forEach((i) => clocks[i.key]?.status === 'running' && ctl.pause(i.key));
    else spec.items.forEach((i) => clocks[i.key]?.status !== 'done' && ctl.start(i.key, countdown(i.seconds)));
  };
  return (
    <Surface style={{ gap: t.spacing.m }}>
      <Header
        t={t}
        icon="timer"
        title={spec.label}
        subtitle={tr('ui.timer.multiA11y', { n: spec.items.length })}
        sound={sound}
        toggleSound={toggleSound}
      />
      <View style={{ gap: 2 }}>
        {spec.items.map((it, i) => (
          <MultiRow key={it.key} t={t} item={it} clock={clocks[it.key]} ctl={ctl} disabled={streaming} last={i === spec.items.length - 1} />
        ))}
      </View>
      {spec.items.length > 1 ? (
        <Button
          label={anyRunning ? tr('ui.timer.pauseAll') : tr('ui.timer.startAll')}
          disabled={streaming}
          onPress={allAction}
        />
      ) : null}
      {alert ? <DoneAlert text={alert} onDismiss={dismiss} t={t} /> : null}
    </Surface>
  );
}

function MultiRow({ t, item, clock, ctl, disabled, last }: { t: Theme; item: TimerItem; clock: Clock | undefined; ctl: ClockControls; disabled: boolean; last: boolean }) {
  const tr = useT();
  const base = countdown(item.seconds);
  const c = clock ?? base;
  const now = ctl.now;
  const rem = remainingMs(c, now);
  const running = c.status === 'running';
  const done = c.status === 'done';
  const stateText = done ? tr('ui.timer.done') : running ? tr('ui.timer.running') : c.status === 'paused' ? tr('ui.timer.paused') : tr('ui.timer.notStarted');
  const color = done ? t.colors.success : running ? t.colors.accent : t.colors.borderStrong;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.m, paddingVertical: t.spacing.s, borderBottomWidth: last ? 0 : 1, borderBottomColor: t.colors.border }}>
      <ClockRing size={44} stroke={4} frac={done ? 0 : progress(c, now)} color={color} track={t.colors.surfaceAlt}>
        {done ? <Icon name="check" size={18} color={t.colors.success} strokeWidth={2.4} /> : null}
      </ClockRing>
      <View style={{ flex: 1, minWidth: 0 }} accessible accessibilityRole="timer" accessibilityLabel={tr('ui.timer.a11yClock', { label: item.label, spoken: spoken(rem / 1000, tr), state: stateText })}>
        <HText variant="callout" numberOfLines={1}>
          {item.label}
        </HText>
        <HText variant="headline" tabular style={{ color: done ? t.colors.success : running ? t.colors.text : t.colors.muted }}>
          {done ? tr('ui.timer.done') : formatCountdown(rem)}
        </HText>
      </View>
      {c.status !== 'idle' && !running ? <IconBtn t={t} icon="reset" label={`${tr('ui.timer.reset')}: ${item.label}`} onPress={() => ctl.reset(item.key)} tone="muted" size={40} /> : null}
      {running ? (
        <PressableScale haptic="selection" onPress={() => ctl.adjust(item.key, ADJUST_STEP_MS)} accessibilityLabel={tr('ui.timer.plusMinuteA11y')} style={{ minHeight: 40, minWidth: 52, paddingHorizontal: 8, borderRadius: t.radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: t.colors.surfaceAlt }} hitSlop={4}>
          <HText variant="caption" weight="600" tabular>
            {tr('ui.timer.plusMinute')}
          </HText>
        </PressableScale>
      ) : null}
      <IconBtn
        t={t}
        icon={running ? 'pause' : 'play'}
        filled={!running}
        size={44}
        disabled={disabled}
        label={`${running ? tr('ui.timer.pause') : done ? tr('ui.timer.restart') : c.status === 'paused' ? tr('ui.timer.resume') : tr('ui.timer.start')}: ${item.label}`}
        onPress={() => {
          haptic(running ? 'light' : 'medium');
          if (running) ctl.pause(item.key);
          else ctl.start(item.key, base);
        }}
      />
    </View>
  );
}

/* ───────────── helpers ───────────── */

/** "5 Minuten 30 Sekunden" for screen readers. */
function spoken(sec: number, tr: ReturnType<typeof useT>): string {
  const s = Math.max(0, Math.ceil(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return [h ? tr('ui.timer.hours', { n: h }) : '', m ? tr('ui.timer.minutes', { n: m }) : '', r || (!h && !m) ? tr('ui.timer.seconds', { n: r }) : ''].filter(Boolean).join(' ');
}
export { spoken as spokenDuration };
