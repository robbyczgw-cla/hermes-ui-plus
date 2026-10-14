import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bridgeRoot, isProxiedImageUrl, proxiedImageUrl, proxyImageSource } from './proxy.ts';

const CONN = { baseUrl: 'https://bridge.example.com/v1/', apiKey: 'nca_user_test_token_000' };

test('bridgeRoot strips /v1 and trailing slashes', () => {
  assert.equal(bridgeRoot('https://bridge.example.com/v1/'), 'https://bridge.example.com');
  assert.equal(bridgeRoot('https://example.com/hermes/v1'), 'https://example.com/hermes');
});

test('proxiedImageUrl: https answer URLs only, nothing the bridge would refuse, never its own origin', () => {
  const u = 'https://cdn.example.org/p/xm5.jpg?w=800&h=600';
  assert.equal(proxiedImageUrl(CONN, u), `https://bridge.example.com/bridge/img?u=${encodeURIComponent(u)}`);
  assert.equal(proxiedImageUrl(CONN, 'https://cdn.example.org:443/a.jpg')?.startsWith('https://bridge.example.com/bridge/img?u='), true);
  for (const bad of ['http://cdn.example.org/a.jpg', 'https://user:pw@cdn.example.org/a.jpg', 'https://cdn.example.org:8443/a.jpg', 'data:image/png;base64,AAAA',
    'not a url', '', `https://cdn.example.org/${'x'.repeat(2100)}`, 'https://bridge.example.com/bridge/media?path=/x.png']) {
    assert.equal(proxiedImageUrl(CONN, bad), null, bad);
  }
  assert.equal(proxiedImageUrl(null, u), null);
  assert.equal(proxiedImageUrl({ baseUrl: 'garbage', apiKey: 'k' }, u), null);
});

test('proxyImageSource: the device token goes into a header for proxy URLs only, never into a URL', () => {
  const p = proxiedImageUrl(CONN, 'https://cdn.example.org/a.jpg')!;
  assert.ok(!p.includes(CONN.apiKey));
  assert.equal(isProxiedImageUrl(CONN, p), true);
  assert.deepEqual(proxyImageSource(CONN, p), { uri: p, headers: { Authorization: `Bearer ${CONN.apiKey}` } });
  assert.deepEqual(proxyImageSource(CONN, 'https://cdn.example.org/a.jpg'), { uri: 'https://cdn.example.org/a.jpg' });
  assert.deepEqual(proxyImageSource(null, p), { uri: p });
  assert.equal(isProxiedImageUrl(CONN, 'https://other.example.com/bridge/img?u=x'), false);
});
