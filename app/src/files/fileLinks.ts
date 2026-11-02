/**
 * Markdown links that point at a file (web: rendered as a file card with "Öffnen" / "Sichern" instead of a bare link).
 * An agent server may send an agent's files as one paragraph each: `[name.pdf](https://…/v1/attachments/<signed>) (2 KB)`;
 * other answers may link a file by its URL. Pure (fileLinks.test.ts).
 */
import { mediaMime, mediaRefOf, type MediaKind } from '../chat/mediaTags.ts';
import { withDownloadParam } from './webFile.ts';

export type FileLink = {
  href: string;
  name: string;
  mime: string;
  kind: MediaKind;
  /** "2 KB" as written after the link */
  sizeText?: string;
  /** `?download=1` variant (adapter attachment URLs) */
  downloadUrl?: string;
};

const PARAGRAPH = /^\[([^\]\n]{1,200})\]\(\s*<?((?:https?:\/\/|\/)[^\s()<>]+)>?\s*\)(?:\s*\(([^()\n]{1,24})\))?\s*$/;
const SIGNED = /\/v1\/attachments\/[A-Za-z0-9_.-]+$/;

function lastSegment(path: string): string {
  const seg = path.split('/').pop() ?? '';
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/**
 * The file behind a link (text + href), or null for an ordinary link. `base`: the page URL for root-relative links
 * (the adapter sends `/v1/attachments/…` when it knows no public origin; the web app is then served by it).
 */
export function fileLinkOf(text: string, href: string, base?: string): FileLink | null {
  let u: URL;
  try {
    u = href.startsWith('/') && !href.startsWith('//') && base ? new URL(href, base) : new URL(href);
  } catch {
    return null;
  }
  href = u.href;
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const label = text.replace(/[`*_]/g, '').trim();
  const signed = SIGNED.test(u.pathname);
  // the adapter's link text is the file name; a plain URL needs a file extension in its path
  const ref = (signed ? mediaRefOf(label) : null) ?? mediaRefOf(lastSegment(u.pathname));
  if (!ref) return null;
  const name = signed || mediaRefOf(label) ? label : ref.name;
  return {
    href,
    name,
    mime: mediaMime(ref),
    kind: ref.kind,
    ...(signed ? { downloadUrl: withDownloadParam(href) } : {}),
  };
}

/** A paragraph that is just one file link (optionally followed by its size in parentheses). */
export function fileLinkParagraph(src: string, base?: string): FileLink | null {
  const m = PARAGRAPH.exec(src.trim());
  if (!m) return null;
  const link = fileLinkOf(m[1], m[2], base);
  if (!link) return null;
  const size = m[3]?.trim();
  return size && /^\d[\d.,]*\s?(B|KB|MB|GB|Byte|Bytes)$/i.test(size) ? { ...link, sizeText: size } : link;
}

/** "2 KB" / "1,5 MB" → bytes (approximate; for the size limits only). */
export function parseSizeText(s: string | undefined): number | undefined {
  const m = s ? /^(\d+(?:[.,]\d+)?)\s?(B|Byte|Bytes|KB|MB|GB)$/i.exec(s.trim()) : null;
  if (!m) return undefined;
  const n = Number(m[1].replace(',', '.'));
  const unit = m[2].toUpperCase();
  const f = unit === 'KB' ? 1e3 : unit === 'MB' ? 1e6 : unit === 'GB' ? 1e9 : 1;
  return Math.round(n * f);
}
