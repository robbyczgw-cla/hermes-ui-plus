/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * E2E round 13 O3: the composer's Stop button was missing from uiautomator dumps. It is its own element (not the
 * send button relabelled) with a role, a label and a testID (Android resource-id, iOS accessibilityIdentifier, web
 * data-testid).
 */
test('the Stop button has its own accessible element with label, role and testID', () => {
  const src = readFileSync(new URL('./Composer.tsx', import.meta.url), 'utf8');
  const start = src.indexOf('testID="composer-stop"');
  assert.ok(start > 0, 'testID composer-stop');
  const el = src.slice(src.lastIndexOf('<Pressable', start), src.indexOf('</Pressable>', start));
  assert.match(el, /onPress=\{onStop\}/);
  assert.match(el, /accessibilityRole="button"/);
  assert.match(el, /accessibilityLabel=\{tr\('chat\.composer\.stop'\)\}/);
  assert.match(src, /testID="composer-send"/);
});
