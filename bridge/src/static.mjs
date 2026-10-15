// Optional static web app (PWA) served by the bridge itself: BRIDGE_WEB_DIR=<dist/web>. Same origin as the API, so
// the web app needs no CORS entry and the pair link can be `https://<bridge>/#pair?...`.
//
// Only GET/HEAD for paths outside the API namespaces (/v1, /api, /bridge, /health*) reach this module. Path safety:
// server.mjs already rejects dot segments, encoded slashes/dots, backslashes and control characters
// (paths.mjs); static-safe.mjs (shared with the adapter) additionally refuses hidden segments (".env", ".git";
// ".well-known" is allowed) and compares REAL paths, so a symlink inside the web dir cannot point outside of it.
// Precompressed siblings (`file.br`, `file.gz`, written by scripts/web-precompress.mjs) are preferred when they
// are not older than the original; otherwise compressible text is gzipped on the fly (small LRU, encoding.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { COMPRESSIBLE_EXT, MAX_COMPRESS_BYTES, MIN_COMPRESS_BYTES, acceptedEncodings, createGzipCache } from './encoding.mjs';
import { checkRequestPath } from './paths.mjs';
import { precompressedSibling, realStaticRoot, resolveStaticFile } from './static-safe.mjs';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
};

/** CDNs the hui-html sandbox may load scripts / styles / fonts from (mirrors app/src/sandbox/shell.ts CDN_ORIGINS). */
export const SANDBOX_CDN_ORIGINS = ['https://cdn.jsdelivr.net', 'https://unpkg.com', 'https://cdnjs.cloudflare.com', 'https://esm.sh'];

/**
 * Content-Security-Policy for the app shell (HTML responses). Constraints from the real bundle (verified against an
 * Expo web export in a browser, see docs/BRIDGE.md "Web app CSP"):
 *  - the hui-html sandbox is a `srcdoc` iframe: it INHERITS this policy (and narrows it with its own meta CSP), so
 *    script-src must allow what model widgets need: inline scripts, eval and the sandbox CDNs. Hashes / nonces
 *    are impossible for the same reason (they disable 'unsafe-inline' for the iframe too);
 *  - index.html has inline boot / service-worker scripts; react-native-web injects <style> elements and inline styles;
 *  - the QR scanner loads zxing WebAssembly from a CDN (connect + wasm compile);
 *  - the app talks to user-configured servers / providers and loads images from any https host after a tap.
 * What it buys: no plugins, no <base> hijack, no framing (clickjacking), forms only to self, no plain-http
 * connections or images on HTTPS shells; direct HTTP LAN shells also permit http:. Workers use self / blob:.
 */
export function appCsp({ allowHttp = false } = {}) {
  const cdn = SANDBOX_CDN_ORIGINS.join(' ');
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' ${cdn}`,
    `style-src 'self' 'unsafe-inline' ${cdn}`,
    `font-src 'self' data: ${cdn}`,
    `img-src 'self' data: blob: https:${allowHttp ? ' http:' : ''}`,
    "media-src 'self' data: blob: https:",
    `connect-src 'self' https: wss:${allowHttp ? ' http:' : ''}`,
    "worker-src 'self' blob:",
    "frame-src 'self' blob: data:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** BRIDGE_WEB_CSP: on (default, enforced) | report-only | off. */
export function cspHeader(mode = 'on', options) {
  const m = String(mode || 'on').trim().toLowerCase();
  if (/^(off|0|false|no)$/.test(m)) return null;
  return { name: m === 'report-only' ? 'content-security-policy-report-only' : 'content-security-policy', value: appCsp(options) };
}

/** Paths that always belong to the API, never to the web app. */
export function isApiPath(p) {
  // `/p/<profile>/…`: Hermes profile multiplexing (src/profiles.mjs), never a web app file
  return p === '/p' || p.startsWith('/p/') || p === '/v1' || p.startsWith('/v1/') || p === '/api' || p.startsWith('/api/') || p === '/bridge' || p.startsWith('/bridge/') || p === '/health' || p.startsWith('/health/');
}

export { resolveStaticFile };

/**
 * @param {{dir?: string, logger?: any, csp?: string}} o  csp: BRIDGE_WEB_CSP (on | report-only | off)
 * @returns {{enabled: boolean, root: string, matches(req): boolean, handle(req, res): void}}
 */
export function createStatic({ dir, logger, csp: cspMode } = {}) {
  const root = realStaticRoot(dir);
  if (dir && !root) logger?.warn?.('BRIDGE_WEB_DIR does not exist, web app disabled', {});
  const gzipCache = createGzipCache();
  const pathOf = (req) => { const c = checkRequestPath(req.url); return c.ok ? c.path : null; };

  function matches(req) {
    if (!root || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
    const p = pathOf(req);
    return p !== null && !isApiPath(p);
  }

  function handle(req, res) {
    const p = pathOf(req);
    const hit = p === null ? null : resolveStaticFile(root, p);
    if (!hit) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' });
      return res.end('not found\n');
    }
    const { file, stat: st } = hit;
    const ext = path.extname(file).toLowerCase();
    const hashed = /[._-][0-9a-f]{8,}\.(js|css|woff2?|png|svg|ttf)$/i.test(file) || file.includes(`${path.sep}_expo${path.sep}static${path.sep}`);
    const headers = {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
    };
    // Forwarded scheme can only tighten the policy; it cannot downgrade a TLS socket.
    const allowHttp = !req.socket?.encrypted && !req.headers['x-forwarded-proto'] && !req.headers.forwarded;
    const csp = cspHeader(cspMode, { allowHttp });
    if (csp && ext === '.html') headers[csp.name] = csp.value;
    const head = req.method === 'HEAD';
    let size = st.size;
    let source = file;
    let gzipKey = null;
    if (COMPRESSIBLE_EXT.has(ext) && size >= MIN_COMPRESS_BYTES) {
      headers.vary = 'Accept-Encoding';
      const codings = acceptedEncodings(req.headers['accept-encoding']);
      for (const coding of codings) {
        const sib = precompressedSibling(root, file, st, coding);
        if (sib) {
          source = sib.file;
          size = sib.size;
          headers['content-encoding'] = coding;
          break;
        }
      }
      if (!headers['content-encoding'] && codings.includes('gzip') && st.size <= MAX_COMPRESS_BYTES) {
        gzipKey = `${file}\0${st.mtimeMs}\0${st.size}`;
        headers['content-encoding'] = 'gzip';
      }
    }
    if (gzipKey) {
      gzipCache.gzip(gzipKey, () => fs.promises.readFile(file)).then(
        (body) => {
          if (res.destroyed) return;
          res.writeHead(200, { ...headers, 'content-length': body.length });
          res.end(head ? undefined : body);
        },
        () => { if (!res.headersSent) res.writeHead(500).end(); else res.destroy(); },
      );
      return;
    }
    res.writeHead(200, { ...headers, 'content-length': size });
    if (head) return res.end();
    const s = fs.createReadStream(source);
    s.on('error', () => res.destroy());
    s.pipe(res);
  }

  return { enabled: Boolean(root), root: root ?? '', matches, handle };
}
