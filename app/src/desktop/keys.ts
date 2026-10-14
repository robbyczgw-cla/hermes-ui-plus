/**
 * Desktop app keyboard shortcuts (pure, node:test). The same keys are menu accelerators (desktop/src-tauri/src/
 * menus.rs); whichever sees the press first acts, bridge.ts drops the twin.
 *
 *   ⌘N / ⇧⌘O new chat · ⌘F find in chat · ⌘K search chats · ⌘B / ⌃⌘S sidebar · ⌘, settings
 *   ⌘1–9 n-th chat of the sidebar · ⌥⌘↑ / ⌥⌘↓ previous / next chat · ⌘. stop the answer
 *   ⇧⌘C copy the last answer · ⌘L focus the message field
 * Elsewhere than macOS Ctrl takes the place of ⌘ (Linux build).
 */
import type { DesktopEvent } from './events.ts';

export type KeyInput = {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
};

export function desktopKeyFor(e: KeyInput, mac: boolean): DesktopEvent | null {
  if (e.isComposing) return null;
  const cmdKey = mac ? !!e.metaKey : !!e.ctrlKey;
  if (!cmdKey) return null;
  const ctrl = mac ? !!e.ctrlKey : false;
  if (!mac && e.metaKey) return null;
  const shift = !!e.shiftKey;
  const alt = !!e.altKey;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  // ⌥⌘↑ / ⌥⌘↓
  if (alt && !shift && !ctrl) {
    if (k === 'ArrowUp' || e.code === 'ArrowUp') return { cmd: 'prev-chat' };
    if (k === 'ArrowDown' || e.code === 'ArrowDown') return { cmd: 'next-chat' };
    return null;
  }
  if (alt) return null;
  if (ctrl) return !shift && (k === 's' || e.code === 'KeyS') ? { cmd: 'toggle-sidebar' } : null;
  if (shift) {
    if (k === 'c' || e.code === 'KeyC') return { cmd: 'copy-last' };
    if (k === 'o' || e.code === 'KeyO') return { cmd: 'new-chat' };
    return null;
  }
  if (/^[1-9]$/.test(k)) return { cmd: 'open-recent', index: Number(k) - 1 };
  const digit = /^Digit([1-9])$/.exec(e.code ?? '');
  if (digit && !/^[a-z]$/.test(k)) return { cmd: 'open-recent', index: Number(digit[1]) - 1 };
  switch (k) {
    case 'n':
      return { cmd: 'new-chat' };
    case 'f':
      return { cmd: 'find' };
    case 'k':
      return { cmd: 'search' };
    case 'b':
      return { cmd: 'toggle-sidebar' };
    case ',':
      return { cmd: 'settings' };
    case '.':
      return { cmd: 'stop' };
    case 'l':
      return { cmd: 'focus-composer' };
    default:
      return null;
  }
}

/** Sidebar order for ⌘1–9 and ⌥⌘↑/↓: the visible list as the sidebar shows it (ids). */
export function neighbourChat(order: readonly string[], current: string | null | undefined, dir: 1 | -1): string | null {
  if (!order.length) return null;
  const i = current ? order.indexOf(current) : -1;
  if (i === -1) return dir === 1 ? order[0] : order[order.length - 1];
  const j = i + dir;
  return j < 0 || j >= order.length ? null : order[j];
}
