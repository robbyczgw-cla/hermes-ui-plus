/**
 * "Share to HUI+" (docs/SHARE-TARGET.md): what another app shared → what the share sheet offers → the message.
 * Pure, erasable TS (node:test). The native intake (expo-share-intent) and the web share target (sw.js) both end up
 * in a `SharedPayload`; nothing here sends anything.
 *
 * - Links go as text (Hermes fetches the page itself); the shared text is kept as it is.
 * - Files are filtered with the attachment rules (attachments/mime.ts classifyFile, LIMITS): refused ones are listed in
 *   the sheet and never sent; the accepted ones take the normal attachment path (composer draft → bridge upload).
 */
import { classifyFile, formatSizeOverLimit, isImageMime, normalizeMime } from '../attachments/mime.ts';
import { LIMITS, type AttachmentMsg } from '../attachments/types.ts';

export type SharedFile = {
  /** native: file:// copy or content:// uri of the shared file; web: '' (see `webFile`) */
  uri: string;
  name: string;
  /** normalized (normalizeMime) */
  mimeType: string;
  size?: number;
  width?: number;
  height?: number;
  /** web share target: the shared file itself (sw.js keeps it until the page takes it) */
  webFile?: File;
};

export type SharedPayload = {
  /** the shared text as it came (may contain the link); '' for file-only shares */
  text: string;
  /** first http(s) link of the share (web: the `url` field) */
  url?: string;
  /** page title / subject the sending app passed along */
  title?: string;
  files: SharedFile[];
  /** files that will not be sent (type, size, count) as translatable messages */
  refused: AttachmentMsg[];
  /** the text was longer than one Hermes text part and was cut */
  truncated?: boolean;
};

export type ShareKind = 'link' | 'text' | 'image' | 'file' | 'mixed' | 'empty';

/** Quick intents of the sheet (chips); free text is the note field. */
export const SHARE_INTENTS = ['summarize', 'explain', 'translate', 'save'] as const;
export type ShareIntentId = (typeof SHARE_INTENTS)[number];

/** Hermes caps a text content part at 65 536 chars (attachments/types.ts) */
export const MAX_SHARED_TEXT = LIMITS.hermesTextPartChars;

// ---------------------------------------------------------------- intake

/** Subset of expo-share-intent's `ShareIntent` (Android + iOS) this module reads. */
export type NativeShareIntent = {
  text?: string | null;
  webUrl?: string | null;
  meta?: { title?: string | null } | null;
  files?: ReadonlyArray<{
    path?: string | null;
    mimeType?: string | null;
    fileName?: string | null;
    size?: number | null;
    width?: number | null;
    height?: number | null;
  }> | null;
};

const URL_RE = /\bhttps?:\/\/[^\s<>"'«»]+/i;

/** First http(s) link in `text`, without trailing punctuation ("…, see https://x.y/a)." → https://x.y/a). */
export function firstLink(text: string | null | undefined): string | undefined {
  const m = URL_RE.exec(String(text ?? ''));
  if (!m) return undefined;
  let url = m[0];
  // a closing bracket only belongs to the link when it also opens one (Wikipedia-style "/Foo_(bar)")
  while (/[.,;:!?)\]}]$/.test(url)) {
    const last = url.slice(-1);
    const open = last === ')' ? '(' : last === ']' ? '[' : last === '}' ? '{' : null;
    if (open && url.split(open).length > url.split(last).length - 1) break;
    url = url.slice(0, -1);
  }
  return url.length > 'https://'.length ? url : undefined;
}

function cleanText(raw: string | null | undefined): { text: string; truncated: boolean } {
  const text = String(raw ?? '').replace(/\r\n?/g, '\n').trim();
  if (text.length <= MAX_SHARED_TEXT) return { text, truncated: false };
  return { text: text.slice(0, MAX_SHARED_TEXT).trimEnd(), truncated: true };
}

function cleanTitle(raw: string | null | undefined, text: string): string | undefined {
  const t = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  // Chrome & co. put the page title into the text already, or pass the link itself as the title
  if (!t || text.includes(t) || /^https?:\/\//i.test(t)) return undefined;
  return t;
}

/** last path segment, decoded, without characters a file name must not carry; `url`: drop a query string first */
function baseName(path: string, url = false): string {
  const p = (url ? path.split('?')[0] : path).replace(/[\\/]+$/, '');
  let last = p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
  try {
    last = decodeURIComponent(last);
  } catch {
    // keep the raw segment
  }
  return last.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
}

const EXT_BY_MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf', 'text/plain': 'txt' };

/** a display name for a shared file: its own name, else the last path segment, else `shared-<n>.<ext>` */
export function sharedFileName(fileName: string | null | undefined, path: string, mime: string | null | undefined, index: number): string {
  const own = String(fileName ?? '').trim();
  if (own) return baseName(own) || own;
  const seg = baseName(path, true);
  if (seg && /\.[a-z0-9]{1,6}$/i.test(seg)) return seg;
  const ext = EXT_BY_MIME[String(mime ?? '').toLowerCase()] ?? 'bin';
  return `shared-${index + 1}.${ext}`;
}

type RawFile = {
  uri: string;
  name: string;
  mimeType?: string | null;
  size?: number | null;
  width?: number | null;
  height?: number | null;
  webFile?: File;
  /** the sending app gave neither a name nor a type (Android: no read access to its content uri) */
  unreadable?: boolean;
};

/**
 * Splits shared files into the ones the attachment path takes and the refused ones (unsupported type, over the
 * upload limit, more than `max`). Images and files the composer accepts: classifyFile (images, PDF, text, office).
 */
export function acceptSharedFiles(files: readonly RawFile[], max: number = LIMITS.maxAttachments): { files: SharedFile[]; refused: AttachmentMsg[] } {
  const ok: SharedFile[] = [];
  const refused: AttachmentMsg[] = [];
  for (const f of files) {
    const mimeType = normalizeMime(f.mimeType, f.name);
    if (f.unreadable && mimeType === 'application/octet-stream') {
      refused.push({ key: 'share.sheet.unreadable', vars: { name: f.name } });
      continue;
    }
    if (!classifyFile(mimeType)) {
      refused.push({ key: 'attachments.picker.unsupportedType', vars: { name: f.name } });
      continue;
    }
    const size = typeof f.size === 'number' && Number.isFinite(f.size) && f.size >= 0 ? f.size : undefined;
    if (size !== undefined && size > LIMITS.maxUploadBytes) {
      refused.push({ key: 'attachments.validate.tooLarge', vars: { name: f.name, ...formatSizeOverLimit(size, LIMITS.maxUploadBytes) } });
      continue;
    }
    ok.push({
      uri: f.uri,
      name: f.name,
      mimeType,
      ...(size !== undefined ? { size } : {}),
      ...(f.width && f.width > 0 ? { width: f.width } : {}),
      ...(f.height && f.height > 0 ? { height: f.height } : {}),
      ...(f.webFile ? { webFile: f.webFile } : {}),
    });
  }
  if (ok.length > max) {
    refused.push({ key: 'attachments.picker.onlyRemaining', vars: { remaining: max } });
    ok.length = max;
  }
  return { files: ok, refused };
}

/** Android / iOS share (expo-share-intent) → payload; null when nothing usable arrived. */
export function fromNativeShare(si: NativeShareIntent | null | undefined): SharedPayload | null {
  if (!si) return null;
  const { text, truncated } = cleanText(si.text);
  const raw: RawFile[] = [];
  (si.files ?? []).forEach((f, i) => {
    const uri = String(f?.path ?? '').trim();
    if (!uri) return;
    raw.push({
      uri,
      name: sharedFileName(f.fileName, uri, f.mimeType, i),
      mimeType: f.mimeType,
      size: f.size,
      width: f.width,
      height: f.height,
      unreadable: !String(f.fileName ?? '').trim(),
    });
  });
  const { files, refused } = acceptSharedFiles(raw);
  const url = firstLink(si.webUrl) ?? firstLink(text);
  if (!text && !url && !files.length && !refused.length) return null;
  const title = cleanTitle(si.meta?.title, text);
  return {
    text: text || url || '',
    ...(url ? { url } : {}),
    ...(title ? { title } : {}),
    files,
    refused,
    ...(truncated ? { truncated } : {}),
  };
}

/** Web Share Target (manifest share_target → sw.js): title / text / url fields + files. */
export function fromWebShare(fields: { title?: string | null; text?: string | null; url?: string | null }, files: readonly File[] = []): SharedPayload | null {
  const url = firstLink(fields.url) ?? firstLink(fields.text);
  const joined = [fields.text, fields.url && !String(fields.text ?? '').includes(fields.url) ? fields.url : null].filter((s) => s && String(s).trim()).join('\n');
  const { text, truncated } = cleanText(joined);
  const { files: ok, refused } = acceptSharedFiles(
    files.map((f, i) => ({ uri: '', name: sharedFileName(f.name, '', f.type, i), mimeType: f.type, size: f.size, webFile: f })),
  );
  if (!text && !ok.length && !refused.length) return null;
  const title = cleanTitle(fields.title, text);
  return { text, ...(url ? { url } : {}), ...(title ? { title } : {}), files: ok, refused, ...(truncated ? { truncated } : {}) };
}

// ---------------------------------------------------------------- sheet

export function shareKind(p: SharedPayload): ShareKind {
  if (p.files.length) {
    const images = p.files.filter((f) => isImageMime(f.mimeType)).length;
    if (images === p.files.length) return 'image';
    return images === 0 ? 'file' : 'mixed';
  }
  if (p.url) return 'link';
  return p.text ? 'text' : 'empty';
}

/**
 * The message text: intent prompt and the user's note first, then the shared content (title line + text / link).
 * `prompt` is the translated text of the chosen intent chip.
 */
export function composeShareMessage(p: SharedPayload, opts: { prompt?: string | null; note?: string | null } = {}): string {
  const head = [opts.prompt?.trim(), opts.note?.trim()].filter(Boolean).join('\n');
  const body = [p.title, p.text].filter((s) => s && s.trim()).join('\n');
  return [head, body].filter(Boolean).join('\n\n').trim();
}

/** Sending needs something to send: shared content that survived the checks, or at least a note. */
export function canSendShare(p: SharedPayload, note?: string | null): boolean {
  return !!p.text.trim() || p.files.length > 0 || !!note?.trim();
}

// ---------------------------------------------------------------- gate + target

/**
 * When the sheet may show: `wait` (storage not read yet, onboarding on screen), `locked` (app lock: unlock first),
 * `pair` (no real connection yet: explain, offer pairing, keep the share), `ready`.
 */
export type ShareGate = 'wait' | 'locked' | 'pair' | 'ready';

export function shareGate(s: { ready: boolean; locked: boolean; onboarding: boolean; paired: boolean }): ShareGate {
  if (!s.ready) return 'wait';
  if (s.locked) return 'locked';
  if (s.onboarding) return 'wait';
  return s.paired ? 'ready' : 'pair';
}

export type ShareProfile = { id: string; kind: string; name: string };
export type ShareConversation = {
  id: string;
  title: string;
  profileId: string;
  profileKind: string;
  updatedAt: number;
  archived?: boolean;
  hermesProfile?: string;
  messageCount?: number;
};

/** connections a share can go to (the demo answers from a script: never a target) */
export function shareProfiles<P extends ShareProfile>(profiles: readonly P[]): P[] {
  return profiles.filter((p) => p.kind !== 'demo');
}

/** connection preselected for a new chat: the active one if it can take shares, else the first real one */
export function defaultShareProfile<P extends ShareProfile>(profiles: readonly P[], activeId: string | undefined): P | undefined {
  const real = shareProfiles(profiles);
  return real.find((p) => p.id === activeId) ?? real[0];
}

/**
 * "Last chat": the most recently used chat with messages that still has its connection (same kind) and is not
 * archived. Undefined → only "new chat" is offered.
 */
export function lastShareChat<C extends ShareConversation>(list: readonly C[], profiles: readonly ShareProfile[]): C | undefined {
  const real = shareProfiles(profiles);
  let best: C | undefined;
  for (const c of list) {
    if (c.archived || !(c.messageCount ?? 0)) continue;
    if (!real.some((p) => p.id === c.profileId && p.kind === c.profileKind)) continue;
    if (!best || c.updatedAt > best.updatedAt) best = c;
  }
  return best;
}

export type ShareTarget = { kind: 'new'; profileId: string; bot?: string } | { kind: 'last'; conversationId: string };
