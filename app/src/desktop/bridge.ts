/**
 * Hooks for the macOS desktop shell (Tauri v2, desktop/). Everything here is a no-op outside of it:
 * detection is `window.__TAURI_INTERNALS__` (always injected by Tauri, also without `withGlobalTauri`),
 * so the PWA, the Android/iOS builds and plain browsers never take these paths.
 *
 * Shell -> web: the Rust side dispatches `window` CustomEvents named `hermes-desktop`; `detail` is a command string
 * ("new-chat", "find", …, see `DesktopCommand`) or an object `{cmd, …}` (open-recent, open-chat, context-action,
 * chrome, pending). A page script could dispatch the same events; every command only does what the user could do
 * with a click (no data leaves the app through them).
 * Web -> shell: the `desktop_*` commands (desktop/src-tauri/src/lib.rs), via `invokeDesktop`.
 * `window.__HERMES_DESKTOP__` (init script) = static config for the first render (`desktopConfig()`).
 *
 * Menu accelerators and the web keydown handler (desktop/keys.ts) may both see one key press (depends on whether
 * WebKit or the menu gets it first): commands are de-duplicated here, so each press acts once.
 */
import { Platform } from 'react-native';
import { dedupeKey, parseDesktopEvent, sameCommandWithin, type DesktopEvent } from './events.ts';

export type { DesktopEvent } from './events.ts';

type TauriInternals = { invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> };

function internals(): TauriInternals | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const t = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  return t && typeof t.invoke === 'function' ? t : null;
}

/** true inside the Tauri desktop app */
export function isDesktopApp(): boolean {
  return internals() !== null;
}

export type DesktopPrefs = { menuBarOnly: boolean; lockEnabled: boolean; lockMinutes: number };
export const DEFAULT_DESKTOP_PREFS: DesktopPrefs = { menuBarOnly: false, lockEnabled: false, lockMinutes: 5 };

export type DesktopConfig = {
  platform: string;
  /** content under a transparent title bar, traffic lights inside the header rows (macOS) */
  overlayTitlebar: boolean;
  /** the window has the sidebar material behind the (transparent) web content */
  vibrancy: boolean;
  /** left edge for the first header item, right of the traffic lights (px) */
  titlebarInset: number;
  prefs: DesktopPrefs;
};

/** static desktop config from the init script (null outside the desktop app) */
export function desktopConfig(): DesktopConfig | null {
  if (!isDesktopApp()) return null;
  const raw = (window as unknown as { __HERMES_DESKTOP__?: Partial<DesktopConfig> }).__HERMES_DESKTOP__;
  if (!raw || typeof raw !== 'object') return { platform: 'unknown', overlayTitlebar: false, vibrancy: false, titlebarInset: 0, prefs: DEFAULT_DESKTOP_PREFS };
  const p = (raw.prefs ?? {}) as Partial<DesktopPrefs>;
  return {
    platform: typeof raw.platform === 'string' ? raw.platform : 'unknown',
    overlayTitlebar: raw.overlayTitlebar === true,
    vibrancy: raw.vibrancy === true,
    titlebarInset: typeof raw.titlebarInset === 'number' && raw.titlebarInset >= 0 && raw.titlebarInset < 200 ? raw.titlebarInset : 0,
    prefs: {
      menuBarOnly: p.menuBarOnly === true,
      lockEnabled: p.lockEnabled === true,
      lockMinutes: typeof p.lockMinutes === 'number' && p.lockMinutes >= 0 ? p.lockMinutes : DEFAULT_DESKTOP_PREFS.lockMinutes,
    },
  };
}

/** the macOS desktop app (overlay title bar, dock, Touch ID, …) */
export function isDesktopMac(): boolean {
  return desktopConfig()?.platform === 'macos';
}

/** a shell command; resolves to null outside the desktop app or when it fails */
export async function invokeDesktop<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  const t = internals();
  if (!t) return null;
  try {
    return (await t.invoke(cmd, args)) as T;
  } catch {
    return null;
  }
}

/** a shell command that rejects with the shell's error message (settings actions show it) */
export async function invokeDesktopStrict<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const t = internals();
  if (!t) throw new Error('not the desktop app');
  return (await t.invoke(cmd, args)) as T;
}

// ---------------------------------------------------------------- events (shell -> web + desktop keys)

export const DESKTOP_EVENT = 'hermes-desktop';
const listeners = new Set<(e: DesktopEvent) => void>();
let last: { cmd: string; at: number } = { cmd: '', at: 0 };
let gate: ((e: DesktopEvent) => boolean) | null = null;
let bound = false;

function deliver(e: DesktopEvent): void {
  const now = Date.now();
  if (sameCommandWithin(last, e, now)) return;
  if (!e.args) last = { cmd: dedupeKey(e), at: now };
  if (gate && !gate(e)) return;
  for (const l of [...listeners]) l(e);
}

function bind(): void {
  if (bound || !isDesktopApp()) return;
  bound = true;
  window.addEventListener(DESKTOP_EVENT, (ev) => {
    const e = parseDesktopEvent((ev as CustomEvent<unknown>).detail);
    if (e) deliver(e);
  });
}

/** all desktop events (menu commands, keys, context menu choices, …) */
export function onDesktopEvent(cb: (e: DesktopEvent) => void): () => void {
  if (!isDesktopApp()) return () => {};
  bind();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** a command from the web side (desktop key handler): same path + de-duplication as the menu */
export function emitDesktopCommand(e: DesktopEvent | string): void {
  if (!isDesktopApp()) return;
  bind();
  deliver(typeof e === 'string' ? { cmd: e } : e);
}

/** the app lock lets nothing but its own events through */
export function setDesktopEventGate(fn: ((e: DesktopEvent) => boolean) | null): void {
  gate = fn;
}

export type DesktopCommand = 'new-chat' | 'focus-composer';

export function onDesktopCommand(cb: (c: DesktopCommand) => void): () => void {
  return onDesktopEvent((e) => {
    if (e.cmd === 'new-chat' || e.cmd === 'focus-composer') cb(e.cmd);
  });
}

// ---------------------------------------------------------------- notifications

export type DesktopNotifyOptions = {
  /** comes back on click / action (`push/model.ts` parseTarget shape) */
  data?: Record<string, string>;
  /** notification id: the same tag replaces, `desktopNotifyRemove(tag)` removes */
  tag?: string;
  /** approval: "Erlauben (einmal)" / "Ablehnen" buttons (macOS) */
  kind?: 'approval';
};

/** Native macOS notification (the WKWebView has no Notification API / service worker on tauri://). */
export async function desktopNotify(title: string, body: string, opts: DesktopNotifyOptions = {}): Promise<boolean> {
  const t = internals();
  if (!t) return false;
  try {
    await t.invoke('desktop_notify', {
      title: String(title).slice(0, 200),
      body: String(body).slice(0, 1000),
      data: opts.data ? JSON.stringify(opts.data).slice(0, 4000) : null,
      tag: opts.tag ?? null,
      kind: opts.kind ?? null,
    });
    return true;
  } catch {
    return false;
  }
}

export function desktopNotifyRemove(tag: string): void {
  void invokeDesktop('desktop_notify_remove', { tag });
}

/** system share picker (macOS); false → not available, the caller falls back */
export async function desktopShare(text: string): Promise<boolean> {
  if (!isDesktopMac()) return false;
  return (await invokeDesktop<boolean>('desktop_share', { text })) === true;
}

/** Is the desktop window the key window? (visibilityState stays "visible" while another app is in front) */
export function desktopWindowFocused(): boolean {
  return typeof document !== 'undefined' && document.hasFocus();
}

// ---- composer focus requests (shortcut / tray / ⌘N): survive the remount of a freshly created chat
let pendingFocus = false;
const focusListeners = new Set<() => void>();

export function requestComposerFocus(): void {
  pendingFocus = true;
  for (const l of focusListeners) l();
}

/** The listener should call consumeComposerFocus() and focus when it returns true. */
export function onComposerFocusRequest(cb: () => void): () => void {
  focusListeners.add(cb);
  if (pendingFocus) cb();
  return () => {
    focusListeners.delete(cb);
  };
}

export function consumeComposerFocus(): boolean {
  const p = pendingFocus;
  pendingFocus = false;
  return p;
}
