import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  UNKNOWN_IMAGE_POLICIES,
  getUnknownImagePolicy,
  imageHost,
  proxiedImagesAutoLoad,
  imageLoadDecision,
  isTrustedImageUrl,
  markTrustedImageUrl,
  resetImageTrustForTests,
  setTrustedImageOrigins,
  setUnknownImagePolicy,
  unlockImageUrl,
} from './trust.ts';

beforeEach(() => resetImageTrustForTests());

// Security review H1: model-written image URLs must not be fetched without a tap.
test('model-written URLs on unknown hosts ask first (default policy)', () => {
  for (const u of ['https://x.attacker.tld/p.png?d=secret', 'http://192.168.1.10/a.png', 'https://example.com/favicon.ico', 'https://upload.wikimedia.org.evil.tld/x.jpg']) {
    assert.equal(imageLoadDecision(u), 'ask', u);
  }
});

test('Wikimedia / Wikipedia hosts, local schemes and our own pipeline load directly', () => {
  for (const u of [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/960px-X.jpg',
    'https://de.wikipedia.org/static/x.png',
    'data:image/png;base64,iVBORw0KGgo=',
    'file:///data/user/0/app/cache/a.jpg',
    'blob:https://app/1234',
  ]) {
    assert.equal(imageLoadDecision(u), 'load', u);
  }
  assert.equal(isTrustedImageUrl('data:text/html;base64,PHNjcmlwdD4='), false); // not an image
  assert.equal(isTrustedImageUrl('http://upload.wikimedia.org/x.jpg'), false); // cleartext
  assert.equal(isTrustedImageUrl('https://user:pw@upload.example.org/x.jpg'), false);
});

test('signed attachment URLs from the own server origins load; other paths on other hosts do not', () => {
  setTrustedImageOrigins(['https://agents.example.ts.net:10443/v1', 'https://hermes-host.example.ts.net/v1']);
  assert.equal(imageLoadDecision('https://agents.example.ts.net:10443/v1/attachments/abc.def'), 'load');
  assert.equal(imageLoadDecision('https://hermes-host.example.ts.net/bridge/x.png'), 'load');
  assert.equal(imageLoadDecision('https://agents.example.ts.net/v1/attachments/abc.def'), 'ask'); // other port = other origin
  setTrustedImageOrigins([]);
  assert.equal(imageLoadDecision('https://hermes-host.example.ts.net/bridge/x.png'), 'ask');
});

test('image-search results are trusted by exact URL only', () => {
  markTrustedImageUrl('https://images.example-cdn.com/photo-1.jpg', 'https://images.example-cdn.com/thumb-1.jpg');
  assert.equal(imageLoadDecision('https://images.example-cdn.com/photo-1.jpg'), 'load');
  assert.equal(imageLoadDecision('https://images.example-cdn.com/photo-1.jpg?d=leak'), 'ask');
  assert.equal(imageLoadDecision('https://images.example-cdn.com/other.jpg'), 'ask');
});

test('a tap unlocks one URL; "Immer laden" loads everything', () => {
  const u = 'https://example.org/chart.png';
  assert.equal(imageLoadDecision(u), 'ask');
  unlockImageUrl(u);
  assert.equal(imageLoadDecision(u), 'load');
  assert.equal(imageLoadDecision('https://example.org/other.png'), 'ask');
  setUnknownImagePolicy('always');
  assert.equal(imageLoadDecision('https://example.org/other.png'), 'load');
});

test('placeholder host label', () => {
  assert.equal(imageHost('https://www.example.com/a.png'), 'example.com');
  assert.equal(imageHost('https://x.attacker.tld:8443/p.png?d=1'), 'x.attacker.tld');
  assert.equal(imageHost('javascript:alert(1)'), '');
});

test('unknown-image policies: bridge (default) / tap / always', () => {
  assert.deepEqual(UNKNOWN_IMAGE_POLICIES, ['bridge', 'tap', 'always']);
  assert.equal(getUnknownImagePolicy(), 'bridge');
  const u = 'https://example.org/x.png';
  // direct loads of unknown URLs ask in both bridge and tap mode
  assert.equal(imageLoadDecision(u), 'ask');
  assert.equal(proxiedImagesAutoLoad(), true);
  setUnknownImagePolicy('tap');
  assert.equal(imageLoadDecision(u), 'ask');
  assert.equal(proxiedImagesAutoLoad(), false);
  setUnknownImagePolicy('always');
  assert.equal(imageLoadDecision(u), 'load');
});
