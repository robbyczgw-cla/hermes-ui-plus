/**
 * Files in a chat on the web (browser tab, installed web app, desktop app): what "Öffnen" and "Sichern" do on this
 * device. Pure decision logic (webFile.test.ts); the side effects live in webFileActions.ts.
 *
 * Why not just a link: an installed web app (iOS "Zum Home-Bildschirm", Android PWA) has no download manager. Measured
 * on iOS 27 (simulator, home-screen web app): every navigation to a file URL of the app's own origin, whether
 * `<a target=_blank>`, `window.open(url, '_blank', 'noopener')` (= Linking.openURL on web), `Content-Disposition:
 * attachment` or `<a download href>`, shows the file full-screen INSIDE the app window with no close button, toolbar
 * or back gesture; only force-quitting the app gets out. `<a download>` with a blob URL opens a viewer overlay that
 * has a close button but saves nothing. `navigator.share({files})` works (3 taps to Files, right name), also after
 * a 1.5 s load inside the tap.
 *
 * Sichern:
 *   desktop app      → bytes into the Downloads folder (Tauri command; the webview ignores `<a download>`)
 *   iPhone / iPad    → `navigator.share({files})` (iOS "In Dateien sichern": 3 taps, see below)
 *   Android          → `<a download>` with a blob URL: Chrome saves it to Downloads under its name in 1 tap, also in
 *                      the installed web app, and offers to open it (measured on the Android 15 emulator); the share
 *                      sheet (Drive, Files) only where downloads are not supported
 *   desktop browser  → `<a download>` with a blob URL (the browser's download manager), even where share would work
 *   iOS installed app without file sharing (iOS < 15) → a visible "not possible here" message, never a download or
 *                      the file's URL (both trap the app, see above)
 * Öffnen:
 *   PDF (up to MAX_VIEW_BYTES) → the in-app viewer (PdfViewer.tsx, pdf.js): no leaving the app, "Zurück" and "Sichern"
 *   on top; "Im System öffnen" (viewer failed / other types) as below
 *   iOS installed app → the share sheet (preview, "Öffnen in …"; never a window, see above)
 *   a URL that works without headers (signed adapter link, public file) → new tab / window (`_blank`; desktop app:
 *   the system browser)
 *   bytes only (own sent file, bridge media behind the bearer token) → desktop browser: blob URL in a new tab;
 *   phone: the system share sheet, a mobile browser tab otherwise; desktop app: saved, then opened with the default app
 *
 * A blob: document inherits the app's origin, and on the web the connection keys are in that origin's localStorage
 * (settings/storage.ts). So only types the browser shows without running anything may become one (tabSafeMime); an
 * .html or .svg from an answer, a prompt injection's for instance, is downloaded, like the bridge and the adapter serve it.
 */

/** What the current browser can do (detectWebFileEnv; plain values so tests can build any device). */
export type WebFileEnv = {
  /** iPhone / iPad (also iPadOS with a desktop user agent) */
  ios: boolean;
  android: boolean;
  /** running as an installed web app (display-mode standalone / fullscreen, iOS navigator.standalone) */
  standalone: boolean;
  /** the Tauri desktop app's webview */
  desktopApp: boolean;
  /** `navigator.canShare({files:[<this file>]})` */
  canShareFiles: boolean;
  /** `<a download>` is supported */
  anchorDownload: boolean;
};

/** A file shown in a chat. */
export type WebFileSource = {
  /** cache key (stable per file) */
  key: string;
  name: string;
  mime: string;
  /** http(s) URL that opens / fetches without extra headers (signed adapter URL, same-origin or public file) */
  url?: string;
  /** same file served as `Content-Disposition: attachment` (adapter `?download=1`) */
  downloadUrl?: string;
  /** size in bytes when known up front */
  size?: number;
};

export type SaveMethod = 'desktop' | 'share' | 'anchor' | 'openUrl' | 'none';
/** what the decisions look at */
type FileFacts = Pick<WebFileSource, 'name' | 'mime'> & Partial<Pick<WebFileSource, 'url' | 'size'>>;
export type OpenMethod = 'viewer' | 'url' | 'blobTab' | 'download' | 'share' | 'desktop' | 'none';

/** Files above this are not loaded into memory for "Sichern" (bridge media default limit). */
export const MAX_IN_MEMORY_BYTES = 100 * 1024 * 1024;

/** PDFs above this open in the system instead of the in-app viewer (memory on phones). */
export const MAX_VIEW_BYTES = 60 * 1024 * 1024;

export const isPdfFile = (src: Pick<WebFileSource, 'mime' | 'name'>): boolean =>
  src.mime.split(';')[0].trim().toLowerCase() === 'application/pdf' || /\.pdf$/i.test(src.name);

const bareMime = (mime: string) => mime.split(';')[0].trim().toLowerCase();

/** May a blob of this type be a document of the app's origin? An allowlist: a type nobody thought of is downloaded. */
export function tabSafeMime(mime: string): boolean {
  return /^(image\/(png|jpeg|gif|webp|bmp|avif)|audio\/[\w.+-]+|video\/[\w.+-]+|application\/pdf|text\/plain|application\/json)$/.test(bareMime(mime));
}

/** Types a browser runs or renders as a document: the bytes never carry them on this device. */
export function activeMime(mime: string): boolean {
  return /^(text\/html|text\/xml|application\/xml|text\/xsl|text\/javascript|application\/javascript|application\/ecmascript|text\/ecmascript)$|\+xml$/.test(bareMime(mime));
}

export const isMobile = (env: WebFileEnv): boolean => env.ios || env.android;
/** the iOS home-screen web app: no windows, downloads or file URLs (they trap it), only the share sheet */
export const isIosApp = (env: WebFileEnv): boolean => env.ios && env.standalone;

export function saveMethod(env: WebFileEnv, src: FileFacts): SaveMethod {
  const tooLarge = (src.size ?? 0) > MAX_IN_MEMORY_BYTES;
  // iOS installed app: a download or the file's URL replaces the app with a viewer that has no way back
  if (isIosApp(env)) return env.canShareFiles && !tooLarge ? 'share' : 'none';
  if (env.desktopApp) return tooLarge ? (src.url ? 'openUrl' : 'none') : 'desktop';
  if (tooLarge) return src.url ? 'openUrl' : 'none';
  if (env.android && env.anchorDownload) return 'anchor';
  if (isMobile(env) && env.canShareFiles) return 'share';
  if (env.anchorDownload) return 'anchor';
  if (env.canShareFiles) return 'share';
  return src.url ? 'openUrl' : 'none';
}

/** `system`: skip the in-app viewer ("Im System öffnen"). */
export function openMethod(env: WebFileEnv, src: FileFacts, o: { system?: boolean } = {}): OpenMethod {
  if (!o.system && isPdfFile(src) && (src.size ?? 0) <= MAX_VIEW_BYTES) return 'viewer';
  const tooLarge = (src.size ?? 0) > MAX_IN_MEMORY_BYTES;
  if (isIosApp(env)) return env.canShareFiles && !tooLarge ? 'share' : 'none';
  if (src.url) return 'url';
  if (tooLarge) return 'none';
  if (env.desktopApp) return 'desktop';
  if (isMobile(env) && env.canShareFiles) return 'share';
  // unknown type: decided again with the bytes' type (webFileActions.ts)
  if (tabSafeMime(src.mime) || bareMime(src.mime) === 'application/octet-stream') return 'blobTab';
  return env.anchorDownload ? 'download' : env.canShareFiles ? 'share' : 'none';
}

type NavLike = {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
  canShare?: (data: { files: unknown[] }) => boolean;
};
type WinLike = {
  navigator?: NavLike;
  matchMedia?: (q: string) => { matches: boolean };
  __TAURI_INTERNALS__?: unknown;
  File?: new (parts: BlobPart[], name: string, opts?: FilePropertyBag) => unknown;
  HTMLAnchorElement?: { prototype: object };
};

/** Reads the environment for a file of `mime` / `name` (canShare depends on the type). */
export function detectWebFileEnv(w: WinLike | undefined, file: { name: string; mime: string }): WebFileEnv {
  const nav = w?.navigator ?? {};
  const ua = nav.userAgent ?? '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1);
  const android = /Android/i.test(ua);
  const mq = (q: string) => {
    try {
      return w?.matchMedia?.(q).matches === true;
    } catch {
      return false;
    }
  };
  const standalone = nav.standalone === true || mq('(display-mode: standalone)') || mq('(display-mode: fullscreen)') || mq('(display-mode: minimal-ui)');
  let canShareFiles = false;
  if (typeof nav.canShare === 'function' && w?.File) {
    try {
      canShareFiles = nav.canShare({ files: [new w.File([''], file.name, { type: file.mime })] }) === true;
    } catch {
      canShareFiles = false;
    }
  }
  return {
    ios,
    android,
    standalone,
    desktopApp: !!w?.__TAURI_INTERNALS__,
    canShareFiles,
    anchorDownload: !!w?.HTMLAnchorElement && 'download' in w.HTMLAnchorElement.prototype,
  };
}

const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'application/json': 'json',
  'application/zip': 'zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

/**
 * File name for the saved copy: no path separators / control characters, never empty, and with an extension (the
 * iOS share sheet and "In Dateien sichern" decide by it).
 */
export function saveName(name: string, mime: string): string {
  // eslint-disable-next-line no-control-regex
  let n = String(name ?? '').split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, '').replace(/^\.+/, '').trim();
  if (n.length > 120) {
    const dot = n.lastIndexOf('.');
    const ext = dot > 0 && n.length - dot <= 10 ? n.slice(dot) : '';
    n = n.slice(0, 120 - ext.length) + ext;
  }
  const ext = EXT_BY_MIME[mime.split(';')[0].trim().toLowerCase()];
  if (!n) n = 'file';
  if (ext && !/\.[A-Za-z0-9]{1,8}$/.test(n)) n = `${n}.${ext}`;
  return n;
}

/** `?download=1` variant of an adapter attachment URL (served as `Content-Disposition: attachment`). */
export function withDownloadParam(url: string): string {
  const hash = url.indexOf('#');
  const base = hash === -1 ? url : url.slice(0, hash);
  return `${base}${base.includes('?') ? '&' : '?'}download=1${hash === -1 ? '' : url.slice(hash)}`;
}
