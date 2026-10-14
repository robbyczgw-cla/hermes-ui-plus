/**
 * Parsing of MediaWiki Action API responses (formatversion=2). Input is untrusted JSON: every
 * field is type-checked, nothing is executed or rendered as HTML.
 */
import type { WikiFile, WikiPage } from './types.ts';

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const s = (x: unknown): string | undefined => (typeof x === 'string' ? x : undefined);
const n = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

function pagesOf(json: unknown): Rec[] {
  if (!isRec(json) || !isRec(json.query)) return [];
  return arr(json.query.pages).filter(isRec);
}

/** Only accept https URLs on Wikimedia hosts (protocol-relative "//…" is upgraded). */
export function safeWikimediaUrl(x: unknown): string | undefined {
  let u = s(x);
  if (!u) return undefined;
  if (u.startsWith('//')) u = 'https:' + u;
  return /^https:\/\/([a-z0-9-]+\.)*(wikimedia|wikipedia)\.org\//i.test(u) ? u : undefined;
}

function thumbOf(x: unknown): WikiPage['thumb'] {
  if (!isRec(x)) return undefined;
  const url = safeWikimediaUrl(x.source);
  const width = n(x.width);
  const height = n(x.height);
  return url && width && height ? { url, width, height } : undefined;
}

/** "Datei:Colosseo_2020.jpg" / "File:Colosseo 2020.jpg" / "colosseo_2020.jpg" → "Colosseo 2020.jpg" */
export function fileKey(name: string, hasNamespace = false): string {
  let f = name;
  if (hasNamespace) f = f.replace(/^[^:]{1,40}:/, '');
  f = f.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return f.charAt(0).toUpperCase() + f.slice(1);
}

function toPage(p: Rec): WikiPage | null {
  const title = s(p.title);
  if (!title || p.missing !== undefined || p.invalid !== undefined) return null;
  const pp = isRec(p.pageprops) ? p.pageprops : undefined;
  return {
    title,
    index: n(p.index) ?? 1,
    disambiguation: !!pp && 'disambiguation' in pp,
    file: s(p.pageimage),
    thumb: thumbOf(p.thumbnail),
  };
}

/** generator=search response → pages sorted by search rank. */
export function parseSearchPages(json: unknown): WikiPage[] {
  return pagesOf(json)
    .map(toPage)
    .filter((p): p is WikiPage => p !== null)
    .sort((a, b) => a.index - b.index);
}

/**
 * titles=A|B|C&redirects=1 response → requested title → page (or null if missing).
 * Follows the `normalized` (case/underscores) and `redirects` chains.
 */
export function parseTitleLookup(json: unknown, requested: string[]): Map<string, WikiPage | null> {
  const out = new Map<string, WikiPage | null>();
  const q = isRec(json) && isRec(json.query) ? json.query : {};
  const hop = new Map<string, string>();
  for (const key of ['normalized', 'converted', 'redirects']) {
    for (const r of arr((q as Rec)[key])) {
      if (!isRec(r)) continue;
      const from = s(r.from);
      const to = s(r.to);
      if (from && to && from !== to) hop.set(from, to);
    }
  }
  const byTitle = new Map<string, WikiPage>();
  for (const p of pagesOf(json)) {
    const page = toPage(p);
    if (page) byTitle.set(page.title, page);
  }
  for (const t of requested) {
    let cur = t;
    for (let i = 0; i < 5 && hop.has(cur); i++) cur = hop.get(cur)!;
    out.set(t, byTitle.get(cur) ?? null);
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** HTML (extmetadata values) → plain text: tags removed, common entities decoded, collapsed, capped. */
export function htmlToText(html: string, max = 80): string {
  const t = html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e: string) => {
      const k = e.toLowerCase();
      if (ENTITIES[k] !== undefined) return ENTITIES[k];
      if (k.startsWith('#x')) return safeChar(parseInt(k.slice(2), 16), m);
      if (k.startsWith('#')) return safeChar(parseInt(k.slice(1), 10), m);
      return m;
    })
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

function safeChar(code: number, fallback: string): string {
  return Number.isFinite(code) && code > 31 && code < 0x110000 ? String.fromCodePoint(code) : fallback;
}

function meta(ext: unknown, key: string): string | undefined {
  if (!isRec(ext) || !isRec(ext[key])) return undefined;
  const v = s((ext[key] as Rec).value);
  if (!v) return undefined;
  const t = htmlToText(v);
  return t || undefined;
}

function toFile(p: Rec): WikiFile | null {
  const title = s(p.title);
  const ii = arr(p.imageinfo)[0];
  if (!title || !isRec(ii)) return null;
  const width = n(ii.width) ?? 0;
  const height = n(ii.height) ?? 0;
  const turl = safeWikimediaUrl(ii.thumburl);
  const tw = n(ii.thumbwidth);
  const th = n(ii.thumbheight);
  const ext = ii.extmetadata;
  const licenseUrl = s(isRec(ext) && isRec(ext.LicenseUrl) ? (ext.LicenseUrl as Rec).value : undefined);
  return {
    name: fileKey(title, true),
    index: n(p.index) ?? 1,
    mime: s(ii.mime) ?? '',
    width,
    height,
    thumb: turl && tw && th ? { url: turl, width: tw, height: th } : undefined,
    descriptionUrl: safeWikimediaUrl(ii.descriptionurl),
    author: meta(ext, 'Artist'),
    license: meta(ext, 'LicenseShortName'),
    licenseUrl: licenseUrl && /^https?:\/\//.test(licenseUrl) ? licenseUrl : undefined,
    objectName: meta(ext, 'ObjectName'),
  };
}

/** prop=imageinfo response (titles=File:A|File:B, or Commons generator=search) → files by rank. */
export function parseImageInfo(json: unknown): WikiFile[] {
  return pagesOf(json)
    .map(toFile)
    .filter((f): f is WikiFile => f !== null)
    .sort((a, b) => a.index - b.index);
}

/**
 * Re-size a Wikimedia thumbnail URL (".../thumb/a/ab/X.jpg/960px-X.jpg" → ".../330px-X.jpg").
 * Non-thumb URLs are returned unchanged.
 */
export function resizeThumb(url: string, px: number): string {
  if (!/\/thumb\//.test(url)) return url;
  const q = url.indexOf('?');
  const path = q < 0 ? url : url.slice(0, q);
  const query = q < 0 ? '' : url.slice(q);
  const slash = path.lastIndexOf('/');
  const last = path.slice(slash + 1);
  if (!/^\d+px-/.test(last)) return url;
  return path.slice(0, slash + 1) + last.replace(/^\d+px-/, `${Math.round(px)}px-`) + query;
}
