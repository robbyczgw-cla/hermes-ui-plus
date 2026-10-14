/*
 * Hermes UI web app – minimal service worker (registered by the build in scripts/build-web.sh only).
 * Caches ONLY the app shell of THIS build: index.html (stored under '/'), manifest, icons and the content-hashed
 * bundles under /_expo/static/ (incl. lazy chunks) and /assets/. scripts/web-finalize.mjs writes the exact file list
 * of the export into PRECACHE and a content hash of the whole final export into SHELL_VERSION (cache hui-shell-<v>).
 * Never caches API calls (/v1/…, /api, /bridge), other origins, non-GET requests or URLs with a query string.
 *
 * Install is all-or-nothing for executable code: the shell ('/', must be the Hermes shell) and every /_expo/static/
 * file must load as real content (no error status, no opaque response, no HTML fallback for a script, no redirect
 * to another path). Otherwise the install fails and the previous, complete worker + cache stay in charge. Icons,
 * manifest and /assets/ files are best effort.
 * Activation keeps the newest previous cache while windows are open: a tab still running the previous build can
 * load its lazy chunks after a deploy that removed them from the server. Older caches are deleted.
 * Navigations are network-first (a new deploy shows up on the next start); only the canonical shell of this build
 * (marker + entry scripts in PRECACHE) replaces the cached '/', never another page of the origin. Offline: cached '/'.
 *
 * Static hosts (tailscale serve, Go's http.FileServer, many CDNs) answer /index.html with a redirect to '/'.
 * A redirected response must never answer a navigation (Chrome shows its error page instead), so the shell is
 * fetched as '/' and every cached response is stored "un-redirected".
 */
const SHELL_VERSION = 'dev';
const PREFIX = 'hui-shell-';
const CACHE = `${PREFIX}${SHELL_VERSION}`;
/** best-effort shell files (not executable code) */
const SHELL = ['/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];
/** hashed bundles / lazy chunks / assets of this build (filled in by scripts/web-finalize.mjs) */
const PRECACHE = [];
/** present only in the Hermes shell (the registration script added by scripts/web-finalize.mjs) */
const SHELL_MARKER = 'data-pwa="sw"';
/** previous caches kept for still-open tabs of older builds */
const KEEP_PREVIOUS = 1;

const KNOWN = new Set([...SHELL, ...PRECACHE]);
const BUILD_FILES = new Set(PRECACHE);
const isCode = (path) => path.startsWith('/_expo/static/');

/** a copy without the `redirected` flag (same body, status, headers) */
function plain(res) {
  if (!res || !res.redirected) return Promise.resolve(res);
  return res.blob().then((body) => new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers }));
}

/** throws unless `res` is real same-origin content for `path` (code: never an HTML fallback / login page) */
function verify(path, res, code) {
  if (!res || !res.ok) throw new Error(`${path}: HTTP ${res ? res.status : '?'}`);
  if (res.type === 'opaque' || res.type === 'opaqueredirect' || res.type === 'error') throw new Error(`${path}: ${res.type} response`);
  if (res.redirected && res.url && new URL(res.url).pathname !== path) throw new Error(`${path}: redirected to another path`);
  if (code && /text\/html/i.test(res.headers.get('content-type') || '')) throw new Error(`${path}: HTML instead of code`);
}

function fetchInto(cache, path) {
  return fetch(path, { cache: 'no-cache' }).then((res) => {
    verify(path, res, isCode(path));
    return plain(res).then((r) => cache.put(path, r));
  });
}

/** the Hermes shell of THIS build: marker present, every entry script is one of this build's files */
function isOwnShell(html) {
  if (!html.includes(SHELL_MARKER)) return false;
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => new URL(m[1], self.location.origin).pathname);
  return scripts.every((p) => !isCode(p) || !BUILD_FILES.size || BUILD_FILES.has(p));
}

/** store `res` (metadata) / `copy` (body) as '/' when it is this build's shell; resolves false otherwise */
function storeShell(res, copy) {
  if (!res || !res.ok || res.type === 'opaque' || res.type === 'opaqueredirect') return Promise.resolve(false);
  if (!/text\/html/i.test(res.headers.get('content-type') || '')) return Promise.resolve(false);
  if (res.redirected && res.url && !['/', '/index.html'].includes(new URL(res.url).pathname)) return Promise.resolve(false);
  return copy.text().then((html) => {
    if (!isOwnShell(html)) return false;
    const headers = new Headers(res.headers);
    return caches
      .open(CACHE)
      .then((c) => c.put('/', new Response(html, { status: 200, statusText: 'OK', headers })))
      .then(() => true);
  });
}

/** own caches, current first, then the previous ones newest first */
function ownCaches() {
  return caches.keys().then((keys) => [CACHE, ...keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).reverse()]);
}

function matchOwn(key) {
  return ownCaches().then((names) =>
    names.reduce((p, name) => p.then((hit) => hit || caches.has(name).then((ok) => (ok ? caches.open(name).then((c) => c.match(key)) : undefined))), Promise.resolve(undefined)),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) =>
        fetch('/', { cache: 'no-cache' })
          .then((res) => {
            verify('/', res, false);
            return storeShell({ ok: res.ok, type: res.type, headers: res.headers, redirected: false }, res).then((ok) => {
              if (!ok) throw new Error('/: not the Hermes shell of this build');
            });
          })
          // executable code: all or nothing
          .then(() => Promise.all(PRECACHE.filter(isCode).map((u) => fetchInto(c, u))))
          // icons, manifest, images, fonts: best effort
          .then(() => Promise.allSettled([...SHELL, ...PRECACHE.filter((u) => !isCode(u))].map((u) => fetchInto(c, u)))),
      )
      // a failed install must not leave a half-filled cache behind; the previous worker stays active
      .catch((e) => caches.delete(CACHE).then(() => Promise.reject(e)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([caches.keys(), self.clients.matchAll({ type: 'window', includeUncontrolled: true })])
      .then(([keys, wins]) => {
        const old = keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE);
        const keep = new Set(wins.length ? old.slice(-KEEP_PREVIOUS) : []);
        return Promise.all(old.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
      })
      .then(() => self.clients.claim()),
  );
});

function isApi(url) {
  return /^\/(v1|api|bridge)(\/|$)/.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API on another host, images, …
  if (isApi(url)) return; // never touch API traffic

  if (req.mode === 'navigate') {
    const net = fetch(req).then((res) => ({ res, copy: res.clone() }));
    event.respondWith(
      net.then(
        (x) => x.res,
        () => matchOwn('/').then((r) => (r ? plain(r) : Response.error())),
      ),
    );
    // refresh the offline shell within the event's lifetime (only this build's own shell)
    event.waitUntil(net.then((x) => storeShell(x.res, x.copy)).catch(() => false));
    return;
  }

  if (url.search) return; // query variants are never served from / written to the cache
  const path = url.pathname;
  const known = KNOWN.has(path);
  // an older build's chunk (open tab of the previous version): only from our caches, never stored
  if (!known && !isCode(path)) return;
  event.respondWith(
    matchOwn(path).then((hit) => {
      if (hit) return plain(hit);
      return fetch(req).then((res) => {
        if (known) {
          let ok = true;
          try {
            verify(path, res, isCode(path));
          } catch {
            ok = false;
          }
          if (ok) {
            const copy = res.clone();
            event.waitUntil(caches.open(CACHE).then((c) => plain(copy).then((r) => c.put(path, r))).catch(() => {}));
          }
        }
        return res;
      });
    }),
  );
});

/*
 * Web Push. The server (UI bridge) sends an encrypted JSON payload
 * {title, body, tag, silent, data:{src, profileId, sessionId?, agent?, messageId?}}. A visible + focused app
 * window gets the event as a message instead (it shows the message live); otherwise a notification is shown.
 * Click: focus an open window and tell it which chat to open, or open a new one with ?huiPush=<data>.
 */
const UA = (self.navigator && self.navigator.userAgent) || '';
const IS_WEBKIT = /AppleWebKit/.test(UA) && !/Chrome|Chromium|CriOS|Edg|OPR/.test(UA);

self.addEventListener('push', (event) => {
  let p = {};
  try {
    p = event.data ? event.data.json() : {};
  } catch {
    p = { title: 'Hermes', body: event.data ? event.data.text() : '' };
  }
  const title = typeof p.title === 'string' && p.title ? p.title : 'Hermes';
  const data = p.data && typeof p.data === 'object' ? p.data : {};
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const focused = wins.find((w) => w.visibilityState === 'visible' && w.focused);
      if (focused) {
        focused.postMessage({ type: 'hui-push', data });
        // WebKit (Safari / iOS home-screen apps) requires a visible notification for EVERY push and may revoke
        // the subscription after a few silent ones: show a quiet one and close it right away.
        if (!IS_WEBKIT) return undefined;
        return self.registration
          .showNotification(title, { body: typeof p.body === 'string' ? p.body : '', tag: 'hui-live', silent: true, data, icon: '/icons/icon-192.png' })
          .then(() => self.registration.getNotifications({ tag: 'hui-live' }))
          .then((list) => list.forEach((n) => n.close()));
      }
      return self.registration.showNotification(title, {
        body: typeof p.body === 'string' ? p.body : '',
        tag: typeof p.tag === 'string' ? p.tag : undefined,
        renotify: Boolean(p.tag),
        silent: p.silent === true,
        data,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
      });
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (win) {
        win.postMessage({ type: 'hui-push-open', data });
        return win.focus();
      }
      return self.clients.openWindow('/?huiPush=' + encodeURIComponent(JSON.stringify(data)));
    }),
  );
});
