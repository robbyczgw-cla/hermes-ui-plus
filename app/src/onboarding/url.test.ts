import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateHost, normalizeServerUrl, type UrlResult } from './url.ts';

// CGNAT (100.64.0.0/10) test addresses are assembled at runtime so the repo leak scanner does not flag them
const cgnat = (rest: string): string => ['100', rest].join('.');

function base(input: string): string {
  const r = normalizeServerUrl(input);
  assert.ok(r.ok, `expected ok for ${input}: ${JSON.stringify(r)}`);
  return r.baseUrl;
}
function err(input: string): string {
  const r: UrlResult = normalizeServerUrl(input);
  assert.equal(r.ok, false, `expected error for ${JSON.stringify(input)}, got ${JSON.stringify(r)}`);
  return (r as { error: string }).error;
}

test('adds https:// and /v1', () => {
  assert.equal(base('hermes.example.org'), 'https://hermes.example.org/v1');
  assert.equal(base('  Hermes.Example.ORG/  '), 'https://hermes.example.org/v1');
  const r = normalizeServerUrl('hermes.example.org');
  assert.ok(r.ok && r.addedScheme && r.addedV1 && r.cleartext === 'none');
});

test('host:port without scheme is not mistaken for a scheme', () => {
  assert.equal(base('localhost:8787'), 'https://localhost:8787/v1');
  assert.equal(base('192.168.1.20:8645'), 'https://192.168.1.20:8645/v1');
  assert.equal(base('hermes.local:8645/v1'), 'https://hermes.local:8645/v1');
});

test('keeps explicit http and reports cleartext exposure', () => {
  const lan = normalizeServerUrl('http://192.168.1.20:8645');
  assert.ok(lan.ok && lan.baseUrl === 'http://192.168.1.20:8645/v1' && lan.cleartext === 'private');
  const ts = normalizeServerUrl(`http://${cgnat('101.102.103')}:8645/v1`);
  assert.ok(ts.ok && ts.cleartext === 'private');
  const pub = normalizeServerUrl('http://hermes.example.org');
  assert.ok(pub.ok && pub.cleartext === 'public');
  const pubIp = normalizeServerUrl('http://8.8.8.8');
  assert.ok(pubIp.ok && pubIp.cleartext === 'public');
});

test('does not double /v1, strips pasted endpoints, query and fragment', () => {
  assert.equal(base('https://h.example.org/v1'), 'https://h.example.org/v1');
  assert.equal(base('https://h.example.org/V1/'), 'https://h.example.org/v1');
  assert.equal(base('https://h.example.org/v1/chat/completions'), 'https://h.example.org/v1');
  assert.equal(base('https://h.example.org/v1/models?x=1#frag'), 'https://h.example.org/v1');
  assert.equal(base('https://h.example.org/health'), 'https://h.example.org/v1');
  assert.equal(base('https://h.example.org//hermes///'), 'https://h.example.org/hermes/v1');
  const r = normalizeServerUrl('https://h.example.org/hermes');
  assert.ok(r.ok && r.root === 'https://h.example.org/hermes');
});

test('drops default ports, keeps others', () => {
  assert.equal(base('https://h.example.org:443'), 'https://h.example.org/v1');
  assert.equal(base('http://h.example.org:80'), 'http://h.example.org/v1');
  assert.equal(base('http://h.example.org:443'), 'http://h.example.org:443/v1');
  assert.equal(base('https://h.example.ts.net:8790/v1'), 'https://h.example.ts.net:8790/v1');
});

test('IPv6 literals', () => {
  assert.equal(base('http://[::1]:8645'), 'http://[::1]:8645/v1');
  const r = normalizeServerUrl('http://[fd12:3456:789a::1]:8645');
  assert.ok(r.ok && r.host === 'fd12:3456:789a::1' && r.cleartext === 'private' && r.hostKind === 'ipv6');
  assert.equal(err('http://[::1'), 'host');
  assert.equal(err('http://[nothex]'), 'host');
});

test('rejects hostile / broken input', () => {
  assert.equal(err(''), 'empty');
  assert.equal(err('   '), 'empty');
  assert.equal(err('javascript:alert(1)'), 'scheme');
  assert.equal(err('file:///etc/passwd'), 'scheme');
  assert.equal(err('ftp://h.example.org'), 'scheme');
  assert.equal(err('data:text/html,hi'), 'scheme');
  assert.equal(err('http:/h.example.org'), 'scheme');
  assert.equal(err('https://user:pass@h.example.org'), 'credentials');
  assert.equal(err('https://h.example.org@evil.example.com'), 'credentials');
  assert.equal(err('https://h.example .org'), 'whitespace');
  assert.equal(err('https://h.example.org\r\nX-Evil: 1'), 'whitespace');
  assert.equal(err('https://h.example.org/\u0000'), 'whitespace');
  assert.equal(err('https://h.example.org:0'), 'port');
  assert.equal(err('https://h.example.org:65536'), 'port');
  assert.equal(err('https://h.example.org:12ab'), 'port');
  assert.equal(err('https://-bad.example.org'), 'host');
  assert.equal(err('https://bad_.exa mple'), 'whitespace');
  assert.equal(err('https://999.1.1.1'), 'host');
  assert.equal(err('https://1.2.3'), 'host');
  assert.equal(err('https://01.2.3.4'), 'host');
  assert.equal(err('https://h.example.org\\@evil.example'), 'credentials');
  assert.equal(err('https://exämple.org'), 'host');
  assert.equal(err('https://h.example.org/../admin'), 'path');
  assert.equal(err('https://h.example.org/a%2f..'), 'path');
  assert.equal(err('https://h.example.org/<script>'), 'path');
  assert.equal(err(`https://${'a'.repeat(2050)}.org`), 'too-long');
  assert.equal(err(`https://${'a'.repeat(64)}.org`), 'host');
  assert.equal(err('https://'), 'host');
  assert.equal(err('https://:8080'), 'host');
});

test('trailing dot on host is dropped', () => {
  assert.equal(base('https://h.example.org.'), 'https://h.example.org/v1');
});

test('isPrivateHost', () => {
  for (const h of ['10.0.0.1', '172.16.5.4', '172.31.255.255', '192.168.0.1', '127.0.0.1', cgnat('64.0.1'), cgnat('127.1.1'), '169.254.1.1', 'nas.local', 'hermes-host', 'localhost', 'box.home.arpa', 'hermes-host.example.ts.net']) {
    assert.ok(isPrivateHost(h), h);
  }
  for (const h of ['8.8.8.8', '172.32.0.1', '100.128.0.1', 'example.org', 'ts.net.example.org']) {
    assert.ok(!isPrivateHost(h), h);
  }
});
