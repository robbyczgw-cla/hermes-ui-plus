/**
 * Small shared controls for the modules-b components (calc, recipe, map): icons, buttons,
 * slider, switch, stepper, numeric field, option chips, disclosure. Theme-aware, 44 px targets,
 * accessible roles/values, haptics on native.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, TextInput, View, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTheme } from '../../../theme';
import { HText, PressableScale, textStyle } from '../../../primitives/basics';
import { Icon, type IconName } from '../../../primitives/Icon';
import { haptic } from '../../../primitives/haptics';
import { sliderWebProps } from '../../../lib/sliderKeys';

/* ───────────── icons ───────────── */

export type BIconName = 'play' | 'pause' | 'reset' | 'timer' | 'pin' | 'cart' | 'chef' | 'users' | 'expand' | 'map';

export function BIcon({ name, size = 18, color, strokeWidth = 1.75 }: { name: BIconName; size?: number; color: string; strokeWidth?: number }) {
  const p = { stroke: color, strokeWidth, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  let body: ReactNode;
  switch (name) {
    case 'play':
      body = <Path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" fill={color} stroke="none" />;
      break;
    case 'pause':
      body = (
        <>
          <Rect x={6} y={4.5} width={4} height={15} rx={1.2} fill={color} />
          <Rect x={14} y={4.5} width={4} height={15} rx={1.2} fill={color} />
        </>
      );
      break;
    case 'reset':
      body = <Path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4v5h5" {...p} />;
      break;
    case 'timer':
      body = (
        <>
          <Circle cx={12} cy={13.5} r={7.5} {...p} />
          <Path d="M12 9.5v4l2.5 2M9.5 2.5h5M12 2.5V6" {...p} />
        </>
      );
      break;
    case 'pin':
      body = (
        <>
          <Path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" {...p} />
          <Circle cx={12} cy={10} r={2.3} {...p} />
        </>
      );
      break;
    case 'map':
      body = <Path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4zM9 4v14M15 6v14" {...p} />;
      break;
    case 'cart':
      body = (
        <>
          <Path d="M3 4h2.2l2.3 11.2a1.5 1.5 0 0 0 1.5 1.2h8.4a1.5 1.5 0 0 0 1.5-1.1L20.5 8H6.1" {...p} />
          <Circle cx={9.5} cy={20} r={1.2} {...p} />
          <Circle cx={17} cy={20} r={1.2} {...p} />
        </>
      );
      break;
    case 'chef':
      body = <Path d="M7 14.5V20h10v-5.5M7 14.5a4 4 0 0 1-.7-7.9A5 5 0 0 1 12 3.5a5 5 0 0 1 5.7 3.1 4 4 0 0 1-.7 7.9H7zM7 17h10" {...p} />;
      break;
    case 'users':
      body = (
        <>
          <Circle cx={9} cy={8.5} r={3.2} {...p} />
          <Path d="M3 19.5c.6-3.2 3-5 6-5s5.4 1.8 6 5M16 5.6a3.2 3.2 0 0 1 0 5.8M18 14.8c1.6.7 2.7 2.4 3 4.7" {...p} />
        </>
      );
      break;
    case 'expand':
      body = <Path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" {...p} />;
      break;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {body}
    </Svg>
  );
}

type AnyIcon = { icon?: IconName; bicon?: BIconName };

function IconAny({ icon, bicon, color, size = 16 }: AnyIcon & { color: string; size?: number }) {
  if (bicon) return <BIcon name={bicon} size={size} color={color} />;
  if (icon) return <Icon name={icon} size={size} color={color} strokeWidth={2} />;
  return null;
}

/* ───────────── buttons ───────────── */

export function Btn({
  label,
  onPress,
  kind = 'secondary',
  disabled,
  icon,
  bicon,
  style,
  accessibilityHint,
  compact,
  iconRight,
}: AnyIcon & {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'ghost' | 'success';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  compact?: boolean;
  /** icon after the label (e.g. "Weiter ›") */
  iconRight?: boolean;
}) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.colors.accent : kind === 'success' ? t.colors.successSoft : 'transparent';
  const fg = kind === 'primary' ? t.colors.onAccent : kind === 'success' ? t.colors.success : kind === 'ghost' ? t.colors.accent : t.colors.text;
  return (
    <PressableScale
      haptic={kind === 'primary' ? false : 'selection'}
      disabled={disabled}
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      style={[
        {
          minHeight: compact ? 36 : 44,
          borderRadius: t.radii.pill,
          backgroundColor: bg,
          borderWidth: kind === 'secondary' ? 1 : 0,
          borderColor: t.colors.borderStrong,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 6,
          paddingHorizontal: compact ? t.spacing.m : t.spacing.l,
        },
        style,
      ]}
      pressedStyle={kind === 'primary' ? { opacity: 0.88 } : { backgroundColor: t.colors.surfacePressed }}
    >
      {iconRight ? null : <IconAny icon={icon} bicon={bicon} color={fg} size={compact ? 15 : 16} />}
      <HText variant="callout" weight={kind === 'primary' ? '600' : '500'} style={{ color: fg }} numberOfLines={1}>
        {label}
      </HText>
      {iconRight ? <IconAny icon={icon} bicon={bicon} color={fg} size={compact ? 15 : 16} /> : null}
    </PressableScale>
  );
}

export function RoundBtn({ label, onPress, disabled, icon, bicon, size = 40, filled }: AnyIcon & { label: string; onPress: () => void; disabled?: boolean; size?: number; filled?: boolean }) {
  const t = useTheme();
  return (
    <PressableScale
      haptic="selection"
      disabled={disabled}
      onPress={onPress}
      accessibilityLabel={label}
      hitSlop={Math.max(0, (44 - size) / 2)}
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: filled ? t.colors.accent : t.colors.surfaceAlt }}
      pressedStyle={{ backgroundColor: filled ? t.colors.accent : t.colors.surfacePressed, opacity: filled ? 0.85 : 1 }}
    >
      <IconAny icon={icon} bicon={bicon} color={filled ? t.colors.onAccent : t.colors.text} size={Math.round(size * 0.42)} />
    </PressableScale>
  );
}

/* ───────────── slider ───────────── */

export function snapValue(v: number, min: number, step: number): number {
  if (!(step > 0)) return v;
  const n = Math.round((v - min) / step) * step + min;
  const decimals = Math.min(10, (String(step).split('.')[1] ?? '').length + (String(min).split('.')[1] ?? '').length);
  return Number(n.toFixed(decimals));
}

const THUMB = 26;

export function Slider({ value, min, max, step, onChange, label, valueText, invalid }: { value: number | null; min: number; max: number; step: number; onChange: (v: number) => void; label: string; valueText: string; invalid?: boolean }) {
  const t = useTheme();
  const [w, setW] = useState(0);
  const last = useRef(value);
  const v = value ?? min;
  const ratio = max > min ? Math.min(1, Math.max(0, (v - min) / (max - min))) : 0;
  const set = (e: GestureResponderEvent) => {
    if (w <= 0) return;
    const r = Math.min(1, Math.max(0, (e.nativeEvent.locationX - THUMB / 2) / (w - THUMB)));
    const nv = Math.min(max, Math.max(min, snapValue(min + r * (max - min), min, step)));
    if (nv !== last.current) {
      last.current = nv;
      haptic('selection');
      onChange(nv);
    }
  };
  const accent = invalid ? t.colors.subtle : t.colors.accent;
  // keyboard / assistive changes keep the pointer dedupe in sync
  useEffect(() => {
    last.current = v;
  }, [v]);
  const web = Platform.OS === 'web' ? sliderWebProps({ value: v, range: { min, max, step }, label, text: valueText, onChange: (nv) => { haptic('selection'); onChange(nv); } }) : null;
  return (
    <View
      {...web}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      style={{ height: 40, justifyContent: 'center' }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={set}
      onResponderMove={set}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: v, text: valueText }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => onChange(Math.min(max, Math.max(min, snapValue(v + (e.nativeEvent.actionName === 'increment' ? step : -step), min, step))))}
    >
      <View pointerEvents="none" style={{ marginHorizontal: THUMB / 2, height: 4, borderRadius: 2, backgroundColor: t.colors.surfaceAlt }}>
        <View style={{ width: `${ratio * 100}%`, height: 4, borderRadius: 2, backgroundColor: accent }} />
      </View>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: ratio * Math.max(0, w - THUMB),
          width: THUMB,
          height: THUMB,
          borderRadius: THUMB / 2,
          backgroundColor: '#FFFFFF',
          borderWidth: t.dark ? 0 : 1,
          borderColor: t.colors.border,
          ...t.shadows.md,
        }}
      />
    </View>
  );
}

/* ───────────── switch ───────────── */

export function Switch({ on }: { on: boolean }) {
  const t = useTheme();
  const p = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    p.value = withTiming(on ? 1 : 0, { duration: 180 });
  }, [on, p]);
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: p.value * 18 }] }));
  return (
    <View style={{ width: 46, height: 28, borderRadius: 14, padding: 3, backgroundColor: on ? t.colors.accent : t.colors.borderStrong }}>
      <Animated.View style={[{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF', ...t.shadows.sm }, thumb]} />
    </View>
  );
}

/* ───────────── stepper ───────────── */

export function Stepper({ value, label, onDec, onInc, decDisabled, incDisabled, decLabel, incLabel }: { value: string; label?: string; onDec: () => void; onInc: () => void; decDisabled?: boolean; incDisabled?: boolean; decLabel: string; incLabel: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.pill, padding: 3, gap: 2 }} accessibilityLabel={label}>
      <RoundBtn icon="minus" label={decLabel} onPress={onDec} disabled={decDisabled} size={36} />
      <HText variant="callout" weight="600" tabular align="center" style={{ minWidth: 96, paddingHorizontal: 4 }} accessibilityLiveRegion="polite">
        {value}
      </HText>
      <RoundBtn icon="plus" label={incLabel} onPress={onInc} disabled={incDisabled} size={36} />
    </View>
  );
}

/* ───────────── numeric text field ───────────── */

export function NumField({
  text,
  onChangeText,
  onBlur,
  unit,
  error,
  label,
  autoFocus,
  compact,
}: {
  text: string;
  onChangeText: (s: string) => void;
  onBlur?: () => void;
  unit?: string;
  error?: string | null;
  label: string;
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const t = useTheme();
  const [focus, setFocus] = useState(false);
  const border = error ? t.colors.danger : focus ? t.colors.accent : t.colors.borderStrong;
  return (
    <View
      style={{
        flex: compact ? undefined : 1,
        width: compact ? 150 : undefined,
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: compact ? 38 : 44,
        borderRadius: t.radii.m,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: error ? t.colors.dangerSoft : t.colors.surface,
        paddingHorizontal: t.spacing.m,
        gap: 6,
      }}
    >
      <TextInput
        value={text}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
        inputMode="decimal"
        autoFocus={autoFocus}
        selectTextOnFocus
        accessibilityLabel={label}
        accessibilityHint={error ?? undefined}
        onFocus={() => setFocus(true)}
        onBlur={() => {
          setFocus(false);
          onBlur?.();
        }}
        returnKeyType="done"
        style={[textStyle(t, 'body'), { flex: 1, minWidth: 0, width: '100%', color: t.colors.text, paddingVertical: compact ? 6 : 10, fontVariant: ['tabular-nums'], outlineStyle: 'none' } as object]}
      />
      {unit ? (
        <HText variant="callout" color="muted">
          {unit}
        </HText>
      ) : null}
    </View>
  );
}

/* ───────────── option chips ───────────── */

export function Chips<V extends string | number>({ options, value, onChange, label }: { options: { label: string; value: V }[]; value: V | null; onChange: (v: V) => void; label: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.s }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <PressableScale
            key={`${i}:${o.value}`}
            haptic="selection"
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={o.label}
            style={{ minHeight: 36, paddingHorizontal: 14, justifyContent: 'center', borderRadius: t.radii.pill, borderWidth: 1, borderColor: active ? t.colors.accent : t.colors.borderStrong, backgroundColor: active ? t.colors.accentSoft : t.colors.surface }}
          >
            <HText variant="callout" weight={active ? '600' : '400'} style={{ color: active ? t.colors.accent : t.colors.text }} numberOfLines={1}>
              {o.label}
            </HText>
          </PressableScale>
        );
      })}
    </View>
  );
}

/* ───────────── disclosure ───────────── */

export function Disclosure({ title, children, initiallyOpen = false, icon = 'info' }: { title: string; children: ReactNode; initiallyOpen?: boolean; icon?: IconName }) {
  const t = useTheme();
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={{ borderRadius: t.radii.m, backgroundColor: t.colors.surfaceAlt, overflow: 'hidden' }}>
      <PressableScale
        haptic="selection"
        scaleTo={1}
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
        style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.s, minHeight: 44, paddingHorizontal: t.spacing.m }}
      >
        <Icon name={icon} size={16} color={t.colors.muted} />
        <HText variant="callout" weight="500" style={{ flex: 1 }}>
          {title}
        </HText>
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
          <Icon name="chevronDown" size={16} color={t.colors.muted} />
        </View>
      </PressableScale>
      {open ? <View style={{ paddingHorizontal: t.spacing.m, paddingBottom: t.spacing.m, gap: t.spacing.s }}>{children}</View> : null}
    </View>
  );
}
