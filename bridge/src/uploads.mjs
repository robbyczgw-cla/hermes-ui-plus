// File uploads: POST /bridge/uploads (raw body, streamed to disk) + retention cleanup.
// Zero dependencies. Contract and deployment notes: docs/ROUTER.md, section "File uploads".
import { createWriteStream } from 'node:fs';
import { chmod, lstat, mkdir, readdir, realpath, rename, rmdir, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { silentLogger } from './log.mjs';
import { makeAuthorizer, makeCredentials } from './auth.mjs';
import { corsHeaders } from './cors.mjs';

export const UPLOAD_PATH = '/bridge/uploads';
export const DEFAULT_UPLOAD_DIR = '/var/lib/hermes-ui-bridge/uploads';
export const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
export const DEFAULT_RETENTION_DAYS = 7;
export const CLEANUP_INTERVAL_MS = 24 * 3600_000;
export const DEFAULT_QUOTA_MB = 500;
export const DEFAULT_MAX_INFLIGHT = 2; // per credential
export const DEFAULT_MAX_INFLIGHT_TOTAL = 6;
const MAX_NAME_BYTES = 120; // stored name (without the "<id>-" prefix); well below the 255-byte fs limit
const MAX_EXT_CHARS = 16;

const OOXML = 'application/vnd.openxmlformats-officedocument';
/** Default allow-list. Entries are exact types or `prefix/*`. Zip is opt-in (BRIDGE_UPLOAD_ALLOWED_MIME). */
export const DEFAULT_ALLOWED_MIME = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'image/bmp', 'image/tiff',
  'application/pdf',
  'text/*', // text/plain, text/csv, text/markdown, text/html, ...
  'application/json',
  `${OOXML}.wordprocessingml.document`, // docx
  `${OOXML}.spreadsheetml.sheet`, // xlsx
  `${OOXML}.presentationml.presentation`, // pptx
];

const num = (v, d) => (v === undefined || v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? d : Number(v));

/** @param {Record<string, string|undefined>} env */
export function loadUploadConfig(env = process.env) {
  const list = (env.BRIDGE_UPLOAD_ALLOWED_MIME ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return {
    dir: env.BRIDGE_UPLOAD_DIR || DEFAULT_UPLOAD_DIR,
    /** Path prefix to report to the client when Hermes sees the directory under another path. */
    publicDir: env.BRIDGE_UPLOAD_PUBLIC_DIR || '',
    maxBytes: Math.max(1, num(env.BRIDGE_UPLOAD_MAX_BYTES, DEFAULT_MAX_BYTES)),
    retentionDays: num(env.BRIDGE_UPLOAD_RETENTION_DAYS, DEFAULT_RETENTION_DAYS),
    allowedMime: list.length ? list : DEFAULT_ALLOWED_MIME,
    // GPT security M4: private by default (0600 files / 0700 dirs; a root Hermes reads them). A non-root Hermes
    // in a shared group: BRIDGE_UPLOAD_GROUP_READ=1 -> 0640 / 0750.
    groupRead: /^(1|true|yes|on)$/i.test(env.BRIDGE_UPLOAD_GROUP_READ ?? ''),
    /** aggregate size of the upload dir (0 = unlimited); expired files are evicted before refusing */
    quotaBytes: Math.round(num(env.BRIDGE_UPLOAD_QUOTA_MB, DEFAULT_QUOTA_MB) * 1024 * 1024),
    maxInFlight: Math.max(1, num(env.BRIDGE_UPLOAD_MAX_INFLIGHT, DEFAULT_MAX_INFLIGHT)),
    maxInFlightTotal: Math.max(1, num(env.BRIDGE_UPLOAD_MAX_INFLIGHT_TOTAL, DEFAULT_MAX_INFLIGHT_TOTAL)),
  };
}

/** Content-Type -> bare lowercase media type (no parameters), '' if unusable. */
export function normalizeMime(value) {
  const m = String(value ?? '').split(';')[0].trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(m) ? m : '';
}

export function mimeAllowed(mime, allowed = DEFAULT_ALLOWED_MIME) {
  if (!mime) return false;
  return allowed.some((a) => (a.endsWith('/*') ? mime.startsWith(a.slice(0, -1)) : a === mime));
}

const utf8Len = (s) => Buffer.byteLength(s, 'utf8');
function truncateBytes(s, max) {
  let out = '';
  let used = 0;
  for (const ch of s) {
    const n = utf8Len(ch);
    if (used + n > max) break;
    out += ch;
    used += n;
  }
  return out;
}

/**
 * Make a client-supplied file name safe to use as a single path component.
 * No directories (/ and \ split), no leading dots, no control/bidi/format characters, only
 * letters/digits/`._-+()[]@,` (everything else -> `_`), length capped by UTF-8 bytes, extension kept.
 * Unicode letters are preserved (NFC). Never returns an empty string.
 */
export function sanitizeFilename(raw) {
  let s = String(raw ?? '').normalize('NFC');
  s = s.split(/[\\/]/).pop() ?? ''; // basename, also for Windows-style paths
  s = s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ''); // control, bidi overrides, zero-width, line separators
  s = s.replace(/[^\p{L}\p{N}._+()[\]@,-]/gu, '_'); // whitespace and everything exotic
  s = s.replace(/_{2,}/g, '_').replace(/\.{2,}/g, '.');
  s = s.replace(/^[._\s-]+/, '').replace(/[.\s]+$/, ''); // no hidden files, no "..", no trailing dot
  if (!s) return 'file';
  const dot = s.lastIndexOf('.');
  let stem = dot > 0 ? s.slice(0, dot) : s;
  let ext = dot > 0 ? s.slice(dot) : '';
  if (ext.length > MAX_EXT_CHARS + 1) ext = ext.slice(0, MAX_EXT_CHARS + 1);
  stem = truncateBytes(stem, Math.max(1, MAX_NAME_BYTES - utf8Len(ext)));
  stem = stem.replace(/[._\s-]+$/, '');
  return `${stem || 'file'}${ext}`;
}

/** UTC calendar day, yyyy-mm-dd. */
export const dayDir = (d = new Date()) => d.toISOString().slice(0, 10);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Delete files older than `retentionDays` below `dir` (layout `<yyyy-mm-dd>/<file>`) and remove date
 * directories that are empty and older than today. Never follows symlinks; ignores anything that
 * does not match the layout. Missing `dir` is not an error.
 * @returns {Promise<{removedFiles: number, removedDirs: number, errors: number}>}
 */
export async function cleanupUploads(dir, { retentionDays = DEFAULT_RETENTION_DAYS, now = Date.now() } = {}) {
  const res = { removedFiles: 0, removedDirs: 0, errors: 0 };
  const cutoff = now - retentionDays * 24 * 3600_000;
  const today = dayDir(new Date(now));
  let days;
  try { days = await readdir(dir, { withFileTypes: true }); } catch (err) {
    if (err?.code === 'ENOENT') return res;
    throw err;
  }
  for (const d of days) {
    if (!d.isDirectory() || !DAY_RE.test(d.name)) continue;
    const dp = join(dir, d.name);
    let entries;
    try { entries = await readdir(dp, { withFileTypes: true }); } catch { res.errors++; continue; }
    let left = entries.length;
    for (const e of entries) {
      const fp = join(dp, e.name);
      try {
        const st = await lstat(fp);
        if (!st.isFile() || st.mtimeMs >= cutoff) continue;
        await unlink(fp);
        res.removedFiles++;
        left--;
      } catch (err) {
        if (err?.code === 'ENOENT') left--; else res.errors++;
      }
    }
    if (left <= 0 && d.name < today) {
      try { await rmdir(dp); res.removedDirs++; } catch { /* not empty or raced: keep */ }
    }
  }
  return res;
}

/**
 * Bytes stored below `dir` in the upload layout (`<yyyy-mm-dd>/<file>`, incl. `.part` files in progress). Symlinks
 * and foreign entries are ignored. Missing `dir` = 0.
 */
export async function uploadDirUsage(dir, exclude = new Set()) {
  let total = 0;
  let days;
  try { days = await readdir(dir, { withFileTypes: true }); } catch (err) {
    if (err?.code === 'ENOENT') return 0;
    throw err;
  }
  for (const d of days) {
    if (!d.isDirectory() || !DAY_RE.test(d.name)) continue;
    let entries;
    try { entries = await readdir(join(dir, d.name), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isFile() || exclude.has(join(dir, d.name, e.name))) continue;
      try { total += (await lstat(join(dir, d.name, e.name))).size; } catch { /* raced */ }
    }
  }
  return total;
}

/** Run cleanup now (non-blocking) and every `intervalMs`. Returns a stop function. */
export function startUploadCleanup(cfg, { logger = silentLogger, intervalMs = CLEANUP_INTERVAL_MS } = {}) {
  const run = () => cleanupUploads(cfg.dir, { retentionDays: cfg.retentionDays })
    .then((r) => { if (r.removedFiles || r.removedDirs || r.errors) logger.info('upload_cleanup', r); })
    .catch((err) => logger.warn('upload_cleanup_failed', { error: String(err?.code ?? err?.message ?? err).slice(0, 120) }));
  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}


class TooLarge extends Error {}

/**
 * @param {{token?: string, allowNoAuth?: boolean, corsOrigins?: string[]}} bridgeConfig  loadConfig() result
 * @param {{env?: Record<string, string|undefined>, upload?: ReturnType<typeof loadUploadConfig>,
 *   logger?: ReturnType<typeof import('./log.mjs').createLogger>}} [o]
 */
export function createUploads(bridgeConfig, o = {}) {
  const cfg = o.upload ?? loadUploadConfig(o.env ?? process.env);
  const log = o.logger ?? silentLogger;
  const corsOrigins = bridgeConfig.corsOrigins ?? [];

  const authorized = makeAuthorizer(bridgeConfig); // BRIDGE_TOKEN or a device token (src/auth.mjs)
  const credentials = makeCredentials(bridgeConfig);
  /** @type {Map<string, number>} uploads in flight per credential */
  const inFlight = new Map();
  let inFlightTotal = 0;
  const reservedFiles = new Set();
  let reservedBytes = 0; // quota reserved by uploads in flight
  let quotaQueue = Promise.resolve(); // serializes check + reserve

  /**
   * Reserve `want` bytes of the dir quota (evicting expired files first when it is tight).
   * @returns {Promise<(() => void) | null>} release function, or null when the quota is exhausted
   */
  function reserveQuota(want, files) {
    const run = quotaQueue.then(async () => {
      if (!cfg.quotaBytes) return () => {};
      let used = await uploadDirUsage(cfg.dir, reservedFiles);
      if (used + reservedBytes + want > cfg.quotaBytes) {
        const r = await cleanupUploads(cfg.dir, { retentionDays: cfg.retentionDays }).catch(() => null);
        if (r?.removedFiles) log.info('upload_cleanup', { ...r, reason: 'quota' });
        used = await uploadDirUsage(cfg.dir, reservedFiles);
      }
      if (used + reservedBytes + want > cfg.quotaBytes) return null;
      reservedBytes += want;
      for (const file of files) reservedFiles.add(file);
      let released = false;
      return () => {
        const release = quotaQueue.then(() => {
          if (released) return;
          released = true;
          reservedBytes -= want;
          for (const file of files) reservedFiles.delete(file);
        });
        quotaQueue = release.catch(() => {});
        return release;
      };
    });
    quotaQueue = run.catch(() => {});
    return run;
  }

  /** Only POST /bridge/uploads is ours; everything else (incl. OPTIONS preflight) stays with the bridge. */
  const matches = (req) => req.method === 'POST' && (req.url ?? '').split('?')[0] === UPLOAD_PATH;

  function send(req, res, status, body, { close = false } = {}) {
    if (res.headersSent) return res.destroy();
    const buf = Buffer.from(JSON.stringify(body));
    const headers = { 'content-type': 'application/json', 'content-length': buf.length, 'x-hermes-ui-bridge': '1', ...corsHeaders(corsOrigins, req) };
    if (close) headers.connection = 'close';
    res.writeHead(status, headers);
    if (!close || req.complete) return void res.end(buf);
    // Request body not (fully) consumed: the whole answer goes out at once (content-length framed, the client has
    // it), but the response only *ends* once the rest of the body was read and discarded. Node closes a
    // `connection: close` socket as soon as the response finishes; closing with unread input sends RST, and the
    // RST can make the client drop the 413 it already received (EPIPE / ECONNRESET instead of the answer). The
    // drain is bounded: a client that keeps sending for 2 s gets cut off.
    res.write(buf);
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      req.off('end', end);
      req.off('close', end);
      res.end();
    };
    const timer = setTimeout(end, 2000);
    timer.unref();
    req.on('end', end);
    req.on('close', end);
    req.resume();
  }
  const fail = (req, res, status, message, type, code, close = true) =>
    send(req, res, status, { error: { message, type, code: code ?? null } }, { close });

  async function handle(req, res, reqId = randomBytes(4).toString('hex')) {
    const started = performance.now();
    res.on('finish', () => log.info('http', { reqId, method: req.method, path: UPLOAD_PATH, status: res.statusCode, ms: Math.round(performance.now() - started) }));

    if (!authorized(req)) return fail(req, res, 401, 'Invalid bridge token', 'invalid_request_error', 'invalid_api_key');

    let name;
    const rawName = req.headers['x-filename'];
    if (typeof rawName === 'string' && rawName.trim()) {
      try { name = decodeURIComponent(rawName); } catch { return fail(req, res, 400, 'X-Filename is not valid percent-encoding', 'invalid_request_error'); }
    }
    if (!name || !name.replace(/[\p{Cc}\p{Cf}\s]/gu, '')) return fail(req, res, 400, 'Missing X-Filename header', 'invalid_request_error');

    const mimeType = normalizeMime(req.headers['content-type']);
    if (!mimeAllowed(mimeType, cfg.allowedMime)) {
      return fail(req, res, 415, `Unsupported media type: ${mimeType || 'none'}`, 'invalid_request_error', 'unsupported_media_type');
    }

    const declared = req.headers['content-length'];
    if (declared !== undefined) {
      const n = Number(declared);
      if (!Number.isFinite(n) || n < 0) return fail(req, res, 400, 'Invalid Content-Length', 'invalid_request_error');
      if (n === 0) return fail(req, res, 400, 'Empty upload', 'invalid_request_error');
      if (n > cfg.maxBytes) return fail(req, res, 413, `Upload exceeds ${cfg.maxBytes} bytes`, 'invalid_request_error', 'payload_too_large');
    }

    // per-credential and global uploads in flight (a stolen device token cannot fill the disk in parallel)
    const cred = credentials.of(req) ?? 'anonymous';
    const mine = inFlight.get(cred) ?? 0;
    if (mine >= cfg.maxInFlight || inFlightTotal >= cfg.maxInFlightTotal) {
      res.setHeader('retry-after', '5');
      return fail(req, res, 429, 'Too many uploads in progress, try again shortly', 'rate_limit_error', 'rate_limit_exceeded');
    }
    inFlight.set(cred, mine + 1);
    inFlightTotal++;
    const safe = sanitizeFilename(name);
    const id = randomBytes(8).toString('hex');
    const day = dayDir();
    const dayPath = join(cfg.dir, day);
    const finalPath = join(dayPath, `${id}-${safe}`);
    const tmpPath = join(dayPath, `.${id}.part`);
    const files = { safe, id, day, dayPath, finalPath, tmpPath };
    let releaseQuota = () => {};
    try {
      const release = await reserveQuota(declared !== undefined ? Number(declared) : cfg.maxBytes, [tmpPath, finalPath]);
      if (!release) {
        log.warn('upload_quota_exceeded', { reqId, quotaBytes: cfg.quotaBytes });
        return fail(req, res, 507, 'Upload storage is full (BRIDGE_UPLOAD_QUOTA_MB); try again later', 'bridge_error', 'quota_exceeded');
      }
      releaseQuota = release;
      return await store(req, res, reqId, files, mimeType);
    } finally {
      await releaseQuota();
      inFlightTotal--;
      const left = (inFlight.get(cred) ?? 1) - 1;
      if (left > 0) inFlight.set(cred, left);
      else inFlight.delete(cred);
    }
  }

  async function store(req, res, reqId, { safe, id, day, dayPath, finalPath, tmpPath }, mimeType) {

    let size = 0;
    try {
      const dirMode = cfg.groupRead ? 0o750 : 0o700;
      const fileMode = cfg.groupRead ? 0o640 : 0o600;
      await mkdir(cfg.dir, { recursive: true, mode: dirMode });
      await mkdir(dayPath, { recursive: true, mode: dirMode });
      await chmod(dayPath, dirMode).catch(() => {}); // pre-fix day dirs were 0755
      // Stream straight to disk (memory stays flat). Piped by hand instead of stream.pipeline: on
      // overflow we must keep the socket alive long enough to send the 413 (pipeline would destroy `req`).
      await new Promise((resolve, reject) => {
        const out = createWriteStream(tmpPath, { flags: 'wx', mode: fileMode });
        let done = false;
        const finish = (err) => {
          if (done) return;
          done = true;
          req.off('data', onData); req.off('end', onEnd); req.off('error', finish); req.off('close', onClose);
          if (err) { req.pause(); out.destroy(); out.once('close', () => reject(err)); } else resolve(undefined);
        };
        const onData = (chunk) => {
          size += chunk.length;
          if (size > cfg.maxBytes) return finish(new TooLarge());
          if (!out.write(chunk)) { req.pause(); out.once('drain', () => req.resume()); }
        };
        const onEnd = () => out.end(() => finish());
        const onClose = () => { if (!req.complete) finish(Object.assign(new Error('client aborted'), { code: 'ERR_STREAM_PREMATURE_CLOSE' })); };
        out.on('error', finish);
        req.on('data', onData); req.on('end', onEnd); req.on('error', finish); req.on('close', onClose);
      });
      if (size === 0) { await unlink(tmpPath).catch(() => {}); return fail(req, res, 400, 'Empty upload', 'invalid_request_error', undefined, false); }
      await chmod(tmpPath, fileMode); // explicit, independent of the process umask
      await rename(tmpPath, finalPath);
    } catch (err) {
      await unlink(tmpPath).catch(() => {});
      if (err instanceof TooLarge) return fail(req, res, 413, `Upload exceeds ${cfg.maxBytes} bytes`, 'invalid_request_error', 'payload_too_large');
      if (err?.code === 'ERR_STREAM_PREMATURE_CLOSE' || req.destroyed || res.destroyed) { // client went away
        log.debug('upload_aborted', { reqId });
        return;
      }
      log.error('upload_failed', { reqId, error: String(err?.code ?? err?.message ?? err).slice(0, 120) });
      return fail(req, res, 500, 'Could not store upload', 'bridge_error', 'storage_error');
    }

    // Report the path as Hermes (root) can read it. Under systemd DynamicUser the state directory is
    // really /var/lib/private/...; /var/lib/<name> is only a symlink, so resolve it.
    let base = cfg.publicDir;
    if (!base) base = await realpath(cfg.dir).catch(() => cfg.dir);
    const path = join(base, day, `${id}-${safe}`);
    log.info('upload', { reqId, id, size, mimeType });
    return send(req, res, 201, { id, path, name: safe, size, mimeType });
  }

  return { config: cfg, matches, handle, startCleanup: (opts) => startUploadCleanup(cfg, { logger: log, ...opts }) };
}
