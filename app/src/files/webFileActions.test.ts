/// <reference types="node" />
// "Öffnen" / "Sichern" flows with fake browser pieces (webFileActions.ts): the share sheet gets the file with its name and
// type and nothing else, a refused share (expired tap) asks for a second tap that shares synchronously, downloads use a
// blob URL that is revoked, the desktop app saves through its command, failures come back as visible outcomes.
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { WebFileEnv, WebFileSource } from './webFile.ts';
import { FileFetchError, loadWebFile, openWebFile, resetWebFileCache, saveWebFile, type FileDeps } from './webFileActions.ts';

const iosApp: WebFileEnv = { ios: true, android: false, standalone: true, desktopApp: false, canShareFiles: true, anchorDownload: true };
const desktop: WebFileEnv = { ios: false, android: false, standalone: false, desktopApp: false, canShareFiles: false, anchorDownload: true };
const desktopApp: WebFileEnv = { ...desktop, desktopApp: true };

type FakeFile = Blob & { name: string; type: string };

function fake(env: WebFileEnv, o: { share?: (d: { files: File[] }) => Promise<void>; fetch?: () => Promise<Blob> } = {}) {
  const log: string[] = [];
  const shared: { files: File[] }[] = [];
  let fetches = 0;
  let n = 0;
  const later: (() => void)[] = [];
  const deps: FileDeps = {
    env,
    fetchBytes:
      o.fetch ??
      (async () => {
        fetches++;
        return new Blob(['%PDF-1.4'], { type: 'application/pdf' });
      }),
    makeFile: (blob, name, mime) => Object.assign(new Blob([blob], { type: mime }), { name }) as unknown as File,
    share:
      o.share ??
      (async (d) => {
        shared.push(d);
      }),
    openWindow: (url) => void log.push(`open ${url}`),
    openBlank: () => {
      log.push('blank');
      return { navigate: (u) => void log.push(`navigate ${u}`), close: () => void log.push('close') };
    },
    anchorDownload: (href, name) => void log.push(`download ${href} ${name}`),
    objectUrls: { create: () => `blob:fake/${++n}`, revoke: (u) => void log.push(`revoke ${u}`) },
    desktopSave: async (bytes, name, open) => {
      log.push(`desktop ${name} ${bytes.length} open=${open}`);
      return { path: `/home/u/Downloads/${name}`, opened: open };
    },
    later: (fn) => void later.push(fn),
  };
  return { deps, log, shared, later, fetches: () => fetches };
}

const pdf: WebFileSource = { key: 'k1', name: 'Rechnung März', mime: 'application/pdf' };
const signed: WebFileSource = { key: 'k2', name: 'a.pdf', mime: 'application/pdf', url: 'https://h.example/v1/attachments/t', downloadUrl: 'https://h.example/v1/attachments/t?download=1' };

beforeEach(() => resetWebFileCache());

test('iOS: Sichern shares exactly one file with name + type (no title / text that would become a second file)', async () => {
  const f = fake(iosApp);
  assert.deepEqual(await saveWebFile(pdf, f.deps), { kind: 'shared' });
  assert.equal(f.shared.length, 1);
  assert.deepEqual(Object.keys(f.shared[0]), ['files']);
  const file = f.shared[0].files[0] as unknown as FakeFile;
  assert.equal(file.name, 'Rechnung März.pdf');
  assert.equal(file.type, 'application/pdf');
});

test('iOS: share refused for lack of a fresh tap → needsTap; the second tap shares synchronously from the loaded file', async () => {
  let calls = 0;
  let syncCall = false;
  const share = async () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error('not allowed'), { name: 'NotAllowedError' });
  };
  const f = fake(iosApp, { share });
  assert.deepEqual(await saveWebFile(pdf, f.deps), { kind: 'needsTap' });
  const p = saveWebFile(pdf, f.deps);
  syncCall = calls === 2; // navigator.share was called before the first await (still inside the tap)
  assert.equal(syncCall, true);
  assert.deepEqual(await p, { kind: 'shared' });
  assert.equal(f.fetches(), 1, 'bytes loaded once');
});

test('iOS: the user closing the share sheet is a quiet cancel, other share errors are failures', async () => {
  const abort = fake(iosApp, { share: async () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' })) });
  assert.deepEqual(await saveWebFile(pdf, abort.deps), { kind: 'cancelled' });
  resetWebFileCache();
  const broken = fake(iosApp, { share: async () => Promise.reject(new TypeError('x')) });
  assert.deepEqual(await saveWebFile(pdf, broken.deps), { kind: 'failed', reason: 'error' });
});

test('a file opened in the viewer is saved without a second load (and synchronously)', async () => {
  const f = fake(iosApp);
  await loadWebFile(pdf, f.deps);
  let shared = 0;
  f.deps.share = async () => void shared++;
  const p = saveWebFile(pdf, f.deps);
  assert.equal(shared, 1);
  await p;
  assert.equal(f.fetches(), 1);
});

test('desktop browser: <a download> with a blob URL and the file name, URL revoked later', async () => {
  const f = fake(desktop);
  assert.deepEqual(await saveWebFile(pdf, f.deps), { kind: 'downloaded' });
  assert.deepEqual(f.log, ['download blob:fake/1 Rechnung März.pdf']);
  f.later.forEach((fn) => fn());
  assert.deepEqual(f.log.at(-1), 'revoke blob:fake/1');
});

test('desktop app: Sichern → Downloads; Öffnen im System → saved and opened by the app', async () => {
  const f = fake(desktopApp);
  assert.deepEqual(await saveWebFile(pdf, f.deps), { kind: 'savedTo', path: '/home/u/Downloads/Rechnung März.pdf' });
  assert.deepEqual(await openWebFile({ ...pdf, key: 'k3', name: 'x.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }, f.deps), { kind: 'opened' });
  assert.deepEqual(f.log, ['desktop Rechnung März.pdf 8 open=false', 'desktop x.docx 8 open=true']);
});

test('desktop app: a type the system must not open is only saved (reported as saved)', async () => {
  const f = fake(desktopApp);
  f.deps.desktopSave = async (_b, name) => ({ path: `/d/${name}`, opened: false });
  assert.deepEqual(await openWebFile({ key: 'k4', name: 'run.sh', mime: 'application/octet-stream' }, f.deps), { kind: 'savedTo', path: '/d/run.sh' });
});

test('fetch errors: gone → unavailable; cross-origin / network with a URL → the URL opens instead', async () => {
  const gone = fake(desktop, { fetch: async () => Promise.reject(new FileFetchError(404)) });
  assert.deepEqual(await saveWebFile(pdf, gone.deps), { kind: 'failed', reason: 'unavailable' });
  const cors = fake(desktop, { fetch: async () => Promise.reject(new FileFetchError(0)) });
  assert.deepEqual(await saveWebFile(signed, cors.deps), { kind: 'opened' });
  assert.deepEqual(cors.log, [`open ${signed.downloadUrl}`]);
  const iosTab = fake({ ...iosApp, standalone: false }, { fetch: async () => Promise.reject(new FileFetchError(0)) });
  await saveWebFile({ ...signed, key: 'k5' }, iosTab.deps);
  assert.deepEqual(iosTab.log, [`open ${signed.url}`], 'iOS Safari tab: the inline view (it has a share button)');
  resetWebFileCache();
  const iosHome = fake(iosApp, { fetch: async () => Promise.reject(new FileFetchError(0)) });
  assert.deepEqual(await saveWebFile({ ...signed, key: 'k5' }, iosHome.deps), { kind: 'failed', reason: 'error' });
  assert.deepEqual(iosHome.log, [], 'iOS home-screen app: never the URL (it would trap the app)');
});

test('too large: refused before loading, or after the bytes turn out too big', async () => {
  const f = fake(desktop);
  assert.deepEqual(await saveWebFile({ ...pdf, size: 200 * 1024 * 1024 }, f.deps), { kind: 'failed', reason: 'tooLarge' });
  assert.equal(f.fetches(), 0);
  const big = fake(desktop, { fetch: async () => ({ size: 101 * 1024 * 1024, type: 'application/pdf' }) as Blob });
  assert.deepEqual(await saveWebFile({ ...pdf, key: 'k6' }, big.deps), { kind: 'failed', reason: 'tooLarge' });
});

test('iOS app without file sharing: Sichern says "not possible here" instead of a dead-end download', async () => {
  const f = fake({ ...iosApp, canShareFiles: false });
  assert.deepEqual(await saveWebFile(pdf, f.deps), { kind: 'failed', reason: 'notHere' });
  assert.deepEqual(f.log, []);
});

test('Öffnen im System: URL in a new window; bytes only on a desktop browser → blank window opened in the tap, then navigated', async () => {
  const f = fake(desktop);
  assert.deepEqual(await openWebFile(signed, f.deps, { system: true }), { kind: 'opened' });
  assert.deepEqual(f.log, [`open ${signed.url}`]);
  const g = fake(desktop);
  const png: WebFileSource = { key: 'k7', name: 'b.png', mime: 'image/png' };
  const p = openWebFile(png, g.deps);
  assert.deepEqual(g.log, ['blank'], 'window opened synchronously (popup blockers)');
  assert.deepEqual(await p, { kind: 'opened' });
  assert.deepEqual(g.log, ['blank', 'navigate blob:fake/1']);
  const h = fake(desktop, { fetch: async () => Promise.reject(new FileFetchError(404)) });
  assert.deepEqual(await openWebFile({ ...png, key: 'k8' }, h.deps), { kind: 'failed', reason: 'unavailable' });
  assert.deepEqual(h.log, ['blank', 'close']);
});

test('Öffnen on a PDF without the viewer (caller skipped it) falls back to the system path', async () => {
  const f = fake(desktop);
  assert.deepEqual(await openWebFile(signed, f.deps), { kind: 'opened' });
  assert.deepEqual(f.log, [`open ${signed.url}`]);
});

const htmlBytes = () => Promise.resolve(new Blob(['<script>steal()</script>'], { type: 'text/html' }));
const fileOf = (f: ReturnType<typeof fake>, created: Blob[]) => {
  const create = f.deps.objectUrls.create;
  f.deps.objectUrls.create = (b) => (created.push(b), create(b));
};

for (const [name, mime] of [['report.html', 'text/html'], ['logo.svg', 'image/svg+xml'], ['page.xhtml', 'application/xhtml+xml'], ['feed.xml', 'text/xml']]) {
  test(`Öffnen of ${name}: downloaded under its name as plain bytes, no window, never a document of the app's origin`, async () => {
    const f = fake(desktop, { fetch: htmlBytes });
    const created: Blob[] = [];
    fileOf(f, created);
    assert.deepEqual(await openWebFile({ key: name, name, mime }, f.deps, { system: true }), { kind: 'downloaded' });
    assert.deepEqual(f.log, [`download blob:fake/1 ${name}`]);
    assert.equal(created[0].type, 'application/octet-stream');
  });
}

test('a mobile browser without file sharing: an .html is downloaded too', async () => {
  const f = fake({ ...desktop, android: true }, { fetch: htmlBytes });
  assert.deepEqual(await openWebFile({ key: 'm', name: 'r.html', mime: 'text/html' }, f.deps, { system: true }), { kind: 'downloaded' });
  assert.ok(!f.log.some((l) => l.startsWith('navigate') || l.startsWith('open')));
});

test('no download possible either: a visible failure, not a tab', async () => {
  const f = fake({ ...desktop, anchorDownload: false }, { fetch: htmlBytes });
  assert.deepEqual(await openWebFile({ key: 'n', name: 'r.html', mime: 'text/html' }, f.deps, { system: true }), { kind: 'failed', reason: 'notHere' });
  assert.deepEqual(f.log, []);
});

test('an unknown extension whose bytes say text/html: the blank window closes, the file is downloaded, as bytes', async () => {
  const f = fake(desktop, { fetch: htmlBytes });
  const created: Blob[] = [];
  fileOf(f, created);
  assert.deepEqual(await openWebFile({ key: 'u', name: 'r.bin', mime: 'application/octet-stream' }, f.deps, { system: true }), { kind: 'downloaded' });
  assert.deepEqual(f.log, ['blank', 'close', 'download blob:fake/1 r.bin']);
  assert.equal(created[0].type, 'application/octet-stream');
});

test('a second tap on a kept file takes the same way: still no tab', async () => {
  const f = fake(desktop, { fetch: htmlBytes });
  const src = { key: 'twice', name: 'r.bin', mime: 'application/octet-stream' };
  await openWebFile(src, f.deps, { system: true });
  f.log.length = 0;
  assert.deepEqual(await openWebFile(src, f.deps, { system: true }), { kind: 'downloaded' });
  assert.ok(!f.log.some((l) => l.startsWith('open') || l.startsWith('navigate')));
});

test('a file that is safe to view still opens in a tab', async () => {
  const f = fake(desktop, { fetch: async () => new Blob(['x'], { type: 'image/png' }) });
  assert.deepEqual(await openWebFile({ key: 'p', name: 'a.png', mime: 'image/png' }, f.deps, { system: true }), { kind: 'opened' });
  assert.deepEqual(f.log, ['blank', 'navigate blob:fake/1']);
});
