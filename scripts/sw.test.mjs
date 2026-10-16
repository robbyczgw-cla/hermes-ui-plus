// node --test scripts/sw.test.mjs — app/public/sw.js (offline shell / update behaviour) and the boot-recovery script
// of app/public/index.html, run in a vm with fake CacheStorage / fetch / clients (no browser).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const SW = readFileSync(new URL('../app/public/sw.js', import.meta.url), 'utf8');
const INDEX = readFileSync(new URL('../app/public/index.html', import.meta.url), 'utf8');
const ORIGIN = 'https://app.test';
const ENTRY = '/_expo/static/js/web/entry-a1.js';
const LAZY = '/_expo/static/js/web/Lazy-a1.js';
const FONT = '/assets/fonts/x-a1.ttf';
const shellHtml = (entry = ENTRY) => `<html><head><script data-pwa="sw">reg()</script></head><body><script src="${entry}" defer></script></body></html>`;

function res(body, { status = 200, ct = 'application/javascript', redirected = false, url = '', type = 'basic' } = {}) {
  const r = new Response(body, { status, headers: { 'content-type': ct } });
  Object.defineProperties(r, { redirected: { value: redirected }, url: { value: url }, type: { value: type } });
  return r;
}

class FakeCache {
  constructor() {
    this.m = new Map();
  }
  key(k) {
    return new URL(typeof k === 'string' ? k : k.url, ORIGIN).href;
  }
  async put(k, r) {
    this.m.set(this.key(k), { body: await r.text(), headers: r.headers });
  }
  async match(k) {
    const e = this.m.get(this.key(k));
    return e ? new Response(e.body, { headers: e.headers }) : undefined;
  }
  async keys() {
    return [...this.m.keys()].map((url) => ({ url }));
  }
  async delete(k) {
    return this.m.delete(this.key(k));
  }
}
class FakeCaches {
  constructor() {
    this.c = new Map(); // insertion order = creation order (CacheStorage keeps it too)
  }
  async open(n) {
    if (!this.c.has(n)) this.c.set(n, new FakeCache());
    return this.c.get(n);
  }
  async has(n) {
    return this.c.has(n);
  }
  async keys() {
    return [...this.c.keys()];
  }
  async delete(n) {
    return this.c.delete(n);
  }
}

/** load sw.js as web-finalize would write it; routes: path -> () => Response | throws (offline) */
function load({ version = 'v2', precache = [ENTRY, LAZY, FONT], routes = {}, caches = new FakeCaches(), windows = 1, shareMaxBody = 201_048_576, shareMaxFile = 20_000_000 } = {}) {
  const src = SW.replace(/const SHELL_VERSION = '[^']*';/, `const SHELL_VERSION = '${version}';`).replace(/const PRECACHE = \[[^\]]*\];/, `const PRECACHE = ${JSON.stringify(precache)};`)
    .replace(/const SHARE_MAX_BODY_BYTES = [\d_]+;/, `const SHARE_MAX_BODY_BYTES = ${shareMaxBody};`)
    .replace(/const SHARE_MAX_FILE_BYTES = [\d_]+;/, `const SHARE_MAX_FILE_BYTES = ${shareMaxFile};`);
  const listeners = {};
  const fetched = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (t, fn) => (listeners[t] = fn),
    skipWaiting: async () => {},
    clients: { matchAll: async () => Array.from({ length: windows }, () => ({})), claim: async () => {} },
    registration: {},
  };
  const fetch = async (req) => {
    const u = new URL(typeof req === 'string' ? req : req.url, ORIGIN);
    fetched.push(u.pathname + u.search);
    const r = routes[u.pathname + u.search] ?? routes[u.pathname];
    if (!r) return res('not found', { status: 404, ct: 'text/plain' });
    return r();
  };
  vm.runInNewContext(src, { self, caches, fetch, Response, Headers, URL, Promise, TransformStream, console });
  const fire = async (type, extra = {}) => {
    const waits = [];
    let responded;
    const ev = { ...extra, waitUntil: (p) => waits.push(p), respondWith: (p) => (responded = p) };
    listeners[type](ev);
    const r = responded ? await responded : undefined;
    const settled = await Promise.allSettled(waits);
    return { response: r, waits: settled };
  };
  const nav = (path) => fire('fetch', { request: { method: 'GET', url: ORIGIN + path, mode: 'navigate' } });
  const get = (path) => fire('fetch', { request: { method: 'GET', url: ORIGIN + path, mode: 'no-cors' } });
  return { caches, fire, nav, get, fetched };
}

const okRoutes = () => ({
  '/': () => res(shellHtml(), { ct: 'text/html' }),
  [ENTRY]: () => res('entry'),
  [LAZY]: () => res('lazy'),
  [FONT]: () => res('font', { ct: 'font/ttf' }),
  '/manifest.webmanifest': () => res('{}', { ct: 'application/manifest+json' }),
});

test('install: shell + every code chunk cached; missing icons are best effort', async () => {
  const w = load({ routes: okRoutes() });
  const { waits } = await w.fire('install');
  assert.equal(waits[0].status, 'fulfilled');
  const c = await w.caches.open('hui-shell-v2');
  assert.ok(await c.match('/'));
  assert.equal(await (await c.match(LAZY)).text(), 'lazy');
});

test('install fails (old cache stays in charge) on a missing chunk, an HTML fallback for code or a foreign shell', async () => {
  for (const patch of [
    (r) => delete r[LAZY],
    (r) => (r[LAZY] = () => res('<html>login</html>', { ct: 'text/html' })),
    (r) => (r[LAZY] = () => res('x', { redirected: true, url: `${ORIGIN}/login` })),
    (r) => (r['/'] = () => res('<html>other app</html>', { ct: 'text/html' })),
  ]) {
    const caches = new FakeCaches();
    (await caches.open('hui-shell-v1')).put('/', res(shellHtml('/_expo/static/js/web/entry-old.js'), { ct: 'text/html' }));
    const routes = okRoutes();
    patch(routes);
    const w = load({ routes, caches });
    const { waits } = await w.fire('install');
    assert.equal(waits[0].status, 'rejected');
    assert.deepEqual(await caches.keys(), ['hui-shell-v1'], 'half-filled new cache removed, previous kept');
  }
});

test('activate: keeps the newest previous cache while windows are open, drops older ones and foreign caches stay', async () => {
  const caches = new FakeCaches();
  for (const n of ['hui-shell-v0', 'other-app', 'hui-shell-v1', 'hui-shell-v2']) await caches.open(n);
  await load({ caches, windows: 1 }).fire('activate');
  assert.deepEqual(await caches.keys(), ['other-app', 'hui-shell-v1', 'hui-shell-v2']);
  await load({ caches, windows: 0 }).fire('activate');
  assert.deepEqual(await caches.keys(), ['other-app', 'hui-shell-v2']);
});

test('an old tab still gets its lazy chunk from the previous cache after a deploy removed it', async () => {
  const caches = new FakeCaches();
  const old = '/_expo/static/js/web/Lazy-old.js';
  await (await caches.open('hui-shell-v1')).put(old, res('old lazy'));
  await caches.open('hui-shell-v2');
  const w = load({ caches, routes: okRoutes() });
  const { response } = await w.get(old);
  assert.equal(await response.text(), 'old lazy');
  assert.ok(!w.fetched.includes(old));
});

test('navigation: only this build\'s shell replaces the offline "/", offline falls back to it', async () => {
  const caches = new FakeCaches();
  const routes = okRoutes();
  routes['/login'] = () => res('<html>private login page</html>', { ct: 'text/html' });
  routes['/stale'] = () => res(shellHtml('/_expo/static/js/web/entry-other.js'), { ct: 'text/html' });
  routes['/chat/1'] = () => res(shellHtml(), { ct: 'text/html' });
  const w = load({ caches, routes });
  await w.nav('/login');
  await w.nav('/stale');
  assert.equal(await (await caches.open('hui-shell-v2')).match('/'), undefined, 'foreign / other-build pages never cached');
  await w.nav('/chat/1');
  assert.ok(await (await caches.open('hui-shell-v2')).match('/'));
  routes['/x'] = () => Promise.reject(new TypeError('offline'));
  const { response } = await w.nav('/x');
  assert.match(await response.text(), /data-pwa="sw"/);
});

test('static: query variants and unknown paths are not intercepted; known assets are exact-matched', async () => {
  const caches = new FakeCaches();
  await (await caches.open('hui-shell-v2')).put(FONT, res('cached font'));
  const w = load({ caches, routes: okRoutes() });
  assert.equal((await w.get(`${FONT}?variant=2`)).response, undefined);
  assert.equal((await w.get('/assets/private/avatar.png')).response, undefined);
  assert.equal(await (await w.get(FONT)).response.text(), 'cached font');
});

// ------------------------------------------------------------------ index.html boot recovery

function bootScript() {
  const m = INDEX.match(/<script>\s*(\(function \(\) \{[\s\S]*?\}\)\(\);)\s*<\/script>/);
  assert.ok(m, 'boot script found');
  return m[1];
}

test('boot recovery: Reload removes only Hermes\'s worker and caches; #root watcher waits for the parser', async () => {
  const els = {};
  const el = (id) => (els[id] = { id, style: {}, textContent: '', className: '', childElementCount: 0, remove() {} });
  ['boot', 'boot-name', 'boot-btn', 'boot-msg'].forEach(el);
  const docListeners = {};
  const unregistered = [];
  const deleted = [];
  const reg = (scope, script) => ({ scope, active: { scriptURL: script }, unregister: async () => unregistered.push(scope + script) });
  let reloaded = 0;
  let observed = 0;
  const ctx = {
    navigator: {
      language: 'en',
      serviceWorker: { getRegistrations: async () => [reg(`${ORIGIN}/`, `${ORIGIN}/sw.js`), reg(`${ORIGIN}/other/`, `${ORIGIN}/other/push.js`), reg(`${ORIGIN}/`, `${ORIGIN}/firebase-messaging-sw.js`)] },
    },
    caches: { keys: async () => ['hui-shell-v1', 'other-app', 'workbox-precache'], delete: async (k) => deleted.push(k) },
    document: {
      getElementById: (id) => els[id] || null,
      querySelector: () => null,
      title: 'Hermes',
      addEventListener: (t, fn) => (docListeners[t] = fn),
    },
    location: { origin: ORIGIN, reload: () => reloaded++ },
    window: {},
    MutationObserver: class {
      observe() {
        observed++;
      }
      disconnect() {}
    },
    matchMedia: () => ({ matches: false }),
    addEventListener: () => {},
    setTimeout: () => 0,
    URL,
    Promise,
    String,
    Math,
    parseInt,
  };
  ctx.window = ctx;
  ctx.window.MutationObserver = ctx.MutationObserver;
  vm.runInNewContext(bootScript(), ctx);
  // #root does not exist yet while the script runs
  assert.equal(observed, 0);
  assert.equal(typeof docListeners.DOMContentLoaded, 'function');
  el('root');
  docListeners.DOMContentLoaded();
  assert.equal(observed, 1, 'observer installed once #root exists');
  els['boot-btn'].onclick();
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(unregistered, [`${ORIGIN}/${ORIGIN}/sw.js`]);
  assert.deepEqual(deleted, ['hui-shell-v1']);
  assert.equal(reloaded, 1);
});

/** push handler with a focused window: WebKit gets a quiet, immediately closed notification; others none */
async function pushWithFocusedWindow(ua) {
  const listeners = {};
  const shown = [];
  const closed = [];
  const posted = [];
  const self = {
    location: { origin: ORIGIN },
    navigator: { userAgent: ua },
    addEventListener: (t, fn) => (listeners[t] = fn),
    skipWaiting: async () => {},
    clients: { matchAll: async () => [{ visibilityState: 'visible', focused: true, postMessage: (m) => posted.push(m) }], claim: async () => {} },
    registration: {
      showNotification: async (title, o) => void shown.push({ title, ...o }),
      getNotifications: async ({ tag }) => shown.filter((n) => n.tag === tag).map((n) => ({ close: () => closed.push(n.tag) })),
    },
  };
  vm.runInNewContext(SW, { self, caches: new FakeCaches(), fetch: async () => res('x'), Response, Headers, URL, Promise, console });
  const waits = [];
  listeners.push({ data: { json: () => ({ title: 'Hermes', body: 'Antwort fertig', data: { sessionId: 's1' } }) }, waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return { shown, closed, posted };
}

test('push while the app is focused: WebKit still shows (and closes) a notification, Chrome does not', async () => {
  const safari = await pushWithFocusedWindow('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1');
  assert.equal(safari.posted.length, 1);
  assert.equal(safari.shown.length, 1);
  assert.equal(safari.shown[0].silent, true);
  assert.deepEqual(safari.closed, ['hui-live']);
  const chrome = await pushWithFocusedWindow('Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36');
  assert.equal(chrome.posted.length, 1);
  assert.equal(chrome.shown.length, 0);
});

function shareRequest(form, headers = new Headers()) {
  const request = new Request(`${ORIGIN}/share-target`, { method: 'POST', body: form, headers });
  return { method: request.method, url: request.url, headers: request.headers, body: request.body, mode: 'navigate', formData: () => request.formData() };
}

test('share target: a POST to /share-target is stored in its own cache and redirects to /#huiShare=<id>', async () => {
  const caches = new FakeCaches();
  const stale = await caches.open('hui-share-inbox');
  const oldId = (Date.now() - 2 * 24 * 3600 * 1000).toString(36) + '-old';
  await stale.put(`/__hui-share/${oldId}/meta`, new Response('{}'));
  const w = load({ caches });
  const form = new FormData();
  form.set('title', 'Page');
  form.set('text', 'look');
  form.set('url', 'https://example.com/a');
  form.append('files', new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' }));
  const request = shareRequest(form);
  const { response } = await w.fire('fetch', { request });
  assert.equal(response.status, 303);
  const loc = new URL(response.headers.get('location'));
  assert.equal(loc.origin, ORIGIN);
  const id = /^#huiShare=(.+)$/.exec(loc.hash)?.[1];
  assert.match(id, /^[a-z0-9]+-[a-z0-9]+$/);
  const c = await caches.open('hui-share-inbox');
  const meta = await (await c.match(`/__hui-share/${id}/meta`)).json();
  assert.deepEqual(meta, { title: 'Page', text: 'look', url: 'https://example.com/a', files: [{ name: 'doc.pdf', type: 'application/pdf' }] });
  assert.equal(await (await c.match(`/__hui-share/${id}/0`)).text(), '%PDF-1.4');
  assert.equal(await c.match(`/__hui-share/${oldId}/meta`), undefined, 'shares older than a day are dropped');
  assert.deepEqual(await caches.keys(), ['hui-share-inbox'], 'never written into a shell cache');
  assert.deepEqual(w.fetched, [], 'nothing goes to the network');
});

test('share target: an unreadable POST redirects to #huiShare=failed; other POSTs and foreign origins pass through', async () => {
  const w = load();
  const bad = await w.fire('fetch', { request: { method: 'POST', url: `${ORIGIN}/share-target`, mode: 'navigate', formData: async () => Promise.reject(new Error('bad')) } });
  assert.equal(new URL(bad.response.headers.get('location')).hash, '#huiShare=failed');
  assert.equal((await w.fire('fetch', { request: { method: 'POST', url: `${ORIGIN}/v1/chat/completions` } })).response, undefined);
  assert.equal((await w.fire('fetch', { request: { method: 'POST', url: 'https://other.test/share-target' } })).response, undefined);
});

test('share target: foreign forms and script POSTs cannot populate the inbox', async () => {
  for (const extra of [
    { mode: 'navigate', headers: new Headers({ origin: 'https://other.test' }) },
    { mode: 'navigate', headers: new Headers({ 'sec-fetch-site': 'cross-site' }) },
    { mode: 'navigate', headers: new Headers({ 'sec-fetch-site': 'same-site' }) },
    { mode: 'cors', headers: new Headers({ origin: ORIGIN }) },
  ]) {
    const w = load();
    let parsed = false;
    const { response } = await w.fire('fetch', { request: {
      method: 'POST', url: `${ORIGIN}/share-target`, ...extra,
      formData: async () => { parsed = true; return new FormData(); },
    } });
    assert.equal(response.status, 403);
    assert.equal(parsed, false, 'reject before parsing or storing attacker content');
    assert.deepEqual(await w.caches.keys(), []);
  }
});

test('share target: native launches with no origin or an opaque origin still work', async () => {
  for (const origin of [undefined, 'null', ORIGIN]) {
    const w = load();
    const form = new FormData();
    form.set('text', 'shared deliberately');
    const headers = new Headers({ 'sec-fetch-site': 'none' });
    if (origin) headers.set('origin', origin);
    const { response } = await w.fire('fetch', { request: shareRequest(form, headers) });
    assert.equal(response.status, 303);
    assert.match(response.headers.get('location'), /#huiShare=[a-z0-9]+-[a-z0-9]+$/);
  }
});

test('share target: rejects oversized bodies with and without Content-Length before storage', async () => {
  for (const declared of [false, true]) {
    const w = load({ shareMaxBody: 1024 });
    const form = new FormData();
    form.set('text', 'x'.repeat(2048));
    const request = shareRequest(form);
    if (declared) request.headers.set('content-length', '201048577');
    const { response } = await w.fire('fetch', { request });
    assert.equal(new URL(response.headers.get('location')).hash, '#huiShare=failed');
    assert.deepEqual(await w.caches.keys(), [], 'oversized content never reaches CacheStorage');
  }
});

test('share target: bounds each file and refuses excessive file counts without silently dropping files', async () => {
  for (const files of [1, 21]) {
    const w = load({ shareMaxFile: 4 });
    const form = new FormData();
    for (let i = 0; i < files; i++) form.append('files', new File([files === 1 ? '12345' : 'x'], `test-${i}.pdf`, { type: 'application/pdf' }));
    const { response } = await w.fire('fetch', { request: shareRequest(form) });
    assert.equal(new URL(response.headers.get('location')).hash, '#huiShare=failed');
    assert.deepEqual(await w.caches.keys(), []);
  }
});

test('share target: a failed cache write rolls back every file of that share', async () => {
  const caches = new FakeCaches();
  const cache = await caches.open('hui-share-inbox');
  const existing = `/__hui-share/${Date.now().toString(36)}-existing/meta`;
  await cache.put(existing, Response.json({ text: 'keep existing share' }));
  const put = cache.put.bind(cache);
  cache.put = async (k, r) => {
    if (k.endsWith('/1')) throw new Error('quota exceeded');
    return put(k, r);
  };
  const w = load({ caches });
  const form = new FormData();
  for (let i = 0; i < 3; i++) form.append('files', new File(['private test content'], `test-${i}.pdf`, { type: 'application/pdf' }));
  const { response } = await w.fire('fetch', { request: shareRequest(form) });
  assert.equal(new URL(response.headers.get('location')).hash, '#huiShare=failed');
  assert.deepEqual((await cache.keys()).map((r) => new URL(r.url).pathname), [existing]);
});

test('share target: stale unconsumed files are pruned on normal app visits without another share', async () => {
  for (const action of ['activate', 'navigate']) {
    const caches = new FakeCaches();
    const cache = await caches.open('hui-share-inbox');
    const old = `/__hui-share/${(Date.now() - 2 * 24 * 3600 * 1000).toString(36)}-old/`;
    const fresh = `/__hui-share/${Date.now().toString(36)}-fresh/`;
    for (const base of [old, fresh]) {
      await cache.put(base + 'meta', Response.json({ text: 'test share' }));
      await cache.put(base + '0', new Response('test file'));
    }
    const w = load({ caches, routes: okRoutes() });
    if (action === 'activate') await w.fire('activate');
    else await w.nav('/');
    assert.equal(await cache.match(old + 'meta'), undefined);
    assert.equal(await cache.match(old + '0'), undefined);
    assert.ok(await cache.match(fresh + 'meta'));
    assert.ok(await cache.match(fresh + '0'));
  }
});
