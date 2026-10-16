/**
 * Share-as-image, browser + desktop app: the frame's DOM → a PNG Blob in this page (modern-screenshot, loaded on
 * first use; SVG charts and icons are drawn as SVG), then the action the user picks:
 *   browser      download · Web Share with the file (where the browser can share files) · copy to the clipboard
 *   desktop app  save to the Downloads folder (desktop_save_image) · copy to the clipboard
 * Nothing is uploaded: the PNG only exists in this page until that action hands it on. Remote photos the browser
 * may not read back (no CORS) are drawn as their fallback tile instead. Android / iOS: shareExport.native.ts.
 */
import type { View } from 'react-native';
import { desktopSaveImage, isDesktopApp } from '../../desktop/bridge';
import { SHARE_SCALE, type ShareActionKind, type ShareEnv } from './shareModel';

export type CapturedImage = { blob: Blob; release(): void };
export type ShareOutcome = 'shared' | 'cancelled' | 'downloaded' | 'saved' | 'copied' | 'failed' | 'unavailable';

/** 1×1 transparent PNG: an image the page cannot read back leaves its (tinted) slot empty instead of failing */
const TRANSPARENT_PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

type ShareNavigator = Navigator & { canShare?: (data: { files: File[] }) => boolean };

export function shareEnvironment(): ShareEnv {
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as ShareNavigator | undefined;
  const desktop = isDesktopApp();
  let canShareFiles = false;
  try {
    // the desktop webview's navigator.share is unreliable / absent (onboarding/shareOrCopy.ts): save + copy there
    canShareFiles = !desktop && !!nav?.share && !!nav.canShare && typeof File !== 'undefined' && nav.canShare({ files: [new File([new Uint8Array(8)], 'answer.png', { type: 'image/png' })] });
  } catch {
    canShareFiles = false;
  }
  const canCopyImage = typeof ClipboardItem !== 'undefined' && typeof nav?.clipboard?.write === 'function';
  return { platform: 'web', desktop, canShareFiles, canCopyImage };
}

export async function captureFrame(view: View, size: { width: number; height: number }, background: string, _fileName: string): Promise<CapturedImage> {
  const el = view as unknown as HTMLElement;
  const { domToBlob } = await import('modern-screenshot');
  const blob = await domToBlob(el, {
    width: size.width,
    height: size.height,
    scale: SHARE_SCALE,
    backgroundColor: background,
    type: 'image/png',
    // photos are local blob: copies already (ui/lib/captureImage.ts); this only bounds fonts and stragglers
    timeout: 5000,
    fetch: { placeholderImage: TRANSPARENT_PX },
  });
  if (!blob || !blob.size) throw new Error('empty capture');
  return { blob, release() {} };
}

/**
 * Runs one sheet action. Call it straight from the button handler: the clipboard / share calls are the first thing
 * it does, inside the user's tap (Safari / WebKit refuse them after an await).
 */
export async function runShareAction(kind: ShareActionKind, img: CapturedImage, opts: { fileName: string; title: string }): Promise<ShareOutcome> {
  switch (kind) {
    case 'copy':
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': img.blob })]);
        return 'copied';
      } catch {
        return 'failed';
      }
    case 'share': {
      const file = new File([img.blob], opts.fileName, { type: 'image/png' });
      try {
        await navigator.share({ files: [file], title: opts.title });
        return 'shared';
      } catch (e) {
        return (e as { name?: string })?.name === 'AbortError' ? 'cancelled' : 'failed';
      }
    }
    case 'download': {
      const url = URL.createObjectURL(img.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = opts.fileName;
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // the browser has taken the file over by then
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      return 'downloaded';
    }
    case 'save': {
      const bytes = new Uint8Array(await img.blob.arrayBuffer());
      return (await desktopSaveImage(bytes, opts.fileName)) ? 'saved' : 'failed';
    }
  }
}
