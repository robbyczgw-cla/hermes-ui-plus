import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAIR_SCHEME, buildPairLink, buildWebPairLink, isHeaderSafeToken, isPairLink, isSafeModelId, parsePairLink, sanitizeName, toPairLink, webToPairLink } from './pairLink.ts';

// Parsing itself is flavor-independent (gating: flavor.test.ts).
const ok = (s: string) => {
  const r = parsePairLink(s, { flavor: 'personal' });
  assert.ok(r.ok, `expected ok: ${s} → ${JSON.stringify(r)}`);
  return r.pair;
};
const bad = (s: string | null | undefined) => {
  const r = parsePairLink(s, { flavor: 'personal' });
  assert.equal(r.ok, false, `expected error: ${s}`);
  return (r as { error: string }).error;
};

test('parses an encoded pair link', () => {
  const p = ok('hermesui://pair?u=https%3A%2F%2Fhermes.example.org%3A8790%2Fv1&t=abc.DEF-123_%2B%2F%3D&n=Hermes%20zu%20Hause');
  assert.equal(p.baseUrl, 'https://hermes.example.org:8790/v1');
  assert.equal(p.token, 'abc.DEF-123_+/=');
  assert.equal(p.name, 'Hermes zu Hause');
  assert.equal(p.nameFromLink, true);
});


test('lenient forms: unencoded url, literal + in token, extra slash, link inside pasted text, uppercase scheme', () => {
  assert.equal(ok('hermesui://pair?u=https://h.example.org&t=a+b').token, 'a+b');
  assert.equal(ok('hermesui:///pair?u=h.example.org').baseUrl, 'https://h.example.org/v1');
  assert.equal(ok('hermesui://pair/?u=h.example.org').baseUrl, 'https://h.example.org/v1');
  assert.equal(ok('Kopplung: hermesui://pair?u=h.example.org&n=X+Y, viel Spaß').name, 'X Y');
  assert.equal(ok('HERMESUI://pair?u=h.example.org').baseUrl, 'https://h.example.org/v1');
  assert.equal(ok('hermesui://pair?u=h.example.org&v=1&extra=ignored').baseUrl, 'https://h.example.org/v1');
});

test('token and name are optional; name falls back to host', () => {
  const p = ok('hermesui://pair?u=http%3A%2F%2F10.0.0.5%3A8645');
  assert.equal(p.token, '');
  assert.equal(p.name, '10.0.0.5:8645');
  assert.equal(p.nameFromLink, false);
});

test('rejects hostile and malformed links', () => {
  assert.equal(bad(''), 'empty');
  assert.equal(bad(null), 'empty');
  assert.equal(bad('https://example.org/pair?u=x'), 'not-pair-link');
  assert.equal(bad('hermesui://settings?u=h.example.org'), 'not-pair-link');
  assert.equal(bad('hermesui://pair'), 'missing-url');
  assert.equal(bad('hermesui://pair?t=abc'), 'missing-url');
  assert.equal(bad('hermesui://pair?u=%E0%A4%A'), 'bad-encoding');
  assert.equal(bad('hermesui://pair?u=h.example.org&u=evil.example'), 'duplicate-param');
  assert.equal(bad('hermesui://pair?u=h.example.org&v=2'), 'unsupported-version');
  assert.equal(bad('hermesui://pair?u=javascript%3Aalert(1)'), 'url-scheme');
  assert.equal(bad('hermesui://pair?u=file%3A%2F%2F%2Fetc%2Fpasswd'), 'url-scheme');
  assert.equal(bad('hermesui://pair?u=https%3A%2F%2Fa%3Ab%40h.example.org'), 'url-credentials');
  assert.equal(bad('hermesui://pair?u=h.example.org&t=abc%0D%0AX-Evil%3A%201'), 'bad-token');
  assert.equal(bad('hermesui://pair?u=h.example.org&t=a%20b'), 'bad-token');
  assert.equal(bad('hermesui://pair?u=h.example.org&t=t%C3%B6ken'), 'bad-token');
  assert.equal(bad(`hermesui://pair?u=h.example.org&t=${'a'.repeat(1025)}`), 'bad-token');
  assert.equal(bad(`hermesui://pair?u=h.example.org&n=${'a'.repeat(5000)}`), 'too-long');
  assert.equal(bad('x'.repeat(10000)), 'too-long');
});

test('sanitizes the display name (bidi/zero-width/control, length)', () => {
  assert.equal(sanitizeName('  Mein‮ Hermes\u0000\n '), 'Mein Hermes');
  assert.equal(sanitizeName('a​b'), 'a b');
  assert.equal(sanitizeName('⁦⁩'), '');
  const long = sanitizeName('x'.repeat(100));
  assert.equal(Array.from(long).length, 48);
  assert.ok(long.endsWith('…'));
  // surrogate pairs are not split
  assert.ok(!sanitizeName('😀'.repeat(60)).includes('�'));
  const p = ok('hermesui://pair?u=h.example.org&n=%E2%80%AE%E2%80%AE');
  assert.equal(p.name, 'h.example.org');
  assert.equal(p.nameFromLink, false);
});

test('isHeaderSafeToken', () => {
  assert.ok(isHeaderSafeToken('sk-abc_DEF.123+/='));
  assert.ok(!isHeaderSafeToken(''));
  assert.ok(!isHeaderSafeToken('a b'));
  assert.ok(!isHeaderSafeToken('a\nb'));
  assert.ok(!isHeaderSafeToken('ä'));
});

test('isPairLink / toPairLink (+native-intent paths)', () => {
  assert.ok(isPairLink('hermesui://pair?u=x'));
  assert.ok(!isPairLink('hermesui://chat'));
  assert.ok(!isPairLink(undefined));
  assert.equal(toPairLink('hermesui://pair?u=x&t=y'), 'hermesui://pair?u=x&t=y');
  assert.equal(toPairLink('/pair?u=x'), `${PAIR_SCHEME}://pair?u=x`);
  assert.equal(toPairLink('pair?u=x'), `${PAIR_SCHEME}://pair?u=x`);
  assert.equal(toPairLink('/pair'), `${PAIR_SCHEME}://pair`);
  assert.equal(toPairLink('/settings'), null);
  assert.equal(toPairLink('/pairing?u=x'), null);
  assert.equal(toPairLink('text hermesui://pair?u=x'), null);
  assert.equal(toPairLink(null), null);
});

// ── model / web-app extensions ─────────────────────────────────────────────────────

test('old links get the defaults of the new fields', () => {
  const p = ok('hermesui://pair?u=h.example.org&t=abc&n=Home');
  assert.equal(p.kind, 'hermes');
  assert.equal(p.model, '');
  assert.equal(p.sameOrigin, false);
});




test('rejects bad kind / model', () => {
  assert.equal(bad('hermesui://pair?u=h.example.org&kind=claude'), 'unsupported-kind');
  assert.equal(bad('hermesui://pair?u=h.example.org&m=a%20b'), 'bad-model');
  assert.equal(bad('hermesui://pair?u=h.example.org&m=x&m=y'), 'duplicate-param');
  assert.equal(bad(`hermesui://pair?u=h.example.org&m=${'a'.repeat(201)}`), 'bad-model');
  assert.ok(isSafeModelId('agents/kiwi'));
  assert.ok(!isSafeModelId('tëfy'));
});


test('web-app form https://host/#pair?…', () => {
  const href = 'https://claw.example.ts.net/#pair?u=https%3A%2F%2Fclaw.example.ts.net%2Fv1&t=abc&m=kiwi';
  assert.equal(webToPairLink(href), `${PAIR_SCHEME}://pair?u=https%3A%2F%2Fclaw.example.ts.net%2Fv1&t=abc&m=kiwi`);
  assert.equal(toPairLink(href), webToPairLink(href));
  assert.equal(toPairLink('https://h.example.org/app/#/pair?u=x'), `${PAIR_SCHEME}://pair?u=x`);
  assert.ok(isPairLink(href));
  assert.equal(ok(href).model, 'kiwi');
  assert.equal(ok(`Hier dein Link: ${href}.`).token, 'abc');
  assert.equal(toPairLink('https://h.example.org/#settings'), null);
  assert.equal(toPairLink('https://h.example.org/pair?u=x'), null);
  const web = buildWebPairLink('https://claw.example.ts.net/#old', { url: '/v1', token: 'abc', model: 'kiwi' });
  assert.equal(web, 'https://claw.example.ts.net/#pair?u=%2Fv1&t=abc&m=kiwi');
});

test('same-origin: missing or relative u= resolves against the page origin', () => {
  const origin = 'https://claw.example.ts.net';
  const a = parsePairLink('hermesui://pair?t=abc', { origin, flavor: 'personal' });
  assert.ok(a.ok);
  assert.equal(a.ok && a.pair.baseUrl, 'https://claw.example.ts.net/v1');
  assert.equal(a.ok && a.pair.sameOrigin, true);
  const b = parsePairLink('hermesui://pair?u=%2Fapi%2Fv1', { origin, flavor: 'personal' });
  assert.equal(b.ok && b.pair.baseUrl, 'https://claw.example.ts.net/api/v1');
  // without an origin (native) the old rules apply
  assert.equal(bad('hermesui://pair?t=abc'), 'missing-url');
  // protocol-relative / junk origins are not used
  const pr = parsePairLink('hermesui://pair?u=%2F%2Fevil.example', { origin, flavor: 'personal' });
  assert.equal(pr.ok && pr.pair.sameOrigin, false);
  const c = parsePairLink('hermesui://pair?t=abc', { origin: 'javascript:alert(1)', flavor: 'personal' });
  assert.equal(c.ok ? 'ok' : c.error, 'missing-url');
  // an absolute u= wins over the origin
  const d = parsePairLink('hermesui://pair?u=https%3A%2F%2Fother.example.org', { origin, flavor: 'personal' });
  assert.equal(d.ok && d.pair.sameOrigin, false);
});

test('takeWebPairHash: extracts the link and strips the fragment', async () => {
  const { takeWebPairHash } = await import('./pairLink.ts');
  const r = takeWebPairHash('https://app.example.org/sub/?x=1#pair?u=%2Fv1&t=tok_test_000');
  assert.ok(r);
  assert.equal(r.cleanUrl, 'https://app.example.org/sub/?x=1');
  assert.equal(r.link, `${PAIR_SCHEME}://pair?u=%2Fv1&t=tok_test_000`);
  assert.equal(takeWebPairHash('https://app.example.org/#/pair?t=tok_test_000')?.cleanUrl, 'https://app.example.org/');
  // a malformed / oversized pair fragment is still removed (link null)
  const long = takeWebPairHash(`https://app.example.org/#pair?t=${'x'.repeat(5000)}`);
  assert.equal(long?.link, null);
  assert.equal(long?.cleanUrl, 'https://app.example.org/');
  // anything else is left alone
  assert.equal(takeWebPairHash('https://app.example.org/#settings'), null);
  assert.equal(takeWebPairHash('https://app.example.org/#pairing'), null);
  assert.equal(takeWebPairHash('https://app.example.org/'), null);
  assert.equal(takeWebPairHash(undefined), null);
});

test('one-time code links (c=): parsed, no token; legacy t= still works; c+t or a bogus code is refused', () => {
  const p = ok('hermesuiplus://pair?u=https%3A%2F%2Fbridge.example.org%2Fhermes%2Fv1&c=pc_test_000000000000&n=Hermes');
  assert.equal(p.code, 'pc_test_000000000000');
  assert.equal(p.token, '');
  assert.equal(p.baseUrl, 'https://bridge.example.org/hermes/v1');
  assert.equal(ok('hermesui://pair?u=h.example.org&t=legacy_test_token').code, '');
  assert.equal(ok('hermesui://pair?u=h.example.org&t=legacy_test_token').token, 'legacy_test_token');
  assert.equal(bad('hermesui://pair?u=h.example.org&c=pc_test_000000&t=tok_test'), 'bad-code');
  assert.equal(bad('hermesui://pair?u=h.example.org&c='), 'bad-code');
  assert.equal(bad('hermesui://pair?u=h.example.org&c=abc'), 'bad-code');
  assert.equal(bad('hermesui://pair?u=h.example.org&c=pc%22test%5C000'), 'bad-code');
  assert.equal(bad(`hermesui://pair?u=h.example.org&c=${'a'.repeat(257)}`), 'bad-code');
  // web form and round trip
  const web = parsePairLink('https://app.example.org/#pair?u=https%3A%2F%2Fapp.example.org%2Fv1&c=pc_test_111111111111', { flavor: 'personal' });
  assert.ok(web.ok && web.pair.code === 'pc_test_111111111111' && web.pair.token === '');
  const built = buildPairLink({ url: 'https://h.example.org/v1', code: 'pc_test_222222222222', name: 'X' });
  assert.match(built, /[?&]c=pc_test_222222222222/);
  assert.doesNotMatch(built, /[?&]t=/);
  assert.equal(ok(built).code, 'pc_test_222222222222');
});
