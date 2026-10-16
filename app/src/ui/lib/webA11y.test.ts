import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FOCUS_CSS,
  KBD_ATTR,
  bindKeyboardModality,
  bindSpaceActivation,
  createFocusReturn,
  focusIntoTrap,
  handleTrapTab,
  keepFocusOnId,
  trapTarget,
  isSpaceTarget,
} from './webA11y.ts';

const el = (tagName: string, attrs: Record<string, string> = {}, extra: Record<string, unknown> = {}) => ({
  tagName,
  getAttribute: (n: string) => attrs[n] ?? null,
  ...extra,
});

test('isSpaceTarget: custom checkbox / radio / switch yes; native controls, buttons, disabled and plain divs no', () => {
  for (const role of ['checkbox', 'radio', 'switch', 'option', 'tab', 'menuitemcheckbox']) assert.equal(isSpaceTarget(el('DIV', { role })), true, role);
  assert.equal(isSpaceTarget(el('DIV', { role: 'button' })), false, 'RNW already handles Space on role=button');
  assert.equal(isSpaceTarget(el('DIV')), false);
  assert.equal(isSpaceTarget(el('INPUT', { role: 'checkbox' })), false, 'native input toggles itself');
  assert.equal(isSpaceTarget(el('TEXTAREA')), false);
  assert.equal(isSpaceTarget(el('DIV', { role: 'checkbox', 'aria-disabled': 'true' })), false);
  assert.equal(isSpaceTarget(null), false);
});

function listeners() {
  const l: Record<string, (e: never) => void> = {};
  return { l, target: { addEventListener: (t: string, fn: (e: never) => void) => (l[t] = fn) } };
}
const key = (k: string, target: unknown, extra: Record<string, unknown> = {}) => {
  const e = { key: k, target, prevented: false, preventDefault() { e.prevented = true; }, ...extra };
  return e;
};

test('Space on a checkbox: keydown prevents scrolling, keyup clicks it once; other keys and targets are ignored', () => {
  const { l, target } = listeners();
  bindSpaceActivation(target);
  let clicks = 0;
  const box = el('DIV', { role: 'checkbox' }, { click: () => clicks++ });
  const down = key(' ', box);
  l.keydown(down as never);
  assert.equal(down.prevented, true);
  assert.equal(clicks, 0, 'activates on keyup like a native checkbox');
  l.keyup(key(' ', box) as never);
  assert.equal(clicks, 1);
  l.keyup(key(' ', box) as never);
  assert.equal(clicks, 1, 'one press, one click');
  // key held down: repeats never click twice
  l.keydown(key(' ', box) as never);
  l.keydown(key(' ', box, { repeat: true }) as never);
  l.keyup(key(' ', box) as never);
  assert.equal(clicks, 2);
  // focus moved away between down and up: no click on the new element
  const other = el('DIV', { role: 'checkbox' }, { click: () => clicks++ });
  l.keydown(key(' ', box) as never);
  l.keyup(key(' ', other) as never);
  assert.equal(clicks, 2);
  // Enter, typing in an input, role=button: untouched
  const enter = key('Enter', box);
  l.keydown(enter as never);
  assert.equal(enter.prevented, false);
  const typing = key(' ', el('TEXTAREA'));
  l.keydown(typing as never);
  assert.equal(typing.prevented, false);
});

test('keyboard modality: Tab / arrows set the attribute, a pointer press removes it, typing does not', () => {
  const { l, target } = listeners();
  const attrs = new Set<string>();
  bindKeyboardModality(target, { setAttribute: (n) => attrs.add(n), removeAttribute: (n) => attrs.delete(n) });
  l.keydown(key('a', null) as never);
  assert.equal(attrs.has(KBD_ATTR), false);
  l.keydown(key('Tab', null) as never);
  assert.equal(attrs.has(KBD_ATTR), true);
  l.pointerdown({} as never);
  assert.equal(attrs.has(KBD_ATTR), false);
  assert.match(FOCUS_CSS, new RegExp(`html\\[${KBD_ATTR}\\] textarea:focus`));
});

// a minimal document: dialogs are open while `dialogOpen` is true
function focusFixture() {
  const state = { dialogOpen: false, active: null as unknown };
  const body = { tagName: 'BODY' };
  const doc = {
    body,
    get activeElement() {
      return (state.active ?? body) as never;
    },
    querySelector: () => (state.dialogOpen ? {} : null),
  };
  const deferred: (() => void)[] = [];
  const fr = createFocusReturn(doc as never, (fn) => deferred.push(fn));
  const opener = (extra: Record<string, unknown> = {}) => {
    let focused = 0;
    const e = el('BUTTON', { role: 'button' }, { closest: (s: string) => (s.includes('dialog') ? null : e), focus: () => { focused++; state.active = e; }, isConnected: true, ...extra });
    return { e, focused: () => focused };
  };
  return { state, body, fr, deferred, opener };
}

test('focus return: closing the last dialog gives focus back to the opener when focus fell to <body>', () => {
  const { state, fr, deferred, opener } = focusFixture();
  const o = opener();
  fr.noteFocus(o.e);
  state.dialogOpen = true;
  fr.dialogsChanged();
  state.dialogOpen = false;
  state.active = null; // RNW removed the focused element: focus is on <body>
  fr.dialogsChanged();
  deferred.forEach((f) => f());
  assert.equal(o.focused(), 1);
});

test('focus return: not while a dialog is still open, not when focus already moved, not to a removed element, not without a dialog', () => {
  const f = focusFixture();
  const o = f.opener();
  f.fr.noteFocus(o.e);
  // never had a dialog: nothing to return from
  f.fr.dialogsChanged();
  f.deferred.splice(0).forEach((x) => x());
  assert.equal(o.focused(), 0);
  // nested dialogs: still one open after the first closes
  f.state.dialogOpen = true;
  f.fr.dialogsChanged();
  f.fr.dialogsChanged();
  f.deferred.splice(0).forEach((x) => x());
  assert.equal(o.focused(), 0);
  // closes, but focus is on another element already (e.g. the search field the sheet focused on purpose)
  f.state.dialogOpen = false;
  f.state.active = { tagName: 'INPUT' };
  f.fr.dialogsChanged();
  f.deferred.splice(0).forEach((x) => x());
  assert.equal(o.focused(), 0);
  // opener was removed from the page meanwhile
  const gone = f.opener({ isConnected: false });
  f.fr.noteFocus(gone.e);
  f.state.dialogOpen = true;
  f.fr.dialogsChanged();
  f.state.dialogOpen = false;
  f.state.active = null;
  f.fr.dialogsChanged();
  f.deferred.splice(0).forEach((x) => x());
  assert.equal(gone.focused(), 0);
});

test('focus return: elements inside a dialog never become the opener; a pointer press on a button inside an opener counts', () => {
  const f = focusFixture();
  const inside = el('BUTTON', {}, { closest: (s: string) => (s.includes('dialog') ? {} : null) });
  f.fr.noteFocus(inside);
  assert.equal(f.fr.opener, null);
  const btn = f.opener();
  const child = el('DIV', {}, { closest: (s: string) => (s.includes('dialog') ? null : btn.e) });
  f.fr.notePointer(child);
  assert.equal(f.fr.opener, btn.e);
});

test('keepFocusOnId: focus follows a re-created element with the same id once the old one is gone', () => {
  const old = { id: 'row-1', isConnected: true };
  let focused = 0;
  const fresh = { id: 'row-1', focus: () => focused++ };
  const frames: (() => void)[] = [];
  const step = () => frames.splice(0).forEach((f) => f());
  const doc = { activeElement: old, getElementById: () => fresh as never };
  keepFocusOnId('row-1', doc as never, (fn) => frames.push(fn));
  step();
  step();
  assert.equal(focused, 0, 'old element still in the page (exit animation): wait');
  old.isConnected = false;
  step();
  assert.equal(focused, 1);
  assert.equal(frames.length, 0, 'done');
  // the element is never replaced: polling ends after the frame budget without a focus call
  const same = { id: 'row-1', isConnected: true };
  keepFocusOnId('row-1', { activeElement: same, getElementById: () => fresh as never } as never, (fn) => frames.push(fn), 3);
  for (let i = 0; i < 6; i++) step();
  assert.equal(focused, 1);
  // another element had focus, or no id: nothing is scheduled
  keepFocusOnId('row-1', { activeElement: { id: 'other' }, getElementById: () => fresh as never } as never, (fn) => frames.push(fn));
  keepFocusOnId(undefined, doc as never, (fn) => frames.push(fn));
  assert.equal(frames.length, 0);
});

test('trapTarget: wraps at both ends, pulls focus in from outside, otherwise leaves Tab to the browser', () => {
  const items = ['a', 'b', 'c'];
  assert.equal(trapTarget(items, 'c', false), 'a');
  assert.equal(trapTarget(items, 'a', true), 'c');
  assert.equal(trapTarget(items, 'b', false), null);
  assert.equal(trapTarget(items, 'b', true), null);
  assert.equal(trapTarget(items, null, false), 'a', 'focus outside: first');
  assert.equal(trapTarget(items, null, true), 'c', 'Shift+Tab from outside: last');
  assert.equal(trapTarget([], null, false), null);
});

// a fake overlay with three controls (one hidden) inside a fake document
function trapFixture(activeInside: number | 'outside' | 'modal') {
  const focused: string[] = [];
  const mk = (name: string, visible = true) => ({ name, focus: () => focused.push(name), getClientRects: () => ({ length: visible ? 1 : 0 }), closest: () => null as unknown });
  const items = [mk('first'), mk('hidden', false), mk('last')];
  const trap = { contains: (n: unknown) => items.includes(n as never), querySelectorAll: () => items };
  const modalEl = { ...mk('modal-btn'), closest: (s: string) => (s.includes('dialog') ? {} : null) };
  const outsideEl = mk('outside');
  const active = activeInside === 'outside' ? outsideEl : activeInside === 'modal' ? modalEl : items[activeInside];
  const doc = { activeElement: active, querySelectorAll: (s: string) => (s.includes('data-hui-trap') ? [trap] : []) };
  return { doc, focused };
}

test('handleTrapTab: Tab on the last visible control wraps to the first, hidden ones are skipped, a Modal on top is left alone', () => {
  let f = trapFixture(2);
  assert.equal(handleTrapTab(f.doc as never, false), true);
  assert.deepEqual(f.focused, ['first']);
  f = trapFixture(0);
  assert.equal(handleTrapTab(f.doc as never, true), true);
  assert.deepEqual(f.focused, ['last']);
  f = trapFixture(0);
  assert.equal(handleTrapTab(f.doc as never, false), false, 'middle of the list: browser moves focus');
  f = trapFixture('outside');
  assert.equal(handleTrapTab(f.doc as never, false), true);
  assert.deepEqual(f.focused, ['first']);
  f = trapFixture('modal');
  assert.equal(handleTrapTab(f.doc as never, false), false);
  assert.deepEqual(f.focused, []);
  assert.equal(handleTrapTab({ activeElement: null, querySelectorAll: () => [] } as never, false), false, 'no overlay: nothing to do');
});

test('focusIntoTrap: focuses the first visible control once; not when focus is already inside or in a Modal on top', () => {
  let f = trapFixture('outside');
  focusIntoTrap(f.doc as never);
  assert.deepEqual(f.focused, ['first']);
  f = trapFixture(2);
  focusIntoTrap(f.doc as never);
  assert.deepEqual(f.focused, []);
  f = trapFixture('modal');
  focusIntoTrap(f.doc as never);
  assert.deepEqual(f.focused, []);
});
