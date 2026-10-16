import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { HText, PressableScale } from './basics';
import type { HapticKind } from './haptics';
import { Icon, type IconName } from './Icon';
import { useCaptureMode } from '../lib/capture';

/**
 * The one button of the app (cards, sheets, screens). Three variants, one rule each:
 * - `primary`   ink-filled: the single main action of a card or screen (at most one per group)
 * - `secondary` outline: the alternatives next to it
 * - `tertiary`  text only: quiet ways out (Skip, Cancel, Deny)
 * Colour has a meaning and is never decoration: `tone="seal"` (seal red) only for approval and destructive
 * moments; brass (the accent) is not a button colour, it stays for selection, progress and focus.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'tertiary';
export type ButtonTone = 'default' | 'seal';

export type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  tone?: ButtonTone;
  /** a ui icon name, or a renderer for another icon set (chat/icons, onboarding, …) in the button's colour and size */
  icon?: IconName | ((color: string, size: number) => ReactNode);
  /** 'end': the icon follows the label ("Next ›") */
  iconPosition?: 'start' | 'end';
  /** `small`: 36 high (44 with the hit slop) for rows inside cards */
  size?: 'regular' | 'small';
  disabled?: boolean;
  /** shows a spinner instead of the icon and blocks presses */
  loading?: boolean;
  /** take an equal share of the row (in a column a button stretches anyway) */
  grow?: boolean;
  /** label lines before it truncates (default 1; long translations in narrow rows may use 2) */
  numberOfLines?: number;
  haptic?: HapticKind | false;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityState?: { selected?: boolean; checked?: boolean | 'mixed'; busy?: boolean; expanded?: boolean };
  testID?: string;
};

function ButtonInner({
  label,
  onPress,
  variant = 'secondary',
  tone = 'default',
  icon,
  iconPosition = 'start',
  size = 'regular',
  disabled,
  loading,
  grow,
  numberOfLines = 1,
  haptic,
  style,
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  testID,
}: ButtonProps) {
  const t = useTheme();
  const c = t.colors;
  const seal = tone === 'seal';
  const off = !!disabled || !!loading;
  const small = size === 'small';
  let bg = 'transparent';
  let fg = seal ? c.seal : variant === 'tertiary' ? c.muted : c.text;
  let border: string | undefined;
  if (variant === 'primary') {
    bg = disabled ? c.surfaceAlt : seal ? c.seal : c.ink;
    fg = disabled ? c.subtle : seal ? c.onSeal : c.onInk;
  } else if (variant === 'secondary') {
    border = disabled ? c.border : seal ? c.seal : c.borderControl;
    if (disabled) fg = c.subtle;
  } else if (disabled) {
    fg = c.subtle;
  }
  const iconSize = small ? 15 : 17;
  const iconNode = icon ? (
    <View accessible={false} importantForAccessibility="no">
      {typeof icon === 'function' ? icon(fg, iconSize) : <Icon name={icon} size={iconSize} color={fg} strokeWidth={2.1} />}
    </View>
  ) : null;
  const pressed = variant === 'primary' ? { opacity: 0.86 } : { backgroundColor: seal ? c.sealSoft : c.surfacePressed };
  return (
    <PressableScale
      haptic={haptic ?? (variant === 'primary' ? 'light' : 'selection')}
      disabled={off}
      dimDisabled={false}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ ...accessibilityState, busy: loading || accessibilityState?.busy }}
      hitSlop={small ? 4 : undefined}
      testID={testID}
      style={[
        styles.base,
        {
          minHeight: small ? 36 : 44,
          paddingHorizontal: variant === 'tertiary' ? (small ? 8 : 10) : small ? 12 : 16,
          borderRadius: t.radii.control,
          backgroundColor: bg,
        },
        border ? { borderWidth: 1, borderColor: border } : null,
        grow ? styles.grow : null,
        style,
      ]}
      pressedStyle={pressed}
    >
      {loading ? <ActivityIndicator size="small" color={fg} /> : iconPosition === 'start' ? iconNode : null}
      <HText variant={small ? 'callout' : 'bodyStrong'} weight="600" align="center" numberOfLines={numberOfLines} style={[styles.label, { color: fg }]}>
        {label}
      </HText>
      {!loading && iconPosition === 'end' ? iconNode : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 6 },
  grow: { flexGrow: 1, flexBasis: 0 },
  label: { flexShrink: 1 },
});

/** share-as-image (capture mode): an app-only control, not part of the picture */
export function Button(props: Parameters<typeof ButtonInner>[0]) {
  return useCaptureMode() ? null : <ButtonInner {...props} />;
}
