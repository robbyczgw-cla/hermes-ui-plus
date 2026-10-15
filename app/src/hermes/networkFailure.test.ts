/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeT } from '../i18n/core.ts';
import { networkFailureKind, presentMessageError, scrubHosts } from './networkFailure.ts';

const de = makeT('de', 'de-DE');
const en = makeT('en', 'en-US');
const es = makeT('es', 'es-ES');

// fake hosts / documentation addresses only
const DNS = 'java.net.UnknownHostException: Unable to resolve host "<host>.<tailnet>.ts.net": No address associated with hostname';
const REFUSED = 'java.net.ConnectException: Failed to connect to box.example.com/192.0.2.17:8645';
const RESET = 'java.net.SocketException: Connection reset';
const TIMEOUT = 'java.net.SocketTimeoutException: timeout';
const TLS = 'javax.net.ssl.SSLHandshakeException: java.security.cert.CertPathValidatorException: Trust anchor for certification path not found.';
const TLS_HOST = 'javax.net.ssl.SSLPeerUnverifiedException: Hostname box.example.org not verified';

test('networkFailureKind: DNS, timeout, refused, reset, TLS, offline; null for non-network text', () => {
  assert.equal(networkFailureKind(DNS), 'dns');
  assert.equal(networkFailureKind(REFUSED), 'refused');
  assert.equal(networkFailureKind('connect ECONNREFUSED 127.0.0.1:8645'), 'refused');
  assert.equal(networkFailureKind(RESET), 'reset');
  assert.equal(networkFailureKind('read ECONNRESET'), 'reset');
  assert.equal(networkFailureKind(TIMEOUT), 'timeout');
  assert.equal(networkFailureKind(TLS), 'tls');
  assert.equal(networkFailureKind(TLS_HOST), 'tls');
  assert.equal(networkFailureKind('Network request failed'), 'unreachable');
  assert.equal(networkFailureKind('Failed to fetch'), 'unreachable');
  assert.equal(networkFailureKind('The Internet connection appears to be offline.'), 'offline');
  assert.equal(networkFailureKind('tool crashed'), null);
  assert.equal(networkFailureKind('Model overloaded, please retry'), null);
});

test('scrubHosts removes host names, IPs and URLs but keeps exception class names', () => {
  const d = scrubHosts(DNS);
  assert.doesNotMatch(d, /tailnet|ts\.net/);
  assert.match(d, /^java\.net\.UnknownHostException: Unable to resolve host "<host>"/);
  const r = scrubHosts(REFUSED);
  assert.doesNotMatch(r, /example\.com|192\.0\.2\.17/);
  assert.match(r, /^java\.net\.ConnectException: Failed to connect to <host>/);
  assert.equal(scrubHosts(TLS), TLS);
  assert.doesNotMatch(scrubHosts(TLS_HOST), /example\.org/);
  assert.doesNotMatch(scrubHosts('GET https://box.example.net:8645/v1/chat/completions failed'), /example\.net|8645|chat\/completions/);
  assert.doesNotMatch(scrubHosts('connect ECONNREFUSED 198.51.100.4:8645'), /198\.51/);
  assert.doesNotMatch(scrubHosts('connect ECONNREFUSED [2001:db8::1]:8645'), /2001:db8/);
  assert.doesNotMatch(scrubHosts('getaddrinfo ENOTFOUND hermesbox'), /hermesbox/);
  assert.equal(scrubHosts(RESET), RESET);
});

test('Hermes network error (persisted with the raw detail): friendly text, scrubbed detail', () => {
  const m = { error: `Netzwerkfehler: ${DNS}`, errorText: { key: 'backends.hermes.errors.networkDetail' as const, params: { detail: DNS } } };
  const p = presentMessageError(m, de);
  assert.equal(p.text, de('chat.message.network.dns'));
  assert.match(p.text, /Server nicht erreichbar/);
  assert.match(p.text, /Tailscale/);
  assert.ok(p.detail);
  assert.doesNotMatch(p.detail ?? '', /tailnet/);
  assert.doesNotMatch(p.text, /java|example/);
  assert.equal(presentMessageError(m, en).text, en('chat.message.network.dns'));
  assert.notEqual(presentMessageError(m, es).text, presentMessageError(m, en).text);
});

test('every kind has a text in de/en/es; an unknown network detail still gets the generic text', () => {
  for (const kind of ['dns', 'timeout', 'refused', 'reset', 'tls', 'offline', 'unreachable'] as const) {
    for (const t of [de, en, es]) assert.notEqual(t(`chat.message.network.${kind}`), `chat.message.network.${kind}`);
  }
  const m = { error: 'x', errorText: { key: 'backends.hermes.errors.networkDetail' as const, params: { detail: 'something odd at box.example.com' } } };
  const p = presentMessageError(m, en);
  assert.equal(p.text, en('chat.message.network.unreachable'));
  assert.equal(p.detail, 'something odd at <host>');
});

test('unkeyed raw exception text (old messages / other paths) is mapped too; server text stays as is', () => {
  const p = presentMessageError({ error: REFUSED }, en);
  assert.equal(p.text, en('chat.message.network.refused'));
  assert.doesNotMatch(p.detail ?? '', /192\.0\.2/);
  assert.deepEqual(presentMessageError({ error: 'tool crashed' }, en), { text: 'tool crashed' });
  // other keyed errors untouched
  const k = { error: 'x', errorText: { key: 'backends.hermes.errors.agentFailed' as const } };
  assert.deepEqual(presentMessageError(k, en), { text: en('backends.hermes.errors.agentFailed') });
});

test('Hermes fetch failures are stored without the host (message error, params.detail)', async () => {
  const { hermesFetchFailure } = await import('./stream.ts');
  const e = hermesFetchFailure(new Error(REFUSED), false);
  assert.doesNotMatch(e.message, /example\.com|192\.0\.2/);
  assert.doesNotMatch(String(e.text?.params?.detail), /example\.com|192\.0\.2/);
  assert.equal(networkFailureKind(String(e.text?.params?.detail)), 'refused');
});
