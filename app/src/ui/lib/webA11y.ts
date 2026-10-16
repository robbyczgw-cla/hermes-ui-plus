// Keyboard accessibility the browser and react-native-web do not provide on their own (web + desktop app only):
//  - Space activates checkbox / radio / switch / option / tab elements. RNW's Pressable only treats Enter (and Space on
//    role="button") as a press, so these roles reacted to Enter only.
//  - text inputs get a focus ring for keyboard users: RNW sets `outline: none` on every TextInput and most of ours draw
//    no focus state of their own. Mouse users keep today's look (the ring needs `html[data-hui-kbd]`, set on the
//    first Tab / arrow key and removed on the next pointer press).
//  - focus returns to the opener when a modal dialog closes (RNW's Modal drops it on <body>).
//  - overlays that are not an RN Modal (the mobile conversation drawer) mark their panel with TRAP_ATTR: focus moves
//    into it on open and Tab / Shift+Tab stay inside while it is open (RNW's Modal does this itself).
// Pure logic + tiny DOM bindings, tested in webA11y.test.ts; installed once from the root layout.

type El = {
  tagName?: string;
  getAttribute(name: string): string | null;
  closest?(selector: string): El | null;
  click?(): void;
  focus?(opts?: { preventScroll?: boolean }): void;
  isConnected?: boolean;
};

/** roles on non-native elements that must react to Space like the native control would */
const SPACE_ROLES = new Set(['checkbox', 'radio', 'switch', 'option', 'tab', 'menuitemcheckbox', 'menuitemradio', 'treeitem']);
const NATIVE_ACTIVATORS = new Set(['INPUT', 'TEXTAREA', 'BUTTON', 'A', 'SELECT', 'SUMMARY']);

export function isSpaceTarget(el: El | null | undefined): boolean {
  if (!el || typeof el.getAttribute !== 'function') return false;
  if (el.tagName && NATIVE_ACTIVATORS.has(el.tagName.toUpperCase())) return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;
  const role = el.getAttribute('role');
  return !!role && SPACE_ROLES.has(role);
}

type KeyEv = { key: string; target: unknown; defaultPrevented?: boolean; isComposing?: boolean; repeat?: boolean; preventDefault(): void };
type Listen = { addEventListener(type: string, fn: (e: never) => void, capture?: boolean): void; removeEventListener?(type: string, fn: (e: never) => void, capture?: boolean): void };

/** Space: keydown stops the page from scrolling, keyup (like a native control) clicks the element that got the keydown. */
export function bindSpaceActivation(target: Listen): () => void {
  let armed: El | null = null;
  const down = (e: KeyEv) => {
    if (e.key !== ' ' || e.defaultPrevented || e.isComposing) return;
    const el = e.target as El;
    if (!isSpaceTarget(el)) return;
    e.preventDefault();
    if (!e.repeat) armed = el;
  };
  const up = (e: KeyEv) => {
    if (e.key !== ' ' || !armed) return;
    const el = armed;
    armed = null;
    if (e.target === el && isSpaceTarget(el)) el.click?.();
  };
  target.addEventListener('keydown', down as never, true);
  target.addEventListener('keyup', up as never, true);
  return () => {
    target.removeEventListener?.('keydown', down as never, true);
    target.removeEventListener?.('keyup', up as never, true);
  };
}

/** keys that mean "keyboard user": Tab and the arrow keys (not typing) */
export const KEYBOARD_NAV_KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
export const KBD_ATTR = 'data-hui-kbd';

type Root = { setAttribute(n: string, v: string): void; removeAttribute(n: string): void };

export function bindKeyboardModality(target: Listen, root: Root): () => void {
  const key = (e: KeyEv) => {
    if (KEYBOARD_NAV_KEYS.has(e.key)) root.setAttribute(KBD_ATTR, '');
  };
  const pointer = () => root.removeAttribute(KBD_ATTR);
  target.addEventListener('keydown', key as never, true);
  target.addEventListener('pointerdown', pointer as never, true);
  return () => {
    target.removeEventListener?.('keydown', key as never, true);
    target.removeEventListener?.('pointerdown', pointer as never, true);
  };
}

/** focus ring for text inputs, only while the user navigates by keyboard; the color follows the accent (see setFocusColor) */
export const FOCUS_CSS =
  `html[${KBD_ATTR}] input:focus,html[${KBD_ATTR}] textarea:focus,html[${KBD_ATTR}] select:focus` +
  '{outline:2px solid var(--hui-focus,#005fcc);outline-offset:1px}';

// ---------------------------------------------------------------- focus return after dialogs

export const DIALOG_SELECTOR = '[role="dialog"],[aria-modal="true"]';
/** `dataSet={{ huiTrap: '1' }}` on a non-Modal overlay panel renders as this attribute */
export const TRAP_ATTR = 'data-hui-trap';
export const TRAP_SELECTOR = `[${TRAP_ATTR}]`;
export const FOCUSABLE_SELECTOR = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Where Tab goes inside a trapped overlay: wraps at both ends and pulls focus in when it is outside. null = let the
 * browser move focus (the next element is inside the overlay anyway).
 */
export function trapTarget<T>(items: readonly T[], active: T | null, shift: boolean): T | null {
  if (!items.length) return null;
  const i = active === null ? -1 : items.indexOf(active);
  if (i === -1) return shift ? items[items.length - 1] : items[0];
  if (shift && i === 0) return items[items.length - 1];
  if (!shift && i === items.length - 1) return items[0];
  return null;
}
/** anything that counts as an open overlay for focus return: dialogs and trapped panels */
export const OVERLAY_SELECTOR = `${DIALOG_SELECTOR},${TRAP_SELECTOR}`;
export const OPENER_SELECTOR = 'button,[role="button"],[tabindex],a[href],input,select,textarea,summary';

export type FocusDoc = {
  activeElement: El | null;
  body: unknown;
  querySelector(selector: string): unknown;
};

/**
 * Remembers the last focusable thing used outside a dialog and gives focus back to it when the last dialog is gone and
 * focus fell to <body>. `noteFocus` gets focusin targets, `notePointer` pointerdown targets (Safari does not focus a
 * button on click), `dialogsChanged` runs after DOM changes. Focus that already moved somewhere sensible is left alone.
 */
export function createFocusReturn(doc: FocusDoc, defer: (fn: () => void) => void) {
  let opener: El | null = null;
  let hadDialog = false;
  const outside = (el: El | null | undefined): el is El => !!el && typeof el.closest === 'function' && !el.closest(OVERLAY_SELECTOR);
  return {
    noteFocus(target: unknown) {
      const el = target as El;
      if (outside(el) && el.tagName !== 'BODY') opener = el;
    },
    notePointer(target: unknown) {
      const el = target as El;
      if (!outside(el)) return;
      const hit = el.closest?.(OPENER_SELECTOR);
      if (outside(hit)) opener = hit;
    },
    dialogsChanged() {
      const open = !!doc.querySelector(OVERLAY_SELECTOR);
      if (open) {
        hadDialog = true;
        return;
      }
      if (!hadDialog) return;
      hadDialog = false;
      const back = opener;
      defer(() => {
        const active = doc.activeElement;
        if (active && active !== doc.body) return;
        if (back && back.isConnected !== false && !doc.querySelector(OVERLAY_SELECTOR)) back.focus?.({ preventScroll: true });
      });
    },
    /** test hook */
    get opener() {
      return opener;
    },
  };
}

// ---------------------------------------------------------------- focus on a re-created element

type IdDoc = {
  activeElement: { id?: string; isConnected?: boolean } | null;
  getElementById(id: string): { focus(o?: { preventScroll?: boolean }): void } | null;
};

/**
 * A row that jumps to another list on toggle (checklist: open -> done) is re-created by React and loses keyboard focus
 * (<body>: the next Tab starts at the top of the page). Call it from the press handler: when the pressed element
 * (by DOM id) has focus, focus goes to the element with that id once the old one is gone (its exit animation may take
 * a few hundred ms, hence the polling, one check per frame).
 */
export function keepFocusOnId(domId: string | undefined, doc: IdDoc, raf: (fn: () => void) => void, tries = 60): void {
  const active = doc.activeElement;
  if (!domId || !active || active.id !== domId) return;
  const step = (left: number) => {
    if (active.isConnected === false) {
      doc.getElementById(domId)?.focus({ preventScroll: true });
    } else if (left > 0) raf(() => step(left - 1));
  };
  raf(() => step(tries));
}

/** web convenience for press handlers (no-op elsewhere) */
export function keepWebFocusOnId(domId: string | undefined): void {
  if (typeof document === 'undefined' || typeof requestAnimationFrame === 'undefined') return;
  keepFocusOnId(domId, document as unknown as IdDoc, (fn) => requestAnimationFrame(fn));
}

type Trap = { contains(n: unknown): boolean; querySelectorAll(sel: string): ArrayLike<unknown> };
type TrapDoc = { activeElement: unknown; querySelectorAll(sel: string): ArrayLike<unknown> };
type Focusable = { focus(o?: { preventScroll?: boolean }): void; getClientRects?(): { length: number } };

const visible = (n: unknown) => (n as Focusable).getClientRects?.().length !== 0;

/** a Modal dialog opened from the overlay (menu, confirm) has its own focus trap: not ours while focus is in it */
function inOtherDialog(trap: Trap, active: unknown): boolean {
  const a = active as El | null;
  return !!a && typeof a.closest === 'function' && !!a.closest(DIALOG_SELECTOR) && !trap.contains(a);
}

/** keydown handler body for Tab: returns true when it moved focus (the caller prevents the default) */
export function handleTrapTab(doc: TrapDoc, shift: boolean): boolean {
  const traps = Array.from(doc.querySelectorAll(TRAP_SELECTOR)) as Trap[];
  const trap = traps[traps.length - 1];
  if (!trap) return false;
  const active = doc.activeElement;
  if (inOtherDialog(trap, active)) return false;
  const items = (Array.from(trap.querySelectorAll(FOCUSABLE_SELECTOR)) as unknown[]).filter(visible);
  const next = trapTarget(items, trap.contains(active) ? active : null, shift) as Focusable | null;
  if (!next) return false;
  next.focus({ preventScroll: true });
  return true;
}

/** focus into a trapped overlay that just appeared (first control; an autoFocus field inside already has it) */
export function focusIntoTrap(doc: TrapDoc): void {
  const traps = Array.from(doc.querySelectorAll(TRAP_SELECTOR)) as Trap[];
  const trap = traps[traps.length - 1];
  if (!trap || trap.contains(doc.activeElement) || inOtherDialog(trap, doc.activeElement)) return;
  const first = (Array.from(trap.querySelectorAll(FOCUSABLE_SELECTOR)) as unknown[]).find(visible) as Focusable | undefined;
  first?.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- install

const STYLE_ID = 'hui-web-a11y';
let installed: (() => void) | null = null;

/** Web only, idempotent: binds the three helpers above and adds the focus-ring rule. Returns the uninstall function. */
export function installWebA11y(): () => void {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') return installed ?? (() => {});
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = FOCUS_CSS;
  document.head.appendChild(style);
  const offSpace = bindSpaceActivation(window as unknown as Listen);
  const offModality = bindKeyboardModality(window as unknown as Listen, document.documentElement);
  const fr = createFocusReturn(document as unknown as FocusDoc, (fn) => setTimeout(fn, 0));
  const onFocusIn = (e: Event) => fr.noteFocus(e.target);
  const onPointer = (e: Event) => fr.notePointer(e.target);
  window.addEventListener('focusin', onFocusIn, true);
  window.addEventListener('pointerdown', onPointer, true);
  const onTab = (e: KeyboardEvent) => {
    if (e.key === 'Tab' && !e.defaultPrevented && handleTrapTab(document as unknown as TrapDoc, e.shiftKey)) e.preventDefault();
  };
  window.addEventListener('keydown', onTab, true);
  // once per frame: streaming answers mutate the DOM at a high rate
  let queued = false;
  let trapOpen = false;
  const mo = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fr.dialogsChanged();
      const has = !!document.querySelector(TRAP_SELECTOR);
      if (has && !trapOpen) focusIntoTrap(document as unknown as TrapDoc);
      trapOpen = has;
    });
  });
  mo.observe(document.body, { childList: true, subtree: true });
  installed = () => {
    offSpace();
    offModality();
    window.removeEventListener('focusin', onFocusIn, true);
    window.removeEventListener('pointerdown', onPointer, true);
    window.removeEventListener('keydown', onTab, true);
    mo.disconnect();
    style.remove();
    installed = null;
  };
  return installed;
}

/** accent for the keyboard focus ring of inputs (CSS variable on <html>) */
export function setFocusColor(color: string): void {
  if (typeof document !== 'undefined') document.documentElement.style.setProperty('--hui-focus', color);
}
