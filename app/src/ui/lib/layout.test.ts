/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { columnMaxWidth, isWideWidth, layoutClass, parseSidebarPrefs, shortcutFor, sidebarWidthFor, DEFAULT_SIDEBAR } from './layout.ts';

test('layout: breakpoints 900 (wide) / 1200 (desktop); phones stay phone', () => {
  for (const w of [360, 390, 430, 768, 899]) assert.equal(layoutClass(w), 'phone', String(w));
  assert.equal(layoutClass(900), 'wide');
  assert.equal(layoutClass(1199), 'wide');
  assert.equal(layoutClass(1200), 'desktop');
  assert.equal(layoutClass(1440), 'desktop');
  assert.equal(isWideWidth(899), false);
  assert.equal(isWideWidth(900), true);
});

test('layout: sidebar width is clamped and gives way on narrow wide windows', () => {
  assert.equal(sidebarWidthFor(undefined, 1280), 304);
  assert.equal(sidebarWidthFor(1000, 1920), 420);
  assert.equal(sidebarWidthFor(100, 1280), 260);
  assert.equal(sidebarWidthFor(400, 900), 380); // 900 - 520 content
  assert.equal(sidebarWidthFor(Number.NaN, 1280), 304);
});

test('layout: stored sidebar prefs parse tolerantly', () => {
  assert.deepEqual(parseSidebarPrefs(null), DEFAULT_SIDEBAR);
  assert.deepEqual(parseSidebarPrefs('nope'), DEFAULT_SIDEBAR);
  assert.deepEqual(parseSidebarPrefs('null'), DEFAULT_SIDEBAR);
  assert.deepEqual(parseSidebarPrefs('{"collapsed":true,"width":300}'), { collapsed: true, width: 300 });
  assert.deepEqual(parseSidebarPrefs('{"collapsed":"yes","width":9999}'), { collapsed: false, width: 420 });
});

test('layout: composer column = message column + its padding', () => {
  assert.equal(columnMaxWidth(760, 12), 784);
  assert.equal(columnMaxWidth(undefined, 12), undefined);
});

test('layout: shortcuts use ⌘ on macOS and Ctrl elsewhere', () => {
  assert.equal(shortcutFor({ key: 'b', metaKey: true }, true), 'toggle-sidebar');
  assert.equal(shortcutFor({ key: 'K', metaKey: true }, true), 'search');
  assert.equal(shortcutFor({ key: 'n', metaKey: true }, true), 'new-chat');
  assert.equal(shortcutFor({ key: 'f', metaKey: true }, true), 'find');
  assert.equal(shortcutFor({ key: 'F', ctrlKey: true }, false), 'find');
  assert.equal(shortcutFor({ key: 'O', metaKey: true, shiftKey: true }, true), 'new-chat');
  assert.equal(shortcutFor({ key: 'b', ctrlKey: true }, true), null); // Ctrl+B = text editing on macOS
  assert.equal(shortcutFor({ key: 'k', ctrlKey: true }, false), 'search');
  assert.equal(shortcutFor({ key: 'k', metaKey: true }, false), null);
  assert.equal(shortcutFor({ key: 'k', ctrlKey: true, altKey: true }, false), null);
  assert.equal(shortcutFor({ key: 'k', ctrlKey: true, isComposing: true }, false), null);
  assert.equal(shortcutFor({ key: 'k' }, false), null);
  assert.equal(shortcutFor({ key: 'b', ctrlKey: true, shiftKey: true }, false), null);
});
