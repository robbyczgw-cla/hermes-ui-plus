// Minimal static server for a built web bundle (dist/web) with SPA fallback – the recorder uses it when no
// app is running at DEMO_APP_URL. Serves precompressed .br/.gz siblings when the client accepts them.
import http from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.map': 'application/json',
};

export function serveStatic(dir, port) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let f = normalize(join(dir, p));
    if (!f.startsWith(dir)) return res.writeHead(403).end();
    if (!existsSync(f) || statSync(f).isDirectory()) f = existsSync(join(f, 'index.html')) ? join(f, 'index.html') : join(dir, 'index.html');
    const type = TYPES[extname(f)] || 'application/octet-stream';
    const ae = String(req.headers['accept-encoding'] || '');
    const headers = { 'Content-Type': type, 'Cache-Control': f.endsWith('index.html') || f.endsWith('sw.js') ? 'no-cache' : 'max-age=3600' };
    if (/\bbr\b/.test(ae) && existsSync(f + '.br')) return res.writeHead(200, { ...headers, 'Content-Encoding': 'br' }).end(readFileSync(f + '.br'));
    if (/\bgzip\b/.test(ae) && existsSync(f + '.gz')) return res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip' }).end(readFileSync(f + '.gz'));
    res.writeHead(200, headers).end(readFileSync(f));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
