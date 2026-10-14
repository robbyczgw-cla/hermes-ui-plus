/**
 * Attachment types + limits (owner: attachments workstream). Erasable TS only (node:test runs
 * these files with type stripping): no enums/namespaces/parameter properties.
 */
import { makeT } from '../i18n/core.ts';
import type { TKey, Vars } from '../i18n/core.ts';
import type { OpenAIAttachmentCaps } from './openaiCaps.ts';

/** User-facing text as an i18n key + vars. Non-React code returns this; the UI renders `t(key, vars)`. */
export type AttachmentMsg = { key: TKey; vars?: Vars };

export type AttachmentKind = 'image' | 'file';
export type AttachmentStatus = 'ready' | 'uploading' | 'error';

/** Response of the UI bridge `POST /bridge/uploads` (201). `path` is readable by the Hermes agent. */
export type RemoteRef = {
  id: string;
  /** absolute path on the Hermes host, e.g. /var/lib/hermes-ui-bridge/uploads/2026-10-10/ab12…-bericht.pdf */
  path: string;
  name: string;
  size: number;
  mimeType: string;
};

export type Attachment = {
  id: string;
  kind: AttachmentKind;
  /** display name (original file name, or `Foto 14-32.jpg` for camera shots) */
  name: string;
  /** mime type of the file at `uri` (images: after preparation, i.e. image/jpeg or image/png) */
  mimeType: string;
  /** bytes of the file at `uri` */
  size: number;
  /** local file (app document dir on native, blob:/data: URL on web); never base64 in memory */
  uri: string;
  width?: number;
  height?: number;
  status: AttachmentStatus;
  /** set once the file was uploaded to the UI bridge (Hermes + bridge only) */
  remoteRef?: RemoteRef;
  // ---- additions ----
  /** upload progress 0..1; undefined = indeterminate */
  progress?: number;
  /** error message when status === 'error' */
  error?: AttachmentMsg;
  /** why it was attached: 'edit' = image of a "✨ Bearbeiten" request (imageedit/; before/after view) */
  purpose?: 'edit';
};

/** Where a message with attachments is going. Decides encoding + limits. */
export type AttachmentTarget =
  | { kind: 'hermes'; /** profile talks to the UI bridge (has POST /bridge/uploads) */ bridge: boolean }
  | { kind: 'claude' }
  /** generic OpenAI-compatible server: image_url / text / file content parts, limits from its capabilities */
  | { kind: 'openai'; caps: OpenAIAttachmentCaps };

const germanT = makeT('de', 'de-DE');

/**
 * Thrown by encoders/validators. `msg` is the translatable message (render with `t(msg.key, msg.vars)`).
 * `message` is the German text, for logs and callers that do not translate yet.
 */
export class AttachmentError extends Error {
  readonly attachmentError = true;
  code: string;
  msg: AttachmentMsg;
  attachmentId?: string;
  constructor(code: string, msg: AttachmentMsg, attachmentId?: string) {
    super(germanT(msg.key, msg.vars));
    this.name = 'AttachmentError';
    this.code = code;
    this.msg = msg;
    this.attachmentId = attachmentId;
  }
}

export function isAttachmentError(e: unknown): e is AttachmentError {
  return typeof e === 'object' && e !== null && (e as { attachmentError?: unknown }).attachmentError === true;
}

/** Reads attachment bytes lazily (only when a message is encoded). Native impl: store.ts. */
export type AttachmentReader = {
  /** standard base64 (no data: prefix) of the file at `att.uri` */
  base64(att: Attachment): Promise<string>;
  /** file content decoded as UTF-8 */
  text(att: Attachment): Promise<string>;
};

export const LIMITS = {
  /** attachments per message */
  maxAttachments: 10,
  /** gallery multi-select limit per pick */
  maxGalleryPick: 6,
  /** images are downscaled to this long edge */
  imageMaxEdge: 2048,
  /** JPEG quality for prepared images */
  jpegQuality: 0.8,
  /** second try when the prepared JPEG is still too large */
  jpegQualityRetry: 0.6,
  /** max bytes of one prepared image (Claude: 5 MB per image, base64 counted → 3.75 MB raw) */
  maxImageBytes: 3_750_000,
  /** keep an original JPEG/PNG untouched if it is at most this big and ≤ imageMaxEdge */
  keepOriginalImageBytes: 1_500_000,
  /** Hermes rejects bodies > 10 MB (aiohttp client_max_size) */
  hermesBodyLimit: 10_000_000,
  /** encoded attachment payload budget per Hermes message (leaves ~1 MB for text + system message) */
  hermesPayloadBudget: 9_000_000,
  /** Hermes caps each text content part at 65 536 chars → split inline files below that */
  hermesTextPartChars: 60_000,
  /** bridge upload limit per file */
  maxUploadBytes: 20_000_000,
  /** inline text files (no bridge / Claude text documents) */
  maxInlineTextBytes: 200_000,
  /** Claude Messages API request limit is 32 MB; history is resent every turn */
  claudeRequestBudget: 30_000_000,
  /** Claude PDF: keep well below the request limit (raw bytes) */
  maxClaudePdfBytes: 20_000_000,
} as const;
