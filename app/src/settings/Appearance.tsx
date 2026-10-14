// Compatibility layer: the old Appearance/ToolDetails API on top of the preferences store.
// New code should use `usePreferences()` from './PreferencesProvider'.
import type { ReactNode } from 'react';
import type { ColorScheme } from '../ui';
import { PreferencesProvider, usePreferences } from './PreferencesProvider';
import { DEFAULT_PREFERENCES, parseToolDetailsPref, type ToolDetailsPref } from './preferences';

export type AppearancePref = 'system' | ColorScheme;
export type { ToolDetailsPref };
export { parseToolDetailsPref };
export const TOOL_DETAILS_DEFAULT: ToolDetailsPref = DEFAULT_PREFERENCES.toolDetails;

/** Tool-details level (Settings → Chat → Werkzeug-Details). */
export function useToolDetails(): { toolDetails: ToolDetailsPref; setToolDetails(p: ToolDetailsPref): void } {
  const { prefs, set } = usePreferences();
  const toolDetails = prefs.toolDetails;
  return { toolDetails, setToolDetails: (p) => set('toolDetails', p) };
}

/** Light/dark override ("System" follows the OS). */
export function useAppearance(): { pref: AppearancePref; setPref(p: AppearancePref): void } {
  const { prefs, set } = usePreferences();
  return { pref: prefs.themeMode, setPref: (p) => set('themeMode', p) };
}

/** App-wide preferences provider (theme family, accent, font size, … + legacy appearance/tool details). */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  return <PreferencesProvider>{children}</PreferencesProvider>;
}
