/**
 * App lock of the macOS app (Settings → Mac-App → "Mit Touch ID sperren", default off): at launch and after
 * `lockMinutes` with the window in the background, an opaque cover hides the app until Touch ID / Apple Watch /
 * the login password (system dialog, `desktop_unlock`) succeeds.
 *
 * The cover is plain DOM above everything (React Native modals included), created when this module loads so the
 * chat never paints unlocked at launch; the rest of the page is `inert` meanwhile, desktop commands are blocked and
 * notification actions / opened files wait (pending.ts). It is a privacy screen for the UI, not encryption:
 * stored chats stay as readable as without the lock.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { brand } from '../brand';
import { useT } from '../i18n';
import { useTheme } from '../ui';
import { desktopConfig, invokeDesktop, setDesktopEventGate } from './bridge';
import { getDesktopChrome } from './chrome';
import { holdPending } from './pending';
import { lockDue } from './policy';

const ID = 'hermes-lock';
type Texts = { title: string; unlock: string; reason: string; failed: string };
let texts: Texts = { title: '', unlock: 'Unlock', reason: 'unlock', failed: '' };
/** the system dialog shows `reason`: ask only once the app language is known */
let textsReady = false;
let locked = false;
let busy = false;
let autoPrompted = false;
let colors: { bg: string; text: string; accent: string; onAccent: string } | null = null;

/** events that may pass while locked (no user command; their effects wait for the unlock themselves) */
const PASS = new Set(['pending', 'chrome']);

function el(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.getElementById(ID);
}

function setInert(on: boolean): void {
  for (const n of Array.from(document.body.children)) {
    if (n.id === ID || n.tagName === 'SCRIPT' || n.tagName === 'STYLE') continue;
    if (on) n.setAttribute('inert', '');
    else n.removeAttribute('inert');
  }
}

const LOCK_SVG =
  '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>';

function render(): void {
  let root = el();
  if (!root) {
    root = document.createElement('div');
    root.id = ID;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;' +
      'font-family:system-ui,-apple-system,sans-serif;-webkit-user-select:none;user-select:none;cursor:default;';
    root.innerHTML =
      `<div data-part="icon" style="opacity:.75">${LOCK_SVG}</div>` +
      '<div data-part="title" style="font-size:17px;font-weight:600"></div>' +
      '<button data-part="btn" type="button" style="margin-top:6px;padding:7px 18px;border-radius:999px;border:0;font:inherit;font-size:14px;font-weight:500;cursor:default"></button>' +
      '<div data-part="err" role="status" style="min-height:18px;font-size:13px;opacity:.75"></div>';
    root.querySelector('button')?.addEventListener('click', () => void unlock());
    document.body.appendChild(root);
  }
  const dark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  const c = colors ?? (dark ? { bg: '#1c1c1e', text: '#f2f2f7', accent: '#0a84ff', onAccent: '#ffffff' } : { bg: '#f5f5f7', text: '#1d1d1f', accent: '#007aff', onAccent: '#ffffff' });
  root.style.background = c.bg;
  root.style.color = c.text;
  const title = root.querySelector<HTMLElement>('[data-part="title"]');
  if (title) title.textContent = texts.title || brand().name;
  const btn = root.querySelector<HTMLButtonElement>('[data-part="btn"]');
  if (btn) {
    btn.textContent = texts.unlock;
    btn.style.background = c.accent;
    btn.style.color = c.onAccent;
    btn.disabled = busy;
    btn.style.opacity = busy ? '0.6' : '1';
  }
}

function setError(msg: string): void {
  const e = el()?.querySelector<HTMLElement>('[data-part="err"]');
  if (e) e.textContent = msg;
}

const keyBlocker = (e: KeyboardEvent) => {
  if (!locked) return;
  const root = el();
  if (root && e.target instanceof Node && root.contains(e.target)) return;
  e.preventDefault();
  e.stopPropagation();
};

export function isLocked(): boolean {
  return locked;
}

export function lockNow(): void {
  if (locked || typeof document === 'undefined') return;
  locked = true;
  autoPrompted = false;
  render();
  setInert(true);
  setDesktopEventGate((e) => PASS.has(e.cmd));
  holdPending(true);
  document.addEventListener('keydown', keyBlocker, true);
  el()?.querySelector('button')?.focus();
  // already in front: ask right away (at launch once the texts are there); otherwise when the window comes back
  if (textsReady && document.hasFocus()) void unlock(true);
}

function unlockDone(): void {
  locked = false;
  setInert(false);
  el()?.remove();
  setDesktopEventGate(null);
  document.removeEventListener('keydown', keyBlocker, true);
  holdPending(false);
}

async function unlock(auto = false): Promise<void> {
  if (!locked || busy) return;
  if (auto) {
    if (autoPrompted) return;
    autoPrompted = true;
  }
  busy = true;
  setError('');
  render();
  const ok = await invokeDesktop<boolean>('desktop_unlock', { reason: texts.reason });
  busy = false;
  if (ok === true) unlockDone();
  else {
    render();
    if (!auto) setError(texts.failed);
  }
}

// launch: cover before the first paint when the lock is on
if (desktopConfig()?.prefs.lockEnabled && typeof document !== 'undefined' && document.body) lockNow();

/** mounted once via DesktopHost: texts / colors of the cover, the background timer */
export function useDesktopLock(): void {
  const tr = useT();
  const th = useTheme();
  useLayoutEffect(() => {
    texts = {
      title: tr('desktop.lock.title', { name: brand().name }),
      unlock: tr('desktop.lock.unlock'),
      reason: tr('desktop.lock.reason'),
      failed: tr('desktop.lock.failed'),
    };
    colors = { bg: th.colors.bg, text: th.colors.text, accent: th.colors.accent, onAccent: th.colors.onAccent };
    const first = !textsReady;
    textsReady = true;
    if (locked) {
      render();
      if (first && document.hasFocus()) void unlock(true);
    }
  }, [tr, th]);

  const blurredAt = useRef<number | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const prefs = () => getDesktopChrome().prefs;
    const onBlur = () => {
      blurredAt.current = Date.now();
      const p = prefs();
      clearTimeout(timer);
      // lock while still in the background, so the content is covered before the window is seen again
      if (p?.lockEnabled && p.lockMinutes > 0) timer = setTimeout(lockNow, p.lockMinutes * 60_000);
    };
    const onFocus = () => {
      clearTimeout(timer);
      const p = prefs();
      if (p?.lockEnabled && lockDue(blurredAt.current, Date.now(), p.lockMinutes)) lockNow();
      blurredAt.current = null;
      if (locked) void unlock(true);
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, []);
}
