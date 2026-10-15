/**
 * The URL to show an attachment's `uri` with: web / desktop app attachments are stored as `hui-att:` (webBlobs.ts)
 * and get an object URL per session; everything else (native files, http, data:) is returned as it is.
 */
import { useEffect, useReducer } from 'react';
import { webAttachments } from './webStore';

export function useAttachmentUri(uri: string | null | undefined): string | undefined {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const now = uri ? webAttachments().peek(uri) : undefined;
  useEffect(() => {
    if (!uri || now !== undefined) return;
    let alive = true;
    void webAttachments()
      .resolve(uri)
      .then(() => {
        if (alive) bump();
      });
    return () => {
      alive = false;
    };
  }, [uri, now]);
  return now;
}
