import { cssVariables, getTheme, useTheme, useThemeConfig, type ColorScheme, type Theme } from '../ui';

/** `theme` prop of HtmlBlock: a full app theme, a forced scheme, or nothing (follow app/system). */
export type HtmlBlockTheme = Theme | ColorScheme;

export type SandboxTheme = {
  theme: Theme;
  scheme: ColorScheme;
  /** CSS declaration list injected as `:root{…}` into the sandbox. */
  css: string;
};

/** Theme of a sandbox frame: follows the app theme family/accent/font size; a forced scheme keeps them too. */
export function useSandboxTheme(input?: HtmlBlockTheme): SandboxTheme {
  const fromContext = useTheme();
  const cfg = useThemeConfig();
  const theme = typeof input === 'string' ? getTheme(input, cfg) : input ?? fromContext;
  return { theme, scheme: theme.scheme, css: cssVariables(theme) };
}
