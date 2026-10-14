import { useEffect, useRef } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { isDesktopApp, onDesktopEvent } from '../../desktop/bridge';
import { isWideWidth, layoutClass, shortcutFor, type LayoutClass, type ShortcutCommand } from './layout';

const SHORTCUT_COMMANDS: ReadonlySet<string> = new Set<ShortcutCommand>(['toggle-sidebar', 'search', 'new-chat', 'find']);

/** ≥ 900 px window: sidebar instead of the drawer, sheets as centred dialogs (re-renders on resize) */
export function useIsWide(): boolean {
  return isWideWidth(useWindowDimensions().width);
}

export function useLayoutClass(): LayoutClass {
  return layoutClass(useWindowDimensions().width);
}

function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const n = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad/i.test(n.userAgentData?.platform || n.platform || n.userAgent || '');
}

/**
 * Web: ⌘/Ctrl+B, ⌘/Ctrl+K, ⌘/Ctrl+F, ⌘/Ctrl+N (see `shortcutFor`). Listens in the capture phase so the
 * keys also work while the composer has focus. Return false from the handler to let the browser have the key.
 * Desktop app: the same commands arrive as desktop events (menu bar accelerators + desktop/keys.ts, one per press).
 */
export function useKeyboardShortcuts(handler: (c: ShortcutCommand) => boolean | void, enabled = true): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  }, [handler]);
  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled || typeof document === 'undefined') return;
    if (isDesktopApp()) {
      return onDesktopEvent((e) => {
        if (SHORTCUT_COMMANDS.has(e.cmd)) ref.current(e.cmd as ShortcutCommand);
      });
    }
    const mac = isMac();
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      const cmd = shortcutFor(e, mac);
      if (!cmd) return;
      if (ref.current(cmd) === false) return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [enabled]);
}
