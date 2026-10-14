// GET /bridge/media: allow-listed roots only, path-traversal / symlink / hidden-file / type protection.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';
import { hasHiddenSegment, isWithin, loadMediaConfig, parseMediaPath, resolveMedia } from '../src/media.mjs';

const TOKEN = 'bridge-token';
let tmp, root, outside, server, base;

const get = (path, { auth = true, method = 'GET' } = {}) =>
  fetch(`${base}/bridge/media?path=${encodeURIComponent(path)}`, { method, headers: auth ? { authorization: `Bearer ${TOKEN}` } : {} });

before(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'hui-media-'));
  root = join(tmp, 'cache');
  outside = join(tmp, 'secret');
  await mkdir(join(root, 'images'), { recursive: true });
  await mkdir(join(root, '.hidden'), { recursive: true });
  await mkdir(outside);
  await writeFile(join(root, 'images', 'chart.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(join(root, 'images', 'äbericht 1.pdf'), '%PDF-1.4');
  await writeFile(join(root, 'page.html'), '<script>alert(1)</script>');
  await writeFile(join(root, 'notes.weird'), 'x');
  await writeFile(join(root, '.env.json'), '{"k":1}');
  await writeFile(join(root, '.hidden', 'a.png'), 'x');
  await writeFile(join(outside, 'passwd.txt'), 'root:x');
  await symlink(join(outside, 'passwd.txt'), join(root, 'link.txt'));
  await symlink(outside, join(root, 'dirlink'));
  await symlink(join(root, 'images', 'chart.png'), join(root, 'inner.png')); // symlink inside the root: fine
  const env = { HERMES_BASE_URL: 'http://127.0.0.1:1/v1', BRIDGE_TOKEN: TOKEN, ROUTER_BACKEND: 'heuristic', BRIDGE_MEDIA_DIRS: root, BRIDGE_MEDIA_MAX_BYTES: '1000' };
  ({ server } = createServer(env, { logger: silentLogger }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await rm(tmp, { recursive: true, force: true });
});

test('parseMediaPath rejects anything but a plain absolute path', () => {
  assert.equal(parseMediaPath('/a/b/c.png').ok, true);
  for (const bad of ['', undefined, 'a/b.png', '/a/../b.png', '/a/./b.png', '/a//b.png', '/a/b.png/', '/a\\b.png', '/a/b\0.png', '/a/\nb.png', `/${'x'.repeat(5000)}`, '..', '~/x.png']) {
    assert.equal(parseMediaPath(bad).ok, false, JSON.stringify(bad));
  }
});

test('isWithin / hasHiddenSegment', () => {
  assert.equal(isWithin('/r', '/r/a'), true);
  assert.equal(isWithin('/r', '/r'), true);
  assert.equal(isWithin('/r', '/rx/a'), false);
  assert.equal(isWithin('/r', '/r/../x'), false);
  assert.equal(hasHiddenSegment('/r', '/r/a/.b/c.png'), true);
  assert.equal(hasHiddenSegment('/.r', '/.r/a/c.png'), false); // only below the root
});

test('loadMediaConfig: absolute dirs only, comma or colon separated', () => {
  assert.deepEqual(loadMediaConfig({ BRIDGE_MEDIA_DIRS: '/a/b,/c:/d,rel,' }).dirs, ['/a/b', '/c', '/d']);
  assert.deepEqual(loadMediaConfig({}).dirs, []);
  assert.equal(loadMediaConfig({ BRIDGE_MEDIA_MAX_BYTES: '5' }).maxBytes, 5);
});

test('requires a bridge token', async () => {
  assert.equal((await get(join(root, 'images', 'chart.png'), { auth: false })).status, 401);
});

test('serves an allowed image inline with safe headers; HEAD works', async () => {
  const res = await get(join(root, 'images', 'chart.png'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.match(res.headers.get('content-disposition'), /^inline;/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-security-policy'), /sandbox/);
  assert.equal((await res.arrayBuffer()).byteLength, 4);
  const head = await get(join(root, 'images', 'chart.png'), { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '4');
});

test('unicode file names: encoded Content-Disposition', async () => {
  const res = await get(join(root, 'images', 'äbericht 1.pdf'));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /filename\*=UTF-8''%C3%A4bericht%201\.pdf/);
});

test('active content is never inline', async () => {
  const res = await get(join(root, 'page.html'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/octet-stream');
  assert.match(res.headers.get('content-disposition'), /^attachment;/);
});

test('path traversal and absolute escapes are refused', async () => {
  for (const p of [`${root}/../secret/passwd.txt`, `${root}/images/../../secret/passwd.txt`, join(outside, 'passwd.txt'), '/etc/passwd', '/etc/hostname.txt', 'relative/chart.png', `${root}/images/..%2fpage.html`]) {
    const res = await get(p);
    assert.ok([400, 403].includes(res.status), `${p} -> ${res.status}`);
  }
  // the query is decoded exactly once: a literal "%2e%2e" segment is just a file name that does not exist
  assert.equal((await get(`${root}/images/%2e%2e/page.html`)).status, 404);
  // sibling directory sharing the root as a string prefix
  await mkdir(`${root}-evil`, { recursive: true });
  await writeFile(`${root}-evil/a.png`, 'x');
  assert.equal((await get(`${root}-evil/a.png`)).status, 403);
});

test('symlinks leaving the root are refused, symlinks inside are fine', async () => {
  assert.equal((await get(join(root, 'link.txt'))).status, 403);
  assert.equal((await get(join(root, 'dirlink', 'passwd.txt'))).status, 403);
  assert.equal((await get(join(root, 'inner.png'))).status, 200);
});

test('hidden files, unknown types, directories, missing files', async () => {
  assert.equal((await get(join(root, '.env.json'))).status, 403);
  assert.equal((await get(join(root, '.hidden', 'a.png'))).status, 403);
  assert.equal((await get(join(root, 'notes.weird'))).status, 415);
  assert.equal((await get(join(root, 'images'))).status, 415);
  assert.equal((await get(root)).status, 403);
  assert.equal((await get(join(root, 'nope.png'))).status, 404);
  assert.equal((await get('')).status, 400);
});

test('files above BRIDGE_MEDIA_MAX_BYTES are refused', async () => {
  await writeFile(join(root, 'big.txt'), 'x'.repeat(1001));
  assert.equal((await get(join(root, 'big.txt'))).status, 413);
});

test('disabled without BRIDGE_MEDIA_DIRS', async () => {
  const r = await resolveMedia('/tmp/a.png', { dirs: [], maxBytes: 10 });
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.equal(r.code, 'media_disabled');
});
