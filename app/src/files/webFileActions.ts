/**
 * "Öffnen" / "Sichern" for a file in a chat on the web (decisions: webFile.ts). Side effects go through `FileDeps`
 * so the flows are testable without a browser (webFileActions.test.ts).
 *
 * iOS: `navigator.share` only works while the tap's user activation lasts, and loading the bytes can outlast it.
 * Loaded files are kept (a few, by key) so the share call of a second tap (and a save from the PDF viewer, which has
 * loaded the bytes already) happens synchronously. A share refused for lack of activation comes back as `needsTap`.
 */
import { activeMime, isIosApp, MAX_IN_MEMORY_BYTES, openMethod, saveMethod, saveName, tabSafeMime, type WebFileEnv, type WebFileSource } from './webFile.ts';

export type FileFailure = 'unavailable' | 'tooLarge' | 'notHere' | 'error';

export type FileOutcome =
  | { kind: 'downloaded' }
  | { kind: 'savedTo'; path: string }
  | { kind: 'shared' }
  | { kind: 'opened' }
  | { kind: 'cancelled' }
  | { kind: 'needsTap' }
  | { kind: 'failed'; reason: FileFailure };

/** The file could not be fetched (HTTP status, 0 = network). */
export class FileFetchError extends Error {
  status: number;
  constructor(status: number) {
    super(`file fetch failed (${status})`);
    this.status = status;
  }
}

class TooLarge extends Error {}

export type FileDeps = {
  env: WebFileEnv;
  /** the file's bytes (auth / signed URL handled by the caller) */
  fetchBytes: () => Promise<Blob>;
  makeFile: (blob: Blob, name: string, mime: string) => File;
  share?: (data: { files: File[] }) => Promise<void>;
  /** `window.open(url, '_blank', 'noopener')` */
  openWindow: (url: string) => void;
  /** a blank window opened inside the gesture, navigated once the bytes are there (popup blockers) */
  openBlank?: () => { navigate: (url: string) => void; close: () => void } | null;
  /** `<a href download>` click */
  anchorDownload: (href: string, name: string) => void;
  objectUrls: { create: (b: Blob) => string; revoke: (u: string) => void };
  /** desktop app: bytes into Downloads (and open them with the default app); null when it failed */
  desktopSave?: (bytes: Uint8Array, name: string, open: boolean) => Promise<{ path: string; opened: boolean } | null>;
  later?: (fn: () => void, ms: number) => void;
};

const KEEP = 6;
const ready = new Map<string, File>();
const loading = new Map<string, Promise<File>>();

function remember(key: string, f: File) {
  ready.delete(key);
  ready.set(key, f);
  while (ready.size > KEEP) ready.delete(ready.keys().next().value as string);
}

/** Test hook: forget loaded files. */
export function resetWebFileCache(): void {
  ready.clear();
  loading.clear();
}

const OCTET = 'application/octet-stream';

const mimeOf = (src: WebFileSource, blob?: Blob) => {
  const mime = src.mime && src.mime !== OCTET ? src.mime : blob?.type || src.mime || OCTET;
  return activeMime(mime) ? OCTET : mime;
};

function load(src: WebFileSource, deps: FileDeps): Promise<File> {
  const hit = ready.get(src.key);
  if (hit) return Promise.resolve(hit);
  const running = loading.get(src.key);
  if (running) return running;
  const p = (async () => {
    if ((src.size ?? 0) > MAX_IN_MEMORY_BYTES) throw new TooLarge();
    const blob = await deps.fetchBytes();
    if (blob.size > MAX_IN_MEMORY_BYTES) throw new TooLarge();
    const mime = mimeOf(src, blob);
    const file = deps.makeFile(blob, saveName(src.name, mime), mime);
    remember(src.key, file);
    return file;
  })();
  loading.set(src.key, p);
  p.then(
    () => loading.delete(src.key),
    () => loading.delete(src.key),
  );
  return p;
}

/** The file's bytes for the in-app viewer (shared with "Sichern": a save from the viewer needs no second load). */
export function loadWebFile(src: WebFileSource, deps: FileDeps): Promise<File> {
  return load(src, deps);
}

/** Why loading failed, for the viewer's message. */
export function loadFailure(e: unknown): FileFailure {
  const o = failure(e);
  return o.kind === 'failed' ? o.reason : 'error';
}

/**
 * A file with a URL that could not be fetched by the app (a cross-origin link without CORS, network): the URL itself
 * in a new window / overlay browser still lets the user view and keep it.
 */
function failedLoad(src: WebFileSource, deps: FileDeps) {
  return (e: unknown): FileOutcome => {
    // never in the iOS home-screen app: a file URL traps it (webFile.ts)
    if (src.url && e instanceof FileFetchError && e.status === 0 && !isIosApp(deps.env)) {
      deps.openWindow(deps.env.ios ? src.url : (src.downloadUrl ?? src.url));
      return { kind: 'opened' };
    }
    return failure(e);
  };
}

function failure(e: unknown): FileOutcome {
  if (e instanceof TooLarge) return { kind: 'failed', reason: 'tooLarge' };
  if (e instanceof FileFetchError) return { kind: 'failed', reason: e.status === 0 ? 'error' : 'unavailable' };
  return { kind: 'failed', reason: 'error' };
}

async function shareFile(file: File, deps: FileDeps): Promise<FileOutcome> {
  if (!deps.share) return { kind: 'failed', reason: 'notHere' };
  try {
    // files only: a title / text would land in "In Dateien sichern" as an extra text file
    await deps.share({ files: [file] });
    return { kind: 'shared' };
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    if (name === 'AbortError') return { kind: 'cancelled' };
    if (name === 'NotAllowedError') return { kind: 'needsTap' };
    return { kind: 'failed', reason: 'error' };
  }
}

/** Share with the bytes at hand: synchronous up to `navigator.share` when they are already loaded. */
function viaShare(src: WebFileSource, deps: FileDeps): Promise<FileOutcome> {
  const hit = ready.get(src.key);
  if (hit) return shareFile(hit, deps);
  return load(src, deps).then((f) => shareFile(f, deps), failedLoad(src, deps));
}

const toBytes = async (f: Blob) => new Uint8Array(await f.arrayBuffer());

function downloadFile(f: File, deps: FileDeps): FileOutcome {
  const url = deps.objectUrls.create(f);
  deps.anchorDownload(url, f.name);
  (deps.later ?? setTimeout)(() => deps.objectUrls.revoke(url), 60_000);
  return { kind: 'downloaded' };
}

/** "Sichern": keep a copy on this device. Call it straight from the tap handler. */
export function saveWebFile(src: WebFileSource, deps: FileDeps): Promise<FileOutcome> {
  const m = saveMethod(deps.env, src);
  switch (m) {
    case 'share':
      return viaShare(src, deps);
    case 'openUrl':
      // iOS Safari tab: the inline view has a share button; elsewhere the download variant
      deps.openWindow(deps.env.ios ? src.url! : (src.downloadUrl ?? src.url!));
      return Promise.resolve({ kind: 'opened' });
    case 'none':
      return Promise.resolve({ kind: 'failed', reason: (src.size ?? 0) > MAX_IN_MEMORY_BYTES ? 'tooLarge' : 'notHere' });
    case 'anchor':
      return load(src, deps).then((f) => downloadFile(f, deps), failedLoad(src, deps));
    case 'desktop':
      return load(src, deps).then(async (f) => {
        const r = deps.desktopSave ? await deps.desktopSave(await toBytes(f), f.name, false) : null;
        return r ? ({ kind: 'savedTo', path: r.path } as FileOutcome) : ({ kind: 'failed', reason: 'error' } as FileOutcome);
      }, failedLoad(src, deps));
  }
}

/** "Öffnen": view the file without leaving the app for good. Call it straight from the tap handler. */
export function openWebFile(src: WebFileSource, deps: FileDeps, o: { system?: boolean } = {}): Promise<FileOutcome> {
  const m = openMethod(deps.env, src, o);
  switch (m) {
    case 'viewer':
      // shown by the caller (FileActions → PdfViewer); here only when a caller skipped that
      return openWebFile(src, deps, { system: true });
    case 'url':
      deps.openWindow(src.url!);
      return Promise.resolve({ kind: 'opened' });
    case 'share':
      return viaShare(src, deps);
    case 'none':
      return Promise.resolve({ kind: 'failed', reason: (src.size ?? 0) > MAX_IN_MEMORY_BYTES ? 'tooLarge' : 'notHere' });
    case 'download':
      return load(src, deps).then((f) => downloadFile(f, deps), failure);
    case 'blobTab': {
      const hit = ready.get(src.key);
      const show = (f: File, win: ReturnType<NonNullable<FileDeps['openBlank']>> | null): FileOutcome => {
        // the one place a blob becomes a document of the app's origin (webFile.ts): what the bytes turned out to be counts
        if (!tabSafeMime(f.type)) {
          win?.close();
          return deps.env.anchorDownload ? downloadFile(f, deps) : { kind: 'failed', reason: 'notHere' };
        }
        const url = deps.objectUrls.create(f);
        if (win) win.navigate(url);
        else deps.openWindow(url);
        // the tab keeps its document; the URL is only needed while it loads (and for a reload)
        (deps.later ?? setTimeout)(() => deps.objectUrls.revoke(url), 5 * 60_000);
        return { kind: 'opened' } as FileOutcome;
      };
      if (hit) return Promise.resolve(show(hit, null));
      const win = deps.openBlank?.() ?? null;
      return load(src, deps).then(
        (f) => show(f, win),
        (e) => {
          win?.close();
          return failure(e);
        },
      );
    }
    case 'desktop':
      return load(src, deps).then(async (f) => {
        // a type the system must not open (scripts, apps …) is only saved
        const r = deps.desktopSave ? await deps.desktopSave(await toBytes(f), f.name, true) : null;
        if (!r) return { kind: 'failed', reason: 'error' } as FileOutcome;
        return r.opened ? ({ kind: 'opened' } as FileOutcome) : ({ kind: 'savedTo', path: r.path } as FileOutcome);
      }, failure);
  }
}
