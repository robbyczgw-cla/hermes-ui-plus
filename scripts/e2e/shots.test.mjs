// Review screenshots of the smoke suite are JPEG q60 <= 1080 px (scripts/e2e/device.py png_to_jpeg, prune_shots);
// nothing in the suite/report code may write a .png review shot any more (the app's own share-image.png is the one
// artifact pulled as is). Needs python3 + ImageMagick (convert/magick) or sips, else skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const has = (c, a) => spawnSync(c, a).status === 0;
const hasConvert = has('convert', ['-version']) || has('magick', ['-version']) || has('sips', ['--help']);
const py = (code) => spawnSync('python3', ['-B', '-c', `import sys; sys.path.insert(0, ${JSON.stringify(DIR)}); import device as d\n${code}`], { encoding: 'utf8' });

test('suite code writes no png review shots', () => {
  for (const f of ['suite.py', '../perf/droid.py']) {
    const src = readFileSync(join(DIR, f), 'utf8');
    assert.doesNotMatch(src, /screenshot_png\(/, `${f} still saves a PNG review shot`);
  }
});

test('png_to_jpeg: JPEG, at most 1080 px wide, small', { skip: !hasConvert && 'no ImageMagick/sips' }, () => {
  const t = mkdtempSync(join(tmpdir(), 'e2e-shots-test-'));
  try {
    const png = join(t, 'a.png'), jpg = join(t, 'a.jpg');
    const mk = spawnSync('python3', ['-B', '-c', `
import struct, zlib, sys
w, h = 1600, 400
raw = b''.join(b'\\0' + bytes((x * 7 + y) % 256 for x in range(w)) * 1 for y in range(h))
def ch(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
open(sys.argv[1], 'wb').write(b'\\x89PNG\\r\\n\\x1a\\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 0, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw)) + ch(b'IEND', b''))`, png]);
    assert.equal(mk.status, 0, mk.stderr);
    const r = py(`d.png_to_jpeg(${JSON.stringify(png)}, ${JSON.stringify(jpg)})`);
    assert.equal(r.status, 0, r.stderr);
    const b = readFileSync(jpg);
    assert.deepEqual([...b.subarray(0, 3)], [0xff, 0xd8, 0xff]);
    const id = spawnSync('identify', ['-format', '%w', jpg], { encoding: 'utf8' });
    if (id.status === 0) assert.ok(Number(id.stdout) <= 1080);
  } finally {
    rmSync(t, { recursive: true, force: true });
  }
});

test('prune_shots keeps the newest N and never a failure shot', () => {
  const t = mkdtempSync(join(tmpdir(), 'e2e-prune-test-'));
  try {
    for (let i = 0; i < 6; i++) {
      const f = join(t, `s${i}.jpg`);
      writeFileSync(f, 'x');
      utimesSync(f, 1000 + i, 1000 + i);
    }
    writeFileSync(join(t, 'pair.jpg'), 'x');
    utimesSync(join(t, 'pair.jpg'), 1, 1);
    writeFileSync(join(t, 's1-ui.txt'), 'x');
    const r = py(`print(len(d.prune_shots(${JSON.stringify(t)}, 2, always=('pair',))))`);
    assert.equal(r.stdout.trim(), '4', r.stderr);
    assert.ok(existsSync(join(t, 'pair.jpg')) && existsSync(join(t, 's5.jpg')) && existsSync(join(t, 's4.jpg')));
    assert.ok(!existsSync(join(t, 's0.jpg')) && existsSync(join(t, 's1-ui.txt')));
  } finally {
    rmSync(t, { recursive: true, force: true });
  }
});
