import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeT } from '../i18n/core.ts';
import { classifyFetchError, classifyStatus, describeConnError, HINT_COUNT, type ConnErrorKind, type ErrorContext } from './errors.ts';
import { normalizeServerUrl, type NormalizedUrl } from './url.ts';

function u(s: string): NormalizedUrl {
  const r = normalizeServerUrl(s);
  assert.ok(r.ok);
  return r;
}
const nat = (url: string, platform = 'android'): ErrorContext => ({ platform, url: u(url) });
const nodeErr = (code: string, msg = 'fetch failed') => Object.assign(new TypeError(msg), { cause: Object.assign(new Error(code), { code }) });

test('specific error texts win', () => {
  const ctx = nat('https://h.example.org');
  assert.equal(classifyFetchError(Object.assign(new Error('aborted'), { name: 'AbortError' }), ctx).kind, 'timeout');
  assert.equal(classifyFetchError(nodeErr('ENOTFOUND'), ctx).kind, 'dns');
  assert.equal(classifyFetchError(nodeErr('ECONNREFUSED'), ctx).kind, 'refused');
  assert.equal(classifyFetchError(nodeErr('DEPTH_ZERO_SELF_SIGNED_CERT'), ctx).kind, 'tls');
  assert.equal(classifyFetchError(new Error('java.net.UnknownHostException: Unable to resolve host "x"'), ctx).kind, 'dns');
  assert.equal(classifyFetchError(new Error('CLEARTEXT communication to 1.2.3.4 not permitted by network security policy'), ctx).kind, 'cleartext');
  assert.equal(classifyFetchError(new Error('A server with the specified hostname could not be found.'), ctx).kind, 'dns');
  assert.equal(classifyFetchError(new Error('An SSL error has occurred'), ctx).kind, 'tls');
});

test('generic RN "Network request failed" gets a URL-based suspect', () => {
  const e = new TypeError('Network request failed');
  assert.deepEqual(
    [classifyFetchError(e, nat('https://192.168.1.2:8645')).suspect, classifyFetchError(e, nat('https://[fd00::1]')).suspect],
    ['tls', 'tls'],
  );
  assert.equal(classifyFetchError(e, nat(`http://${['100', '100', '1', '2'].join('.')}:8645`)).suspect, 'vpn');
  assert.equal(classifyFetchError(e, nat('https://hermes-host.example.ts.net')).suspect, 'vpn');
  assert.equal(classifyFetchError(e, nat('http://localhost:8787', 'android')).suspect, 'emulator');
  assert.equal(classifyFetchError(e, nat('http://localhost:8787', 'ios')).suspect, undefined);
  const r = classifyFetchError(e, nat('https://h.example.org'));
  assert.equal(r.kind, 'network');
  assert.equal(r.suspect, undefined);
});

test('web: mixed content vs CORS', () => {
  const e = new TypeError('Failed to fetch');
  const web = (url: string, pageProtocol: string): ErrorContext => ({ platform: 'web', url: u(url), pageProtocol });
  assert.equal(classifyFetchError(e, web('http://192.168.1.2:8645', 'https:')).kind, 'mixedContent');
  assert.equal(classifyFetchError(e, web('http://localhost:8787', 'https:')).kind, 'cors');
  assert.equal(classifyFetchError(e, web('http://192.168.1.2:8645', 'http:')).kind, 'cors');
  assert.equal(classifyFetchError(e, web('https://h.example.org', 'https:')).kind, 'cors');
});

test('HTTP status classification', () => {
  assert.equal(classifyStatus(401, { hasKey: true }).kind, 'unauthorized');
  assert.equal(classifyStatus(401, { hasKey: false }).kind, 'keyMissing');
  assert.equal(classifyStatus(403, { hasKey: true }).kind, 'forbidden');
  assert.equal(classifyStatus(404, { hasKey: true, path: '/v1/models' }).kind, 'notFound');
  assert.equal(classifyStatus(429, { hasKey: true }).kind, 'rateLimited');
  assert.equal(classifyStatus(502, { hasKey: true }).kind, 'server');
  assert.equal(classifyStatus(418, { hasKey: true }).kind, 'unknown');
});

const t = makeT('de', 'de-DE');
const tEn = makeT('en', 'en-US');

test('describeConnError fills placeholders and prepends suspect hint', () => {
  const d = describeConnError({ kind: 'dns', host: 'h.example.org' }, t);
  assert.match(d.message, /„h\.example\.org“/);
  assert.ok(d.hints.length > 0);
  const n = describeConnError({ kind: 'network', host: '1.2.3.4', suspect: 'tls' }, t);
  assert.match(n.hints[0], /Zertifikat/);
  assert.match(describeConnError({ kind: 'server', status: 503 }, t).title, /503/);
  assert.match(describeConnError({ kind: 'notFound', path: '/v1/models' }, t).message, /\/v1\/models/);
  const unk = describeConnError({ kind: 'unknown', detail: 'HTTP 418' }, t);
  assert.equal(unk.message, 'HTTP 418');
  assert.ok(describeConnError({ kind: 'unknown' }, t).message.length > 0);
  for (const s of [d, n]) for (const t of [s.title, s.message, ...s.hints]) assert.ok(!/\{\w+\}/.test(t), t);
});

test('describeConnError: every kind has title, message and the declared hints in both languages', () => {
  for (const tr of [t, tEn]) {
    for (const kind of Object.keys(HINT_COUNT) as ConnErrorKind[]) {
      const d = describeConnError({ kind, host: 'h', path: '/p', status: 500, detail: 'x' }, tr);
      assert.equal(d.hints.length, HINT_COUNT[kind], kind);
      for (const x of [d.title, d.message, ...d.hints]) assert.ok(x && !x.startsWith('onboarding.'), `${kind}: ${x}`);
    }
  }
  assert.match(describeConnError({ kind: 'server', status: 503 }, tEn).title, /Server error \(503\)/);
});
