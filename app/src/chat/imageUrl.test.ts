import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveImageUrl } from './imageUrl.ts';

const BASE = 'https://agents.example.ts.net:10443';

test('absolute http(s) is kept', () => {
  assert.equal(resolveImageUrl('https://a.b/x.png', BASE), 'https://a.b/x.png');
  assert.equal(resolveImageUrl('http://a.b/x.png', null), 'http://a.b/x.png');
});
test('root-relative resolves against the origin of the profile base', () => {
  assert.equal(resolveImageUrl('/v1/attachments/tok.en', BASE), `${BASE}/v1/attachments/tok.en`);
  assert.equal(resolveImageUrl('/v1/attachments/t', 'https://h.example/api/v1'), 'https://h.example/v1/attachments/t');
});
test('path-relative resolves against the base path', () => {
  assert.equal(resolveImageUrl('img/a.png', 'https://h.example/api'), 'https://h.example/api/img/a.png');
});
test('relative without base, unsafe schemes and junk are rejected', () => {
  assert.equal(resolveImageUrl('/v1/a', null), null);
  assert.equal(resolveImageUrl('/v1/a', ''), null);
  assert.equal(resolveImageUrl('javascript:alert(1)', BASE), null);
  assert.equal(resolveImageUrl('data:image/png;base64,AAAA', BASE), null);
  assert.equal(resolveImageUrl('file:///etc/passwd', BASE), null);
  assert.equal(resolveImageUrl('//evil.example/x.png', BASE), null);
  assert.equal(resolveImageUrl('   ', BASE), null);
  assert.equal(resolveImageUrl('/x', 'ftp://h'), null);
});
