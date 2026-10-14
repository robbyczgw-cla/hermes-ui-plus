import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';
import { Platform, useColorScheme } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import {
  DEFAULT_THEME_FAMILY,
  DENSITY_SPACING,
  FONT_SCALE,
  buildColors,
  isAccentPref,
  isThemeFamilyId,
  scaleSpacing,
  scaleTypography,
  type AccentPref,
  type Density,
  type FontSizePref,
  type ThemeFamilyId,
} from './themes.ts';

// Design tokens for Hermes UI. Calm and quiet: neutral, slightly warm surfaces, subtle borders, one sparing accent,
// a real dark mode (not inverted light). The Standard family "Bote" (messenger) is the brand: ink + ivory + brass, the
// colors of the Petasos icon. Color families (Standard, OLED, Graphit, Papier, Nord, …) live in themes.ts.

export type ColorScheme = 'light' | 'dark';

export type ThemeColors = {
  /** App / chat background */
  bg: string;
  /** Card / component surface */
  surface: string;
  /** Secondary surface: table header, chips, input fields, skeletons */
  surfaceAlt: string;
  /** Pressed / hover state on surfaces */
  surfacePressed: string;
  text: string;
  muted: string;
  /** Even quieter text (axis labels, placeholders) */
  subtle: string;
  accent: string;
  /** Text/icon color on top of `accent` */
  onAccent: string;
  /** Low-emphasis accent background (selected chip, highlight column) */
  accentSoft: string;
  border: string;
  /** Stronger border for inputs / focus */
  borderStrong: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;
  /** Code block background */
  codeBg: string;
  /** Code text + syntax colors (each ≥ 3:1 on codeBg; codeText ≥ 4.5:1) */
  codeText: string;
  codeComment: string;
  codeKeyword: string;
  codeString: string;
  codeNumber: string;
  codeFunction: string;
  /** Skeleton shimmer base + highlight */
  skeleton: string;
  skeletonHighlight: string;
  /** Overlay / scrim */
  overlay: string;
  /** Categorical chart palette, fixed order (the "Hermes" palette or a family's own, validated per family: CVD-safe adjacent pairs, see themes.test.ts / cvd.ts). Never cycle: >8 series fold into 'Andere'. */
  chart: string[];
};

export type Spacing = { xxs: number; xs: number; s: number; m: number; l: number; xl: number; xxl: number };
export type Radii = { xs: number; s: number; m: number; l: number; xl: number; pill: number };

export type TextStyleToken = {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '500' | '600' | '700';
  letterSpacing?: number;
  fontFamily?: string;
};

export type Typography = {
  display: TextStyleToken;
  title: TextStyleToken;
  headline: TextStyleToken;
  body: TextStyleToken;
  bodyStrong: TextStyleToken;
  callout: TextStyleToken;
  caption: TextStyleToken;
  micro: TextStyleToken;
  mono: TextStyleToken;
  stat: TextStyleToken;
};

export type ShadowToken = {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
  elevation: number;
};

export type Theme = {
  scheme: ColorScheme;
  dark: boolean;
  /** theme family id (registry in themes.ts) */
  family: ThemeFamilyId;
  /** app font size multiplier already applied to `typography` (S 0.9 · M 1 · L 1.12 · XL 1.25) */
  fontScale: number;
  /** message density; `spacing` is already scaled by it */
  density: Density;
  colors: ThemeColors;
  spacing: Spacing;
  radii: Radii;
  typography: Typography;
  shadows: { none: ShadowToken; sm: ShadowToken; md: ShadowToken; lg: ShadowToken };
  fonts: { sans: string | undefined; mono: string };
  /** Content max width for components inside a chat bubble */
  maxContentWidth: number;
};

const monoFont = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' })!;
const sansFont = Platform.select<string | undefined>({
  web: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  default: undefined,
});

const spacing: Spacing = { xxs: 2, xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 };
const radii: Radii = { xs: 6, s: 8, m: 12, l: 16, xl: 20, pill: 999 };

const typography: Typography = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: '600', letterSpacing: -0.6 },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '600', letterSpacing: -0.3 },
  headline: { fontSize: 16, lineHeight: 22, fontWeight: '600', letterSpacing: -0.2 },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  callout: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  micro: { fontSize: 11, lineHeight: 14, fontWeight: '500', letterSpacing: 0.2 },
  mono: { fontSize: 13, lineHeight: 20, fontWeight: '400', fontFamily: monoFont },
  stat: { fontSize: 24, lineHeight: 30, fontWeight: '600', letterSpacing: -0.5 },
};

function shadow(color: string, opacity: number, radius: number, y: number, elevation: number): ShadowToken {
  return { shadowColor: color, shadowOpacity: opacity, shadowRadius: radius, shadowOffset: { width: 0, height: y }, elevation };
}

function shadowsFor(dark: boolean): Theme['shadows'] {
  const sc = dark ? '#000000' : '#0D0D0D';
  return {
    none: shadow(sc, 0, 0, 0, 0),
    sm: shadow(sc, dark ? 0.3 : 0.05, 3, 1, 1),
    md: shadow(sc, dark ? 0.35 : 0.08, 12, 4, 3),
    lg: shadow(sc, dark ? 0.45 : 0.12, 24, 10, 8),
  };
}

/** Everything that shapes a theme besides the OS. All fields optional; nested providers inherit unset ones. */
export type ThemeConfig = {
  /** null/undefined = follow the OS color scheme */
  scheme?: ColorScheme | null;
  family?: ThemeFamilyId;
  accent?: AccentPref;
  fontSize?: FontSizePref;
  density?: Density;
  /** 'system' = OS setting, 'on' = always reduce, 'off' = never reduce */
  reduceMotion?: 'system' | 'on' | 'off';
};

const cache = new Map<string, Theme>();

/** Pure + memoized: same inputs → same Theme object (stable identity for useMemo deps). */
export function resolveTheme(cfg: ThemeConfig, system: ColorScheme | null | undefined = 'light'): Theme {
  const scheme: ColorScheme = (cfg.scheme ?? system) === 'dark' ? 'dark' : 'light';
  const family = isThemeFamilyId(cfg.family) ? cfg.family : DEFAULT_THEME_FAMILY;
  const accent = cfg.accent && isAccentPref(cfg.accent) ? cfg.accent : 'theme';
  const fontSize = cfg.fontSize && FONT_SCALE[cfg.fontSize] ? cfg.fontSize : 'm';
  const density = cfg.density && DENSITY_SPACING[cfg.density] ? cfg.density : 'normal';
  const key = `${family}|${scheme}|${accent}|${fontSize}|${density}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const dark = scheme === 'dark';
  const fontScale = FONT_SCALE[fontSize];
  const th: Theme = {
    scheme,
    dark,
    family,
    fontScale,
    density,
    colors: buildColors(family, scheme, accent),
    spacing: scaleSpacing(spacing, DENSITY_SPACING[density]),
    radii,
    typography: scaleTypography(typography, fontScale),
    shadows: shadowsFor(dark),
    fonts: { sans: sansFont, mono: monoFont },
    maxContentWidth: 720,
  };
  cache.set(key, th);
  return th;
}

export const lightTheme: Theme = resolveTheme({ scheme: 'light' });
export const darkTheme: Theme = resolveTheme({ scheme: 'dark' });

/** Both default token sets. `theme.light` / `theme.dark`. */
export const theme = { light: lightTheme, dark: darkTheme } as const;

/** Default family token set for a scheme (pass `cfg` to keep family/accent/scale of the app). */
export function getTheme(scheme: string | null | undefined, cfg?: ThemeConfig): Theme {
  const s: ColorScheme = scheme === 'dark' ? 'dark' : 'light';
  return cfg ? resolveTheme({ ...cfg, scheme: s }) : s === 'dark' ? darkTheme : lightTheme;
}

const ThemeConfigContext = createContext<ThemeConfig>({});

/**
 * Theme settings for a subtree. Unset props inherit from the parent provider, so a nested
 * `<HuiThemeProvider scheme="dark">` (Gallery toggle) keeps the app's family/accent/font size.
 * `scheme={null}` = follow the parent (top level: the OS). Without any provider, `useTheme()` follows the OS.
 */
export function HuiThemeProvider(props: ThemeConfig & { children?: ReactNode }) {
  const parent = useContext(ThemeConfigContext);
  const { children, scheme, family, accent, fontSize, density, reduceMotion } = props;
  const value = useMemo<ThemeConfig>(
    () => ({
      scheme: scheme ?? parent.scheme ?? null,
      family: family ?? parent.family,
      accent: accent ?? parent.accent,
      fontSize: fontSize ?? parent.fontSize,
      density: density ?? parent.density,
      reduceMotion: reduceMotion ?? parent.reduceMotion,
    }),
    [parent, scheme, family, accent, fontSize, density, reduceMotion],
  );
  return createElement(ThemeConfigContext.Provider, { value }, children);
}

/** The effective theme config (family, accent, …) of this subtree. */
export function useThemeConfig(): ThemeConfig {
  return useContext(ThemeConfigContext);
}

/** Current theme: provider config (family, accent, font size, density, scheme override) + system color scheme. */
export function useTheme(): Theme {
  const cfg = useContext(ThemeConfigContext);
  const system = useColorScheme();
  return resolveTheme(cfg, system === 'dark' ? 'dark' : 'light');
}

/** Reduced motion: the app override (Settings → Bedienung → Animationen) wins over the OS setting. */
export function useMotionReduced(): boolean {
  const cfg = useContext(ThemeConfigContext);
  const system = useReducedMotion();
  return cfg.reduceMotion === 'on' ? true : cfg.reduceMotion === 'off' ? false : system;
}

/**
 * CSS custom properties for the hui-html sandbox, as a declaration list (no selector):
 *   `<style>:root{${cssVariables(theme)}}</style>`
 * Includes the SPEC set (--h-bg, --h-surface, --h-text, --h-muted, --h-accent, --h-border,
 * --h-radius, --h-font) plus extras (--h-surface-alt, --h-on-accent, --h-accent-soft,
 * --h-success/-warning/-danger/-info, --h-code-*, --h-font-mono, --h-radius-sm, --h-chart-1..8) and `color-scheme`.
 * `--h-font-size` follows the app font size setting.
 */
export function cssVariables(t: Theme): string {
  const c = t.colors;
  const vars: [string, string][] = [
    ['--h-bg', c.bg],
    ['--h-surface', c.surface],
    ['--h-surface-alt', c.surfaceAlt],
    ['--h-text', c.text],
    ['--h-muted', c.muted],
    ['--h-subtle', c.subtle],
    ['--h-accent', c.accent],
    ['--h-on-accent', c.onAccent],
    ['--h-accent-soft', c.accentSoft],
    ['--h-border', c.border],
    ['--h-border-strong', c.borderStrong],
    ['--h-success', c.success],
    ['--h-warning', c.warning],
    ['--h-danger', c.danger],
    ['--h-info', c.info],
    ['--h-code-bg', c.codeBg],
    ['--h-code-text', c.codeText],
    ['--h-code-comment', c.codeComment],
    ['--h-code-keyword', c.codeKeyword],
    ['--h-code-string', c.codeString],
    ['--h-code-number', c.codeNumber],
    ['--h-code-function', c.codeFunction],
    ['--h-radius', `${t.radii.m}px`],
    ['--h-radius-sm', `${t.radii.s}px`],
    ['--h-radius-lg', `${t.radii.l}px`],
    ['--h-font', 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'],
    ['--h-font-mono', 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'],
    ['--h-font-size', `${t.typography.body.fontSize}px`],
    ...c.chart.map((col, i) => [`--h-chart-${i + 1}`, col] as [string, string]),
  ];
  return vars.map(([k, v]) => `${k}:${v};`).join('') + `color-scheme:${t.scheme};`;
}
