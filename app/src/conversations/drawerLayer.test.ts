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
