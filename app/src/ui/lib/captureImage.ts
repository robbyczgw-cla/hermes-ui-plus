/**
 * Photos in a share-as-image frame on the web (browser / desktop app): the frame fetches each photo itself (CORS) and
 * draws it from a local `blob:` copy. The PNG renderer (modern-screenshot) then reads only local data – no second
 * download that could stall the capture or come back empty – and a photo the page may not read back (no CORS) is
 * known before the capture: it is drawn as its fallback in the preview AND the image, never as an empty box.
 * The request is the one the chat already made for this photo (same URL, same headers); nothing new is contacted.
 * Native captures what is drawn (react-native-view-shot), so the source passes through unchanged there.
 */
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useCaptureMode } from './capture';
import { needsLocalCopy } from './captureTracker.ts';

export type CaptureImageState = 'pass' | 'loading' | 'ready' | 'failed';
type Src = { uri: string; headers?: Record<string, string> };

/**
 * `source` for the `<Image>`: unchanged outside a capture frame / on native ('pass'); in a web capture frame null
 * while the local copy loads ('loading'), the `blob:` copy ('ready'), or null when it cannot be read ('failed').
 * Pass a memoized source (its identity is not watched, its uri and headers are).
 */
export function useCaptureImageSource<S extends Src>(source: S | null): { source: S | { uri: string } | null; state: CaptureImageState } {
  const capture = useCaptureMode();
  const uri = source?.uri ?? null;
  const local = needsLocalCopy(Platform.OS, capture, uri);
  const auth = source?.headers?.Authorization;
  const [copy, setCopy] = useState<{ uri: string; blob: string | null } | null>(null);
  useEffect(() => {
    if (!local || !uri) return;
    let alive = true;
    let url: string | null = null;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    fetch(uri, { mode: 'cors', credentials: 'omit', cache: 'force-cache', headers: auth ? { Authorization: auth } : undefined, signal: ctrl?.signal })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b) => {
        if (!b.size) throw new Error('empty');
        url = URL.createObjectURL(b);
        if (alive) setCopy({ uri, blob: url });
      })
      .catch(() => {
        if (alive) setCopy({ uri, blob: null });
      });
    return () => {
      alive = false;
      ctrl?.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [local, uri, auth]);
  if (!local) return { source, state: 'pass' };
  if (!copy || copy.uri !== uri) return { source: null, state: 'loading' };
  return copy.blob ? { source: { uri: copy.blob }, state: 'ready' } : { source: null, state: 'failed' };
}
