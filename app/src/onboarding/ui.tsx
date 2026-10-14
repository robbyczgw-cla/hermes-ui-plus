// Small building blocks for the onboarding screens. Uses the design tokens of app/src/ui (calm,
// ChatGPT-like neutrals + one accent); layout tuned for 360 px wide phones, centered max 480 px on tablets/web.
import * as Clipboard from 'expo-clipboard';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { FadeIn, HText, Icon, PressableScale, haptic, mix, useIsWide, useTheme, type IconName } from '../ui';
import { useTitlebarInset } from '../desktop/chrome';
import { useT } from '../i18n';
import { codeBoxLines } from './model';

export const CONTENT_MAX = 480;

// ── icons not in the shared set ───────────────────────────────────────────────────────────────
export type OnbIconName = 'qr' | 'server' | 'play' | 'plug' | 'key' | 'terminal' | 'shield' | 'camera';

export function OnbIcon({ name, size = 22, color }: { name: OnbIconName | IconName; size?: number; color: string }) {
  const p = { stroke: color, strokeWidth: 1.75, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'qr':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Rect x={3} y={3} width={7} height={7} rx={1.5} {...p} />
          <Rect x={14} y={3} width={7} height={7} rx={1.5} {...p} />
          <Rect x={3} y={14} width={7} height={7} rx={1.5} {...p} />
          <Path d="M14 14h3v3M21 14v.01M14 21h.01M17.5 21H21v-3.5" {...p} />
        </Svg>
      );
    case 'server':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Rect x={3} y={4} width={18} height={7} rx={2} {...p} />
          <Rect x={3} y={13} width={18} height={7} rx={2} {...p} />
          <Path d="M7 7.5h.01M7 16.5h.01" {...p} strokeWidth={2.5} />
        </Svg>
      );
    case 'play':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx={12} cy={12} r={9} {...p} />
          <Path d="M10 8.5v7l5.5-3.5z" {...p} />
        </Svg>
      );
    case 'plug':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4" {...p} />
        </Svg>
      );
    case 'key':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx={8} cy={15} r={4} {...p} />
          <Path d="M11 12l9-9M17 6l3 3M15 8l2 2" {...p} />
        </Svg>
      );
    case 'terminal':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Rect x={3} y={4} width={18} height={16} rx={2.5} {...p} />
          <Path d="M7 9l3 3-3 3M13 15h4" {...p} />
        </Svg>
      );
    case 'shield':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z" {...p} />
          <Path d="M9 12l2 2 4-4" {...p} />
        </Svg>
      );
    case 'camera':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" {...p} />
          <Circle cx={12} cy={13} r={3.5} {...p} />
        </Svg>
      );
    default:
      return <Icon name={name} size={size} color={color} />;
  }
}

// ── desktop frame ─────────────────────────────────────────────────────────────────────────────
/** max width of the centered onboarding card in the wide/desktop layout */
export const CARD_MAX = 520;
const FramedContext = createContext(false);

/**
 * Wide layout (≥ 900 px): the flow sits in a centered card (≤ 520 px) on a tinted backdrop instead of
 * stretching over the window. Phones: renders the children unchanged.
 */
export function OnbFrame({ children }: { children: ReactNode }) {
  const wide = useIsWide();
  const t = useTheme();
  const { height } = useWindowDimensions();
  if (!wide) return <>{children}</>;
  const backdrop = t.dark ? mix(t.colors.bg, '#000000', 0.45) : t.colors.surfaceAlt;
  return (
    <View style={[styles.frameOuter, { backgroundColor: backdrop }]}>
      <View
        style={[
          styles.frameCard,
          {
            height: Math.max(480, Math.min(height - 64, 820)),
            backgroundColor: t.colors.bg,
            borderColor: t.colors.border,
            borderRadius: t.radii.xl + 6,
          },
          Platform.OS === 'web' ? ({ boxShadow: t.dark ? '0 18px 60px rgba(0,0,0,0.55)' : '0 18px 50px rgba(20,20,58,0.10)' } as object) : null,
        ]}
      >
        <FramedContext.Provider value>{children}</FramedContext.Provider>
      </View>
    </View>
  );
}

// ── screen scaffold ───────────────────────────────────────────────────────────────────────────
export function OnbScreen({
  onBack,
  step,
  total,
  footer,
  children,
  scroll = true,
}: {
  onBack?: () => void;
  /** 1-based progress (hidden when undefined) */
  step?: number;
  total?: number;
  footer?: ReactNode;
  children: ReactNode;
  scroll?: boolean;
}) {
  const t = useTheme();
  const tr = useT();
  const safe = useSafeAreaInsets();
  // inside the desktop card the window's safe-area insets don't apply
  const framed = useContext(FramedContext);
  const insets = framed ? { top: 0, bottom: 0 } : safe;
  // macOS app (full-window flow): the traffic lights sit at the left end of the header row
  const titlebarInset = useTitlebarInset();
  const body = (
    <View style={[styles.content, { paddingHorizontal: t.spacing.xl - 4 }]}>{children}</View>
  );
  return (
    <KeyboardAvoidingView style={[styles.fill, { backgroundColor: t.colors.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }, !framed && titlebarInset > 0 && { paddingLeft: titlebarInset - 8 }]}>
        <View style={styles.headerSide}>
          {onBack ? (
            <Pressable
              onPress={onBack}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={tr('onboarding.common.back')}
              style={({ pressed }) => [styles.backBtn, { backgroundColor: pressed ? t.colors.surfacePressed : 'transparent' }]}
            >
              <Icon name="chevronLeft" size={22} color={t.colors.text} />
            </Pressable>
          ) : null}
        </View>
        {step && total ? <StepDots step={step} total={total} /> : null}
        <View style={styles.headerSide} />
      </View>
      {scroll ? (
        <ScrollView style={styles.fill} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {body}
        </ScrollView>
      ) : (
        <View style={styles.fill}>{body}</View>
      )}
      {footer ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 4, borderTopColor: t.colors.border, backgroundColor: t.colors.bg }]}>
          <View style={[styles.content, { paddingHorizontal: t.spacing.xl - 4, gap: t.spacing.s }]}>{footer}</View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function StepDots({ step, total }: { step: number; total: number }) {
  const t = useTheme();
  const tr = useT();
  return (
    <View style={styles.dots} accessibilityRole="progressbar" accessibilityLabel={tr('onboarding.common.stepOf', { n: step, total })}>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={{
            width: i + 1 === step ? 18 : 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: i + 1 <= step ? t.colors.text : t.colors.borderStrong,
            opacity: i + 1 < step ? 0.35 : 1,
          }}
        />
      ))}
    </View>
  );
}

export function Title({ children, lead }: { children: string; lead?: string }) {
  const t = useTheme();
  return (
    <FadeIn style={{ gap: t.spacing.s, marginTop: t.spacing.s, marginBottom: t.spacing.xl }}>
      <HText variant="display" accessibilityRole="header">
        {children}
      </HText>
      {lead ? (
        <HText variant="body" color="muted">
          {lead}
        </HText>
      ) : null}
    </FadeIn>
  );
}

// ── buttons ───────────────────────────────────────────────────────────────────────────────────
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  icon,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  icon?: OnbIconName | IconName;
}) {
  const t = useTheme();
  const primary = variant === 'primary';
  const fg = primary ? (t.dark ? '#0D0D0D' : '#FFFFFF') : t.colors.text;
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityLabel={label}
      accessibilityState={{ busy: !!loading }}
      haptic={primary ? 'light' : 'selection'}
      style={[
        styles.button,
        {
          backgroundColor: primary ? t.colors.text : variant === 'secondary' ? t.colors.surfaceAlt : 'transparent',
          borderRadius: t.radii.pill,
        },
      ]}
      pressedStyle={{ opacity: 0.85 }}
    >
      {loading ? <ActivityIndicator size="small" color={fg} /> : icon ? <OnbIcon name={icon} size={18} color={fg} /> : null}
      <HText variant="bodyStrong" style={{ color: fg }} numberOfLines={1}>
        {label}
      </HText>
    </PressableScale>
  );
}

/** Big tappable choice row (connection options). */
export function OptionCard({ icon, title, text, badge, onPress, delay = 0 }: { icon: OnbIconName | IconName; title: string; text: string; badge?: string; onPress: () => void; delay?: number }) {
  const t = useTheme();
  return (
    <FadeIn delay={delay}>
      <PressableScale
        onPress={onPress}
        accessibilityLabel={`${title}. ${text}`}
        haptic="selection"
        scaleTo={0.985}
        style={[styles.option, { borderColor: t.colors.border, backgroundColor: t.dark ? t.colors.surface : t.colors.bg, borderRadius: t.radii.l }]}
        pressedStyle={{ backgroundColor: t.colors.surfacePressed }}
      >
        <View style={[styles.optionIcon, { backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.m }]}>
          <OnbIcon name={icon} size={22} color={t.colors.text} />
        </View>
        <View style={styles.flex1}>
          <View style={styles.row}>
            <HText variant="headline" style={styles.flexShrink} numberOfLines={2}>
              {title}
            </HText>
            {badge ? (
              <View style={[styles.badge, { backgroundColor: t.colors.accentSoft }]}>
                <HText variant="micro" color="accent">
                  {badge}
                </HText>
              </View>
            ) : null}
          </View>
          <HText variant="callout" color="muted">
            {text}
          </HText>
        </View>
        <Icon name="chevronRight" size={18} color={t.colors.subtle} />
      </PressableScale>
    </FadeIn>
  );
}

// ── inputs ────────────────────────────────────────────────────────────────────────────────────
export function Field({
  label,
  help,
  error,
  trailing,
  ref,
  ...input
}: TextInputProps & { label: string; help?: string; error?: string | null; trailing?: ReactNode; ref?: Ref<TextInput> }) {
  const t = useTheme();
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ gap: 6, marginBottom: t.spacing.l }}>
      <HText variant="caption" color="muted" weight="500">
        {label}
      </HText>
      <View
        style={[
          styles.inputWrap,
          {
            backgroundColor: t.colors.surfaceAlt,
            borderColor: error ? t.colors.danger : focus ? t.colors.borderStrong : 'transparent',
            borderRadius: t.radii.m,
          },
        ]}
      >
        <TextInput
          ref={ref}
          placeholderTextColor={t.colors.subtle}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          {...input}
          accessibilityLabel={label}
          onFocus={(e) => {
            setFocus(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocus(false);
            input.onBlur?.(e);
          }}
          style={[styles.input, { color: t.colors.text, fontFamily: t.fonts.sans }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
        />
        {trailing}
      </View>
      {error ? (
        <HText variant="caption" color="danger" accessibilityLiveRegion="polite">
          {error}
        </HText>
      ) : help ? (
        <HText variant="caption" color="subtle">
          {help}
        </HText>
      ) : null}
    </View>
  );
}

/** Compact secondary action (diagnostics buttons, copy, share). */
export function ActionPill({ label, onPress, icon, tone = 'neutral', disabled }: { label: string; onPress: () => void; icon?: OnbIconName | IconName; tone?: 'neutral' | 'accent'; disabled?: boolean }) {
  const t = useTheme();
  const fg = tone === 'accent' ? t.colors.accent : t.colors.text;
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      haptic="selection"
      scaleTo={0.97}
      style={[styles.pill, { backgroundColor: tone === 'accent' ? t.colors.accentSoft : t.colors.surfaceAlt, borderRadius: t.radii.pill }]}
      pressedStyle={{ opacity: 0.8 }}
    >
      {icon ? <OnbIcon name={icon} size={15} color={fg} /> : null}
      <HText variant="caption" weight="600" style={{ color: fg }} numberOfLines={1}>
        {label}
      </HText>
    </PressableScale>
  );
}

export function SmallLink({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" style={({ pressed }) => [{ paddingHorizontal: t.spacing.s, paddingVertical: 6, opacity: pressed ? 0.6 : 1 }]}>
      <HText variant="caption" color="accent" weight="600">
        {label}
      </HText>
    </Pressable>
  );
}

// ── notices ───────────────────────────────────────────────────────────────────────────────────
export function Notice({
  tone,
  title,
  text,
  hints,
  hintsTitle,
  detail,
  children,
}: {
  tone: 'info' | 'success' | 'warning' | 'danger';
  title?: string;
  text?: string;
  hints?: readonly string[];
  hintsTitle?: string;
  detail?: string;
  children?: ReactNode;
}) {
  const t = useTheme();
  const color = t.colors[tone];
  const icon: IconName = tone === 'success' ? 'checkCircle' : tone === 'danger' ? 'alertOctagon' : tone === 'warning' ? 'alert' : 'info';
  return (
    <FadeIn>
      <View
        style={[styles.notice, { backgroundColor: t.colors[`${tone}Soft`], borderRadius: t.radii.m }]}
        accessibilityLiveRegion={tone === 'danger' || tone === 'success' ? 'polite' : undefined}
      >
        <View style={{ paddingTop: 2 }}>
          <Icon name={icon} size={18} color={color} />
        </View>
        <View style={[styles.flex1, { gap: 4 }]}>
          {title ? <HText variant="bodyStrong">{title}</HText> : null}
          {text ? (
            <HText variant="callout" color={title ? 'muted' : 'text'}>
              {text}
            </HText>
          ) : null}
          {hints && hints.length ? (
            <View style={{ gap: 4, marginTop: 4 }}>
              {hintsTitle ? (
                <HText variant="caption" weight="600" color="muted">
                  {hintsTitle}
                </HText>
              ) : null}
              {hints.map((h, i) => (
                <View key={i} style={styles.hintRow}>
                  <HText variant="callout" color="muted">
                    •
                  </HText>
                  <HText variant="callout" color="muted" style={styles.flex1}>
                    {h}
                  </HText>
                </View>
              ))}
            </View>
          ) : null}
          {detail ? (
            <HText variant="micro" color="subtle" style={{ fontFamily: t.fonts.mono, marginTop: 4 }} numberOfLines={3} selectable>
              {detail}
            </HText>
          ) : null}
          {children}
        </View>
      </View>
    </FadeIn>
  );
}

// ── code box with copy ────────────────────────────────────────────────────────────────────────
export function CodeBox({ code, label }: { code: string; label?: string }) {
  const t = useTheme();
  const tr = useT();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const copy = () => {
    Clipboard.setStringAsync(code)
      .then(() => {
        haptic('success');
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => {});
  };
  return (
    <View style={[styles.code, { backgroundColor: t.colors.codeBg, borderColor: t.colors.border, borderRadius: t.radii.m }]}>
      <View style={[styles.codeHead, { borderBottomColor: t.colors.border }]}>
        <HText variant="caption" color="muted">
          {label ?? 'bash'}
        </HText>
        <Pressable onPress={copy} hitSlop={8} accessibilityRole="button" accessibilityLabel={copied ? tr('onboarding.common.copied') : tr('onboarding.common.copy')} style={({ pressed }) => [styles.row, { gap: 6, opacity: pressed ? 0.6 : 1 }]}>
          <Icon name={copied ? 'check' : 'copy'} size={15} color={copied ? t.colors.success : t.colors.muted} />
          <HText variant="caption" color={copied ? 'success' : 'muted'} weight="500">
            {copied ? tr('onboarding.common.copied') : tr('onboarding.common.copy')}
          </HText>
        </Pressable>
      </View>
      {/* every command line wraps on its own (a cut-off line with a hidden scroller gave no hint, E2E round 5 N4);
          the gap between lines tells a wrapped continuation from the next command */}
      <View style={{ padding: t.spacing.m, gap: 6 }}>
        {codeBoxLines(code).map((line, i) => (
          <HText key={i} variant="mono" selectable>
            {line || ' '}
          </HText>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frameOuter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  frameCard: { width: '100%', maxWidth: CARD_MAX, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  pill: { minHeight: 36, paddingHorizontal: 12, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  fill: { flex: 1 },
  flex1: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  content: { width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center' },
  scrollContent: { flexGrow: 1, paddingBottom: 24 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingBottom: 4, minHeight: 52 },
  headerSide: { width: 44, height: 44, justifyContent: 'center' },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  footer: { paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  button: { minHeight: 50, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderWidth: 1, marginBottom: 10 },
  optionIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, paddingRight: 4 },
  input: { flex: 1, minHeight: 48, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  notice: { flexDirection: 'row', gap: 10, padding: 14, marginBottom: 16 },
  hintRow: { flexDirection: 'row', gap: 8 },
  code: { borderWidth: 1, overflow: 'hidden', marginBottom: 12 },
  codeHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
});
