// Upload endpoint tests: real HTTP server (createServer) with a temp upload dir; no upstream needed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, readdir, readFile, stat, mkdir, writeFile, utimes, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/server.mjs';
import { silentLogger } from '../src/log.mjs';
import {
  cleanupUploads, dayDir, loadUploadConfig, mimeAllowed, normalizeMime, sanitizeFilename, DEFAULT_ALLOWED_MIME,
} from '../src/uploads.mjs';

const TOKEN = 'bridge-token';
const MAX = 64 * 1024;
let root;
let dir;
let server;
let port;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'hui-uploads-'));
  dir = join(root, 'uploads');
  const env = {
    HERMES_BASE_URL: 'http://127.0.0.1:1/v1', BRIDGE_TOKEN: TOKEN, ROUTER_BACKEND: 'heuristic',
    BRIDGE_UPLOAD_DIR: dir, BRIDGE_UPLOAD_MAX_BYTES: String(MAX),
  };
  ({ server } = createServer(env, { logger: silentLogger }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  port = server.address().port;
});
after(async () => {
  server.close();
  server.closeAllConnections();
  await rm(root, { recursive: true, force: true });
});

/** Send an upload. `body` may be a Buffer or an array of chunks (chunked transfer, no content-length). */
function upload({ body = Buffer.from('hello'), headers = {}, auth = `Bearer ${TOKEN}`, chunked = false } = {}) {
  return new Promise((resolve, reject) => {
    const h = { 'content-type': 'text/plain', 'x-filename': 'a.txt', ...headers };
    if (auth) h.authorization = auth;
    for (const k of Object.keys(h)) if (h[k] === undefined) delete h[k];
    const chunks = Array.isArray(body) ? body : [body];
    if (!chunked && !('content-length' in h)) h['content-length'] = String(chunks.reduce((n, c) => n + c.length, 0));
    const req = http.request({ host: '127.0.0.1', port, path: '/bridge/uploads', method: 'POST', headers: h, agent: false }, (res) => {
      const out = [];
      res.on('data', (c) => out.push(c));
      res.on('end', () => {
        const text = Buffer.concat(out).toString();
        let json = null;
        try { json = JSON.parse(text); } catch { /* keep null */ }
        resolve({ status: res.statusCode, headers: res.headers, json, text });
      });
    });
    // A server that answers 413 early may reset the connection while we are still writing.
    let answered = false;
    req.on('response', () => { answered = true; });
    // EPIPE / ECONNRESET can win the race against the already sent early answer: give the response a moment
    req.on('error', (err) => { if (!answered) setTimeout(() => { if (!answered) reject(err); }, 300); });
    (async () => {
      for (const c of chunks) {
        if (!req.write(c)) await Promise.race([once(req, 'drain'), once(req, 'close')]);
        if (req.destroyed) return;
        await new Promise((r) => setImmediate(r));
      }
      req.end();
    })().catch(() => {});
  });
}

const listAll = async () => {
  const out = [];
  for (const d of await readdir(dir).catch(() => [])) for (const f of await readdir(join(dir, d))) out.push(join(d, f));
  return out;
};

test('success: 201, response shape, file content and private mode 0600 in a 0700 dir (GPT security M4)', async () => {
  const body = Buffer.from('Grüße,\nWelt');
  const r = await upload({ body, headers: { 'content-type': 'text/plain; charset=utf-8', 'x-filename': encodeURIComponent('Bericht Q3.txt') } });
  assert.equal(r.status, 201, r.text);
  assert.match(r.headers['content-type'], /application\/json/);
  assert.deepEqual(Object.keys(r.json).sort(), ['id', 'mimeType', 'name', 'path', 'size']);
  assert.match(r.json.id, /^[0-9a-f]{16}$/);
  assert.equal(r.json.name, 'Bericht_Q3.txt');
  assert.equal(r.json.size, body.length);
  assert.equal(r.json.mimeType, 'text/plain');
  const real = await realpath(dir);
  assert.equal(r.json.path, join(real, dayDir(), `${r.json.id}-Bericht_Q3.txt`));
  assert.deepEqual(await readFile(r.json.path), body);
  assert.equal((await stat(r.json.path)).mode & 0o777, 0o600);
  assert.equal((await stat(join(real, dayDir()))).mode & 0o777, 0o700);
  assert.equal(r.headers['x-hermes-ui-bridge'], '1');
});

test('no leftover temp files after success', async () => {
  const names = (await listAll()).map((p) => p.split('/').pop());
  assert.ok(names.length > 0);
  assert.ok(names.every((n) => !n.endsWith('.part')));
});

test('chunked upload without content-length works', async () => {
  const r = await upload({ body: [Buffer.from('ab'), Buffer.from('cd'), Buffer.from('ef')], chunked: true });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.size, 6);
  assert.equal((await readFile(r.json.path)).toString(), 'abcdef');
});

test('auth: missing, wrong token -> 401 with error shape; nothing stored', async () => {
  const before = (await listAll()).length;
  for (const auth of [null, 'Bearer wrong', 'Basic abc', `Bearer ${TOKEN}x`]) {
    const r = await upload({ auth });
    assert.equal(r.status, 401);
    assert.equal(typeof r.json.error.message, 'string');
    assert.equal(r.json.error.type, 'invalid_request_error');
  }
  assert.equal((await listAll()).length, before);
});

test('auth is checked before anything else (bad mime + wrong token -> 401)', async () => {
  const r = await upload({ auth: 'Bearer nope', headers: { 'content-type': 'application/x-evil' } });
  assert.equal(r.status, 401);
});

test('400: missing / blank / malformed filename and empty body', async () => {
  for (const h of [{ 'x-filename': undefined }, { 'x-filename': ' ' }, { 'x-filename': '%00%1F' }, { 'x-filename': '%E0%A4%A' }]) {
    const r = await upload({ headers: h });
    assert.equal(r.status, 400, JSON.stringify(h));
    assert.equal(r.json.error.type, 'invalid_request_error');
  }
  const empty = await upload({ body: Buffer.alloc(0) });
  assert.equal(empty.status, 400);
  const emptyChunked = await upload({ body: [], chunked: true });
  assert.equal(emptyChunked.status, 400);
});

test('413: declared content-length over the limit is rejected before reading', async () => {
  const before = (await listAll()).length;
  const r = await upload({ body: Buffer.alloc(MAX + 1, 1) });
  assert.equal(r.status, 413);
  assert.equal(r.json.error.type, 'invalid_request_error');
  assert.equal((await listAll()).length, before);
});

test('413: streamed overflow (chunked, no content-length) aborts and removes the partial file', async () => {
  const before = (await listAll()).length;
  const chunk = Buffer.alloc(8 * 1024, 7);
  const r = await upload({ body: Array.from({ length: 24 }, () => chunk), chunked: true }); // 192 KiB > 64 KiB
  assert.equal(r.status, 413);
  assert.match(r.json.error.message, /exceeds/);
  assert.equal((await listAll()).length, before);
});

test('exactly the maximum size is accepted', async () => {
  const r = await upload({ body: Buffer.alloc(MAX, 1) });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.size, MAX);
});

test('415: mime outside the allow-list or missing', async () => {
  for (const ct of ['application/x-msdownload', 'application/octet-stream', 'video/mp4', 'application/zip', 'garbage', '']) {
    const r = await upload({ headers: { 'content-type': ct } });
    assert.equal(r.status, 415, `content-type "${ct}"`);
    assert.equal(r.json.error.type, 'invalid_request_error');
  }
  const none = await upload({ headers: { 'content-type': undefined } });
  assert.equal(none.status, 415);
});

test('allowed mime types are accepted (parameters and case ignored)', async () => {
  for (const ct of ['image/png', 'image/JPEG', 'application/pdf', 'text/markdown', 'text/csv; charset=utf-8', 'application/json',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document']) {
    const r = await upload({ headers: { 'content-type': ct } });
    assert.equal(r.status, 201, ct);
    assert.equal(r.json.mimeType, normalizeMime(ct));
  }
});

test('traversal and exotic names never escape the upload dir', async () => {
  const real = await realpath(dir);
  for (const n of ['../../etc/passwd', '..\\..\\windows\\system32\\x.dll', '/etc/shadow', '....//....//x.txt', 'a/../../b.txt', '.bashrc', '..', 'C:\\Users\\x\\y.txt']) {
    const r = await upload({ headers: { 'x-filename': encodeURIComponent(n) } });
    assert.equal(r.status, 201, n);
    assert.ok(r.json.path.startsWith(`${real}/`), `${n} -> ${r.json.path}`);
    const rel = r.json.path.slice(real.length + 1).split('/');
    assert.equal(rel.length, 2, `${n} -> ${r.json.path}`); // <day>/<file>, no extra directories
    assert.ok(!r.json.name.includes('..') && !r.json.name.startsWith('.'));
    assert.equal((await stat(r.json.path)).isFile(), true);
  }
});

test('unicode names are kept; emoji/odd chars replaced; response name equals stored name', async () => {
  const r = await upload({ headers: { 'x-filename': encodeURIComponent('Übersicht – größe 日本語.pdf'), 'content-type': 'application/pdf' } });
  assert.equal(r.status, 201);
  assert.equal(r.json.name, 'Übersicht_größe_日本語.pdf');
  assert.ok(r.json.path.endsWith(`${r.json.id}-Übersicht_größe_日本語.pdf`));
});

test('unrelated paths still reach the bridge (404 behind auth); GET /bridge/uploads is not an upload', async () => {
  const r = await new Promise((resolve) => http.get({ host: '127.0.0.1', port, path: '/bridge/uploads', headers: { authorization: `Bearer ${TOKEN}` }, agent: false }, (res) => { res.resume(); resolve(res.statusCode); }));
  assert.equal(r, 404);
});

// ---- unit tests -------------------------------------------------------------------------------

test('sanitizeFilename: basics', () => {
  assert.equal(sanitizeFilename('report.pdf'), 'report.pdf');
  assert.equal(sanitizeFilename('my file (1).docx'), 'my_file_(1).docx');
  assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFilename('a\\b\\c.txt'), 'c.txt');
  assert.equal(sanitizeFilename('.hidden'), 'hidden');
  assert.equal(sanitizeFilename('...'), 'file');
  assert.equal(sanitizeFilename(''), 'file');
  assert.equal(sanitizeFilename('name.'), 'name');
  assert.equal(sanitizeFilename('a..b...c.txt'), 'a.b.c.txt');
  assert.equal(sanitizeFilename('foo/'), 'file');
});

test('sanitizeFilename: control chars, bidi overrides, null bytes, shell metachars', () => {
  assert.equal(sanitizeFilename('a\x00b\x1f\x7fc.txt'), 'abc.txt');
  assert.equal(sanitizeFilename('inv\u202Eoice.exe'), 'invoice.exe');
  assert.equal(sanitizeFilename('a\u200Bb\u2028c.txt'), 'abc.txt');
  assert.equal(sanitizeFilename('x;rm -rf $(id) `y` |&<>.txt'), 'x_rm_-rf_(id)_y.txt');
  assert.equal(sanitizeFilename('new\nline\r\n.txt'), 'newline.txt');
});

test('sanitizeFilename: unicode kept, NFC normalised, length capped with extension kept', () => {
  assert.equal(sanitizeFilename('Übung.txt'), 'Übung.txt');
  assert.equal(sanitizeFilename('U\u0308bung.txt'), 'Übung.txt'); // NFD -> NFC
  assert.equal(sanitizeFilename('日本語のファイル.md'), '日本語のファイル.md');
  assert.equal(sanitizeFilename('😀 smile.png'), 'smile.png');
  assert.ok(!/[^\p{L}\p{N}._+()[\]@,-]/u.test(sanitizeFilename('😀 smile 🎉.png')));
  const long = `${'a'.repeat(300)}.pdf`;
  const s = sanitizeFilename(long);
  assert.ok(Buffer.byteLength(s) <= 120);
  assert.ok(s.endsWith('.pdf'));
  const longCjk = `${'日'.repeat(200)}.xlsx`;
  const c = sanitizeFilename(longCjk);
  assert.ok(Buffer.byteLength(c) <= 120, String(Buffer.byteLength(c)));
  assert.ok(c.endsWith('.xlsx'));
  assert.ok(!c.includes('\uFFFD'));
  const hugeExt = sanitizeFilename(`x.${'e'.repeat(100)}`);
  assert.ok(hugeExt.length <= 120 && hugeExt.startsWith('x.'));
});

test('mime allow-list: defaults and configuration', () => {
  assert.equal(mimeAllowed('application/zip'), false);
  assert.equal(mimeAllowed('text/x-python'), true); // text/*
  assert.equal(mimeAllowed('image/svg+xml'), false);
  assert.equal(mimeAllowed(''), false);
  assert.ok(DEFAULT_ALLOWED_MIME.includes('application/pdf'));
  const cfg = loadUploadConfig({ BRIDGE_UPLOAD_ALLOWED_MIME: ' application/zip, Image/* ,text/plain' });
  assert.deepEqual(cfg.allowedMime, ['application/zip', 'image/*', 'text/plain']);
  assert.equal(mimeAllowed('application/zip', cfg.allowedMime), true);
  assert.equal(mimeAllowed('image/png', cfg.allowedMime), true);
  assert.equal(mimeAllowed('application/pdf', cfg.allowedMime), false);
  assert.equal(normalizeMime('Text/Plain; charset=UTF-8'), 'text/plain');
  assert.equal(normalizeMime('nonsense'), '');
});

test('loadUploadConfig defaults and overrides', () => {
  const d = loadUploadConfig({});
  assert.equal(d.dir, '/var/lib/hermes-ui-bridge/uploads');
  assert.equal(d.maxBytes, 20 * 1024 * 1024);
  assert.equal(d.retentionDays, 7);
  const c = loadUploadConfig({ BRIDGE_UPLOAD_DIR: '/x', BRIDGE_UPLOAD_MAX_BYTES: '1000', BRIDGE_UPLOAD_RETENTION_DAYS: '2', BRIDGE_UPLOAD_PUBLIC_DIR: '/y' });
  assert.deepEqual([c.dir, c.maxBytes, c.retentionDays, c.publicDir], ['/x', 1000, 2, '/y']);
  assert.equal(loadUploadConfig({ BRIDGE_UPLOAD_MAX_BYTES: 'abc' }).maxBytes, 20 * 1024 * 1024);
});

test('cleanupUploads: removes old files and old empty day dirs, keeps recent files, ignores foreign entries', async () => {
  const d = await mkdtemp(join(tmpdir(), 'hui-cleanup-'));
  try {
    const now = Date.parse('2026-10-20T12:00:00Z');
    const day = 24 * 3600_000;
    const mk = async (dayName, file, ageDays) => {
      await mkdir(join(d, dayName), { recursive: true });
      const p = join(d, dayName, file);
      await writeFile(p, 'x');
      const t = new Date(now - ageDays * day);
      await utimes(p, t, t);
      return p;
    };
    const old1 = await mk('2026-10-05', 'old1.txt', 15);
    const old2 = await mk('2026-10-05', 'old2.txt', 15);
    const edge = await mk('2026-10-13', 'edge-just-inside.txt', 6.9);
    const stale = await mk('2026-10-13', 'older.txt', 7.1);
    const fresh = await mk('2026-10-20', 'fresh.txt', 0);
    await mkdir(join(d, 'not-a-date'));
    await writeFile(join(d, 'not-a-date', 'keep.txt'), 'x');
    await writeFile(join(d, 'stray.txt'), 'x');
    await mkdir(join(d, '2026-09-01')); // empty old day dir -> removed
    await mkdir(join(d, '2026-10-20', 'subdir')); // only files are deleted, never directories

    const r = await cleanupUploads(d, { retentionDays: 7, now });
    assert.equal(r.removedFiles, 3);
    assert.equal(r.errors, 0);
    const exists = (p) => stat(p).then(() => true, () => false);
    assert.equal(await exists(old1), false);
    assert.equal(await exists(old2), false);
    assert.equal(await exists(stale), false);
    assert.equal(await exists(edge), true);
    assert.equal(await exists(fresh), true);
    assert.equal(await exists(join(d, '2026-10-05')), false, 'emptied old day dir removed');
    assert.equal(await exists(join(d, '2026-09-01')), false, 'empty old day dir removed');
    assert.equal(r.removedDirs, 2);
    assert.equal(await exists(join(d, '2026-10-13')), true, 'dir with remaining file kept');
    assert.equal(await exists(join(d, 'not-a-date', 'keep.txt')), true);
    assert.equal(await exists(join(d, 'stray.txt')), true);
    assert.equal(await exists(join(d, '2026-10-20', 'subdir')), true);
  } finally {
    await rm(d, { recursive: true, force: true });
  }
});

test('cleanupUploads: today\'s empty dir is kept; symlinks are not followed; missing dir is fine', async () => {
  const d = await mkdtemp(join(tmpdir(), 'hui-cleanup2-'));
  const outside = await mkdtemp(join(tmpdir(), 'hui-outside-'));
  try {
    const now = Date.parse('2026-10-20T12:00:00Z');
    await mkdir(join(d, '2026-10-20'));
    await mkdir(join(d, '2026-10-01'));
    const target = join(outside, 'precious.txt');
    await writeFile(target, 'x');
    const t = new Date(now - 30 * 24 * 3600_000);
    await utimes(target, t, t);
    await symlink(target, join(d, '2026-10-01', 'link.txt')); // old symlink inside an old day dir
    await symlink(outside, join(d, '2026-10-02')); // symlinked "day dir"
    const r = await cleanupUploads(d, { retentionDays: 7, now });
    assert.equal(r.removedFiles, 0);
    assert.equal((await stat(target)).isFile(), true, 'symlink target untouched');
    assert.equal((await readdir(outside)).length, 1);
    assert.equal((await stat(join(d, '2026-10-20'))).isDirectory(), true);
    assert.deepEqual(await cleanupUploads(join(d, 'nope'), { now }), { removedFiles: 0, removedDirs: 0, errors: 0 });
  } finally {
    await rm(d, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('BRIDGE_UPLOAD_GROUP_READ opts into group-readable uploads (default private)', () => {
  assert.equal(loadUploadConfig({}).groupRead, false);
  assert.equal(loadUploadConfig({ BRIDGE_UPLOAD_GROUP_READ: '1' }).groupRead, true);
});
