/** Browser implementation of the file actions' side effects (webFileActions.ts `FileDeps`). Web / desktop only. */
import { desktopSaveFile } from '../desktop/bridge';
import { detectWebFileEnv } from './webFile.ts';
import { FileFetchError, type FileDeps } from './webFileActions.ts';

/** GET the bytes; `headers` for the bridge's bearer token, signed / public URLs need none. */
export async function fetchFileBytes(url: string, headers?: Record<string, string>): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(url, { headers, credentials: 'same-origin' });
  } catch {
    throw new FileFetchError(0);
  }
  if (!res.ok) throw new FileFetchError(res.status);
  return res.blob();
}

export function browserFileDeps(file: { name: string; mime: string }, fetchBytes: () => Promise<Blob>): FileDeps {
  const w = window;
  return {
    env: detectWebFileEnv(w as never, file),
    fetchBytes,
    makeFile: (blob, name, mime) => new File([blob], name, { type: mime }),
    share: typeof navigator.share === 'function' ? (data) => navigator.share(data) : undefined,
    openWindow: (url) => void w.open(url, '_blank', 'noopener'),
    openBlank: () => {
      const win = w.open('', '_blank');
      if (!win) return null;
      return {
        navigate: (url) => {
          win.location.href = url;
        },
        close: () => win.close(),
      };
    },
    anchorDownload: (href, name) => {
      const a = document.createElement('a');
      a.href = href;
      a.download = name;
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
    objectUrls: { create: (b) => URL.createObjectURL(b), revoke: (u) => URL.revokeObjectURL(u) },
    desktopSave: desktopSaveFile,
  };
}
