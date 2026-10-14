/**
 * Fetch Hermes media files through the UI bridge (`GET /bridge/media?path=`, bridge/src/media.mjs) and hand them to
 * the system. Native: download into the cache (`File.downloadFileAsync` with the bearer header) and open the share
 * sheet; web: fetch -> blob URL -> new tab. A bridge without `BRIDGE_MEDIA_DIRS` answers 404 `media_disabled`:
 * the chip then says "Datei liegt auf dem Server".
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Linking, Platform } from 'react-native';
import { mediaMime, mediaUrl, type MediaRef } from './mediaTags';

export type MediaConn = { baseUrl: string; apiKey: string };

/** The file cannot be fetched (bridge without media support, path not allowed, gone, too large …). */
export class MediaUnavailable extends Error {
  status: number;
  constructor(status: number) {
    super(`media unavailable (${status})`);
    this.status = status;
  }
}

const FAIL_TTL_MS = 60_000;
type Entry<T> = { p: Promise<T>; failedAt?: number };
const files = new Map<string, Entry<string>>();
const probes = new Map<string, Entry<{ size?: number }>>();

function cached<T>(map: Map<string, Entry<T>>, key: string, run: () => Promise<T>): Promise<T> {
  const hit = map.get(key);
  if (hit && (hit.failedAt === undefined || Date.now() - hit.failedAt < FAIL_TTL_MS)) return hit.p;
  const entry: Entry<T> = { p: run() };
  entry.p.catch(() => {
    entry.failedAt = Date.now();
  });
  map.set(key, entry);
  return entry.p;
}

const headers = (conn: MediaConn): Record<string, string> => (conn.apiKey ? { Authorization: `Bearer ${conn.apiKey}` } : {});

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

/** Cheap availability check (HEAD): resolves with the size, rejects with MediaUnavailable. */
export function probeMedia(conn: MediaConn, ref: MediaRef): Promise<{ size?: number }> {
  const url = mediaUrl(conn.baseUrl, ref.path);
  return cached(probes, `${conn.baseUrl}|${ref.path}`, async () => {
    let res: Response;
    try {
      res = await fetch(url, { method: 'HEAD', headers: headers(conn) });
    } catch {
      throw new MediaUnavailable(0);
    }
    if (!res.ok) throw new MediaUnavailable(res.status);
    const n = Number(res.headers.get('content-length'));
    return { size: Number.isFinite(n) && n > 0 ? n : undefined };
  });
}

/** Local URI (`file://` / `blob:`) of the file; downloaded once per session. */
export function fetchMedia(conn: MediaConn, ref: MediaRef): Promise<string> {
  const url = mediaUrl(conn.baseUrl, ref.path);
  return cached(files, `${conn.baseUrl}|${ref.path}`, async () => {
    if (Platform.OS === 'web') {
      let res: Response;
      try {
        res = await fetch(url, { headers: headers(conn) });
      } catch {
        throw new MediaUnavailable(0);
      }
      if (!res.ok) throw new MediaUnavailable(res.status);
      return URL.createObjectURL(await res.blob());
    }
    try {
      const dir = new Directory(Paths.cache, 'hui-media');
      try {
        dir.create({ intermediates: true, idempotent: true });
      } catch {
        // exists
      }
      const dest = new File(dir, `${hash(`${conn.baseUrl}|${ref.path}`)}-${ref.name.replace(/[^\w.-]+/g, '_')}`);
      const file = await File.downloadFileAsync(url, dest, { headers: headers(conn), idempotent: true });
      return file.uri;
    } catch (e) {
      const m = /\b(40[0-9]|41[0-9]|50[0-9])\b/.exec(String((e as Error)?.message ?? ''));
      throw new MediaUnavailable(m ? Number(m[1]) : 0);
    }
  });
}

/** Open the downloaded file: native share / "open with" sheet, web: new tab (download for non-browser types). */
export async function openLocalMedia(uri: string, ref: MediaRef): Promise<void> {
  if (Platform.OS === 'web') {
    await Linking.openURL(uri).catch(() => undefined);
    return;
  }
  if (!(await Sharing.isAvailableAsync())) return;
  await Sharing.shareAsync(uri, { mimeType: mediaMime(ref), dialogTitle: ref.name }).catch(() => undefined);
}
