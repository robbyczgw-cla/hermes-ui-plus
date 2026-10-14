/**
 * Wide-screen layout math (tablet / desktop / web / the Tauri app). Pure, so it is unit-tested; the hooks
 * live in `useLayout.ts`.
 *
 *   < 900 px   phone layout: slide-in conversation drawer, bottom sheets
 *   ≥ 900 px   wide: persistent (collapsible) sidebar, sheets as centred dialogs, header title left
 *   ≥ 1200 px  desktop: same, more room (the sidebar may be wider)
 */
export const BREAKPOINT_WIDE = 900;
export const BREAKPOINT_DESKTOP = 1200;

export type LayoutClass = 'phone' | 'wide' | 'desktop';

export function layoutClass(width: number): LayoutClass {
  if (width >= BREAKPOINT_DESKTOP) return 'desktop';
  if (width >= BREAKPOINT_WIDE) return 'wide';
  return 'phone';
}

/** ≥ 900 px: sidebar instead of the drawer, sheets as centred dialogs */
export function isWideWidth(width: number): boolean {
  return width >= BREAKPOINT_WIDE;
}

export const SIDEBAR_DEFAULT_WIDTH = 304;
export const SIDEBAR_MIN_WIDTH = 260;
export const SIDEBAR_MAX_WIDTH = 420;
/** the chat next to the sidebar keeps at least this much room (else the sidebar gives way) */
const MIN_CONTENT_WIDTH = 520;

/** Sidebar width for a window: the stored width, clamped to [min, max] and to the room the window has. */
export function sidebarWidthFor(stored: number | undefined, windowWidth: number): number {
  const want = typeof stored === 'number' && Number.isFinite(stored) ? stored : SIDEBAR_DEFAULT_WIDTH;
  const room = Math.max(SIDEBAR_MIN_WIDTH, windowWidth - MIN_CONTENT_WIDTH);
  return Math.round(Math.min(Math.max(want, SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH, room));
}

/** Persisted sidebar state; tolerant parse (anything odd → defaults). */
export type SidebarPrefs = { collapsed: boolean; width: number };
export const DEFAULT_SIDEBAR: SidebarPrefs = { collapsed: false, width: SIDEBAR_DEFAULT_WIDTH };

export function parseSidebarPrefs(raw: string | null | undefined): SidebarPrefs {
  if (!raw) return DEFAULT_SIDEBAR;
  try {
    const v = JSON.parse(raw) as Partial<SidebarPrefs> | null;
    if (!v || typeof v !== 'object') return DEFAULT_SIDEBAR;
    const width = typeof v.width === 'number' && Number.isFinite(v.width) ? Math.round(Math.min(Math.max(v.width, SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH)) : SIDEBAR_DEFAULT_WIDTH;
    return { collapsed: v.collapsed === true, width };
  } catch {
    return DEFAULT_SIDEBAR;
  }
}

/**
 * Width of a centred content column with horizontal `padding` on each side: the composer / approval cards
 * use the message column's max width (Settings → Chatbreite) plus their own padding, so their inner edges
 * line up with the messages. `undefined` max = full width.
 */
export function columnMaxWidth(maxWidth: number | undefined, padding: number): number | undefined {
  return maxWidth === undefined ? undefined : maxWidth + 2 * padding;
}

// ---------------------------------------------------------------- keyboard shortcuts (web / desktop)

export type ShortcutCommand = 'toggle-sidebar' | 'search' | 'new-chat' | 'find';

export type KeyLike = { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; isComposing?: boolean };

/**
 * ⌘/Ctrl+B sidebar, ⌘/Ctrl+K conversation search, ⌘/Ctrl+F find in the open chat, ⌘/Ctrl+N new chat (browsers keep Ctrl+N for a new
 * window, so ⌘/Ctrl+Shift+O works too, like in ChatGPT). Mac: ⌘ only (Ctrl+B etc. are text-editing keys
 * there); elsewhere Ctrl only.
 */
export function shortcutFor(e: KeyLike, mac: boolean): ShortcutCommand | null {
  if (e.isComposing || e.altKey) return null;
  const mod = mac ? !!e.metaKey && !e.ctrlKey : !!e.ctrlKey && !e.metaKey;
  if (!mod) return null;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.shiftKey) return k === 'o' ? 'new-chat' : null;
  if (k === 'b') return 'toggle-sidebar';
  if (k === 'k') return 'search';
  if (k === 'f') return 'find';
  if (k === 'n') return 'new-chat';
  return null;
}
