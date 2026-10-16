import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { once } from 'node:events';
import { bearer, createAuth } from '../src/auth.mjs';
import { checkRequestPath, upstreamUrl } from '../src/paths.mjs';
import { splitProfilePath, isProfileName } from '../src/profiles.mjs';
import { sanitizeFilename } from '../src/uploads.mjs';
import { isPublicAddress, parseTarget, makeCheckedLookup } from '../src/image-proxy.mjs';
import { resumeOffset, createReplayStore } from '../src/replay.mjs';
import { createSseParser, createAssistantCollector } from '../src/sse.mjs';
import { SEEDS, ROUNDS, random, TEST_TOKEN } from './security-helpers.mjs';

for (const seed of SEEDS) {
  test(`seed=${seed}: auth parser never authenticates mutated credentials`, () => {
    const next = random(seed);
    const auth = createAuth({ token: TEST_TOKEN });
    for (let i = 0; i < ROUNDS; i++) {
      const token = TEST_TOKEN.slice(0, next(TEST_TOKEN.length)) + 'fake' + next(10000);
      for (const authorization of [`Bearer ${token}`, `Basic ${TEST_TOKEN}`, `Bearer ${TEST_TOKEN},${token}`, [token], null, {}]) {
        const req = { headers: { authorization } };
        assert.equal(auth.check(req), null, `iteration=${i}`);
      }
      const authorization = `${['Bearer', 'BEARER', 'bearer'][next(3)]}${[' ', '\t', '  '][next(3)]}${TEST_TOKEN} `;
      assert.equal(bearer({ headers: { authorization } }), TEST_TOKEN);
      assert.equal(auth.check({ headers: { authorization } }).kind, 'admin');
    }
  });

  test(`seed=${seed}: path and profile mutations cannot escape the upstream prefix`, () => {
    const next = random(seed);
    const segments = ['writer', 'reader', '..', '.', '%2e%2e', '%2F', '%252f', '%00', '%5c', '', 'WRITER', 'a'.repeat(65), '__proto__', 'constructor'];
    for (let i = 0; i < ROUNDS; i++) {
      const name = segments[next(segments.length)];
      const raw = `/p/${name}/${['v1/models', '../api/jobs', 'p/reader/v1/models', '%76%31/models'][next(4)]}`;
      const checked = checkRequestPath(raw);
      if (!checked.ok) continue;
      const target = upstreamUrl('http://example.com/prefix', raw);
      assert.equal(target.origin, 'http://example.com');
      assert.ok(target.pathname.startsWith('/prefix/p/'));
      assert.equal(target.pathname, '/prefix' + raw);
      const split = splitProfilePath(checked.path);
      if (!('error' in split)) {
        assert.equal(isProfileName(split.profile), true);
        assert.equal(split.path.startsWith('/p/'), false);
      }
    }
  });

  test(`seed=${seed}: upload names remain bounded single path components`, () => {
    const next = random(seed);
    const parts = ['../', '..\\', '%2f', '\0', '\r\n', '\u202e', '文', 'é', '.'.repeat(140), 'test', '💾', ':', '__proto__'];
    for (let i = 0; i < ROUNDS; i++) {
      const raw = Array.from({ length: 1 + next(30) }, () => parts[next(parts.length)]).join('');
      const safe = sanitizeFilename(raw);
      assert.ok(safe.length > 0);
      assert.ok(Buffer.byteLength(safe) <= 120);
      assert.doesNotMatch(safe, /[/\\\p{Cc}\p{Cf}]/u);
      assert.doesNotMatch(safe, /^[.\s-]|[.\s]$/u);
      assert.equal(sanitizeFilename(safe), safe);
    }
  });

  test(`seed=${seed}: SSRF refuses generated private IPv4, mapped IPv6 and unusual numeric URLs`, async () => {
    const next = random(seed);
    const networks = [[0x0a000000, 24], [0x7f000000, 24], [0xac100000, 20], [0xc0a80000, 16], [0x64400000, 22], [0xa9fe0000, 16]];
    for (let i = 0; i < ROUNDS; i++) {
      const [prefix, bits] = networks[next(networks.length)];
      const value = (prefix + next(2 ** bits)) >>> 0;
      const ip = [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
      const mapped = `::ffff:${(value >>> 16).toString(16)}:${(value & 65535).toString(16)}`;
      assert.equal(isPublicAddress(ip), false);
      assert.equal(isPublicAddress(mapped), false);
      for (const host of [ip, String(value), '0x' + value.toString(16), `[${mapped}]`]) {
        assert.equal(parseTarget(`https://${host}/test.png`).ok, false, `iteration=${i}`);
      }
      const lookup = makeCheckedLookup(async () => [
        { address: '93.184.215.14', family: 4 }, { address: ip, family: 4 },
      ], isPublicAddress);
      await new Promise((resolve) => lookup('img.example.com', { all: true }, (err) => {
        assert.equal(err?.code, 'EFORBIDDENADDR'); resolve();
      }));
    }
    for (const host of ['[::]', '[::1]', '[fc00::1]', '[fe80::1]', '[64:ff9b::1]', '[2002::1]', '[2001:db8::1]']) {
      assert.equal(parseTarget(`https://${host}/test.png`).ok, false);
    }
  });

  test(`seed=${seed}: resume offsets and replay byte slicing are exact across arbitrary chunks`, async () => {
    const next = random(seed);
    for (const invalid of ['-1', '1e9', '1.0', 'NaN', 'Infinity', '9007199254740993', '0x10', '', {}, ['1', '2']]) {
      assert.equal(resumeOffset({ 'x-hermes-ui-resume-offset': invalid }), null);
    }
    assert.equal(resumeOffset({}), undefined);
    for (let i = 0; i < ROUNDS; i++) {
      const body = Buffer.from('test: Grüß dich 🌍\n'.repeat(1 + next(30)));
      const store = createReplayStore();
      const turn = store.begin('test-scope', 'test-session');
      turn.start({ status: 200, headers: {} });
      for (let at = 0; at < body.length;) {
        const size = 1 + next(23); turn.append(body.subarray(at, at + size)); at += size;
      }
      turn.end();
      const offset = next(body.length + 1);
      assert.equal(resumeOffset({ 'x-hermes-ui-resume-offset': String(offset) }), offset);
      const got = [];
      const res = Object.assign(new Writable({ highWaterMark: 16, write(c, _e, done) { got.push(c); setImmediate(done); } }), { writeHead() {}, flushHeaders() {} });
      const finished = once(res, 'finish');
      assert.equal(turn.attach(res, offset), null);
      await finished;
      assert.deepEqual(Buffer.concat(got), body.subarray(offset));
      assert.equal(turn.attach({ writeHead() { assert.fail('huge offset was accepted'); } }, 999999999999999)?.status, 409);
      store.clear();
    }
  });

  test(`seed=${seed}: malicious SSE output obeys parser caps and preserves UTF-8 across chunking`, () => {
    const next = random(seed);
    for (let i = 0; i < ROUNDS; i++) {
      const events = [];
      const dropped = [];
      const parser = createSseParser((event) => events.push(event), { maxFrameChars: 64, onOversize: (info) => dropped.push(info) });
      const stream = Buffer.from('data: ' + 'fake'.repeat(100) + '\r\n\r\ndata: Grüß 🌍\r\n\r\n');
      for (let at = 0; at < stream.length;) {
        const size = 1 + next(43); parser.push(stream.subarray(at, at + size)); at += size;
      }
      parser.end();
      assert.deepEqual(events, [{ event: 'message', data: 'Grüß 🌍' }]);
      assert.equal(dropped.length, 1);
      assert.deepEqual(Object.keys(dropped[0]).sort(), ['chars', 'event']);
      const collector = createAssistantCollector(8);
      collector.push(Buffer.from('data: {"__proto__":{"polluted":true},"choices":[{"delta":{"content":"test text too long"}}]}\n\n'));
      assert.equal(collector.end(), 'test tex');
      assert.equal({}.polluted, undefined);
    }
  });
}
