/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStick, STICK_MS } from './stickToBottom.ts';

test('nothing sent yet: no follow, no reveal', () => {
  const s = createStick();
  assert.equal(s.follow(0), false);
  assert.equal(s.pinned(), false);
});

test('after a send the list follows content changes for the window (instant failure: E2E round 12 F2)', () => {
  const s = createStick();
  s.arm(1000);
  // user bubble + placeholder, then the error card 68 ms later: both re-pin the bottom
  assert.equal(s.follow(1000), true);
  assert.equal(s.follow(1068), true);
  assert.equal(s.follow(1000 + STICK_MS - 1), true);
  // afterwards maintainVisibleContentPosition / the auto-scroll preference decide again
  assert.equal(s.follow(1000 + STICK_MS), false);
  // a send error later in the turn still reveals the error card
  assert.equal(s.pinned(), true);
});

test('a deliberate scroll up releases: no follow, no reveal on error', () => {
  const s = createStick();
  s.arm(0);
  s.release();
  assert.equal(s.follow(10), false);
  assert.equal(s.pinned(), false);
  // the next send pins again
  s.arm(5000);
  assert.equal(s.follow(5010), true);
  assert.equal(s.pinned(), true);
});

test('scrolled-away offsets only release outside the follow window (inside it mvcp itself moves the offset)', () => {
  const s = createStick();
  s.arm(0);
  s.scrolled(400, 100);
  assert.equal(s.pinned(), true);
  s.scrolled(400, STICK_MS + 1);
  assert.equal(s.pinned(), false);
  s.arm(10_000);
  s.scrolled(20, 10_000 + STICK_MS + 1);
  assert.equal(s.pinned(), true, 'near the bottom stays pinned');
});

// source guard (no React renderer in node:test): the list arms on send, follows content changes, releases on a drag,
// and ChatView reveals a failed answer
test('MessageList / ChatView wiring', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const list = read('./MessageList.tsx');
  const view = read('./ChatView.tsx');
  assert.match(list, /stick\.arm\(Date\.now\(\)\);\s*list\.current\?\.scrollToOffset\(\{ offset: 0/);
  assert.match(list, /onContentSizeChange=\{[\s\S]*?if \(stick\.follow\(Date\.now\(\)\)\) list\.current\?\.scrollToOffset\(\{ offset: 0, animated: false \}\)/);
  assert.match(list, /onScrollBeginDrag=\{stick\.release\}/);
  assert.match(list, /maintainVisibleContentPosition=\{mvcp\}/);
  assert.match(view, /if \(!send\(text, attachments, pending\)\) return false;[\s\S]{0,120}scrollToBottom\(true\)/);
  assert.match(view, /last\.status === 'error' \? last : null;[\s\S]{0,120}revealLatest\(\)/);
});
