/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The phone drawer (scrim + panel) must cover the whole chat, header included, in light and dark. Fabric flattens
 * plain views and sorts the hoisted children by zIndex (Android draws elevation on top of that), so the drawer
 * layer needs its own raised stacking context and the chat header must not raise itself: a header zIndex put
 * the header icons above the scrim (and, before the drawer was raised, above the panel's top buttons).
 */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

test('drawer layer: own raised stacking context (zIndex + elevation) on the absolute-fill root', () => {
  const src = read('./ConversationDrawer.tsx');
  assert.match(src, /<Animated\.View style=\{\[StyleSheet\.absoluteFill, styles\.layer\]\}/);
  const layer = /layer: \{ zIndex: (\d+), elevation: (\d+) \}/.exec(src);
  assert.ok(layer, 'styles.layer with zIndex and elevation');
  assert.ok(Number(layer[1]) >= 10 && Number(layer[2]) >= 10);
});

test('chat header: no zIndex / elevation that could outrank the drawer scrim', () => {
  const src = read('../chat/ChatHeader.tsx');
  const code = src
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join('\n');
  assert.doesNotMatch(code, /\bzIndex\b/);
  assert.doesNotMatch(code, /\belevation\b/);
  // shadow tokens carry an Android elevation
  assert.doesNotMatch(code, /t\.shadows\./);
});

// iOS home-screen app, live 2026-10-27: switching chats from the drawer flashed and landed on a new chat or stayed on the
// old one. (1) the swipe's touch-down toggled `panning`, which drops the settled-open override (panel jumped for a plain
// tap); (2) the drawer stopped catching taps right on close, so iOS' synthesized click for the same tap hit the chat behind.
test('drawer: a plain tap never counts as a swipe (panning only from onStart, not onBegin)', () => {
  const src = read('./ConversationDrawer.tsx');
  const pan = src.slice(src.indexOf('Gesture.Pan()'), src.indexOf('if (!mounted)'));
  assert.match(pan, /\.onStart\(\(\) => \{\s*runOnJS\(setPanning\)\(true\);/);
  assert.doesNotMatch(pan, /\.onBegin\(/);
});

test('drawer: a shield over the closing drawer swallows the late iOS click, also after unmount', () => {
  const src = read('./ConversationDrawer.tsx');
  assert.match(src, /const GHOST_CLICK_MS = (\d+);/);
  assert.ok(Number(/const GHOST_CLICK_MS = (\d+);/.exec(src)![1]) >= 350, 'iOS click delay is ~300 ms');
  assert.match(src, /pointerEvents=\{open \? 'box-none' : shield \? 'auto' : 'none'\}/);
  assert.match(src, /if \(!mounted\) return shield \? <View style=\{\[StyleSheet\.absoluteFill, styles\.layer\]\}/);
  // the shield is the LAST child of the layer (above scrim and panel)
  const layer = src.slice(src.indexOf('</GestureDetector>'), src.lastIndexOf('</Animated.View>'));
  assert.match(layer, /shield && !open \? <View style=\{StyleSheet\.absoluteFill\}/);
});
