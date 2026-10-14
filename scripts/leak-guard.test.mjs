// Unit + CLI tests for scripts/leak-guard.mjs with synthetic samples only (nothing real).
// Samples are assembled at runtime so that this file itself passes `leak-guard --tree`.
//   node --test scripts/leak-guard.test.mjs
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { dmgSignatureRange, isBinary, isSignaturePath, isTestPath, loadAllowList, machoSignatureRanges, makeScanner, mask, parseDenylist } from './leak-guard.mjs';

const script = fileURLToPath(new URL('./leak-guard.mjs', import.meta.url));
const j = (...p) => p.join('');
const tmps = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'lg-test-'));
  tmps.push(d);
  return d;
};
after(() => tmps.forEach((d) => rmSync(d, { recursive: true, force: true })));

const DENY = ['zorblax', 'cs:Quux', 're:\\bag-9999[0-9a-z-]*', '10.77.', '# comment', ''].join('\n');
const scan = (path, text, opts = {}) => makeScanner({ denylist: parseDenylist(DENY), ...opts }).scanContent(path, Buffer.from(text));
const rules = (fs) => fs.map((f) => f.rule.split('(')[0]);

// samples
const TS_HOST = j('box.mynet', '.ts', '.net');
const CGNAT = j('100', '.64.', '3.4');
const CGNAT_HIGH = j('100', '.127.', '0.1');
const NOT_CGNAT = j('100', '.128.', '0.1');
const LAN = j('192', '.168.', '1.20');
const LAN10 = j('10', '.1.', '2.3');
const LAN172 = j('172', '.20.', '0.5');
const EMAIL = j('bob', '@', 'corp', '.io');

test('parseDenylist: comments, blanks, boundaries, cs:, re:', () => {
  const r = parseDenylist(DENY);
  assert.equal(r.length, 4);
  assert.throws(() => parseDenylist('re:(unclosed'), /denylist line 1/);
});

test('denylist: case-insensitive, word-bounded, regex, case-sensitive', () => {
  assert.deepEqual(rules(scan('a.ts', 'host = ZorBlax;')), ['denylist#1']);
  assert.equal(scan('a.ts', 'the zorblaxes are fine').length, 0, 'no match inside a longer word');
  assert.equal(scan('a.ts', 'x_zorblax_y').length, 1, 'underscore is not alnum');
  assert.equal(scan('a.ts', 'Quux and quux').length, 1, 'cs: only exact case');
  assert.equal(scan('a.ts', 'group ag-9999-abc-1 here').length, 1);
  assert.equal(scan('a.ts', 'ip 10.77.3.4').filter((f) => f.rule.startsWith('denylist')).length, 1);
  assert.equal(scan('a.ts', 'ip 110.77.3.4').filter((f) => f.rule.startsWith('denylist')).length, 0, 'leading boundary on digit edge');
});

test('denylist applies to file names too', () => {
  const f = scan('docs/ZORBLAX-notes.md', 'clean content');
  assert.equal(f.length, 1);
  assert.equal(f[0].where, 'path');
});

test('findings carry line/col and are masked by mask()', () => {
  const [f] = scan('a.ts', 'ok\n  zorblax');
  assert.equal(f.line, 2);
  assert.equal(f.col, 3);
  assert.equal(mask('zorblax'), 'zo***[7]');
  assert.equal(mask('ab'), '***');
});

test('generic: tailnet hosts', () => {
  assert.deepEqual(rules(scan('a.ts', `url https://${TS_HOST}/v1`)), ['generic:tailnet-host']);
  for (const ok of ['host.example.ts.net', 'example.ts.net', '<host>.<tailnet>.ts.net', '${HOST}.ts.net', '*.ts.net', 'any *.ts.net host'])
    assert.equal(scan('a.md', ok).length, 0, ok);
});

test('generic: CGNAT 100.64/10', () => {
  assert.deepEqual(rules(scan('a.ts', `ip ${CGNAT}`)), ['generic:cgnat-ip']);
  assert.equal(scan('a.ts', `ip ${CGNAT_HIGH}`).length, 1);
  assert.equal(scan('a.ts', `ip ${NOT_CGNAT}`).length, 0);
  assert.equal(scan('a.ts', 'magic dns 100.100.100.100').length, 0);
  assert.equal(scan('a.md', 'range 100.64.0.0/10 is CGNAT').length, 0, 'CIDR notation is documentation');
  assert.equal(scan('a.ts', 'version 1.100.64.2.3').length, 0);
  assert.equal(scan('test/a.test.ts', `ip ${CGNAT}`).length, 1, 'CGNAT is flagged in tests too');
  assert.equal(scan('a.ts', j('v6 fd7a', ':115c:a1e0::1')).length, 1);
});

test('generic: RFC1918 only in non-test code', () => {
  for (const ip of [LAN, LAN10, LAN172]) {
    assert.deepEqual(rules(scan('src/net.ts', `host ${ip}`)), ['generic:private-ip']);
    assert.equal(scan('src/net.test.ts', `host ${ip}`).length, 0);
    assert.equal(scan('app/test/x.mjs', `host ${ip}`).length, 0);
  }
  assert.equal(scan('src/net.ts', 'emulator 10.0.2.2').length, 0);
  assert.equal(scan('src/net.ts', 'localhost 127.0.0.1 and 8.8.8.8').length, 0);
  assert.equal(scan('src/net.ts', '172.32.0.1').length, 0, '172.32 is not RFC1918');
  assert.equal(scan('src/net.ts', '999.168.1.1').length, 0);
});

test('generic: e-mail addresses', () => {
  assert.deepEqual(rules(scan('a.md', `contact ${EMAIL}`)), ['generic:email']);
  for (const ok of ['me@example.com', 'a@b.example.org', 'noreply@anthropic.com', 'no-reply@x.io', '1+2@users.noreply.github.com', 'git@github.com:o/r.git', 'icon@2x.png', 'x@3x.webp', 'file@bar.mjs', 'pkg@1.2.3', '@scope/pkg'])
    assert.equal(scan('a.md', ok).length, 0, ok);
});

test('inline allow marker and allow regexes', () => {
  assert.equal(scan('a.md', `${EMAIL} leak-guard:allow`).length, 0);
  assert.equal(scan('a.md', `${EMAIL}`, { allow: [/corp\.io$/i] }).length, 0);
  assert.equal(scan('a.md', 'zorblax', { allow: [/^zorblax$/i] }).length, 0);
});

test('lockfiles: only e-mail checked, no version-number IP noise', () => {
  assert.equal(scan('app/package-lock.json', '"version": "10.1.2.3"').length, 0);
});

test('binary: strings in ASCII and UTF-16LE are found, deduplicated; media skips e-mail noise', () => {
  const ascii = Buffer.concat([Buffer.from([0, 1, 2, 255]), Buffer.from('zorblax'), Buffer.from([0, 0]), Buffer.from('zorblax'), Buffer.from([0, 9])]);
  assert.ok(isBinary(ascii));
  const f = scan('lib/x.so', '');
  assert.equal(f.length, 0);
  const fa = makeScanner({ denylist: parseDenylist(DENY) }).scanContent('lib/x.so', ascii);
  assert.equal(fa.length, 1);
  assert.equal(fa[0].count, 2);
  const u16 = Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('zorblax', 'utf16le'), Buffer.from([0, 0, 1])]);
  assert.equal(makeScanner({ denylist: parseDenylist(DENY) }).scanContent('resources.arsc', u16).length, 1);
  const u16odd = Buffer.concat([Buffer.from([7, 0, 1, 2, 9]), Buffer.from('zorblax', 'utf16le'), Buffer.from([0, 0, 1])]);
  assert.equal(makeScanner({ denylist: parseDenylist(DENY) }).scanContent('resources.arsc', u16odd).length, 1, 'odd alignment');
  const media = Buffer.concat([Buffer.from([0, 1]), Buffer.from(` ${EMAIL} `), Buffer.from([0, 2])]);
  assert.equal(makeScanner({}).scanContent('a.png', media).length, 0);
  assert.equal(makeScanner({}).scanContent('classes.dex', media).length, 1);
});

test('isTestPath', () => {
  for (const p of ['a/test/b.mjs', 'a/tests/b.mjs', 'a/__tests__/b.ts', 'a/b.test.ts', 'a/b.spec.mjs', 'a/fixtures/x.json']) assert.ok(isTestPath(p), p);
  for (const p of ['a/latest/b.ts', 'a/testing.ts', 'a/contest.mjs']) assert.ok(!isTestPath(p), p);
});

test('MP4: isolated four-byte compressed noise is filtered, metadata and readable payloads still scan', () => {
  const box = (type, payload) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(payload.length + 8);
    header.write(type, 4, 4, 'latin1');
    return Buffer.concat([header, payload]);
  };
  const track = (codec, handler = 'vide') => {
    const hdlr = Buffer.alloc(12);
    hdlr.write(handler, 8, 4);
    const entry = box(codec, Buffer.alloc(handler === 'vide' ? 78 : 28));
    const head = Buffer.alloc(8);
    head.writeUInt32BE(1, 4);
    const stsd = box('stsd', Buffer.concat([head, entry]));
    return box('trak', box('mdia', Buffer.concat([box('hdlr', hdlr), box('minf', box('stbl', stsd))])));
  };
  const movie = (payload, { codecs = [['avc1', 'vide'], ['mp4a', 'soun']], metadata = Buffer.alloc(0) } = {}) =>
    Buffer.concat([
      box('ftyp', Buffer.from('isom\0\0\0\0isom')),
      box('moov', Buffer.concat([...codecs.map(([c, h]) => track(c, h)), box('udta', metadata)])),
      box('mdat', payload),
    ]);
  const word = 'z'.repeat(4); // obviously fake short denylist term
  const scanner = makeScanner({ denylist: parseDenylist(word), signature: true });
  const noise = Buffer.concat([Buffer.from([0, 255]), Buffer.from(word), Buffer.from([0, 255])]);
  assert.equal(scanner.scanContent('clip.mp4', movie(noise)).length, 0);
  const metadata = movie(noise, { metadata: noise });
  const found = scanner.scanContent('clip.mp4', metadata);
  assert.equal(found.length, 1, 'short metadata is not filtered');
  assert.equal(found[0].offset, metadata.indexOf(Buffer.from(word)), 'binary offsets refer to the original bytes');
  assert.equal(scanner.scanContent('clip.mp4', movie(Buffer.from(`\0Readable text: ${word}\0`))).length, 1);
  assert.equal(scanner.scanContent('clip.mp4', movie(Buffer.from(`\0${word}\0`, 'utf16le'))).length, 1);
  assert.equal(scanner.scanContent('clip.mp4', movie(noise, { codecs: [['tx3g', 'text']] })).length, 1, 'subtitles scan fully');
  assert.equal(scanner.scanContent('clip.mp4', movie(noise, { codecs: [['fake', 'vide']] })).length, 1, 'unknown codecs scan fully');
  assert.equal(scanner.scanContent(`${word}.mp4`, movie(noise)).length, 1, 'filenames scan fully');
  assert.equal(scanner.scanContent('clip.mp4', movie(noise).subarray(0, -1)).length, 1, 'truncation falls back to a full scan');
  assert.equal(scanner.scanContent('clip.mp4', noise).length, 1, 'an extension alone cannot activate filtering');
});

// ---- CLI ----------------------------------------------------------------------------------------------
function run(args, { env = {}, cwd } = {}) {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd, env: { PATH: process.env.PATH, HOME: tmp(), ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
function fixtureDir() {
  const d = tmp();
  mkdirSync(join(d, 'sub'));
  writeFileSync(join(d, 'clean.txt'), 'nothing to see\n');
  writeFileSync(join(d, 'sub', 'leak.txt'), `line1\nconnect to ${TS_HOST} now\n`);
  return d;
}
function privateDir() {
  const d = tmp();
  writeFileSync(join(d, 'leak-denylist.txt'), 'zorblax\n');
  return d;
}

test('CLI --path: findings exit 1, masked by default, --show reveals, clean exits 0', () => {
  const d = fixtureDir();
  const r = run(['--path', d, '--generic-only']);
  assert.equal(r.code, 1);
  assert.match(r.err, /sub\/leak\.txt:2:12\s+\[generic:tailnet-host\]/);
  assert.ok(!r.err.includes(TS_HOST), 'host must be masked in output');
  assert.ok(run(['--path', d, '--generic-only', '--show']).err.includes(TS_HOST));
  const clean = tmp();
  writeFileSync(join(clean, 'a.txt'), 'hello\n');
  assert.equal(run(['--path', clean, '--generic-only']).code, 0);
});

test('CLI denylist: HUI_PRIVATE_DIR file is used; missing file warns and runs generic only; --require-denylist errors', () => {
  const d = tmp();
  writeFileSync(join(d, 'a.txt'), 'zorblax is here\n');
  const withList = run(['--path', d], { env: { HUI_PRIVATE_DIR: privateDir() } });
  assert.equal(withList.code, 1);
  assert.match(withList.err, /denylist#1/);
  const missing = run(['--path', d], { env: { HUI_PRIVATE_DIR: tmp() } });
  assert.equal(missing.code, 0);
  assert.match(missing.err, /WARNING: no denylist/);
  const req = run(['--path', d, '--require-denylist'], { env: { HUI_PRIVATE_DIR: tmp() } });
  assert.equal(req.code, 2);
});

test('CLI errors never pass silently: bad args, missing path, invalid denylist', () => {
  assert.equal(run(['--bogus']).code, 2);
  assert.equal(run([]).code, 2);
  assert.equal(run(['--path', '/nonexistent-dir-for-leak-guard']).code, 2);
  const p = tmp();
  writeFileSync(join(p, 'leak-denylist.txt'), 're:(broken\n');
  const d = tmp();
  writeFileSync(join(d, 'a.txt'), 'x\n');
  assert.equal(run(['--path', d], { env: { HUI_PRIVATE_DIR: p } }).code, 2);
  assert.equal(run(['--staged'], { cwd: tmp() }).code, 2, 'not a git repo');
});

test('CLI --staged / --tree / --tree --ref in a scratch git repo', () => {
  const repo = tmp();
  const g = (...a) => execFileSync('git', a, { cwd: repo, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }, stdio: 'pipe' });
  g('init', '-q');
  g('config', 'user.email', 'ci@example.com');
  g('config', 'user.name', 'ci');
  writeFileSync(join(repo, 'ok.txt'), 'fine\n');
  g('add', 'ok.txt');
  assert.equal(run(['--staged', '--generic-only'], { cwd: repo }).code, 0);
  writeFileSync(join(repo, 'bad.txt'), `host ${TS_HOST}\n`);
  assert.equal(run(['--staged', '--generic-only'], { cwd: repo }).code, 0, 'untracked/unstaged files are not scanned');
  g('add', 'bad.txt');
  const staged = run(['--staged', '--generic-only'], { cwd: repo });
  assert.equal(staged.code, 1);
  assert.match(staged.err, /bad\.txt:1:6/);
  // staged blob is what counts, not the working tree
  writeFileSync(join(repo, 'bad.txt'), 'cleaned afterwards\n');
  assert.equal(run(['--staged', '--generic-only'], { cwd: repo }).code, 1);
  assert.equal(run(['--tree', '--generic-only'], { cwd: repo }).code, 0, 'tree = tracked files, working tree content');
  g('commit', '-qm', 'x');
  assert.equal(run(['--tree', '--ref', 'HEAD', '--generic-only'], { cwd: repo }).code, 1, 'committed blob still leaks');
  assert.equal(run(['--tree', '--ref', 'nope', '--generic-only'], { cwd: repo }).code, 2);
  const json = JSON.parse(run(['--tree', '--ref', 'HEAD', '--generic-only', '--json'], { cwd: repo }).out);
  assert.equal(json.findings.length, 1);
  assert.ok(!JSON.stringify(json).includes(TS_HOST));
});

// ---- code signatures (artifact scans): synthetic Mach-O with an LC_CODE_SIGNATURE SuperBlob --------------
// layout: header | load commands | __TEXT-like content with a string | signature blob with a string
function machO({ content = 'app text', sig = 'Apple Development: nobody', bigEndian = false, blobMagic = 0xfade0cc0 } = {}) {
  const hdr = 32;
  const cmds = [
    [0x26, 16, 0, 0], // LC_FUNCTION_STARTS (linkedit_data_command, irrelevant)
    [0x1d, 16, 0, 0], // LC_CODE_SIGNATURE: dataoff/datasize filled in below
  ];
  const sizeofcmds = cmds.reduce((n, c) => n + c[1], 0);
  const contentBuf = Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from(content), Buffer.alloc(8)]);
  const blob = Buffer.concat([Buffer.alloc(12), Buffer.from(sig), Buffer.alloc(4)]);
  blob.writeUInt32BE(blobMagic, 0);
  blob.writeUInt32BE(blob.length, 4);
  const dataoff = hdr + sizeofcmds + contentBuf.length;
  cmds[1][2] = dataoff;
  cmds[1][3] = blob.length;
  const head = Buffer.alloc(hdr + sizeofcmds);
  const w = (v, o) => (bigEndian ? head.writeUInt32BE(v, o) : head.writeUInt32LE(v, o));
  head.writeUInt32LE(bigEndian ? 0xcffaedfe : 0xfeedfacf, 0); // magic as stored on disk
  w(0x0100000c, 4);
  w(2, 12);
  w(cmds.length, 16);
  w(sizeofcmds, 20);
  let o = hdr;
  for (const c of cmds) {
    c.forEach((v, i) => w(v, o + i * 4));
    o += c[1];
  }
  return { buf: Buffer.concat([head, contentBuf, blob]), sigRange: [dataoff, dataoff + blob.length] };
}

function fat(slices, is64 = false) {
  const entry = is64 ? 32 : 20;
  const align = 64;
  let off = Math.ceil((8 + slices.length * entry) / align) * align;
  const head = Buffer.alloc(off);
  head.writeUInt32BE(is64 ? 0xcafebabf : 0xcafebabe, 0);
  head.writeUInt32BE(slices.length, 4);
  const parts = [head];
  const offs = [];
  slices.forEach((s, i) => {
    const e = 8 + i * entry;
    head.writeUInt32BE(0x0100000c, e);
    if (is64) {
      head.writeBigUInt64BE(BigInt(off), e + 8);
      head.writeBigUInt64BE(BigInt(s.length), e + 16);
    } else {
      head.writeUInt32BE(off, e + 8);
      head.writeUInt32BE(s.length, e + 12);
    }
    offs.push(off);
    const pad = Math.ceil(s.length / align) * align;
    parts.push(s, Buffer.alloc(pad - s.length));
    off += pad;
  });
  return { buf: Buffer.concat(parts), offs };
}

const SIG_NAME = j('Apple Development: Zorb', 'lax Quux (TEAM0000)');

test('machoSignatureRanges: thin LE/BE, fat 32/64, malformed and non-Mach-O give []', () => {
  const t = machO({ sig: SIG_NAME });
  assert.deepEqual(machoSignatureRanges(t.buf), [t.sigRange]);
  const be = machO({ sig: SIG_NAME, bigEndian: true });
  assert.deepEqual(machoSignatureRanges(be.buf), [be.sigRange]);
  for (const is64 of [false, true]) {
    const a = machO({ sig: SIG_NAME });
    const b = machO({ sig: SIG_NAME, content: 'other slice' });
    const f = fat([a.buf, b.buf], is64);
    assert.deepEqual(machoSignatureRanges(f.buf), [
      [f.offs[0] + a.sigRange[0], f.offs[0] + a.sigRange[1]],
      [f.offs[1] + b.sigRange[0], f.offs[1] + b.sigRange[1]],
    ]);
  }
  assert.deepEqual(machoSignatureRanges(machO({ blobMagic: 0x12345678 }).buf), [], 'not a SuperBlob: nothing excluded');
  const java = Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 0x34, 1, 2, 3, 4]);
  assert.deepEqual(machoSignatureRanges(java), [], 'Java .class shares the fat magic');
  const cut = machO().buf.subarray(0, 40);
  assert.deepEqual(machoSignatureRanges(cut), [], 'truncated load commands');
  assert.deepEqual(machoSignatureRanges(Buffer.from('plain text file')), []);
});

test('signature option: Mach-O signature blob and signature files are skipped, app content is still scanned', () => {
  const sigOnly = machO({ content: 'clean app strings', sig: SIG_NAME }).buf;
  const both = machO({ content: 'api host zorblax here', sig: SIG_NAME }).buf;
  const sc = (path, buf, signature) => makeScanner({ denylist: parseDenylist(DENY), signature }).scanContent(path, buf);
  assert.ok(sc('X.app/X', sigOnly, false).length >= 1, 'without the option the signature strings are findings');
  assert.equal(sc('X.app/X', sigOnly, true).length, 0, 'with it the signature blob is allowed');
  assert.deepEqual(rules(sc('X.app/X', both, true)), ['denylist#1'], 'content outside the blob is still found');
  const f = fat([machO({ sig: SIG_NAME }).buf, machO({ content: 'zorblax in arm64 slice', sig: SIG_NAME }).buf]);
  assert.deepEqual(rules(sc('X.app/Frameworks/Y.framework/Y', f.buf, true)), ['denylist#1']);
  // a load command that points at non-signature bytes does not hide them
  assert.ok(sc('X.app/X', machO({ sig: SIG_NAME, blobMagic: 0x11111111 }).buf, true).length >= 1);
  for (const p of ['Payload/X.app/_CodeSignature/CodeResources', 'Payload/X.app/embedded.mobileprovision', 'Payload/X.app/Frameworks/Y.framework/_CodeSignature/CodeResources', 'Payload/X.app/PlugIns/W.appex/embedded.mobileprovision']) {
    assert.ok(isSignaturePath(p), p);
    assert.equal(sc(p, Buffer.from(`zorblax ${SIG_NAME}`), true).length, 0, p);
    assert.equal(sc(p, Buffer.from(`zorblax ${SIG_NAME}`), false).length > 0, true, 'default (repo scans): not skipped');
  }
  for (const p of ['Payload/X.app/Info.plist', 'Payload/X.app/main.jsbundle', 'Payload/X.app/CodeSignatureNotes.txt', 'mobileprovision.md']) {
    assert.ok(!isSignaturePath(p), p);
    assert.equal(sc(p, Buffer.from('zorblax'), true).length, 1, p);
  }
});

test('CLI --path (artifact): signature data passes, app content in the same binary fails', () => {
  const d = tmp();
  const app = join(d, 'Payload', 'X.app');
  mkdirSync(join(app, '_CodeSignature'), { recursive: true });
  writeFileSync(join(app, 'embedded.mobileprovision'), `profile for ${SIG_NAME}`);
  writeFileSync(join(app, '_CodeSignature', 'CodeResources'), `<string>${SIG_NAME}</string>`);
  writeFileSync(join(app, 'X'), machO({ content: 'clean', sig: SIG_NAME }).buf);
  writeFileSync(join(app, 'main.jsbundle'), 'var a=1;');
  const p = tmp();
  writeFileSync(join(p, 'leak-denylist.txt'), DENY);
  const ok = run(['--path', d, '--require-denylist'], { env: { HUI_PRIVATE_DIR: p } });
  assert.equal(ok.code, 0, ok.err);
  assert.match(ok.err, /2 code-signature file\(s\) skipped/);
  writeFileSync(join(app, 'X'), machO({ content: 'host zorblax', sig: SIG_NAME }).buf);
  assert.equal(run(['--path', d, '--require-denylist'], { env: { HUI_PRIVATE_DIR: p } }).code, 1);
  writeFileSync(join(app, 'X'), machO({ content: 'clean', sig: SIG_NAME }).buf);
  writeFileSync(join(app, 'Info.plist'), '<string>zorblax</string>');
  assert.equal(run(['--path', d, '--require-denylist'], { env: { HUI_PRIVATE_DIR: p } }).code, 1, 'plist strings stay strict');
});

test('artifact scans (--path / signature mode) ignore inline leak-guard:allow markers', () => {
  const marker = j('leak-guard', ':allow');
  // source scan: the marker suppresses its line
  assert.equal(scan('a.js', `x("${TS_HOST}") // ${marker}`).length, 0);
  // artifact: a minified one-line bundle containing the marker as data must still report the host
  assert.equal(rules(scan('bundle.js', `var a="${marker}",b="${TS_HOST}";`, { signature: true })).includes('generic:tailnet-host'), true);
  const d = tmp();
  writeFileSync(join(d, 'bundle.js'), `var a="${marker}",b="${TS_HOST}";`);
  assert.equal(run(['--path', d, '--generic-only']).code, 1);
});

test('span: allow entries allow findings only inside the exact allowed string', () => {
  const dir = tmp();
  writeFileSync(join(dir, '.leak-guard-allow'), '# deliberately published contact\nspan:\\bfakeperson@fake-example\\.test\\b\n');
  const allow = loadAllowList(dir, { HUI_PRIVATE_DIR: join(dir, 'none') });
  assert.equal(allow.length, 1);
  assert.equal(allow[0].span, true);
  const scanner = makeScanner({ denylist: parseDenylist('fakeperson\n'), allow });
  const at = j('@', 'fake-example.test'); // split so this file does not trip the scanner itself
  const line = `Mail: fakeperson${at} or ask fakeperson directly, other${at}`;
  const rules = scanner.scanContent('PRIVACY.md', Buffer.from(line)).map((f) => `${f.rule}:${f.text}`);
  // the name inside the allowed address and the address itself pass; the bare name and another address do not
  assert.equal(rules.filter((r) => r.startsWith('denylist')).length, 1);
  assert.ok(rules.some((r) => r === `generic:email:other${at}`));
  assert.ok(!rules.some((r) => r.includes('fakeperson@')));
});

test('signed .dmg: the code signature SuperBlob before the koly trailer is excluded, the image content is not', () => {
  const name = Buffer.from('fakeperson fakeperson-team');
  // CMS wrapper blob (magic, length, payload with the developer name)
  const cms = Buffer.alloc(8 + name.length);
  cms.writeUInt32BE(0xfade0b01, 0); cms.writeUInt32BE(cms.length, 4); name.copy(cms, 8);
  const sb = Buffer.alloc(12 + 8 + cms.length);
  sb.writeUInt32BE(0xfade0cc0, 0); sb.writeUInt32BE(sb.length, 4); sb.writeUInt32BE(1, 8);
  sb.writeUInt32BE(0x10000, 12); sb.writeUInt32BE(20, 16); cms.copy(sb, 20);
  const koly = Buffer.alloc(512); koly.write('koly', 0, 'latin1');
  const content = Buffer.from('disk image content '.repeat(10));
  const dmg = Buffer.concat([content, sb, koly]);
  assert.deepEqual(dmgSignatureRange(dmg), [content.length, content.length + sb.length]);
  const sc = (buf) => makeScanner({ denylist: parseDenylist('fakeperson\n'), signature: true }).scanContent('App_1.0_aarch64.dmg', buf);
  assert.equal(sc(dmg).length, 0);
  // the same name in the image content is still found
  const leaky = Buffer.concat([Buffer.from('readme by fakeperson '), content, sb, koly]);
  assert.equal(sc(leaky).length, 1);
  // no koly trailer → nothing excluded
  assert.equal(dmgSignatureRange(Buffer.concat([content, sb])), null);
});
