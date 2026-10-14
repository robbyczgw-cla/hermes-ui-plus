/**
 * Window chrome of the macOS desktop app: unified (overlay) title bar, sidebar vibrancy, system accent color.
 *
 * - Overlay title bar: the web content starts at the window top; the traffic lights sit inside the 54 px header
 *   rows. `useTitlebarInset()` is the left padding the first header item needs (0 outside the app / in full screen).
 *   The top band of the window drags the window like a title bar (`installTitlebarDrag`), except on controls.
 * - Vibrancy: the window is transparent with the macOS sidebar material behind it. The web app paints everything
 *   opaque except the sidebar (`useWindowVibrancy`, `TranslucentSurface`). Only for the neutral theme families –
 *   tinted themes (paper, nord, …) keep their own sidebar color.
 * - Accent: `accent: 'system'` (Settings → Darstellung) uses the macOS accent color (`desktop_info`, refreshed when
 *   the window gets focus – changing it in System Settings means leaving the app).
 * Outside the desktop app every hook returns the neutral value and nothing is installed.
 */
import { createContext, useContext, useSyncExternalStore } from 'react';
import { useTheme } from '../ui';
import { desktopConfig, invokeDesktop, isDesktopApp, type DesktopPrefs } from './bridge';

export type DesktopChrome = {
  mac: boolean;
  overlay: boolean;
  inset: number;
  vibrancy: boolean;
  fullscreen: boolean;
  /** macOS accent color #rrggbb */
  accent: string | null;
  loginItem: 'enabled' | 'disabled' | 'requiresApproval' | 'unsupported';
  authAvailable: boolean;
  prefs: DesktopPrefs | null;
};

const NEUTRAL: DesktopChrome = {
  mac: false,
  overlay: false,
  inset: 0,
  vibrancy: false,
  fullscreen: false,
  accent: null,
  loginItem: 'unsupported',
  authAvailable: false,
  prefs: null,
};

let state: DesktopChrome | null = null;
const subs = new Set<() => void>();

function current(): DesktopChrome {
  if (state) return state;
  const cfg = desktopConfig();
  state = cfg
    ? { ...NEUTRAL, mac: cfg.platform === 'macos', overlay: cfg.overlayTitlebar, inset: cfg.titlebarInset, vibrancy: cfg.vibrancy, prefs: cfg.prefs }
    : NEUTRAL;
  return state;
}

export function getDesktopChrome(): DesktopChrome {
  return current();
}

export function setDesktopChrome(patch: Partial<DesktopChrome>): void {
  const cur = current();
  if (cur === NEUTRAL) return;
  const next = { ...cur, ...patch };
  if ((Object.keys(patch) as (keyof DesktopChrome)[]).every((k) => Object.is(cur[k], next[k]))) return;
  state = next;
  for (const fn of subs) fn();
}

function subscribe(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

export function useDesktopChrome(): DesktopChrome {
  return useSyncExternalStore(subscribe, current, current);
}

/** left padding of the first header item (right of the traffic lights); 0 outside the macOS app / in full screen */
export function useTitlebarInset(): number {
  const c = useDesktopChrome();
  return c.overlay && !c.fullscreen ? c.inset : 0;
}

/**
 * Options for a react-navigation stack header (gallery): moves the back button and the left-aligned title right of
 * the traffic lights, like the chat header. The desktop app runs the web build, whose stack header (elements
 * `Header`) takes `headerLeftContainerStyle`; the native-stack option types do not list it – spread the result into
 * the options. Empty outside the macOS app / in full screen.
 */
export function useStackHeaderInset(): { headerLeftContainerStyle?: { paddingLeft: number } } {
  const inset = useTitlebarInset();
  // the back button keeps its own 11 px margin: its left edge lands on `inset`, like the chat header's first button
  return inset > 0 ? { headerLeftContainerStyle: { paddingLeft: Math.max(0, inset - 11) } } : {};
}

/** theme families whose sidebar may show the (neutral grey) macOS material */
export const VIBRANT_FAMILIES: ReadonlySet<string> = new Set(['standard', 'graphite']);

/**
 * The window shows the macOS sidebar material: root + chat screen paint nothing, the chat column paints its own
 * background, the sidebar stays see-through. False outside the macOS app and for tinted theme families.
 */
export function useWindowVibrancy(): boolean {
  const c = useDesktopChrome();
  const family = useTheme().family;
  return c.vibrancy && VIBRANT_FAMILIES.has(family);
}

/** set by the sidebar: lists inside it paint no background of their own */
export const TranslucentSurface = createContext(false);

/** `bg`, or transparent inside a translucent sidebar */
export function useSurfaceBackground(bg: string): string {
  return useContext(TranslucentSurface) ? 'transparent' : bg;
}

type Info = {
  accent: string | null;
  titlebarInset: number;
  fullscreen: boolean;
  loginItem: DesktopChrome['loginItem'];
  authAvailable: boolean;
  prefs: DesktopPrefs;
};

/** accent color, exact traffic light geometry, login item state (desktop_info) */
export async function refreshDesktopInfo(): Promise<void> {
  const info = await invokeDesktop<Info>('desktop_info');
  if (!info) return;
  setDesktopChrome({
    accent: typeof info.accent === 'string' && /^#[0-9a-f]{6}$/i.test(info.accent) ? info.accent : null,
    inset: info.titlebarInset > 0 && info.titlebarInset < 200 ? info.titlebarInset : current().inset,
    fullscreen: info.fullscreen === true,
    loginItem: info.loginItem,
    authAvailable: info.authAvailable === true,
    prefs: info.prefs,
  });
}

// ---------------------------------------------------------------- title bar band: drag + double-click

/** height of the header rows: mouse-down there (not on a control) moves the window */
export const DRAG_BAND = 52;
const CLICKABLE = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY', 'VIDEO', 'AUDIO', 'IFRAME']);
const ROLES = new Set(['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'switch', 'option', 'slider', 'textbox', 'searchbox', 'combobox', 'adjustable']);

function interactive(path: EventTarget[]): boolean {
  for (const t of path) {
    if (!(t instanceof HTMLElement)) continue;
    if (CLICKABLE.has(t.tagName)) return true;
    if (t.isContentEditable) return true;
    const tab = t.getAttribute('tabindex');
    if (tab !== null && tab !== '-1') return true;
    const role = t.getAttribute('role');
    if (role && ROLES.has(role)) return true;
  }
  return false;
}

let dragInstalled = false;

export function installTitlebarDrag(): void {
  if (dragInstalled || !isDesktopApp() || typeof document === 'undefined') return;
  dragInstalled = true;
  document.addEventListener('mousedown', (e) => {
    const c = current();
    if (!c.overlay || c.fullscreen || e.button !== 0 || e.clientY > DRAG_BAND || e.defaultPrevented) return;
    if (interactive(e.composedPath())) return;
    if (window.getSelection()?.toString()) return;
    e.preventDefault(); // no text selection / focus change, like a title bar
    if (e.detail === 2) void invokeDesktop('desktop_titlebar_double_click');
    else if (e.detail === 1) void invokeDesktop('plugin:window|start_dragging');
  });
}

// ---------------------------------------------------------------- page CSS (desktop only)

let cssInstalled = false;

/** transparent page (vibrancy), arrow cursor on buttons like native controls */
export function installDesktopCss(): void {
  if (cssInstalled || !isDesktopApp() || typeof document === 'undefined') return;
  cssInstalled = true;
  const c = current();
  const css = [
    c.vibrancy ? 'html, body, #root { background: transparent !important; }' : '',
    '[role="button"], [role="menuitem"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"] { cursor: default !important; }',
  ].join('\n');
  const el = document.createElement('style');
  el.id = 'hermes-desktop-css';
  el.textContent = css;
  document.head.appendChild(el);
}
