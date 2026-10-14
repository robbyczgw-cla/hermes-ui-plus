/**
 * Desktop app look (mounted once via DesktopHost): page CSS + title bar drag band, window appearance following the
 * app's light/dark setting, accent color / traffic light geometry (`desktop_info`, refreshed on focus), full screen.
 */
import { useEffect } from 'react';
import { usePreferences } from '../settings/PreferencesProvider';
import { invokeDesktop, onDesktopEvent } from './bridge';
import { installDesktopCss, installTitlebarDrag, refreshDesktopInfo, setDesktopChrome } from './chrome';

export function useDesktopLook(): void {
  useEffect(() => {
    installDesktopCss();
    installTitlebarDrag();
    void refreshDesktopInfo();
    // accent color changes happen in System Settings: re-read when the user comes back
    const onFocus = () => void refreshDesktopInfo();
    window.addEventListener('focus', onFocus);
    const off = onDesktopEvent((e) => {
      if (e.cmd === 'chrome' && typeof e.fullscreen === 'boolean') setDesktopChrome({ fullscreen: e.fullscreen });
    });
    return () => {
      window.removeEventListener('focus', onFocus);
      off();
    };
  }, []);

  // the window (title bar, vibrancy material) follows the app's light/dark choice; "system" = follow macOS
  const mode = usePreferences().prefs.themeMode;
  useEffect(() => {
    void invokeDesktop('desktop_set_theme', { mode });
  }, [mode]);
}
