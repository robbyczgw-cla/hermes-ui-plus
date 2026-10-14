/**
 * Everything the macOS desktop app adds to the web app, mounted once in the root layout (inside the providers).
 * Renders nothing; a no-op outside the desktop app. Feature modules: look.ts (title bar, vibrancy, accent),
 * menus.ts (menu bar + keys), dock.ts, notifications.ts, files.ts, lock.ts.
 */
import { isDesktopApp } from './bridge';
import { useDesktopDock } from './dock';
import { useDesktopFiles } from './files';
import { useDesktopLock } from './lock';
import { useDesktopLook } from './look';
import { useDesktopMenus } from './menus';
import { useDesktopNotifications } from './notifications';

export function DesktopHost() {
  return isDesktopApp() ? <DesktopHostInner /> : null;
}

function DesktopHostInner() {
  useDesktopLook();
  useDesktopMenus();
  useDesktopDock();
  useDesktopNotifications();
  useDesktopFiles();
  useDesktopLock();
  return null;
}
