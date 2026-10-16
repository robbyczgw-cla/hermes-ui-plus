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
  /**
   * The accent as TEXT / link color: ≥ 4.5:1 on bg, surface, surfaceAlt and accentSoft. Equals `accent` where that
   * already passes; a custom accent (only held to 3:1 as a fill / icon / border) gets a nudged copy. Use it for every
   * `color:` of a label; keep `accent` for fills, borders and icons.
   */
  accentText: string;
  /** Text/icon color on top of `accent` */
  onAccent: string;
  /** Low-emphasis accent background (selected chip, highlight column) */
  accentSoft: string;
  border: string;
  /** Stronger border for inputs / focus */
  borderStrong: string;
  /**
   * Outline of a control that is recognisable by its border alone (text field, unchecked radio / checkbox, outlined chip,
   * switch track when off): ≥ 3:1 on bg, surface and surfaceAlt (WCAG 1.4.11). Dividers and decoration stay on `border` /
   * `borderStrong`.
   */
  borderControl: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  /** Ink: fill of the primary button (the text colour), `onInk` its label */
  ink: string;
  onInk: string;
  /** Seal red: approval and destructive moments only (the approval seal mark, "Delete"), never a general accent */
  seal: string;
  onSeal: string;
  sealSoft: string;
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
/**
 * Four radii, by what the shape is: `inline` 6 (chips, inline code, small tags), `control` 10 (buttons, inputs,
 * thumbnails and other elements inside a card), `card` 16 (cards, sheets, dialogs), `pill` (counters, segmented
 * selections, the composer). xs/s/m/l/xl are the older names, kept as aliases of the same four values.
 */
export type Radii = { inline: number; control: number; card: number; pill: number; xs: number; s: number; m: number; l: number; xl: number };

export type TextStyleToken = {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '500' | '600' | '700';
  letterSpacing?: number;
  fontFamily?: string;
};

export type Typography = {
  /** Gloock: the empty-chat greeting and onboarding titles. The display face never goes below 22 px or into controls. */
  hero: TextStyleToken;
  /** Gloock: titles of empty states (no chats yet, nothing found, onboarding done) */
  heroCompact: TextStyleToken;
  /** big numbers (score, result, countdown) */
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
  /** answer prose (Markdown): one size up from UI body, with more leading for long reading */
  reading: TextStyleToken;
  readingH1: TextStyleToken;
  readingH2: TextStyleToken;
  readingH3: TextStyleToken;
  /** answer tables and other dense prose */
  readingSmall: TextStyleToken;
  /** code blocks, commands */
  code: TextStyleToken;
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
  /** Atkinson Hyperlegible Next (UI + text), Gloock (display moments only), JetBrains Mono (code, commands) */
  fonts: { sans: string; display: string; mono: string };
  /** Content max width for components inside a chat bubble */
  maxContentWidth: number;
};

// Bundled (SIL OFL, app/assets/fonts + app/public/fonts, scripts/subset-fonts.sh): native registers the static faces under
// these family names (expo-font config plugin in app.json, weights resolve per face); web/desktop load the variable
// woff2 via @font-face in public/index.html (preloaded, metric-matched fallback faces against a layout shift).
export const FONT_FAMILY = { sans: 'Atkinson Hyperlegible Next', display: 'Gloock', mono: 'JetBrains Mono' } as const;
const sansFont = Platform.select({
  web: '"Atkinson Hyperlegible Next", "Atkinson Fallback", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  default: FONT_FAMILY.sans,
});
const displayFont = Platform.select({ web: 'Gloock, "Gloock Fallback", Georgia, "Times New Roman", serif', default: FONT_FAMILY.display });
const monoFont = Platform.select({ web: '"JetBrains Mono", "JetBrains Mono Fallback", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', default: FONT_FAMILY.mono });
/** The platform's `fontFamily` values (web: stacks with metric-matched fallbacks). Same for every theme. */
export const FONTS = { sans: sansFont, display: displayFont, mono: monoFont } as const;

const spacing: Spacing = { xxs: 2, xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 };
const radii: Radii = { inline: 6, control: 10, card: 16, pill: 999, xs: 6, s: 10, m: 10, l: 16, xl: 16 };

// Type scale. UI steps 11 · 13 · 14 · 15 · 17 · 20 · 24 · 28 (one role each), answer prose 16 → H3 17 · H2 20 · H1 24,
// and Gloock only at 24 / 32. Weights 400 / 500 / 600 / 700 exist as real faces on every platform (no faux bold);
// Gloock has only 400. Atkinson runs wide with a large x-height, so body text gets generous leading (≈ 1.5).
const typography: Typography = {
  hero: { fontSize: 32, lineHeight: 38, fontWeight: '400', letterSpacing: -0.4, fontFamily: displayFont },
  heroCompact: { fontSize: 24, lineHeight: 30, fontWeight: '400', letterSpacing: -0.2, fontFamily: displayFont },
  display: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: -0.5 },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '700', letterSpacing: -0.2 },
  headline: { fontSize: 17, lineHeight: 23, fontWeight: '600', letterSpacing: -0.1 },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  callout: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  micro: { fontSize: 11, lineHeight: 14, fontWeight: '500', letterSpacing: 0.1 },
  mono: { fontSize: 13, lineHeight: 20, fontWeight: '400', fontFamily: monoFont },
  stat: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.4 },
  reading: { fontSize: 16, lineHeight: 25, fontWeight: '400' },
  readingH1: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.4 },
  readingH2: { fontSize: 20, lineHeight: 27, fontWeight: '700', letterSpacing: -0.2 },
  readingH3: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  readingSmall: { fontSize: 14, lineHeight: 21, fontWeight: '400' },
  code: { fontSize: 13, lineHeight: 20, fontWeight: '400', fontFamily: monoFont },
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
    fonts: { sans: sansFont, display: displayFont, mono: monoFont },
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
    ['--h-accent-text', c.accentText],
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
    // the sandboxed iframe cannot reach the app's @font-face files: the app faces are used where installed, else the system's
    ['--h-font', '"Atkinson Hyperlegible Next", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'],
    ['--h-font-mono', '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'],
    ['--h-font-size', `${t.typography.body.fontSize}px`],
    ...c.chart.map((col, i) => [`--h-chart-${i + 1}`, col] as [string, string]),
  ];
  return vars.map(([k, v]) => `${k}:${v};`).join('') + `color-scheme:${t.scheme};`;
}
