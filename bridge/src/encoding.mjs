// Content-encoding helpers for the optional static web app (BRIDGE_WEB_DIR, src/static.mjs). Same approach as
// other Hermes UI servers: Accept-Encoding negotiation (br > gzip, q-values
// respected) and on-the-fly gzip for compressible text types with a small in-memory LRU keyed by path + mtime + size.
import zlib from 'node:zlib';

/** Extensions worth compressing on the fly (images, fonts, wasm … are already compressed or not text). */
export const COMPRESSIBLE_EXT = new Set(['.js', '.mjs', '.css', '.html', '.json', '.svg', '.webmanifest', '.txt', '.map']);
export const MIN_COMPRESS_BYTES = 1024;
export const MAX_COMPRESS_BYTES = 32 * 1024 * 1024;

/** Parse an Accept-Encoding header -> Map(coding -> q). */
export function parseAcceptEncoding(header) {
  const out = new Map();
  if (typeof header !== 'string') return out;
  for (const part of header.split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    if (!name) continue;
    let q = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/.exec(p);
      if (m) q = Number(m[1]);
    }
    out.set(name.trim(), Number.isFinite(q) ? q : 0);
  }
  return out;
}

/** Codings (from `offered`, in server preference order) the client accepts. */
export function acceptedEncodings(header, offered = ['br', 'gzip']) {
  const acc = parseAcceptEncoding(header);
  const star = acc.get('*');
  return offered.filter((c) => (acc.has(c) ? acc.get(c) > 0 : star !== undefined && star > 0));
}

/** Small byte-bounded LRU of compressed bodies. */
export function createGzipCache({ maxBytes = 16 * 1024 * 1024, maxEntries = 64 } = {}) {
  const map = new Map(); // key -> Buffer (insertion order = recency)
  const pending = new Map(); // key -> Promise<Buffer>
  let bytes = 0;
  const evict = () => {
    while (map.size > maxEntries || bytes > maxBytes) {
      const [k, v] = map.entries().next().value;
      map.delete(k);
      bytes -= v.length;
    }
  };
  return {
    get size() {
      return map.size;
    },
    get bytes() {
      return bytes;
    },
    /** Gzip of `read()` (a function returning Promise<Buffer>), cached under `key`. */
    async gzip(key, read) {
      const hit = map.get(key);
      if (hit) {
        map.delete(key);
        map.set(key, hit);
        return hit;
      }
      let p = pending.get(key);
      if (!p) {
        p = (async () => {
          const src = await read();
          return new Promise((resolve, reject) => zlib.gzip(src, { level: 6 }, (e, b) => (e ? reject(e) : resolve(b))));
        })();
        pending.set(key, p);
        p.then(
          (b) => {
            pending.delete(key);
            if (b.length <= maxBytes) {
              map.set(key, b);
              bytes += b.length;
              evict();
            }
          },
          () => pending.delete(key),
        );
      }
      return p;
    },
  };
}
