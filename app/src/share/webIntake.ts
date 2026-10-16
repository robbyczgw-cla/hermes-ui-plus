/**
 * Web Share Target (docs/SHARE-TARGET.md "Web"): the installed PWA appears in the system share sheet
 * (manifest.webmanifest `share_target`, POST multipart). app/public/sw.js takes the POST, stores the share in the Cache
 * Storage `hui-share-inbox` and redirects to `/#huiShare=<id>` (a fragment, like pair links: Expo Router keeps a query
 * string in its own state and would put it back). This module reads that entry once, removes the fragment from the
 * address bar (history.replaceState) and hands the share to the sheet; the stored entry is deleted
 * once its files are in memory (closing the page must not leave a disk copy).
 * `#huiShare=missed`: the POST reached the server instead of the service worker (bridge/src/static.mjs answers it with
 * that redirect) – nothing arrived, the user gets a notice instead of a silent loss.
 * Erasable TS (node:test); the browser APIs are passed in.
 */
import { fromWebShare, type SharedPayload } from './model.ts';

export const SHARE_CACHE = 'hui-share-inbox';
/** sw.js stores `<prefix><id>/meta` (JSON) and `<prefix><id>/<n>` (file bodies) */
export const SHARE_KEY_PREFIX = '/__hui-share/';
const ID_RE = /^[a-z0-9-]{4,64}$/;

export type ShareParam = { id: string | 'missed' | 'failed'; cleanUrl: string };

/** `#huiShare=<id>` in `href` → the id + the URL without the fragment; null when absent */
export function takeShareParam(href: string): ShareParam | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  const m = /^#huiShare=([^&]*)$/.exec(u.hash);
  if (!m) return null;
  const raw = m[1];
  const cleanUrl = `${u.pathname}${u.search}`;
  if (raw === 'missed' || raw === 'failed') return { id: raw, cleanUrl };
  return ID_RE.test(raw) ? { id: raw, cleanUrl } : { id: 'failed', cleanUrl };
}

type MetaFile = { name?: unknown; type?: unknown };
type Meta = { title?: unknown; text?: unknown; url?: unknown; files?: unknown };
type CacheLike = { match(key: string): Promise<{ json(): Promise<unknown>; blob(): Promise<Blob> } | undefined>; delete(key: string): Promise<boolean> };
type CachesLike = { open(name: string): Promise<CacheLike> };

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Consumes the share `id` stored by sw.js into independent File objects. null = already consumed (a reload).
 * An incomplete or unreadable entry throws: never silently offer text without its missing file.
 */
export async function readWebShare(id: string, caches: CachesLike): Promise<{ payload: SharedPayload; release: () => void } | null> {
  const base = `${SHARE_KEY_PREFIX}${id}/`;
  let cache: CacheLike | undefined;
  let count = 0;
  const release = async () => {
    if (!cache) return;
    for (let i = 0; i < count; i++) await cache.delete(`${base}${i}`).catch(() => false);
    await cache.delete(`${base}meta`).catch(() => false);
  };
  try {
    cache = await caches.open(SHARE_CACHE);
    const metaRes = await cache.match(`${base}meta`);
    if (!metaRes) return null;
    const meta = (await metaRes.json()) as Meta;
    const list = Array.isArray(meta.files) ? (meta.files as MetaFile[]) : [];
    if (list.length > 20) throw new Error('invalid share metadata');
    count = list.length;
    const files: File[] = [];
    for (let i = 0; i < list.length; i++) {
      const r = await cache.match(`${base}${i}`);
      if (!r) throw new Error('shared file missing');
      const blob = await r.blob();
      files.push(new File([blob], str(list[i]?.name) || `shared-${i + 1}`, { type: str(list[i]?.type) || blob.type }));
    }
    const payload = fromWebShare({ title: str(meta.title), text: str(meta.text), url: str(meta.url) }, files);
    await release();
    if (!payload) return null;
    return { payload, release };
  } catch {
    await release();
    throw new Error('share intake failed');
  }
}
