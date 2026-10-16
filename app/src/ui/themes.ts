// Theme registry: color families (light + dark variant each), accent swatches, and the pure math that
// turns user preferences (family, scheme, accent, font size, density) into token sets.
// No React / RN imports → tested with node:test (themes.test.ts checks completeness + WCAG contrast).
import type { ColorScheme, ThemeColors, Typography } from './theme';
import { bestOn, contrast, ensureContrast, mix, normalizeHex, withAlpha } from './color.ts';

export const THEME_FAMILY_IDS = ['standard', 'oled', 'graphite', 'paper', 'nord', 'solarized', 'rose', 'forest', 'ocean'] as const;
export type ThemeFamilyId = (typeof THEME_FAMILY_IDS)[number];
export const DEFAULT_THEME_FAMILY: ThemeFamilyId = 'standard';
/** Shown up front in the theme picker; the other families sit behind "Mehr Designs". */
export const FEATURED_THEME_FAMILIES: readonly ThemeFamilyId[] = ['standard', 'oled', 'paper', 'nord', 'rose'];

/**
 * Families the picker shows: the featured five, plus the rest when expanded. A selected non-featured family
 * stays visible (appended) even when collapsed, so the current choice is never hidden.
 */
export function pickerFamilies(selected: ThemeFamilyId, expanded: boolean): { shown: ThemeFamilyId[]; hiddenCount: number } {
  const rest = THEME_FAMILY_IDS.filter((id) => !FEATURED_THEME_FAMILIES.includes(id));
  if (expanded) return { shown: [...FEATURED_THEME_FAMILIES, ...rest], hiddenCount: 0 };
  const extra = rest.includes(selected) ? [selected] : [];
  return { shown: [...FEATURED_THEME_FAMILIES, ...extra], hiddenCount: rest.length - extra.length };
}

/** Hand-picked base colors of one variant; everything else (soft tints, borders, code colors) is derived. */
export type ThemeSpec = {
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  muted: string;
  subtle: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  codeBg: string;
  /** 8 categorical series colors, fixed order */
  chart: string[];
  /** exact values for derived tokens (the original light/dark sets keep their tuned values) */
  overrides?: Partial<ThemeColors>;
};

export type ThemeFamily = {
  id: ThemeFamilyId;
  /** null = this family has no own variant for the scheme → `fallback[scheme]` family is used ("System" pairing) */
  light: ThemeSpec | null;
  dark: ThemeSpec | null;
  fallback?: Partial<Record<ColorScheme, ThemeFamilyId>>;
};

// "Hermes" categorical chart palette: eight earthy-classical hues (ink blue, brass, verdigris, terracotta, plum, olive,
// slate, rose) in OKLCH L 0.52–0.64 / C ≥ 0.10 (light) and L 0.62–0.67 (dark). Validated with the dataviz palette
// checker (Machado 2009 protanopia/deuteranopia simulation, OKLab ΔE): every adjacent pair ≥ 8 under CVD and ≥ 15 for
// normal vision, the first three slots also all-pairs, every slot ≥ 3:1 on the card surface. Families re-order the
// slots (first slot = family mood); each order is validated on that family's surfaces (themes.test.ts checks ≥ 3:1).
const HC_LIGHT = ['#346AAC', '#BA7E23', '#178B70', '#C05538', '#97549B', '#65882D', '#5F5EAB', '#C9647D'];
const HC_DARK = ['#578ED4', '#C28836', '#339E82', '#CC6347', '#AD6EB1', '#779A45', '#7C7DC7', '#CF7187'];
/** slots of the Hermes palette in another (validated) order */
const hc = (dark: boolean, order: readonly number[]) => order.map((i) => (dark ? HC_DARK : HC_LIGHT)[i]);
const ORDER_STANDARD = [0, 1, 2, 3, 4, 5, 6, 7] as const; // ink, brass, verdigris, terracotta, …
const ORDER_GRAPHITE = [0, 3, 2, 1, 4, 5, 6, 7] as const; // ink, terracotta, verdigris, brass, …
const ORDER_GREEN = [2, 3, 0, 1, 4, 5, 6, 7] as const; // verdigris, terracotta, ink, brass, … (Wald)

// Standard = "Bote" (messenger): ink + ivory + brass, the colours of the Petasos icon (app/brand/identity.json).
// Neutral, slightly warm surfaces. Ink fills the one primary action; the brass accent is reserved for selection,
// progress, focus and links; seal red (the website's wax) marks approval and destructive moments only.
// Status colours sit apart from the accent: sage green, burnt orange (not amber, which would read as brass), crimson.
// Code: steel-blue functions, slate keywords, verdigris strings, terracotta numbers (none of them brass).
const standardLight: ThemeSpec = {
  bg: '#F8F6F1',
  surface: '#FFFEFB',
  surfaceAlt: '#EFEBE3',
  text: '#161B26',
  muted: '#4E5463',
  subtle: '#656B79',
  accent: '#8A6419',
  success: '#3C7A4A',
  warning: '#B4570F',
  danger: '#B42F3A',
  codeBg: '#F3F0E8',
  chart: hc(false, ORDER_STANDARD),
  overrides: {
    surfacePressed: '#E7E2D8',
    accentSoft: '#F3ECDD',
    seal: '#9E2B25',
    info: '#346AAC',
    infoSoft: '#EAF0F7',
    overlay: 'rgba(16,20,28,0.38)',
    codeKeyword: '#5F5EAB',
    codeString: '#178B70',
    codeNumber: '#C05538',
    codeFunction: '#346AAC',
  },
};

const standardDark: ThemeSpec = {
  bg: '#0F131A',
  surface: '#161B24',
  surfaceAlt: '#1F2530',
  text: '#ECE7DD',
  muted: '#AEB3BE',
  subtle: '#9399A6',
  accent: '#D4A85C',
  success: '#7DBE8E',
  warning: '#EB9455',
  danger: '#F07A80',
  codeBg: '#0B0E14',
  chart: hc(true, ORDER_STANDARD),
  overrides: {
    surfacePressed: '#272E3A',
    onAccent: '#0F131A',
    seal: '#E0776B',
    accentSoft: 'rgba(212,168,92,0.15)',
    border: 'rgba(236,231,221,0.09)',
    borderStrong: 'rgba(236,231,221,0.18)',
    info: '#7FA9DE',
    infoSoft: 'rgba(127,169,222,0.14)',
    overlay: 'rgba(5,7,10,0.62)',
    codeKeyword: '#9C9DDB',
    codeString: '#6FBF9F',
    codeNumber: '#E08A6E',
    codeFunction: '#7FA9DE',
  },
};

// canonical Solarized accents, re-ordered so neighbouring series stay apart under protanopia / deuteranopia
const SOLARIZED_CHART = ['#268bd2', '#cb4b16', '#2aa198', '#dc322f', '#6c71c4', '#859900', '#d33682', '#b58900'];

export const THEME_FAMILIES: Record<ThemeFamilyId, ThemeFamily> = {
  standard: { id: 'standard', light: standardLight, dark: standardDark },
  // true black for OLED panels, same ink-tinted surfaces and brass accent as Standard
  oled: {
    id: 'oled',
    light: null,
    fallback: { light: 'standard' },
    dark: {
      bg: '#000000',
      surface: '#0E1116',
      surfaceAlt: '#181C24',
      text: '#F0ECE3',
      muted: '#AEB3BE',
      subtle: '#9399A6',
      accent: '#D4A85C',
      success: '#7DBE8E',
      warning: '#EB9455',
      danger: '#F07A80',
      codeBg: '#07080B',
      chart: hc(true, ORDER_STANDARD),
      overrides: {
        onAccent: '#000000',
        border: 'rgba(240,236,227,0.11)',
        borderStrong: 'rgba(240,236,227,0.22)',
        info: '#7FA9DE',
        overlay: 'rgba(0,0,0,0.7)',
        codeKeyword: '#9C9DDB',
        codeString: '#6FBF9F',
        codeNumber: '#E08A6E',
        codeFunction: '#7FA9DE',
      },
    },
  },
  // near-monochrome graphite with one ember accent (crimson danger and ochre warning keep clear of it)
  graphite: {
    id: 'graphite',
    light: {
      bg: '#F7F7F6',
      surface: '#FFFFFF',
      surfaceAlt: '#EEEEEC',
      text: '#141414',
      muted: '#505050',
      subtle: '#666666',
      accent: '#B04A1E',
      success: '#2E7D4F',
      warning: '#8F6A00',
      danger: '#B0253F',
      codeBg: '#F2F2F1',
      chart: hc(false, ORDER_GRAPHITE),
      overrides: { info: '#346AAC', codeKeyword: '#5F5EAB', codeNumber: '#BA7E23', codeFunction: '#346AAC' },
    },
    dark: {
      bg: '#141414',
      surface: '#1C1C1C',
      surfaceAlt: '#262626',
      text: '#EBEBEB',
      muted: '#ADADAD',
      subtle: '#999999',
      accent: '#E8804F',
      success: '#6CC08A',
      warning: '#E0B44A',
      danger: '#F07585',
      codeBg: '#0F0F0F',
      chart: hc(true, ORDER_GRAPHITE),
      overrides: { onAccent: '#141414', info: '#7FA9DE', codeKeyword: '#9C9DDB', codeNumber: '#D9A24A', codeFunction: '#7FA9DE' },
    },
  },
  // warm paper with blue-black fountain-pen ink (not terracotta: that would be the cream + clay look every other assistant uses)
  paper: {
    id: 'paper',
    light: {
      bg: '#F6F0E3',
      surface: '#FBF7EE',
      surfaceAlt: '#ECE3D0',
      text: '#2B2118',
      muted: '#685645',
      subtle: '#86735F',
      accent: '#2D4F94',
      success: '#4A7329',
      warning: '#9A5C08',
      danger: '#B0352A',
      codeBg: '#EFE7D6',
      chart: hc(false, ORDER_STANDARD),
      overrides: { info: '#2D4F94', codeKeyword: '#97549B', codeNumber: '#C05538', codeFunction: '#2D4F94' },
    },
    dark: {
      bg: '#1E1913',
      surface: '#28221A',
      surfaceAlt: '#332B21',
      text: '#EEE4D2',
      muted: '#BBA98F',
      subtle: '#A8977F',
      accent: '#93B2EA',
      success: '#9CC77A',
      warning: '#E5B661',
      danger: '#EC8A7A',
      codeBg: '#17130E',
      chart: hc(true, ORDER_STANDARD),
      overrides: { onAccent: '#1E1913', info: '#93B2EA', codeKeyword: '#C79BCB', codeNumber: '#E08A6E', codeFunction: '#93B2EA' },
    },
  },
  nord: {
    id: 'nord',
    light: {
      bg: '#ECEFF4',
      surface: '#F7F8FB',
      surfaceAlt: '#E1E6EE',
      text: '#2E3440',
      muted: '#4C566A',
      subtle: '#6A7385',
      accent: '#4A6C9A',
      success: '#4E7A3A',
      warning: '#9C6A12',
      danger: '#B04C56',
      codeBg: '#E5E9F0',
      chart: ['#5e81ac', '#bf616a', '#7d8fc4', '#c5714f', '#4f9a96', '#c99a2e', '#a77a9e', '#6f9a52'],
    },
    dark: {
      bg: '#2E3440',
      surface: '#353C4A',
      surfaceAlt: '#3F4758',
      text: '#ECEFF4',
      muted: '#BAC3D2',
      subtle: '#929CB0',
      accent: '#88C0D0',
      success: '#A3BE8C',
      warning: '#EBCB8B',
      danger: '#E0868E',
      codeBg: '#272C36',
      chart: ['#88c0d0', '#e0868e', '#7ca1c6', '#d08770', '#89bdbc', '#ebcb8b', '#b48ead', '#a3be8c'],
    },
  },
  solarized: {
    id: 'solarized',
    light: {
      bg: '#FDF6E3',
      surface: '#FFFCF4',
      surfaceAlt: '#EEE8D5',
      text: '#073642',
      muted: '#4F656C',
      subtle: '#6F8186',
      accent: '#1F72B0',
      success: '#647300',
      warning: '#8F6C00',
      danger: '#C52B28',
      codeBg: '#F5EED9',
      chart: SOLARIZED_CHART,
    },
    dark: {
      bg: '#002B36',
      surface: '#073642',
      surfaceAlt: '#0E4250',
      text: '#EEE8D5',
      muted: '#A3B0B0',
      subtle: '#7F9297',
      accent: '#5FB0E8',
      success: '#A4B524',
      warning: '#D9A61C',
      danger: '#F0625F',
      codeBg: '#00222B',
      chart: SOLARIZED_CHART,
    },
  },
  rose: {
    id: 'rose',
    light: {
      bg: '#FAF4ED',
      surface: '#FFFAF3',
      surfaceAlt: '#F0E6DC',
      text: '#4A4468',
      muted: '#6E6A88',
      subtle: '#89849C',
      accent: '#A8566D',
      success: '#2F7558',
      warning: '#9E6411',
      danger: '#B23E58',
      codeBg: '#F4ECE3',
      chart: ['#286983', '#d7827e', '#8d79b1', '#c98a2a', '#56949f', '#8a5a44', '#6c8c2e', '#b4637a'],
      overrides: { codeKeyword: '#907aa9', codeNumber: '#b4637a', codeFunction: '#286983' },
    },
    dark: {
      bg: '#232136',
      surface: '#2A273F',
      surfaceAlt: '#36324E',
      text: '#E0DEF4',
      muted: '#ADA9C8',
      subtle: '#8A85A6',
      accent: '#EA9A97',
      success: '#8FCFA8',
      warning: '#F6C177',
      danger: '#EB6F92',
      codeBg: '#1D1B2D',
      chart: ['#3e8fb0', '#ea9a97', '#9ccfd8', '#eb6f92', '#f6c177', '#c08a6c', '#c4a7e7', '#a3be7c'],
      overrides: { codeKeyword: '#c4a7e7', codeNumber: '#f6c177', codeFunction: '#9ccfd8' },
    },
  },
  forest: {
    id: 'forest',
    light: {
      bg: '#F2F5EF',
      surface: '#FBFCF9',
      surfaceAlt: '#E3EADF',
      text: '#16231A',
      muted: '#4B5C4E',
      subtle: '#6E7F71',
      accent: '#2C7149',
      success: '#1F7A3A',
      warning: '#946109',
      danger: '#AF3A2E',
      codeBg: '#E9EEE5',
      chart: hc(false, ORDER_GREEN),
      overrides: { info: '#346AAC', codeFunction: '#346AAC' },
    },
    dark: {
      bg: '#141B16',
      surface: '#1B241E',
      surfaceAlt: '#243027',
      text: '#E2EBE2',
      muted: '#A2B3A5',
      subtle: '#7B8E7E',
      accent: '#8CC8A0',
      success: '#A3CC7E',
      warning: '#E3B65C',
      danger: '#EF8B7E',
      codeBg: '#0F1511',
      chart: hc(true, ORDER_GREEN),
      overrides: { info: '#7FA9DE', codeFunction: '#7FA9DE' },
    },
  },
  ocean: {
    id: 'ocean',
    light: {
      bg: '#F1F6F9',
      surface: '#FBFDFE',
      surfaceAlt: '#E1ECF2',
      text: '#0E2230',
      muted: '#455E6D',
      subtle: '#68808F',
      accent: '#0B6A85',
      success: '#17794A',
      warning: '#9A600A',
      danger: '#B5372F',
      codeBg: '#E8F0F5',
      chart: hc(false, ORDER_STANDARD),
    },
    dark: {
      bg: '#0C1A23',
      surface: '#12232E',
      surfaceAlt: '#1A2F3C',
      text: '#E1EDF3',
      muted: '#9EB6C3',
      subtle: '#74909F',
      accent: '#52C4DD',
      success: '#5FD39A',
      warning: '#EDBE5E',
      danger: '#F2877D',
      codeBg: '#08131A',
      chart: hc(true, ORDER_STANDARD),
    },
  },
};

export function isThemeFamilyId(v: unknown): v is ThemeFamilyId {
  return typeof v === 'string' && (THEME_FAMILY_IDS as readonly string[]).includes(v);
}

/** Which family + scheme actually supplies the colors ("System" picks the variant of the chosen family). */
export function resolveVariant(family: ThemeFamilyId, scheme: ColorScheme): { family: ThemeFamilyId; spec: ThemeSpec } {
  const f = THEME_FAMILIES[family] ?? THEME_FAMILIES.standard;
  const own = f[scheme];
  if (own) return { family: f.id, spec: own };
  const fb = THEME_FAMILIES[f.fallback?.[scheme] ?? 'standard'];
  return { family: fb.id, spec: (fb[scheme] ?? THEME_FAMILIES.standard[scheme]) as ThemeSpec };
}

/** Schemes a family has its own variant for (the settings preview shows the others as paired). */
export function familySchemes(family: ThemeFamilyId): ColorScheme[] {
  const f = THEME_FAMILIES[family];
  return (['light', 'dark'] as const).filter((s) => !!f[s]);
}

// ---------------------------------------------------------------- accent

// Curated from the brand ("Bote": brass fittings, fountain-pen ink, verdigris, seal wax, plum, graphite) instead of
// saturated UI-kit hues; anything else goes through the custom colour field.
export const ACCENT_SWATCHES = [
  { id: 'brass', light: '#8A6419', dark: '#D4A85C' },
  { id: 'ink', light: '#2D4F94', dark: '#93B2EA' },
  { id: 'verdigris', light: '#178B70', dark: '#5BC4A6' },
  { id: 'seal', light: '#9E2B25', dark: '#E0776B' },
  { id: 'plum', light: '#97549B', dark: '#D49AD8' },
  { id: 'graphite', light: '#3F3F46', dark: '#D4D4D8' },
] as const;
/** Swatch ids of earlier versions → the closest curated swatch (stored preferences are mapped on load). */
export const LEGACY_ACCENT_SWATCHES: Readonly<Record<string, AccentSwatchId>> = {
  blue: 'ink',
  indigo: 'ink',
  violet: 'plum',
  pink: 'plum',
  red: 'seal',
  orange: 'seal',
  amber: 'brass',
  green: 'verdigris',
  teal: 'verdigris',
};
export type AccentSwatchId = (typeof ACCENT_SWATCHES)[number]['id'];

/**
 * 'theme' = the family's own accent · swatch id · custom `#rrggbb` · 'system' = the macOS accent color (desktop app;
 * resolved to a hex by the preferences provider, the family accent anywhere else).
 */
export type AccentPref = 'theme' | 'system' | AccentSwatchId | (string & {});

export function isAccentPref(v: unknown): v is AccentPref {
  if (v === 'theme' || v === 'system') return true;
  if (typeof v !== 'string') return false;
  return ACCENT_SWATCHES.some((s) => s.id === v) || /^#[0-9a-f]{6}$/i.test(v);
}

/** Minimum contrast of the accent against bg/surface (WCAG 1.4.11 non-text / large text). */
export const ACCENT_MIN_CONTRAST = 3;

export type AccentCheck =
  | { ok: false; reason: 'format' }
  | { ok: true; hex: string; ratio: { light: number; dark: number }; adjusted: { light: string; dark: string } };

/**
 * Validates a custom accent input for a family: format, raw contrast on the light/dark backgrounds, and the
 * color that will actually be used per scheme (nudged until it reaches ACCENT_MIN_CONTRAST).
 */
export function checkCustomAccent(input: string, family: ThemeFamilyId = DEFAULT_THEME_FAMILY): AccentCheck {
  const hex = normalizeHex(input);
  if (!hex) return { ok: false, reason: 'format' };
  const L = resolveVariant(family, 'light').spec;
  const D = resolveVariant(family, 'dark').spec;
  const rawL = Math.min(contrast(hex, L.bg), contrast(hex, L.surface));
  const rawD = Math.min(contrast(hex, D.bg), contrast(hex, D.surface));
  return {
    ok: true,
    hex,
    ratio: { light: round2(rawL), dark: round2(rawD) },
    adjusted: { light: fitAccent(hex, L), dark: fitAccent(hex, D) },
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function fitAccent(hex: string, spec: Pick<ThemeSpec, 'bg' | 'surface'>): string {
  const darkerBg = contrast(spec.bg, '#000000') < contrast(spec.surface, '#000000') ? spec.bg : spec.surface;
  const lighterBg = darkerBg === spec.bg ? spec.surface : spec.bg;
  // light schemes: the lighter background is the hardest; dark schemes: the lighter one too (closest to a light accent)
  let c = ensureContrast(hex, lighterBg, ACCENT_MIN_CONTRAST);
  c = ensureContrast(c, darkerBg, ACCENT_MIN_CONTRAST);
  return c;
}

function accentHex(pref: AccentPref | undefined, scheme: ColorScheme): string | null {
  if (!pref || pref === 'theme') return null;
  const sw = ACCENT_SWATCHES.find((s) => s.id === pref);
  if (sw) return sw[scheme];
  return normalizeHex(pref);
}

// ---------------------------------------------------------------- color building

/** Minimum luminance contrast of the skeleton block against the surfaces it sits on. */
export const SKELETON_MIN_CONTRAST = { light: 1.2, dark: 1.12 } as const;

/**
 * Skeleton placeholder colors derived per theme: start from surfaceAlt and mix toward the text
 * color until the block is visible (>= SKELETON_MIN_CONTRAST) on both surface and bg; the shimmer
 * highlight is a lighter (light) / slightly brighter (dark) band of it.
 */
export function deriveSkeleton(spec: ThemeSpec, dark: boolean): { skeleton: string; skeletonHighlight: string } {
  const min = dark ? SKELETON_MIN_CONTRAST.dark : SKELETON_MIN_CONTRAST.light;
  let skeleton = spec.surfaceAlt;
  for (let k = 0; k <= 0.5; k += 0.01) {
    skeleton = mix(spec.surfaceAlt, spec.text, k);
    if (Math.min(contrast(skeleton, spec.surface), contrast(skeleton, spec.bg)) >= min) break;
  }
  const skeletonHighlight = dark ? mix(skeleton, spec.text, 0.06) : mix(skeleton, spec.surface, 0.55);
  return { skeleton, skeletonHighlight };
}

/** WCAG AA for small text: `muted` and `subtle` are used as 11–13 px text (timestamps, credits, captions). */
export const SMALL_TEXT_MIN_CONTRAST = 4.5;

/** Nudges `color` until it reaches `min` on every background (darker on light bgs, lighter on dark ones). */
export function ensureContrastOnAll(color: string, bgs: readonly string[], min: number): string {
  let c = color;
  // two passes: a nudge for one background can only raise the ratio on the others (same direction)
  for (let pass = 0; pass < 2; pass++) for (const b of bgs) c = ensureContrast(c, b, min);
  return c;
}

/**
 * Secondary text tiers, light and dark: `subtle` ≥ 4.5:1 on bg / surface / surfaceAlt (plus `extraBgs`: the soft
 * tints that chips and selected rows put small text on), and `muted` stays at least
 * one visible step stronger than `subtle` (≥ 4.5 and ≥ subtle + 1 on the weakest surface). Hand-picked values that
 * already pass are kept; others get the smallest nudge (darker on light, lighter on dark backgrounds).
 */
export function textTiers(
  spec: Pick<ThemeSpec, 'bg' | 'surface' | 'surfaceAlt' | 'muted' | 'subtle'>,
  extraBgs: readonly string[] = [],
): { muted: string; subtle: string } {
  const bgs = [spec.bg, spec.surface, spec.surfaceAlt, ...extraBgs.filter(isHex)];
  const subtle = ensureContrastOnAll(spec.subtle, bgs, SMALL_TEXT_MIN_CONTRAST);
  const weakest = Math.min(...bgs.map((b) => contrast(subtle, b)));
  const muted = ensureContrastOnAll(spec.muted, bgs, Math.max(SMALL_TEXT_MIN_CONTRAST, weakest + 1));
  return { muted, subtle };
}

/** WCAG 1.4.11: a border that is the only thing marking a control needs 3:1 against what it sits on. */
export const CONTROL_BORDER_MIN_CONTRAST = 3;

/**
 * Opaque outline colour for controls: `text` mixed into the surface in the smallest steps until it reaches
 * CONTROL_BORDER_MIN_CONTRAST on bg, surface and surfaceAlt (the translucent border tokens are ~1.4:1).
 */
export function controlBorder(spec: Pick<ThemeSpec, 'bg' | 'surface' | 'surfaceAlt' | 'text'>): string {
  const bgs = [spec.bg, spec.surface, spec.surfaceAlt];
  let c = mix(spec.surface, spec.text, 0.2);
  for (let k = 0.2; k <= 1; k += 0.01) {
    c = mix(spec.surface, spec.text, k);
    if (Math.min(...bgs.map((b) => contrast(c, b))) >= CONTROL_BORDER_MIN_CONTRAST) break;
  }
  return c;
}

/** Syntax colors are small mono text: same AA minimum as body text on the code background. */
export const CODE_MIN_CONTRAST = SMALL_TEXT_MIN_CONTRAST;

const isHex = (c: string) => /^#[0-9a-f]{6}$/i.test(c);

/**
 * Low-emphasis tint of `color` on `surface` (selected chip, highlight column). Starts at `strength` and fades the tint
 * until `color` itself stays readable on it as small text (≥ 4.5:1), so accent-on-accentSoft labels pass in every theme.
 */
export function softTint(surface: string, color: string, strength: number): string {
  let t = strength;
  let tint = mix(surface, color, t);
  while (t > 0.04 && contrast(color, tint) < SMALL_TEXT_MIN_CONTRAST) {
    t -= 0.01;
    tint = mix(surface, color, t);
  }
  return tint;
}

/**
 * success / warning / danger + their soft tints. The colors double as short labels (chips like "Beispielwerte",
 * deltas, form errors), so each is nudged to small-text AA on bg, surface and its own soft tint (the tint is
 * derived from the hand-picked color first, so it keeps the family's hue).
 */
export function statusColors(spec: ThemeSpec, o: Partial<ThemeColors>, soft: (c: string) => string, extraBgs: readonly string[] = []) {
  const one = (c: string, tint: string | undefined) => {
    const bgTint = tint ?? soft(c);
    const fg = ensureContrastOnAll(c, [spec.bg, spec.surface, ...extraBgs, ...(isHex(bgTint) ? [bgTint] : [])], SMALL_TEXT_MIN_CONTRAST);
    return [fg, bgTint] as const;
  };
  const [success, successSoft] = one(spec.success, o.successSoft);
  const [warning, warningSoft] = one(spec.warning, o.warningSoft);
  const [danger, dangerSoft] = one(spec.danger, o.dangerSoft);
  return { success, successSoft, warning, warningSoft, danger, dangerSoft };
}

/** Full token set of a family variant, with the optional accent override applied. */
export function buildColors(family: ThemeFamilyId, scheme: ColorScheme, accent?: AccentPref): ThemeColors {
  const { spec } = resolveVariant(family, scheme);
  const dark = scheme === 'dark';
  const o = spec.overrides ?? {};
  const override = accentHex(accent, scheme);
  const pressed = o.surfacePressed ?? mix(spec.surfaceAlt, spec.text, dark ? 0.07 : 0.05);
  // `accent` (fills, icons, borders) is held to 3:1 for a custom colour; the hand-picked family accents already pass 4.5:1
  const acc = override ? fitAccent(override, spec) : ensureContrastOnAll(spec.accent, [spec.bg, spec.surface, spec.surfaceAlt], SMALL_TEXT_MIN_CONTRAST);
  // `accentText` is the same hue as link / text-button colour: AA on every static surface it sits on (the transient
  // pressed surface is exempt). The tint behind it is derived from it, so text on the tint passes as well.
  const accentText = override ? ensureContrastOnAll(acc, [spec.bg, spec.surface, spec.surfaceAlt], SMALL_TEXT_MIN_CONTRAST) : acc;
  const accentSoft = override ? softTint(spec.surface, accentText, dark ? 0.2 : 0.11) : (o.accentSoft ?? softTint(spec.surface, acc, dark ? 0.2 : 0.11));
  const onAccent = override ? bestOn(acc) : (o.onAccent ?? bestOn(acc, ['#ffffff', dark ? spec.bg : '#0b0b0f']));
  const soft = (c: string) => mix(spec.surface, c, dark ? 0.16 : 0.1);
  const code = (c: string) => ensureContrast(c, spec.codeBg, CODE_MIN_CONTRAST);
  const status = statusColors(spec, o, soft, [spec.surfaceAlt]);
  // seal: the family's own wax red where it has one, else its danger colour (already contrast-checked)
  const seal = o.seal ? ensureContrastOnAll(o.seal, [spec.bg, spec.surface], SMALL_TEXT_MIN_CONTRAST) : status.danger;
  // info: the family's own info hue (default: the accent) as a short label on bg / surface / its tint
  const infoSoft = override ? accentSoft : (o.infoSoft ?? (o.info ? softTint(spec.surface, o.info, dark ? 0.16 : 0.1) : accentSoft));
  const info = override ? accentText : o.info ? ensureContrastOnAll(o.info, [spec.bg, spec.surface, spec.surfaceAlt, ...(isHex(infoSoft) ? [infoSoft] : [])], SMALL_TEXT_MIN_CONTRAST) : acc;
  const tiers = textTiers(spec, [accentSoft, status.successSoft, status.warningSoft, status.dangerSoft, infoSoft]);
  const colors: ThemeColors = {
    bg: spec.bg,
    surface: spec.surface,
    surfaceAlt: spec.surfaceAlt,
    surfacePressed: pressed,
    text: spec.text,
    muted: tiers.muted,
    subtle: tiers.subtle,
    accent: acc,
    accentText,
    onAccent,
    accentSoft,
    border: o.border ?? withAlpha(spec.text, dark ? 0.1 : 0.09),
    borderStrong: o.borderStrong ?? withAlpha(spec.text, dark ? 0.2 : 0.18),
    borderControl: controlBorder(spec),
    ...status,
    ink: spec.text,
    onInk: o.onInk ?? bestOn(spec.text, [spec.surface, spec.bg]),
    seal,
    onSeal: o.onSeal ?? bestOn(seal, ['#ffffff', spec.bg]),
    sealSoft: o.sealSoft ?? (o.seal ? soft(seal) : status.dangerSoft),
    info,
    infoSoft,
    codeBg: spec.codeBg,
    codeText: spec.text,
    codeComment: code(o.codeComment ?? spec.subtle),
    codeKeyword: code(o.codeKeyword ?? spec.chart[6] ?? acc),
    codeString: code(o.codeString ?? spec.success),
    codeNumber: code(o.codeNumber ?? spec.chart[1] ?? spec.warning),
    codeFunction: code(o.codeFunction ?? acc),
    ...deriveSkeleton(spec, dark),
    overlay: o.overlay ?? (dark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.35)'),
    chart: spec.chart.slice(0, 8),
  };
  return colors;
}

// ---------------------------------------------------------------- font size + density math

export const FONT_SIZES = ['s', 'm', 'l', 'xl'] as const;
export type FontSizePref = (typeof FONT_SIZES)[number];
export const FONT_SCALE: Record<FontSizePref, number> = { s: 0.9, m: 1, l: 1.12, xl: 1.25 };

export const DENSITIES = ['compact', 'normal', 'airy'] as const;
export type Density = (typeof DENSITIES)[number];
/** Multiplier for spacing tokens (padding inside components). */
export const DENSITY_SPACING: Record<Density, number> = { compact: 0.85, normal: 1, airy: 1.2 };
/** Multiplier for the vertical gap between chat messages. */
export const DENSITY_MESSAGE_GAP: Record<Density, number> = { compact: 0.55, normal: 1, airy: 1.45 };

/**
 * App font scale × token sizes. The OS font scale is applied on top by RN `Text` itself (allowFontScaling stays on),
 * so we only scale our own tokens here. Sizes round to 0.5 px, line heights to whole px and keep ≥ 1.2 × size.
 */
export function scaleFont(size: number, lineHeight: number, scale: number): { fontSize: number; lineHeight: number } {
  const fontSize = Math.round(size * scale * 2) / 2;
  const lh = Math.max(Math.round(lineHeight * scale), Math.ceil(fontSize * 1.2));
  return { fontSize, lineHeight: lh };
}

export function scaleTypography(ty: Typography, scale: number): Typography {
  if (scale === 1) return ty;
  const out = {} as Typography;
  for (const k of Object.keys(ty) as (keyof Typography)[]) {
    const tok = ty[k];
    out[k] = { ...tok, ...scaleFont(tok.fontSize, tok.lineHeight, scale) };
  }
  return out;
}

export function scaleSpacing<T extends Record<string, number>>(sp: T, factor: number): T {
  if (factor === 1) return sp;
  const out = {} as Record<string, number>;
  for (const k of Object.keys(sp)) out[k] = Math.max(1, Math.round(sp[k] * factor));
  return out as T;
}
