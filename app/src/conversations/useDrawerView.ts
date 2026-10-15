/** The drawer's current visibility settings (drawerFilter.ts) – for the drawer and the desktop menus. */
import { useMemo } from 'react';
import { usePreference } from '../settings/PreferencesProvider';
import type { DrawerView } from './drawerFilter';

export function useDrawerView(): DrawerView {
  const chatScope = usePreference('chatScope');
  return useMemo(() => ({ chatScope }), [chatScope]);
}
