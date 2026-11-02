/// <reference types="node" />
// What "Öffnen" / "Sichern" do per device (webFile.ts): iOS installed web app, iOS Safari, Android Chrome (PWA and tab),
// desktop browsers, the desktop app's webview, and the environment detection behind it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeMime, detectWebFileEnv, MAX_IN_MEMORY_BYTES, MAX_VIEW_BYTES, openMethod, saveMethod, saveName, tabSafeMime, withDownloadParam, type WebFileEnv } from './webFile.ts';

const base: WebFileEnv = { ios: false, android: false, standalone: false, desktopApp: false, canShareFiles: false, anchorDownload: true };
const iosApp: WebFileEnv = { ...base, ios: true, standalone: true, canShareFiles: true };
const iosSafari: WebFileEnv = { ...base, ios: true, canShareFiles: true };
const androidPwa: WebFileEnv = { ...base, android: true, standalone: true, canShareFiles: true };
const desktopChrome: WebFileEnv = { ...base, canShareFiles: true }; // Chrome on Windows / macOS can share files too
const desktopFirefox: WebFileEnv = { ...base };
const desktopApp: WebFileEnv = { ...base, desktopApp: true, canShareFiles: false };

const pdf = { name: 'Rechnung.pdf', mime: 'application/pdf' };
const signed = { ...pdf, url: 'https://n.example.com/v1/attachments/tok' };
const docx = { name: 'b.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };

test('Sichern: iPhone / iPad → share sheet ("In Dateien sichern"); Android → download (1 tap to Downloads)', () => {
  assert.equal(saveMethod(iosApp, pdf), 'share');
  assert.equal(saveMethod(iosSafari, pdf), 'share');
  assert.equal(saveMethod(androidPwa, pdf), 'anchor');
  assert.equal(saveMethod({ ...androidPwa, anchorDownload: false }, pdf), 'share', 'no download support: share sheet');
});

test('Sichern: desktop browsers download, even where share would work', () => {
  assert.equal(saveMethod(desktopChrome, pdf), 'anchor');
  assert.equal(saveMethod(desktopFirefox, pdf), 'anchor');
});

test('Sichern: desktop app → Downloads folder via the app (the webview ignores <a download>)', () => {
  assert.equal(saveMethod(desktopApp, pdf), 'desktop');
  assert.equal(saveMethod(desktopApp, signed), 'desktop');
});

test('Sichern: iOS installed web app without file sharing never downloads or opens the URL (both trap the app)', () => {
  const oldIosApp = { ...iosApp, canShareFiles: false };
  assert.equal(saveMethod(oldIosApp, pdf), 'none');
  assert.equal(saveMethod(oldIosApp, signed), 'none');
  // the same phone in a Safari tab: the download works there
  assert.equal(saveMethod({ ...iosSafari, canShareFiles: false }, pdf), 'anchor');
});

test('Sichern: Android browser without share support downloads too', () => {
  assert.equal(saveMethod({ ...androidPwa, canShareFiles: false }, pdf), 'anchor');
});

test('Sichern: too large to load into memory → the URL (download variant) or a clear refusal', () => {
  const big = { ...pdf, size: MAX_IN_MEMORY_BYTES + 1 };
  assert.equal(saveMethod(iosApp, big), 'none');
  assert.equal(saveMethod(iosApp, { ...big, url: signed.url }), 'none', 'never the URL in the iOS app');
  assert.equal(saveMethod(desktopChrome, { ...big, url: signed.url }), 'openUrl');
  assert.equal(saveMethod(desktopApp, big), 'none');
});

test('Sichern: nothing works at all → visible "not possible" instead of silence', () => {
  assert.equal(saveMethod({ ...base, anchorDownload: false }, pdf), 'none');
});

test('Öffnen: PDFs open in the in-app viewer everywhere on the web (no leaving the installed app)', () => {
  for (const env of [iosApp, iosSafari, androidPwa, desktopChrome, desktopFirefox, desktopApp]) assert.equal(openMethod(env, signed), 'viewer');
  assert.equal(openMethod(iosApp, pdf), 'viewer');
  assert.equal(openMethod(iosApp, { ...pdf, mime: 'application/octet-stream' }), 'viewer', 'by extension');
  assert.equal(openMethod(iosApp, { ...pdf, size: MAX_VIEW_BYTES + 1 }), 'share', 'too large for the viewer: the system viewer');
  assert.equal(openMethod(iosApp, { ...pdf, size: MAX_IN_MEMORY_BYTES + 1 }), 'none', 'too large to load at all, no URL');
  assert.equal(openMethod(iosApp, { ...signed, size: MAX_IN_MEMORY_BYTES + 1 }), 'none', 'never the URL in the iOS app');
  assert.equal(openMethod(iosSafari, { ...signed, size: MAX_IN_MEMORY_BYTES + 1 }), 'url');
});

test('Öffnen im System: iOS app → share sheet only; elsewhere URL → new tab; bytes only → per device', () => {
  const sys = { system: true };
  assert.equal(openMethod(iosApp, signed, sys), 'share');
  assert.equal(openMethod({ ...iosApp, canShareFiles: false }, signed, sys), 'none');
  assert.equal(openMethod(iosSafari, signed, sys), 'url');
  assert.equal(openMethod(androidPwa, signed, sys), 'url');
  assert.equal(openMethod(desktopApp, signed, sys), 'url');
  assert.equal(openMethod(desktopChrome, docx), 'download', 'a tab would only download it under a random name');
  assert.equal(openMethod(desktopApp, docx), 'desktop');
  assert.equal(openMethod(iosApp, docx), 'share');
  assert.equal(openMethod(androidPwa, docx), 'share');
  assert.equal(openMethod({ ...iosApp, canShareFiles: false }, docx), 'none', 'blob windows of an installed iOS app open empty');
  assert.equal(openMethod({ ...iosSafari, canShareFiles: false }, docx), 'download');
  const png = { name: 'a.png', mime: 'image/png' };
  assert.equal(openMethod(desktopChrome, png), 'blobTab');
  assert.equal(openMethod({ ...iosSafari, canShareFiles: false }, png), 'blobTab');
});

type Nav = Parameters<typeof detectWebFileEnv>[0];
const win = (o: { ua: string; platform?: string; touch?: number; standalone?: boolean; displayMode?: string; canShare?: (d: { files: unknown[] }) => boolean; tauri?: boolean }): Nav => ({
  navigator: { userAgent: o.ua, platform: o.platform, maxTouchPoints: o.touch ?? 0, standalone: o.standalone, canShare: o.canShare },
  matchMedia: (q: string) => ({ matches: !!o.displayMode && q === `(display-mode: ${o.displayMode})` }),
  File: class {
    parts: unknown[];
    name: string;
    opts: { type?: string };
    constructor(parts: unknown[], name: string, opts: { type?: string }) {
      this.parts = parts;
      this.name = name;
      this.opts = opts;
    }
  } as never,
  HTMLAnchorElement: { prototype: { download: '' } },
  ...(o.tauri ? { __TAURI_INTERNALS__: {} } : {}),
});
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

test('detect: iPhone home-screen app (navigator.standalone) with file sharing', () => {
  const seen: unknown[] = [];
  const env = detectWebFileEnv(win({ ua: IPHONE, standalone: true, canShare: (d) => (seen.push(d.files[0]), true) }), pdf);
  assert.deepEqual(env, { ios: true, android: false, standalone: true, desktopApp: false, canShareFiles: true, anchorDownload: true });
  // canShare was asked about this file's name and type
  assert.equal((seen[0] as { name: string }).name, 'Rechnung.pdf');
  assert.equal((seen[0] as { opts: { type: string } }).opts.type, 'application/pdf');
});

test('detect: iPadOS with a desktop user agent counts as iOS (touch points)', () => {
  assert.equal(detectWebFileEnv(win({ ua: IPAD_DESKTOP_UA, platform: 'MacIntel', touch: 5 }), pdf).ios, true);
  assert.equal(detectWebFileEnv(win({ ua: IPAD_DESKTOP_UA, platform: 'MacIntel', touch: 0 }), pdf).ios, false, 'a real Mac');
});

test('detect: Android PWA via display-mode standalone; canShare false or throwing → no sharing', () => {
  const env = detectWebFileEnv(win({ ua: ANDROID, displayMode: 'standalone', canShare: () => false }), pdf);
  assert.equal(env.android, true);
  assert.equal(env.standalone, true);
  assert.equal(env.canShareFiles, false);
  const throwing = detectWebFileEnv(
    win({
      ua: ANDROID,
      canShare: () => {
        throw new Error('x');
      },
    }),
    pdf,
  );
  assert.equal(throwing.canShareFiles, false);
});

test('detect: desktop app webview (Tauri) and no window at all', () => {
  assert.equal(detectWebFileEnv(win({ ua: IPAD_DESKTOP_UA, tauri: true }), pdf).desktopApp, true);
  const none = detectWebFileEnv(undefined, pdf);
  assert.deepEqual(none, { ios: false, android: false, standalone: false, desktopApp: false, canShareFiles: false, anchorDownload: false });
});

test('saveName: keeps the name, adds a missing extension, never a path or a hidden file', () => {
  assert.equal(saveName('Rechnung März.pdf', 'application/pdf'), 'Rechnung März.pdf');
  assert.equal(saveName('Rechnung', 'application/pdf'), 'Rechnung.pdf');
  assert.equal(saveName('../../x/report', 'application/pdf'), 'report.pdf');
  assert.equal(saveName('.hidden.txt', 'text/plain'), 'hidden.txt');
  assert.equal(saveName('', 'image/jpeg'), 'file.jpg');
  assert.equal(saveName('a\u0000b.bin', 'application/octet-stream'), 'ab.bin');
  assert.ok(saveName('x'.repeat(300) + '.pdf', 'application/pdf').endsWith('.pdf'));
  assert.equal(saveName('x'.repeat(300) + '.pdf', 'application/pdf').length, 120);
});

test('withDownloadParam', () => {
  assert.equal(withDownloadParam('https://h.example/v1/attachments/t'), 'https://h.example/v1/attachments/t?download=1');
  assert.equal(withDownloadParam('https://h.example/a?x=1#f'), 'https://h.example/a?x=1&download=1#f');
});

test('a file that could run never becomes a blob tab, whatever the spelling; unknown waits for the bytes', () => {
  const active = ['text/html', 'TEXT/HTML; charset=utf-8', ' text/html', 'image/svg+xml', 'application/xhtml+xml', 'text/xml', 'application/xml', 'application/rss+xml', 'text/xsl', 'text/javascript', 'application/x-unknown', ''];
  for (const mime of active) {
    const f = { name: 'x', mime };
    assert.equal(tabSafeMime(mime), false, mime);
    assert.notEqual(openMethod(desktopChrome, f, { system: true }), 'blobTab', mime);
    assert.notEqual(openMethod({ ...iosSafari, canShareFiles: false }, f, { system: true }), 'blobTab', mime);
    assert.equal(openMethod({ ...desktopChrome, anchorDownload: false, canShareFiles: false }, f, { system: true }), 'none', mime);
  }
  for (const mime of ['application/pdf', 'image/png', 'image/jpeg', 'audio/mpeg', 'video/mp4', 'text/plain; charset=utf-8', 'application/json']) assert.equal(tabSafeMime(mime), true, mime);
  assert.equal(openMethod(desktopChrome, { name: 'x.bin', mime: 'application/octet-stream' }, { system: true }), 'blobTab');
  for (const mime of ['text/html', 'image/svg+xml', 'application/xhtml+xml', 'application/rss+xml']) assert.equal(activeMime(mime), true, mime);
  assert.equal(activeMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), false, 'a share sheet keeps real document types');
});

test('a type the browser would only download from a tab: under its own name, without an empty tab', () => {
  for (const f of [{ name: 'a.csv', mime: 'text/csv' }, { name: 'a.md', mime: 'text/markdown' }]) assert.equal(openMethod(desktopChrome, f, { system: true }), 'download');
});
