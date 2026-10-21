// Unit + CLI tests for scripts/leak-guard.mjs with synthetic samples only (nothing real).
// Samples are assembled at runtime so that this file itself passes `leak-guard --tree`.
//   node --test scripts/leak-guard.test.mjs
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, crc32, deflateSync, gzipSync } from 'node:zlib';

import { dmgSignatureRange, hermesStrings, isBinary, isHermesBytecode, isSignaturePath, isTestPath, loadAllowList, machoSignatureRanges, makeScanner, mask, parseDenylist } from './leak-guard.mjs';

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

test('MP4: the compressed payload is never scanned, metadata still is', () => {
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
  // the payload (mdat) is compressed A/V: readable-looking text in it is chance or encoder boilerplate, not metadata
  assert.equal(scanner.scanContent('clip.mp4', movie(Buffer.from(`\0Readable text: ${word}\0`))).length, 0);
  assert.equal(scanner.scanContent('clip.mp4', movie(Buffer.from(`\0${word}\0`, 'utf16le'))).length, 0);
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

// ---------------------------------------------------------------------------------------------------------
// Hermes bytecode (index.android.bundle / main.jsbundle)
// ---------------------------------------------------------------------------------------------------------

// Real Hermes bytecode (v98) compiled from fixtures/hermes/strings.js by the hermesc in app/node_modules. In its string
// storage the fake terms are glued to neighbours ("…zorbnikzorblaxoverflow…"), 'Qüxel' is UTF-16 and the long text is
// an overflow entry: a `strings`-style scan finds none of the three.
const HBC_FIXTURE = fileURLToPath(new URL('./fixtures/hermes/strings.hbc', import.meta.url));
const HBC_SOURCE = fileURLToPath(new URL('./fixtures/hermes/strings.js', import.meta.url));
const HERMESC = fileURLToPath(new URL('../app/node_modules/hermes-compiler/hermesc/linux64-bin/hermesc', import.meta.url));
const HBC_DENY = 'zorblax\nzorbnik\nqüxel\n';

/**
 * Synthetic Hermes bytecode with the documented layout that hermesStrings decodes (leak-guard.mjs): 128-byte header
 * (magic, version @8, fileLength @32, functionCount @40, stringKindCount @44, identifierCount @48, stringCount @52,
 * overflowStringCount @56, stringStorageSize @60), then function headers (`funcHeaderBytes` each: 16 before v98,
 * 12 from v98), string kinds, identifier hashes, small string table (bit 0 UTF-16, bits 1-23 offset, bits 24-31
 * length, 0xff = overflow index), overflow table ({offset, length}), string storage; each section 4-byte aligned.
 * Strings are packed without separators, like the compiler does. All are of kind String (no identifiers).
 */
function synthHbc({ version = 96, funcHeaderBytes = 16, functions = 3, strings, tail = 64 }) {
  const align = (n) => n + ((4 - (n % 4)) % 4);
  const parts = strings.map((s) => (typeof s === 'string' ? { text: s, utf16: false } : s));
  const store = [];
  let off = 0;
  const small = [];
  const overflow = [];
  for (const p of parts) {
    const bytes = Buffer.from(p.text, p.utf16 ? 'utf16le' : 'latin1');
    const length = p.utf16 ? bytes.length / 2 : bytes.length;
    if (length >= 0xff) {
      small.push(((0xff << 24) | (overflow.length << 1) | (p.utf16 ? 1 : 0)) >>> 0);
      overflow.push([off, length]);
    } else small.push(((length << 24) | (off << 1) | (p.utf16 ? 1 : 0)) >>> 0);
    store.push(bytes);
    off += bytes.length;
  }
  const storage = Buffer.concat(store);
  const kinds = 128 + align(functions * funcHeaderBytes);
  const smallAt = kinds + 4; // one kind entry, no identifier hashes
  const overflowAt = smallAt + small.length * 4;
  const storageAt = align(overflowAt + overflow.length * 8);
  const buf = Buffer.alloc(storageAt + storage.length + tail);
  Buffer.from([0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f]).copy(buf, 0);
  buf.writeUInt32LE(version, 8);
  buf.writeUInt32LE(buf.length, 32);
  [functions, 1, 0, small.length, overflow.length, storage.length].forEach((v, i) => buf.writeUInt32LE(v, 40 + i * 4));
  buf.fill(0xab, 128, kinds); // function headers: arbitrary bytes
  buf.writeUInt32LE(small.length, kinds); // kind String (bit 31 clear), count
  small.forEach((e, i) => buf.writeUInt32LE(e, smallAt + i * 4));
  overflow.forEach(([o, l], i) => { buf.writeUInt32LE(o, overflowAt + i * 8); buf.writeUInt32LE(l, overflowAt + i * 8 + 4); });
  storage.copy(buf, storageAt);
  return buf;
}

const hbcScan = (buf, path = 'assets/index.android.bundle', deny = HBC_DENY) => makeScanner({ denylist: parseDenylist(deny), signature: true }).scanContent(path, buf);
const legacyScan = (buf, deny) => {
  // what the scanner saw before the string-table decoder: printable ASCII runs and ASCII UTF-16LE runs only
  const rules = parseDenylist(deny);
  const latin1 = buf.toString('latin1');
  const runs = [...latin1.matchAll(/[\x20-\x7e]{4,}/g)].map((m) => m[0]).concat([...latin1.matchAll(/(?:[\x20-\x7e]\x00){4,}/g)].map((m) => m[0].replace(/\x00/g, '')));
  return runs.filter((r) => rules.some((x) => { x.re.lastIndex = 0; return x.re.test(r); }));
};

function assertFixtureStrings(buf) {
  assert.ok(isHermesBytecode(buf));
  const { version, strings } = hermesStrings(buf);
  assert.ok(version >= 98, `bytecode v${version}`);
  const texts = strings.map((s) => s.text);
  for (const t of ['zorblax', 'Qüxel Fakename', 'globalThis', 'plain', 'unicode', 'overflow']) assert.ok(texts.includes(t), t);
  const long = texts.find((t) => t.endsWith('zorbnik'));
  assert.ok(long && long.length > 255 && long.startsWith('lorem ipsum'), 'overflow entry decoded');
  assert.ok(buf.readUInt32LE(56) >= 1, 'fixture really has an overflow string table entry');
  // offsets point at the string bytes in the file
  const z = strings.find((s) => s.text === 'zorblax');
  assert.equal(buf.toString('latin1', z.offset, z.offset + 7), 'zorblax');
  const q = strings.find((s) => s.text === 'Qüxel Fakename');
  assert.equal(buf.toString('utf16le', q.offset, q.offset + 28), 'Qüxel Fakename');
  // the old `strings`-style scan misses all three, the decoder finds each one
  assert.deepEqual(legacyScan(buf, HBC_DENY), []);
  const f = hbcScan(buf);
  assert.deepEqual(f.map((x) => [x.text.toLowerCase(), x.variant]).sort(), [['qüxel', 'hermes'], ['zorblax', 'hermes'], ['zorbnik', 'hermes']]);
  assert.ok(f.every((x) => !x.error));
}

test('Hermes bytecode: real fixture: glued ASCII, UTF-16 and overflow strings are decoded and scanned', () => {
  const buf = readFileSync(HBC_FIXTURE);
  assertFixtureStrings(buf);
  assert.match(readFileSync(HBC_SOURCE, 'utf8'), /globalThis\.plain = 'zorblax'/);
  // file names do not matter: detection is by magic (main.jsbundle, any .hbc)
  assert.equal(hbcScan(buf, 'Payload/App.app/main.jsbundle').length, 3);
  // a clean bundle stays clean
  assert.equal(hbcScan(buf, 'x.hbc', 'notpresentanywhere\n').length, 0);
});

test('Hermes bytecode: compiled now with the installed hermesc (catches a layout change on Hermes upgrades)', { skip: !existsSync(HERMESC) && 'hermesc not installed (app/node_modules)' }, () => {
  const out = join(tmp(), 'index.android.bundle');
  execFileSync(HERMESC, ['-emit-binary', '-out', out, HBC_SOURCE]);
  assertFixtureStrings(readFileSync(out));
});

test('Hermes bytecode: synthetic pre-v98 layout (16-byte function headers), small + overflow + UTF-16 entries', () => {
  const long = `${'x'.repeat(300)} zorbnik`;
  const buf = synthHbc({ strings: ['zorblax', 'global', { text: 'Qüxel', utf16: true }, long, 'zorbnikend'] });
  const { version, strings } = hermesStrings(buf);
  assert.equal(version, 96);
  assert.deepEqual(strings.map((s) => s.text), ['zorblax', 'global', 'Qüxel', long, 'zorbnikend']);
  assert.deepEqual(legacyScan(buf, 'zorblax\nqüxel\n'), [], 'glued + UTF-16: invisible to the old scan');
  const f = hbcScan(buf);
  assert.deepEqual(f.map((x) => x.text.toLowerCase()).sort(), ['qüxel', 'zorblax', 'zorbnik']);
  // 12-byte layout (v98) of the same strings decodes too
  assert.equal(hermesStrings(synthHbc({ version: 98, funcHeaderBytes: 12, functions: 5, strings: ['a', 'zorblax'] })).strings[1].text, 'zorblax');
  // the e-mail / host rules see decoded strings as text
  const host = j('box.mynet', '.ts', '.net');
  assert.deepEqual(rules(hbcScan(synthHbc({ strings: ['connect', host, 'next'] }))), ['generic:tailnet-host']);
});

test('Hermes bytecode: an unrecognized or broken layout is a scan error, never clean', () => {
  const good = synthHbc({ strings: ['alpha', 'zorblax'] });
  const broken = (mutate) => { const b = Buffer.from(good); mutate(b); return b; };
  const cases = {
    'kind counts do not add up': broken((b) => b.writeUInt32LE(b.readUInt32LE(52) + 1, 52)),
    'storage past the end': broken((b) => b.writeUInt32LE(1 << 20, 60)),
    'fileLength > size': broken((b) => b.writeUInt32LE(b.length + 1, 32)),
    'truncated header': good.subarray(0, 100),
    'entry outside the storage': broken((b) => b.writeUInt32LE(((50 << 24) | (0 << 1)) >>> 0, 128 + 48 + 4)),
  };
  for (const [name, buf] of Object.entries(cases)) {
    assert.throws(() => hermesStrings(buf), /Hermes bytecode/, name);
    const f = hbcScan(buf);
    assert.ok(f.some((x) => x.error && x.rule === 'scan-error'), name);
  }
});

test('binary: non-ASCII names in UTF-8 and UTF-16LE runs are found; ASCII hits are not double-counted', () => {
  const deny = 'qüxel\nzorblax\n';
  const sc = (buf, path = 'lib/x.so') => makeScanner({ denylist: parseDenylist(deny) }).scanContent(path, buf);
  const pad = Buffer.from([0, 1, 2, 0xff]);
  const u8 = sc(Buffer.concat([pad, Buffer.from('by Qüxel ok'), pad]));
  assert.deepEqual(u8.map((f) => [f.text, f.variant, f.offset]), [['Qüxel', 'utf8', 7]]);
  for (const lead of [[0, 1], [7, 0, 1]]) {
    const u16 = sc(Buffer.concat([Buffer.from(lead), Buffer.from('a Qüxel b', 'utf16le'), pad]));
    assert.deepEqual(u16.map((f) => [f.text, f.variant, f.offset]), [['Qüxel', 'utf16le', lead.length + 4]], `alignment ${lead.length}`);
  }
  // an ASCII term next to non-ASCII text: reported once (by the ASCII pass)
  const mixed = sc(Buffer.concat([pad, Buffer.from('é zorblax é'), pad]));
  assert.deepEqual(mixed.map((f) => [f.text, f.variant, f.count]), [['zorblax', 'latin1', 1]]);
});

/** Minimal stored (uncompressed) zip, enough for unzip in scan-artifact.sh. */
function storedZip(files) {
  const locals = [];
  const central = [];
  let off = 0;
  for (const [name, data] of Object.entries(files)) {
    const n = Buffer.from(name);
    const crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    locals.push(h, n, data);
    central.push(c, n);
    off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('CLI --expect-hermes: every JS bundle must decode as Hermes bytecode, and one must exist', () => {
  const hbc = readFileSync(HBC_FIXTURE);
  const env = { HUI_PRIVATE_DIR: privateDir() };
  const dir = (files) => {
    const d = tmp();
    for (const [p, data] of Object.entries(files)) { mkdirSync(join(d, p, '..'), { recursive: true }); writeFileSync(join(d, p), data); }
    return d;
  };
  const leaky = run(['--path', dir({ 'assets/index.android.bundle': hbc }), '--expect-hermes'], { env });
  assert.equal(leaky.code, 1);
  assert.match(leaky.err, /1 Hermes bytecode file\(s\) decoded \(\d+ strings\)/);
  assert.match(leaky.err, /index\.android\.bundle:byte~\d+ hermes\s+\[denylist#1/);
  const clean = run(['--path', dir({ 'Payload/A.app/main.jsbundle': hbc }), '--expect-hermes'], { env: { HUI_PRIVATE_DIR: tmp() } });
  assert.equal(clean.code, 0, clean.err);
  const text = run(['--path', dir({ 'assets/index.android.bundle': 'var a = 1;\n' }), '--expect-hermes'], { env });
  assert.equal(text.code, 2);
  assert.match(text.err, /not Hermes bytecode/);
  assert.equal(run(['--path', dir({ 'a.txt': 'x\n' }), '--expect-hermes'], { env }).code, 2, 'no bundle');
  const broken = Buffer.from(hbc); broken.writeUInt32LE(broken.readUInt32LE(52) + 1, 52);
  const bad = run(['--path', dir({ 'assets/index.android.bundle': broken }), '--expect-hermes'], { env });
  assert.equal(bad.code, 2);
  assert.match(bad.err, /unrecognized string table layout/);
});

test('scan-artifact.sh: APK/AAB/IPA bundles go through the Hermes decoder; AAB/IPA without a bundle fail', () => {
  const sh = fileURLToPath(new URL('./scan-artifact.sh', import.meta.url));
  const bin = tmp();
  writeFileSync(join(bin, 'gitleaks'), '#!/bin/sh\nexit 0\n'); // secrets scan stub: this test is about leak-guard
  chmodSync(join(bin, 'gitleaks'), 0o755);
  const art = (name, files) => { const p = join(tmp(), name); writeFileSync(p, storedZip(files)); return p; };
  const go = (target, pdir) => {
    const r = spawnSync('bash', [sh, target], { encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH}`, HOME: tmp(), HUI_PRIVATE_DIR: pdir } });
    return { code: r.status, all: r.stdout + r.stderr };
  };
  const hbc = readFileSync(HBC_FIXTURE);
  const deny = privateDir();
  const cleanDeny = tmp();
  writeFileSync(join(cleanDeny, 'leak-denylist.txt'), 'notpresentanywhere\n');
  const apk = go(art('app.apk', { 'assets/index.android.bundle': hbc, 'AndroidManifest.xml': Buffer.from('<m/>') }), deny);
  assert.equal(apk.code, 1, apk.all);
  assert.match(apk.all, /Hermes bytecode file\(s\) decoded/);
  assert.match(apk.all, /hermes\s+\[denylist#1/);
  const aab = go(art('app.aab', { 'base/assets/index.android.bundle': hbc }), cleanDeny);
  assert.equal(aab.code, 0, aab.all);
  assert.match(aab.all, /1 Hermes bytecode file\(s\) decoded/);
  const ipa = go(art('app.ipa', { 'Payload/A.app/main.jsbundle': hbc }), deny);
  assert.equal(ipa.code, 1, ipa.all);
  for (const name of ['app.aab', 'app.ipa']) {
    const r = go(art(name, { 'a.txt': Buffer.from('x\n') }), cleanDeny);
    assert.equal(r.code, 2, `${name} without a bundle: ${r.all}`);
    assert.match(r.all, /no JS bundle/);
  }
  const debugApk = go(art('debug.apk', { 'AndroidManifest.xml': Buffer.from('<m/>') }), cleanDeny);
  assert.equal(debugApk.code, 0, debugApk.all);
  assert.match(debugApk.all, /no JS bundle in .* \(debug APK\)/);
  const textBundle = go(art('app.apk', { 'assets/index.android.bundle': Buffer.from('var a = 1;\n') }), cleanDeny);
  assert.equal(textBundle.code, 1, textBundle.all);
  assert.match(textBundle.all, /not Hermes bytecode/);
});

test('CLI --path: .gz / .br are scanned decompressed, .zip entry by entry; a broken archive is scanned raw', () => {
  const d = tmp();
  writeFileSync(join(d, 'bundle.js.gz'), gzipSync(Buffer.from('const host = "zorblax";\n')));
  writeFileSync(join(d, 'bundle.js.br'), brotliCompressSync(Buffer.from('nothing to see\n')));
  const zdir = tmp();
  writeFileSync(join(zdir, 'inner.txt'), 'zorblax lives here\n');
  execFileSync('python3', ['-c', 'import sys, zipfile; zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED).write(sys.argv[2], "inner.txt")', join(d, 'app.zip'), join(zdir, 'inner.txt')]);
  writeFileSync(join(d, 'broken.gz'), 'not gzip at all: zorblax\n');
  const r = run(['--path', d], { env: { HUI_PRIVATE_DIR: privateDir() } });
  assert.equal(r.code, 1);
  assert.match(r.err, /bundle\.js\.gz!gunzip/, 'finding inside the decompressed .gz');
  assert.match(r.err, /app\.zip!inner\.txt/, 'finding inside the zip entry');
  assert.match(r.err, /broken\.gz!gunzip/, 'a file that does not decompress is still scanned (raw)');
  assert.doesNotMatch(r.err, /bundle\.js\.br/, 'clean brotli content has no finding');
});

// --- gitleaks on Hermes bytecode: scan-artifact.sh gives gitleaks the decoded strings, one per line ----------------
const GITLEAKS = [...(process.env.PATH ?? '').split(':'), join(process.env.HOME ?? '', '.local/bin')].map((d) => join(d, 'gitleaks')).find((p) => existsSync(p));

test('scan-artifact.sh + gitleaks: glued neighbour strings in Hermes bytecode are not a token, a real key in it still is', { skip: !GITLEAKS && 'gitleaks not installed' }, () => {
  const sh = fileURLToPath(new URL('./scan-artifact.sh', import.meta.url));
  const neighbours = ['LONG_TOKEN_LEAD_MS', 'Samstag 18:00', 'IFrame', '1280x720', '19.2.3.x - 2.4.x', 'GestureHandlerRootView', 'RCTImageView_v2'];
  const bundle = (strings) => { const d = tmp(); mkdirSync(join(d, 'assets')); writeFileSync(join(d, 'assets/index.android.bundle'), synthHbc({ strings })); return d; };
  const gate = (dir) => {
    const r = spawnSync('bash', [sh, '--public', dir], { encoding: 'utf8', env: { PATH: `${dirname(GITLEAKS)}:${process.env.PATH}`, HOME: tmp(), HUI_PRIVATE_DIR: tmp() } });
    return { code: r.status, all: r.stdout + r.stderr };
  };
  const clean = gate(bundle(['api_key', 'token', ...neighbours]));
  assert.equal(clean.code, 0, clean.all);
  assert.match(clean.all, /1 Hermes bytecode file\(s\) replaced/);
  // a real (fake-valued) key among the same neighbours must still be caught
  const key = `sk_${'test'}_${'Zq8vK2mXp4Rt7Lw9Yb3Nc5Hd1'}`; // runtime-built Stripe-shaped fake key, so this file stays clean
  const leaky = gate(bundle(['api_key', ...neighbours, key, 'token']));
  assert.equal(leaky.code, 1, leaky.all);
  assert.match(leaky.all, /RuleID:\s+stripe-access-token/);
  assert.match(leaky.all, /scan-artifact: FAILED/);
});

test('hermes-strings-dump: one escaped string per line, other files copied unchanged, broken bytecode is an error', () => {
  const dump = fileURLToPath(new URL('./hermes-strings-dump.mjs', import.meta.url));
  const src = tmp();
  mkdirSync(join(src, 'assets'));
  writeFileSync(join(src, 'assets/index.android.bundle'), synthHbc({ strings: ['zorblax', 'two\nlines', 'back\\slash', { text: 'Qüxel', utf16: true }] }));
  writeFileSync(join(src, 'assets/app.config'), '{"a":1}\n');
  const out = join(tmp(), 'out');
  const ok = spawnSync('node', [dump, src, out], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(readFileSync(join(out, 'assets/index.android.bundle.hermes-strings.txt'), 'utf8'), 'zorblax\ntwo\\nlines\nback\\\\slash\nQüxel\n');
  assert.equal(existsSync(join(out, 'assets/index.android.bundle')), false, 'raw bytecode is not handed to gitleaks');
  assert.equal(readFileSync(join(out, 'assets/app.config'), 'utf8'), '{"a":1}\n');
  const bad = synthHbc({ strings: ['a'] });
  bad.writeUInt32LE(bad.readUInt32LE(52) + 1, 52);
  writeFileSync(join(src, 'assets/index.android.bundle'), bad);
  const err = spawnSync('node', [dump, src, join(tmp(), 'out2')], { encoding: 'utf8' });
  assert.equal(err.status, 2);
});

// ---- media containers: metadata/text atoms only, never the compressed payload ------------------------------------------
// Synthetic containers around a payload of "random" bytes that contains a short fake denylist term (bounded by
// non-alphanumerics, as a 4-letter word inside an H.264 stream is), plus a real ffmpeg-made H.264/AAC file.
const MEDIA_TERM = 'zqxv'; // obviously fake
const termScanner = () => makeScanner({ denylist: parseDenylist(MEDIA_TERM), signature: true });
const noisy = () => Buffer.concat([Buffer.from([0x00, 0xfe, 0x9a]), Buffer.from(`#${MEDIA_TERM}!`), Buffer.from([0x81, 0x00, 0xff])]);
const be32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const hits = (name, buf) => termScanner().scanContent(name, buf).length;
const withPayload = (name, make) => {
  assert.equal(hits(name, make(noisy(), Buffer.alloc(0))), 0, `${name}: noise in the payload is ignored`);
  assert.equal(hits(name, make(noisy(), Buffer.from(`text ${MEDIA_TERM} text`))), 1, `${name}: the same word in metadata is found`);
  assert.equal(hits(`${MEDIA_TERM}-clip.${name.split('.').pop()}`, make(noisy(), Buffer.alloc(0))), 1, `${name}: the file name is scanned`);
};

test('media: a real H.264/AAC mp4 (ffmpeg): a short word inside a 6-byte printable run of the stream is not a finding', () => {
  const file = readFileSync(new URL('./fixtures/media/noise.mp4', import.meta.url));
  const word = 'zeue'; // sits in the run "T(zeue" of the video payload
  assert.ok(file.indexOf(Buffer.from(`(${word}`)) > 0 && file.indexOf(Buffer.from(`(${word}`)) < file.indexOf(Buffer.from('moov')), 'fixture still has the stream bytes');
  const s = makeScanner({ denylist: parseDenylist(word), signature: true });
  assert.equal(s.scanContent('noise.mp4', file).length, 0, 'payload ignored');
  assert.equal(s.scanContent('noise.bin', file).length, 1, 'the same bytes under a non-media name are still scanned (this was the false positive)');
  const title = makeScanner({ denylist: parseDenylist('Fixture'), signature: true }).scanContent('noise.mp4', file);
  assert.equal(title.length, 1, 'the title tag (udta/meta) is a true positive');
});

test('media: MP4 with XMP uuid box and ilst tags; fragmented boxes and sample tables are payload', () => {
  const box = (type, payload) => Buffer.concat([be32(payload.length + 8), Buffer.from(type, 'latin1'), payload]);
  const mk = (payload, meta) => {
    const hdlr = Buffer.alloc(12); hdlr.write('vide', 8, 4);
    const stsd = box('stsd', Buffer.concat([Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]), box('avc1', Buffer.alloc(78))]));
    const trak = box('trak', box('mdia', Buffer.concat([box('hdlr', hdlr), box('minf', box('stbl', Buffer.concat([stsd, box('stco', payload)])))])));
    return Buffer.concat([box('ftyp', Buffer.from('isom\0\0\0\0isom')), box('moov', Buffer.concat([trak, box('udta', meta)])), box('mdat', payload), box('uuid', meta)]);
  };
  // the uuid box always carries the metadata argument, so test with and without it
  assert.equal(hits('a.mp4', mk(noisy(), Buffer.alloc(0)).subarray(0, -8)), 0);
  assert.equal(hits('a.mov', mk(noisy(), Buffer.from(`<x:xmpmeta>${MEDIA_TERM}</x:xmpmeta>`))), 1);
  assert.equal(hits('a.m4a', mk(noisy(), Buffer.alloc(0))), 0, 'noise in stbl and mdat');
});

test('media: PNG (text chunks and inflated zTXt/iTXt are scanned, IDAT is not)', () => {
  const chunk = (type, data) => Buffer.concat([be32(data.length), Buffer.from(type, 'latin1'), data, be32(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])))]);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const png = (idat, extra = []) => Buffer.concat([sig, chunk('IHDR', Buffer.alloc(13)), ...extra, chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
  withPayload('a.png', (noise, meta) => png(noise, meta.length ? [chunk('tEXt', Buffer.concat([Buffer.from('Comment\0'), meta]))] : []));
  const z = chunk('zTXt', Buffer.concat([Buffer.from('Comment\0\0'), deflateSync(Buffer.from(`made by ${MEDIA_TERM}`))]));
  assert.equal(hits('a.png', png(noisy(), [z])), 1, 'compressed text chunk is inflated and scanned');
  const it = chunk('iTXt', Buffer.concat([Buffer.from('XML:com.adobe.xmp\0\x01\0\0\0'), deflateSync(Buffer.from(`<x>${MEDIA_TERM}</x>`))]));
  assert.equal(hits('a.png', png(noisy(), [it])), 1);
  assert.equal(hits('a.png', png(noisy()).subarray(0, -6)), 1, 'truncated: full scan');
  assert.equal(hits('a.png', Buffer.concat([sig, noisy()])), 1, 'no chunk structure: full scan');
});

test('media: JPEG (COM/APPn/EXIF are scanned, entropy-coded scan data is not)', () => {
  const seg = (m, data) => Buffer.concat([Buffer.from([0xff, m]), Buffer.from([(data.length + 2) >> 8, (data.length + 2) & 255]), data]);
  const jpg = (scan, metaSeg) => Buffer.concat([Buffer.from([0xff, 0xd8]), ...(metaSeg ? [metaSeg] : []), seg(0xdb, Buffer.alloc(65)), seg(0xda, Buffer.alloc(10)), scan, Buffer.from([0xff, 0xd9])]);
  assert.equal(hits('a.jpg', jpg(noisy())), 0);
  assert.equal(hits('a.jpeg', jpg(noisy(), seg(0xfe, Buffer.from(`by ${MEDIA_TERM}`)))), 1);
  assert.equal(hits('a.jpg', jpg(noisy(), seg(0xe1, Buffer.from(`Exif\0\0 ${MEDIA_TERM} `)))), 1);
  assert.equal(hits('a.jpg', jpg(Buffer.concat([noisy().subarray(0, -1), Buffer.from([0xff, 0x00, 0xff, 0xd0]), noisy().subarray(0, -1)]))), 0, 'stuffed bytes and restart markers stay in the scan data');
  assert.equal(hits('a.jpg', Buffer.concat([jpg(noisy()), Buffer.from(`trailer ${MEDIA_TERM}`)])), 1, 'data after EOI is scanned');
  assert.equal(hits('a.jpg', jpg(noisy()).subarray(0, -2)), 1, 'no EOI: full scan');
});

test('media: WebP (EXIF/XMP chunks are scanned, VP8 data is not)', () => {
  const chunk = (t, data) => { const h = Buffer.alloc(8); h.write(t, 0, 4, 'latin1'); h.writeUInt32LE(data.length, 4); return Buffer.concat([h, data, data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]); };
  const webp = (vp8, extra) => { const body = Buffer.concat([Buffer.from('WEBP'), chunk('VP8 ', vp8), ...extra]); const h = Buffer.alloc(8); h.write('RIFF', 0, 4); h.writeUInt32LE(body.length, 4); return Buffer.concat([h, body]); };
  assert.equal(hits('a.webp', webp(noisy(), [])), 0);
  assert.equal(hits('a.webp', webp(noisy(), [chunk('EXIF', Buffer.from(`Exif\0\0${MEDIA_TERM} `))])), 1);
  assert.equal(hits('a.webp', webp(noisy(), [chunk('XMP ', Buffer.from(`<x>${MEDIA_TERM}</x>`))])), 1);
  assert.equal(hits('a.webp', webp(noisy(), []).subarray(0, -3)), 1, 'truncated: full scan');
});

test('media: MP3 (ID3v2 and the trailer tags are scanned, audio frames are not)', () => {
  const id3 = (text) => { const body = Buffer.concat([Buffer.from('TIT2'), be32(text.length + 1), Buffer.from([0, 0, 0]), Buffer.from(text)]); const h = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, (body.length >> 7) & 127, body.length & 127]); return Buffer.concat([h, body]); };
  const frames = (n) => Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), n, Buffer.alloc(3000, 0x41)]);
  assert.equal(hits('a.mp3', Buffer.concat([id3('Song'), frames(noisy())])), 0);
  assert.equal(hits('a.mp3', Buffer.concat([id3(`Song ${MEDIA_TERM}`), frames(noisy())])), 1);
  assert.equal(hits('a.mp3', Buffer.concat([frames(noisy()), Buffer.from(`TAG ${MEDIA_TERM} `), Buffer.alloc(100)])), 1, 'ID3v1 trailer');
  assert.equal(hits('a.mp3', Buffer.concat([Buffer.from('not mp3 '), noisy()])), 1, 'not an MP3 stream: full scan');
});

test('media: WebM (Info/Tags are scanned, clusters are not; live streams scan fully)', () => {
  const el = (id, data, unknown = false) => Buffer.concat([Buffer.from(id), unknown ? Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]) : Buffer.from([0x40 | (data.length >> 8), data.length & 255]), data]);
  const hex = (h) => Buffer.from(h, 'hex');
  const webm = (cluster, tag, unknownCluster) => {
    const info = el(hex('1549a966'), el(hex('7ba9'), Buffer.from(tag || 'Title')));
    const seg = Buffer.concat([info, el(hex('1f43b675'), cluster, unknownCluster)]);
    return Buffer.concat([el(hex('1a45dfa3'), Buffer.from([0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d])), el(hex('18538067'), seg)]);
  };
  assert.equal(hits('a.webm', webm(noisy())), 0);
  assert.equal(hits('a.webm', webm(noisy(), `Title ${MEDIA_TERM}`)), 1);
  assert.equal(hits('a.webm', webm(noisy(), '', true)), 1, 'unknown-size cluster: full scan');
});

test('media: an unknown or unproven container never switches filtering on; other files are untouched', () => {
  assert.equal(hits('a.mp4', noisy()), 1);
  assert.equal(hits('a.webm', noisy()), 1);
  assert.equal(hits('a.mp3', Buffer.concat([Buffer.from('xx'), noisy()])), 1);
  assert.equal(hits('a.dex', noisy()), 1);
  assert.equal(hits('a.js', Buffer.from(`const x = "${MEDIA_TERM}"`)), 1);
});

test('scan-artifact.sh: a single mp4 is scanned by its metadata (stream noise is clean, a tag is a finding); a single dmg-like file is scanned; unknown extensions are refused', () => {
  const sh = fileURLToPath(new URL('./scan-artifact.sh', import.meta.url));
  const bin = tmp();
  writeFileSync(join(bin, 'gitleaks'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(bin, 'gitleaks'), 0o755);
  const fixture = readFileSync(new URL('./fixtures/media/noise.mp4', import.meta.url));
  const go = (name, content, term) => {
    const p = join(tmp(), name); writeFileSync(p, content);
    const pd = tmp(); writeFileSync(join(pd, 'leak-denylist.txt'), `${term}\n`);
    const r = spawnSync('bash', [sh, p], { encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH}`, HOME: tmp(), HUI_PRIVATE_DIR: pd } });
    return { code: r.status, all: r.stdout + r.stderr };
  };
  const stream = go('trailer.mp4', fixture, 'zeue');
  assert.equal(stream.code, 0, stream.all);
  assert.equal(go('trailer.mp4', fixture, 'Fixture').code, 1, 'the title tag is found');
  assert.equal(go('trailer.bin.dmg', Buffer.from('plain bytes with zeue inside\n'), 'zeue').code, 1, 'a dmg is scanned as it is');
  const odd = go('thing.xyz', Buffer.from('x'), 'zeue');
  assert.equal(odd.code, 2); assert.match(odd.all, /don't know how to unpack/);
});

test('hermes-strings-dump: media get their payload zeroed for gitleaks, other files are copied unchanged', async () => {
  const { dumpTree } = await import('./hermes-strings-dump.mjs');
  const src = tmp(); const out = join(tmp(), 'o');
  const mp4 = readFileSync(new URL('./fixtures/media/noise.mp4', import.meta.url));
  writeFileSync(join(src, 'v.mp4'), mp4); writeFileSync(join(src, 'a.txt'), 'hello\n');
  dumpTree(src, out);
  assert.equal(readFileSync(join(out, 'a.txt'), 'utf8'), 'hello\n');
  const masked = readFileSync(join(out, 'v.mp4'));
  assert.equal(masked.length, mp4.length);
  assert.ok(mp4.indexOf('x264 - core') > 0 && masked.indexOf('x264 - core') < 0, 'stream bytes are gone');
  assert.ok(masked.indexOf('Fixture clip') > 0, 'metadata is kept');
});
