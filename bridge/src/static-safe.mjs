// Static-file containment of the bridge (src/static.mjs); self-contained so other servers can vendor it.
// Self-contained (node:fs/node:path only). Rules:
//  - hidden segments are refused (".env", ".git"; only ".well-known" is allowed), as are "." / ".." / NUL / "\"
//  - the candidate, a directory's index.html, the SPA fallback and precompressed siblings are compared as REAL
//    paths against the real root, so a symlink inside the root cannot point outside of it
import fs from 'node:fs';
import path from 'node:path';

const realOrNull = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
const statOrNull = (p) => { try { return fs.statSync(p); } catch { return null; } };
const inside = (root, p) => p === root || p.startsWith(root + path.sep);

/** Real path of the configured root (null when it does not exist). */
export function realStaticRoot(dir) {
  return dir ? realOrNull(path.resolve(dir)) : null;
}

/**
 * Map a request path onto a file below `root` (pure apart from fs reads). Returns null when nothing may be served.
 * @param {string} root  absolute, real path of the web dir (realStaticRoot)
 * @param {string} reqPath  decoded request path (already checked by paths.mjs)
 * @returns {{file: string, stat: import('node:fs').Stats, fallback: boolean} | null}
 */
export function resolveStaticFile(root, reqPath) {
  if (!root || typeof reqPath !== 'string' || !reqPath.startsWith('/') || reqPath.includes('\0') || reqPath.includes('\\')) return null;
  const segs = reqPath.split('/').slice(1);
  for (const s of segs) {
    if (s === '..' || s === '.') return null;
    if (s.startsWith('.') && s !== '.well-known') return null;
  }
  const candidate = path.resolve(root, '.' + path.posix.normalize(reqPath));
  if (!inside(root, candidate)) return null;
  const pick = (file, fallback) => {
    const real = realOrNull(file);
    if (!real || !inside(root, real)) return null;
    let st = statOrNull(real);
    let f = real;
    if (st?.isDirectory()) {
      f = path.join(real, 'index.html');
      const r2 = realOrNull(f);
      if (!r2 || !inside(root, r2)) return null;
      f = r2;
      st = statOrNull(f);
    }
    return st?.isFile() ? { file: f, stat: st, fallback } : null;
  };
  const hit = pick(candidate, false);
  if (hit) return hit;
  // SPA fallback for client-side routes (no extension); missing assets stay 404
  if (path.posix.extname(reqPath)) return null;
  return pick(path.join(root, 'index.html'), true);
}

/**
 * Precompressed sibling (`file.br` / `file.gz`) inside the root, not older than the original; null otherwise.
 * @param {string} root real root
 * @param {string} file real path returned by resolveStaticFile
 * @param {import('node:fs').Stats} st stat of `file`
 * @param {'br'|'gzip'} coding
 * @returns {{file: string, size: number} | null}
 */
export function precompressedSibling(root, file, st, coding) {
  const real = realOrNull(file + (coding === 'br' ? '.br' : '.gz'));
  const sst = real && inside(root, real) ? statOrNull(real) : null;
  return sst?.isFile() && sst.mtimeMs >= st.mtimeMs ? { file: real, size: sst.size } : null;
}
