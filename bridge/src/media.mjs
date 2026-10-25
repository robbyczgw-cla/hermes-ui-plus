// Hermes-generated files: GET /bridge/media?path=<absolute server path> (authenticated, read-only).
// Hermes answers with `MEDIA:<server path>` tags; the app asks for exactly that path. Only files below the
// operator-configured roots (BRIDGE_MEDIA_DIRS, comma/colon separated absolute dirs) are served; with no root
// configured the endpoint answers 404 `media_disabled`. Zero dependencies.
import { open, realpath } from 'node:fs/promises';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { silentLogger } from './log.mjs';
import { makeAuthorizer } from './auth.mjs';
import { corsHeaders } from './cors.mjs';

export const MEDIA_PATH = '/bridge/media';
export const DEFAULT_MEDIA_MAX_BYTES = 100 * 1024 * 1024;
const MAX_PATH_CHARS = 4096;

/** Extension allow-list (the deliverable types of Hermes' MEDIA tags). `inline`: safe to show in the app/browser. */
export const MEDIA_TYPES = {
  '.png': ['image/png', true], '.jpg': ['image/jpeg', true], '.jpeg': ['image/jpeg', true], '.gif': ['image/gif', true],
  '.webp': ['image/webp', true], '.bmp': ['image/bmp', true], '.tiff': ['image/tiff', false],
  '.mp4': ['video/mp4', true], '.mov': ['video/quicktime', true], '.webm': ['video/webm', true], '.mkv': ['video/x-matroska', false],
  '.avi': ['video/x-msvideo', false], '.3gp': ['video/3gpp', false],
  '.mp3': ['audio/mpeg', true], '.wav': ['audio/wav', true], '.ogg': ['audio/ogg', true], '.opus': ['audio/ogg', true],
  '.m4a': ['audio/mp4', true], '.flac': ['audio/flac', true], '.m2a': ['audio/mpeg', true],
  '.pdf': ['application/pdf', true],
  '.txt': ['text/plain; charset=utf-8', true], '.md': ['text/markdown; charset=utf-8', true], '.csv': ['text/csv; charset=utf-8', true],
  '.tsv': ['text/tab-separated-values; charset=utf-8', true], '.json': ['application/json', true],
  '.yaml': ['text/plain; charset=utf-8', true], '.yml': ['text/plain; charset=utf-8', true],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', false],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', false],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation', false],
  '.doc': ['application/msword', false], '.xls': ['application/vnd.ms-excel', false], '.ppt': ['application/vnd.ms-powerpoint', false],
  '.odt': ['application/vnd.oasis.opendocument.text', false], '.ods': ['application/vnd.oasis.opendocument.spreadsheet', false],
  '.odp': ['application/vnd.oasis.opendocument.presentation', false], '.rtf': ['application/rtf', false], '.epub': ['application/epub+zip', false],
  '.zip': ['application/zip', false], '.tar': ['application/x-tar', false], '.gz': ['application/gzip', false], '.tgz': ['application/gzip', false],
  '.7z': ['application/x-7z-compressed', false], '.kml': ['application/vnd.google-earth.kml+xml', false], '.kmz': ['application/vnd.google-earth.kmz', false],
  '.geojson': ['application/geo+json', false], '.gpx': ['application/gpx+xml', false],
  // active content: never rendered inline (served as a download with a sandbox CSP)
  '.svg': ['application/octet-stream', false], '.html': ['application/octet-stream', false], '.htm': ['application/octet-stream', false],
  '.xml': ['application/octet-stream', false],
};

const num = (v, d) => (v === undefined || v === '' || !Number.isFinite(Number(v)) || Number(v) <= 0 ? d : Number(v));

/** @param {Record<string, string|undefined>} env */
export function loadMediaConfig(env = process.env) {
  const dirs = String(env.BRIDGE_MEDIA_DIRS ?? '')
    .split(/,|:(?=\/)/) // "," or the ":" path-list separator before an absolute path
    .map((s) => s.trim())
    .filter((s) => s && isAbsolute(s))
    .map((s) => resolve(s));
  return { dirs: [...new Set(dirs)], maxBytes: num(env.BRIDGE_MEDIA_MAX_BYTES, DEFAULT_MEDIA_MAX_BYTES) };
}

/**
 * Syntactic check of the requested path (no file system access): a plain absolute POSIX path without NUL/control
 * characters, backslashes, `.`/`..` segments or empty segments.
 * @returns {{ok: true, path: string} | {ok: false, reason: string}}
 */
export function parseMediaPath(raw) {
  if (typeof raw !== 'string' || !raw) return { ok: false, reason: 'missing' };
  if (raw.length > MAX_PATH_CHARS) return { ok: false, reason: 'too long' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return { ok: false, reason: 'control or backslash' };
  if (!raw.startsWith('/')) return { ok: false, reason: 'not absolute' };
  const segs = raw.split('/').slice(1);
  if (segs.length > 1 && segs[segs.length - 1] === '') return { ok: false, reason: 'trailing slash' };
  for (const s of segs) {
    if (s === '' || s === '.' || s === '..') return { ok: false, reason: 'dot or empty segment' };
  }
  return { ok: true, path: raw };
}

/** `file` is `root` or below it (both absolute, normalized). */
export function isWithin(root, file) {
  const rel = relative(root, file);
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel));
}

/** Path below a root that has a dot-file/dot-directory segment (`.env`, `.git/…`): never served. */
export function hasHiddenSegment(root, file) {
  return relative(root, file).split(sep).some((s) => s.startsWith('.'));
}

/**
 * Decide whether `rawPath` may be served. Lexical check first (no fs access outside the roots, so the answer
 * does not reveal whether a file exists), then realpath (symlinks resolved) and the same check again.
 * @returns {Promise<{ok: true, real: string, type: string, inline: boolean, name: string} | {ok: false, status: number, code: string, message: string}>}
 */
export async function resolveMedia(rawPath, cfg) {
  if (!cfg.dirs.length) return { ok: false, status: 404, code: 'media_disabled', message: 'Media downloads are not enabled on this bridge' };
  const parsed = parseMediaPath(rawPath);
  if (!parsed.ok) return { ok: false, status: 400, code: 'invalid_path', message: `Invalid path (${parsed.reason})` };
  const denied = { ok: false, status: 403, code: 'path_not_allowed', message: 'Path is outside the media directories' };
  const ext = extname(parsed.path).toLowerCase();
  const kind = Object.hasOwn(MEDIA_TYPES, ext) ? MEDIA_TYPES[ext] : null;
  const lexicalRoot = cfg.dirs.find((d) => isWithin(d, parsed.path));
  if (!lexicalRoot || parsed.path === lexicalRoot || hasHiddenSegment(lexicalRoot, parsed.path)) return denied;
  if (!kind) return { ok: false, status: 415, code: 'unsupported_type', message: `File type ${ext || '(none)'} is not served` };
  let real;
  try { real = await realpath(parsed.path); } catch { return { ok: false, status: 404, code: 'not_found', message: 'File not found' }; }
  // symlinks may only point to somewhere inside a (real) root
  for (const d of cfg.dirs) {
    let realRoot;
    try { realRoot = await realpath(d); } catch { continue; }
    if (isWithin(realRoot, real) && real !== realRoot && !hasHiddenSegment(realRoot, real)) {
      return { ok: true, real, type: kind[0], inline: kind[1], name: basename(parsed.path) };
    }
  }
  return denied;
}

/** RFC 5987 filename for Content-Disposition (ASCII fallback + UTF-8). */
function disposition(inline, name) {
  const ascii = name.replace(/[^\x20-\x7e]|["\\;%]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`;
}

/**
 * @param {{token?: string, allowNoAuth?: boolean, corsOrigins?: string[]}} bridgeConfig
 * @param {{env?: Record<string, string|undefined>, media?: ReturnType<typeof loadMediaConfig>, logger?: any}} [o]
 */
export function createMedia(bridgeConfig, o = {}) {
  const cfg = o.media ?? loadMediaConfig(o.env ?? process.env);
  const log = o.logger ?? silentLogger;
  const corsOrigins = bridgeConfig.corsOrigins ?? [];
  const authorized = makeAuthorizer(bridgeConfig);

  /** Only GET/HEAD /bridge/media is ours. */
  const matches = (req) => (req.method === 'GET' || req.method === 'HEAD') && (req.url ?? '').split('?')[0] === MEDIA_PATH;

  const baseHeaders = (req) => {
    const h = { 'x-hermes-ui-bridge': '1', 'x-content-type-options': 'nosniff' };
    Object.assign(h, corsHeaders(corsOrigins, req));
    return h;
  };
  function fail(req, res, status, message, code) {
    if (res.headersSent) return res.destroy();
    const buf = Buffer.from(JSON.stringify({ error: { message, type: 'invalid_request_error', code } }));
    res.writeHead(status, { ...baseHeaders(req), 'content-type': 'application/json', 'content-length': buf.length });
    res.end(buf);
  }

  async function handle(req, res) {
    if (!authorized(req)) return fail(req, res, 401, 'Invalid bridge token', 'invalid_api_key');
    let raw;
    try { raw = new URL(req.url, 'http://x').searchParams.get('path'); } catch { raw = null; }
    const r = await resolveMedia(raw, cfg);
    if (!r.ok) {
      if (r.status !== 404 || r.code === 'media_disabled') log.info('media_denied', { code: r.code });
      return fail(req, res, r.status, r.message, r.code);
    }
    let fh;
    try {
      fh = await open(r.real, 'r');
      const st = await fh.stat();
      if (!st.isFile()) { await fh.close(); return fail(req, res, 404, 'File not found', 'not_found'); }
      if (st.size > cfg.maxBytes) { await fh.close(); return fail(req, res, 413, `File exceeds ${cfg.maxBytes} bytes`, 'payload_too_large'); }
      res.writeHead(200, {
        ...baseHeaders(req),
        'content-type': r.type,
        'content-length': st.size,
        'content-disposition': disposition(r.inline, r.name),
        'content-security-policy': "sandbox; default-src 'none'",
        'cache-control': 'private, max-age=300',
      });
      if (req.method === 'HEAD') { await fh.close(); return res.end(); }
      const stream = fh.createReadStream({ autoClose: true });
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
      log.info('media', { size: st.size, type: r.type });
    } catch (err) {
      await fh?.close().catch(() => {});
      log.warn('media_failed', { error: String(err?.code ?? err?.message ?? err).slice(0, 120) });
      return fail(req, res, 500, 'Could not read file', 'bridge_error');
    }
  }

  return { config: cfg, matches, handle };
}
