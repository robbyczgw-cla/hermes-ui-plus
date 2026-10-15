/** MIME / file-type helpers + German byte formatting. Pure (tested in mime.test.ts). */
import type { TFn } from '../i18n/core.ts';

export const MIME = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  yaml: 'application/yaml',
  xml: 'application/xml',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

const BY_EXT: Record<string, string> = {
  jpg: MIME.jpeg,
  jpeg: MIME.jpeg,
  png: MIME.png,
  gif: MIME.gif,
  webp: MIME.webp,
  heic: MIME.heic,
  heif: MIME.heif,
  pdf: MIME.pdf,
  txt: MIME.txt,
  log: MIME.txt,
  md: MIME.md,
  markdown: MIME.md,
  csv: MIME.csv,
  tsv: MIME.tsv,
  json: MIME.json,
  yaml: MIME.yaml,
  yml: MIME.yaml,
  xml: MIME.xml,
  docx: MIME.docx,
  xlsx: MIME.xlsx,
};

/** Types offered in the document picker (accepted files are re-checked with `classifyFile`). */
export const DOCUMENT_PICKER_TYPES: string[] = [
  MIME.pdf,
  'text/*',
  MIME.json,
  MIME.docx,
  MIME.xlsx,
  'image/*',
  // Android often reports .md / .csv / .json as octet-stream; classifyFile() filters by extension
  'application/octet-stream',
];

export function extOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

export function mimeFromName(name: string): string | undefined {
  return BY_EXT[extOf(name)];
}

/** Picker mime types are unreliable (missing, octet-stream, text/comma-separated-values …). */
export function normalizeMime(mime: string | null | undefined, name: string): string {
  const m = (mime ?? '').toLowerCase().split(';')[0].trim();
  const byName = mimeFromName(name);
  if (!m || m === 'application/octet-stream' || m === 'binary/octet-stream') return byName ?? 'application/octet-stream';
  if (m === 'image/jpg') return MIME.jpeg;
  if (m === 'text/comma-separated-values' || m === 'application/csv') return MIME.csv;
  if (m === 'text/x-markdown') return MIME.md;
  if (m === 'text/json') return MIME.json;
  if (m === 'text/plain' && byName && isTextLike(byName)) return byName; // .md/.csv reported as text/plain
  return m;
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

/** Image formats Claude accepts natively (others are converted to JPEG during preparation). */
export function isClaudeImageMime(mime: string): mime is 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  return mime === MIME.jpeg || mime === MIME.png || mime === MIME.gif || mime === MIME.webp;
}

export function isPdf(mime: string): boolean {
  return mime === MIME.pdf;
}

const TEXT_APP = new Set<string>([MIME.json, MIME.yaml, MIME.xml, 'application/x-yaml', 'application/ld+json']);

/** UTF-8 text content (can be inlined as text). */
export function isTextLike(mime: string): boolean {
  return mime.startsWith('text/') || TEXT_APP.has(mime) || mime.endsWith('+json');
}

export function isOfficeDoc(mime: string): boolean {
  return mime === MIME.docx || mime === MIME.xlsx;
}

export type FileClass = 'image' | 'pdf' | 'text' | 'office';

/** Accepted attachment classes; `null` = unsupported type. */
export function classifyFile(mime: string): FileClass | null {
  if (isImageMime(mime)) return 'image';
  if (isPdf(mime)) return 'pdf';
  if (isTextLike(mime)) return 'text';
  if (isOfficeDoc(mime)) return 'office';
  return null;
}

/** Fence language hint for inlined text files. */
export function fenceLang(name: string, mime: string): string {
  const e = extOf(name);
  if (e === 'md' || e === 'markdown') return 'markdown';
  if (e === 'yml') return 'yaml';
  if (['json', 'csv', 'tsv', 'yaml', 'xml'].includes(e)) return e;
  if (mime === MIME.json) return 'json';
  if (mime === MIME.csv) return 'csv';
  return '';
}

/** "512 B", "830 KB", "1,2 MB" (German decimal comma, 1 KB = 1000 B like iOS/Android file UIs). */
export function formatBytes(n: number, lang: 'de' | 'en' | 'es' = 'de'): string {
  if (!Number.isFinite(n) || n < 0) return '–';
  if (n < 1000) return `${Math.round(n)} B`;
  if (n < 1_000_000) return `${Math.round(n / 1000)} KB`;
  const mb = n / 1_000_000;
  const s = mb < 10 ? mb.toFixed(1) : String(Math.round(mb));
  return `${lang === 'en' ? s : s.replace('.', ',')} MB`;
}

/** formatBytes with one decimal (KB / MB); bytes stay exact */
function formatBytes1(n: number, lang: 'de' | 'en' | 'es'): string {
  if (n < 1000) return `${Math.round(n)} B`;
  const [v, unit] = n < 1_000_000 ? [n / 1000, 'KB'] : [n / 1_000_000, 'MB'];
  const s = v.toFixed(1);
  return `${lang === 'en' ? s : s.replace('.', ',')} ${unit}`;
}

/** exact byte count, digits grouped with no-break spaces (reads the same in every language) */
function exactBytes(n: number): string {
  return `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')} B`;
}

/**
 * Size and limit for a "too large" message. When rounding would make them read the same ("20 MB, max. 20 MB"), both
 * get one decimal, and if that is still equal, exact bytes.
 */
export function formatSizeOverLimit(n: number, max: number, lang: 'de' | 'en' | 'es' = 'de'): { size: string; max: string } {
  const plain = { size: formatBytes(n, lang), max: formatBytes(max, lang) };
  if (plain.size !== plain.max) return plain;
  const one = { size: formatBytes1(n, lang), max: formatBytes1(max, lang) };
  if (one.size !== one.max) return one;
  return { size: exactBytes(n), max: exactBytes(max) };
}

/** Short label for file cards ("PDF", "DOCX", "CSV" …; generic image/file labels are translated via `t`). */
export function typeLabel(name: string, mime: string, t: TFn): string {
  const e = extOf(name);
  if (e) return e.toUpperCase().slice(0, 5);
  if (isPdf(mime)) return 'PDF';
  if (isImageMime(mime)) return t('attachments.type.image');
  return t('attachments.type.file');
}

/** Replace the extension (or append one). */
export function withExt(name: string, ext: string): string {
  const base = name.split(/[\\/]/).pop() || 'datei';
  const i = base.lastIndexOf('.');
  return `${i > 0 ? base.slice(0, i) : base}.${ext}`;
}
