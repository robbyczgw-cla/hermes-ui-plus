/**
 * Hermes (OpenAI chat-completions content parts). Pure, I/O via the injected reader
 * (encodeHermes.test.ts). Hermes accepts only `text` and `image_url` parts (file parts → 400
 * unsupported_content_type, api_server.py `_normalize_multimodal_content`), caps each text part at
 * 65 536 chars and the body at 10 MB.
 *
 * - images → `{type:'image_url', image_url:{url:'data:image/jpeg;base64,…'}}`
 * - files with bridge → text part `[Datei angehängt: name (mime, size) – Pfad auf dem Server: /…]`
 *   (Hermes' read_file tool extracts PDF/DOCX/XLSX/CSV/… itself)
 * - files without bridge → small text files are inlined as a fenced block (split into ≤ 60k-char
 *   parts on line boundaries; Hermes joins all-text arrays with "\n"), everything else → error
 */
import { fenceLang, formatBytes, formatSizeOverLimit, isImageMime } from './mime.ts';
import { validateForTarget } from './validate.ts';
import { AttachmentError, LIMITS } from './types.ts';
import type { Attachment, AttachmentReader } from './types.ts';

export type HermesTextPart = { type: 'text'; text: string };
export type HermesImagePart = { type: 'image_url'; image_url: { url: string } };
export type HermesContentPart = HermesTextPart | HermesImagePart;

export type HermesEncodeOptions = {
  reader: AttachmentReader;
  /** active profile is the UI bridge (files must already carry `remoteRef`) */
  bridge: boolean;
  /** skip validateForTarget (caller already validated) */
  skipValidation?: boolean;
};

export function fileReferenceText(att: Attachment): string {
  const ref = att.remoteRef;
  if (!ref) throw new AttachmentError('not_uploaded', { key: 'attachments.encode.notUploaded', vars: { name: att.name } }, att.id);
  return `[Datei angehängt: ${att.name} (${att.mimeType}, ${formatBytes(att.size)}) – Pfad auf dem Server: ${ref.path}]`;
}

/** Backtick fence longer than any backtick run inside `content`. */
export function fenceFor(content: string): string {
  let max = 0;
  for (const m of content.matchAll(/`+/g)) max = Math.max(max, m[0].length);
  return '`'.repeat(Math.max(3, max + 1));
}

/**
 * Split text into chunks of ≤ `max` chars, preferring line boundaries. Joining the chunks with
 * "\n" restores the original exactly when every cut happened at a newline (the newline is dropped).
 */
export function splitForParts(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut <= 0) {
      // one very long line: hard cut (inserts a newline when re-joined; acceptable)
      out.push(rest.slice(0, max));
      rest = rest.slice(max);
    } else {
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut + 1);
    }
  }
  out.push(rest);
  return out;
}

export function inlineTextBlock(att: Attachment, content: string): string {
  const fence = fenceFor(content);
  const body = content.endsWith('\n') ? content : `${content}\n`;
  return `[Datei angehängt: ${att.name} (${att.mimeType}, ${formatBytes(att.size)}) – Inhalt:]\n${fence}${fenceLang(att.name, att.mimeType)}\n${body}${fence}`;
}

/**
 * Content for the new user message. Returns the plain string when there are no attachments
 * (keeps today's wire shape), else a content-part array: text, file references, images.
 */
export async function buildHermesContent(
  text: string,
  atts: readonly Attachment[],
  opts: HermesEncodeOptions
): Promise<string | HermesContentPart[]> {
  if (atts.length === 0) return text;
  if (!opts.skipValidation) validateForTarget(atts, { kind: 'hermes', bridge: opts.bridge });

  const parts: HermesContentPart[] = [];
  if (text.trim()) parts.push({ type: 'text', text });

  for (const att of atts) {
    if (att.kind === 'image' || isImageMime(att.mimeType)) continue;
    if (opts.bridge) {
      parts.push({ type: 'text', text: fileReferenceText(att) });
      continue;
    }
    let content: string;
    try {
      content = await opts.reader.text(att);
    } catch {
      throw new AttachmentError('read_failed', { key: 'attachments.encode.readFailed', vars: { name: att.name } }, att.id);
    }
    for (const chunk of splitForParts(inlineTextBlock(att, content), LIMITS.hermesTextPartChars)) {
      parts.push({ type: 'text', text: chunk });
    }
  }

  for (const att of atts) {
    if (!(att.kind === 'image' || isImageMime(att.mimeType))) continue;
    let data: string;
    try {
      data = await opts.reader.base64(att);
    } catch {
      throw new AttachmentError('read_failed', { key: 'attachments.encode.readFailed', vars: { name: att.name } }, att.id);
    }
    parts.push({ type: 'image_url', image_url: { url: `data:${att.mimeType};base64,${data}` } });
  }

  // Exact body check (estimate in validateForTarget is an upper bound for images only)
  const bytes = parts.reduce((s, p) => s + (p.type === 'text' ? utf8Length(p.text) : p.image_url.url.length), 0);
  if (bytes > LIMITS.hermesPayloadBudget) {
    throw new AttachmentError('too_large', {
      key: 'attachments.encode.messageTooLarge',
      vars: formatSizeOverLimit(bytes, LIMITS.hermesPayloadBudget),
    });
  }
  return parts;
}

export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}
