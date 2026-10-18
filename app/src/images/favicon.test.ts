/// <reference types="node" />
// Favicons under the image privacy settings (favicon.ts): bridge proxy first, direct only when allowed, else the letter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faviconOf, planFavicon } from './favicon.ts';

const PAGE = 'https://docs.example.org/articles/a?x=1';
const ICON = 'https://docs.example.org/favicon.ico';
const proxy = (u: string) => `https://bridge.example.com/bridge/img?u=${encodeURIComponent(u)}`;
const ask = () => 'ask' as const;
const load = () => 'load' as const;

test('faviconOf: the site itself, http(s) only, no credentials', () => {
  assert.equal(faviconOf(PAGE), ICON);
  assert.equal(faviconOf('http://Example.com:8080/x'), 'http://Example.com:8080/favicon.ico');
  assert.equal(faviconOf('javascript:alert(1)'), undefined);
  assert.equal(faviconOf('https://user@example.com/x'), undefined);
});

test('images off: never a request, not even through the bridge', () => {
  assert.equal(planFavicon(PAGE, load, { allowed: false, proxy, proxyAuto: true }), null);
});

test('default ("über die Bridge"): through the proxy, never directly from an unknown site', () => {
  assert.equal(planFavicon(PAGE, ask, { allowed: true, proxy, proxyAuto: true }), proxy(ICON));
  // no proxy on this bridge: letter avatar instead of a direct third-party fetch
  assert.equal(planFavicon(PAGE, ask, { allowed: true, proxy: () => null, proxyAuto: true }), null);
  assert.equal(planFavicon(PAGE, ask, { allowed: true, proxyAuto: true }), null);
});

test('"Erst nach Tippen": letter avatar unless that icon was unlocked; "Immer laden" / trusted: proxy, else direct', () => {
  assert.equal(planFavicon(PAGE, ask, { allowed: true, proxy, proxyAuto: false }), null);
  assert.equal(planFavicon(PAGE, load, { allowed: true, proxy, proxyAuto: false }), proxy(ICON));
  assert.equal(planFavicon(PAGE, load, { allowed: true, proxy: () => null, proxyAuto: true }), ICON);
});
