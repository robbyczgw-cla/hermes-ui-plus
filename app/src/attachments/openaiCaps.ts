/**
 * Attachment capabilities of an OpenAI-compatible server. Pure (openaiCaps.test.ts).
 *
 * Advertised by the server in `GET {baseUrl}/capabilities` (optional endpoint, 404 tolerated):
 *   { "attachments": { "images": true, "files": ["text/*", "application/pdf"], "maxBytes": 9000000 } }
 * The legacy flag `"images_in": true|false` is understood as `attachments.images`.
 *
 * - `images`   image_url parts with data: URLs are accepted
 * - `files`    mime patterns (`text/*`, `application/pdf`, or a lone star for everything) of NON-text files the server
 *              takes as `{type:'file', file:{filename, file_data:'data:<mime>;base64,…'}}` parts.
 *              Text-like files (≤ 200 KB) are always inlined as text parts and need no entry.
 * - `maxBytes` max encoded attachment payload per message (default 9 MB)
 */
export type OpenAIAttachmentCaps = {
  images: boolean;
  files: string[];
  maxBytes: number;
};

export const OPENAI_DEFAULT_MAX_BYTES = 9_000_000;
/** per image after downscale (base64 characters), the OpenAI limit */
export const OPENAI_MAX_IMAGE_BASE64 = 5_000_000;

/** unknown OpenAI-compatible server: most support vision, files = text only (inlined) */
export const DEFAULT_OPENAI_CAPS: OpenAIAttachmentCaps = { images: true, files: ['text/*'], maxBytes: OPENAI_DEFAULT_MAX_BYTES };

export function mimeMatches(pattern: string, mime: string): boolean {
  const p = pattern.trim().toLowerCase();
  const m = mime.trim().toLowerCase();
  if (!p) return false;
  if (p === '*' || p === '*/*') return true;
  if (p.endsWith('/*')) return m.startsWith(p.slice(0, -1));
  return p === m;
}

export function capsAllowFile(caps: OpenAIAttachmentCaps, mime: string): boolean {
  return caps.files.some((p) => mimeMatches(p, mime));
}

/** Parse a `/capabilities` JSON body. Missing/invalid fields fall back to the defaults. */
export function parseOpenAICaps(json: unknown): OpenAIAttachmentCaps {
  const out: OpenAIAttachmentCaps = { ...DEFAULT_OPENAI_CAPS, files: [...DEFAULT_OPENAI_CAPS.files] };
  if (!json || typeof json !== 'object') return out;
  const root = json as Record<string, unknown>;
  if (typeof root.images_in === 'boolean') out.images = root.images_in;
  const a = root.attachments;
  if (a && typeof a === 'object') {
    const o = a as Record<string, unknown>;
    if (typeof o.images === 'boolean') out.images = o.images;
    if (Array.isArray(o.files)) out.files = o.files.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    if (typeof o.maxBytes === 'number' && Number.isFinite(o.maxBytes) && o.maxBytes > 0) out.maxBytes = Math.floor(o.maxBytes);
  }
  return out;
}
