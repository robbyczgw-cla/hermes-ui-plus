/**
 * "✨ Bearbeiten" for chat images: message composition, capability gating per backend, detection of
 * edit turns (before/after comparison) and the result image of the answer. Pure TS (core.test.ts):
 * erasable syntax only, `.ts` imports.
 */
import { hasDictionary, makeT } from '../i18n/core.ts';
import type { Lang, TFn, TKey } from '../i18n/core.ts';
import { resolveImageUrl } from '../chat/imageUrl.ts';
import type { Attachment, AttachmentTarget } from '../attachments/types.ts';
import type { OpenAIAttachmentCaps } from '../attachments/openaiCaps.ts';

/** Where the image to edit comes from. `local` = already a file of this device (attachment, generated image). */
export type EditSource = {
  uri: string;
  name?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  size?: number;
  /** alt text / caption for a11y */
  label?: string;
};

/** Suggestion chips in the sheet (label = `imageEdit.suggest.<id>`, sent text = `imageEdit.suggestText.<id>`). */
export const EDIT_SUGGESTIONS = ['removeBg', 'comic', 'brighter', 'addText', 'watercolor', 'extendPortrait'] as const;
export type EditSuggestion = (typeof EDIT_SUGGESTIONS)[number];

/** Marker on the attachment of an edit request (survives local persistence; text prefix is the fallback). */
export const EDIT_PURPOSE = 'edit';

/** The user message text of an edit request, in the UI language. */
export function buildEditRequestText(instruction: string, tr: TFn): string {
  const ins = instruction.replace(/\s+/g, ' ').trim();
  return ins ? tr('imageEdit.request', { instruction: ins }) : tr('imageEdit.requestGeneric');
}

/** The attachment sent with an edit request (marks it, keeps everything else). */
export function markEditAttachment(att: Attachment): Attachment {
  return { ...att, purpose: EDIT_PURPOSE };
}

const LANGS: Lang[] = ['de', 'en', 'es'];
let prefixes: string[] | null = null;

/** Text before `{instruction}` in every language (+ the generic request), lower-cased. */
function editPrefixes(): string[] {
  if (prefixes) return prefixes;
  const out: string[] = [];
  for (const l of LANGS) {
    const t = makeT(l, l);
    const withVar = t('imageEdit.request', { instruction: '\u0000' });
    const cut = withVar.indexOf('\u0000');
    const head = (cut >= 0 ? withVar.slice(0, cut) : withVar).trim().toLowerCase();
    if (head.length >= 6) out.push(head);
    out.push(t('imageEdit.requestGeneric').trim().toLowerCase());
  }
  // en/es dictionaries load lazily in the app: cache only once every language is available
  if (LANGS.every(hasDictionary)) prefixes = out;
  return out;
}

/** Text of an edit request (any UI language)? Used when the attachment marker is gone (synced history). */
export function isEditRequestText(text: string): boolean {
  const s = text.trim().toLowerCase();
  if (!s) return false;
  return editPrefixes().some((p) => s.startsWith(p));
}

type MsgLike = { id: string; role: string; text: string; attachments?: readonly Attachment[] };

/** First image of a user message that is an edit request, else null. */
export function editSourceOf(m: MsgLike): Attachment | null {
  if (m.role !== 'user') return null;
  const imgs = (m.attachments ?? []).filter((a) => a.kind === 'image');
  if (!imgs.length) return null;
  const marked = imgs.find((a) => a.purpose === EDIT_PURPOSE);
  if (marked) return marked;
  return isEditRequestText(m.text) ? imgs[0] : null;
}

/**
 * assistant message id → uri of the "before" image, for every answer that directly follows an edit
 * request. Whether the answer actually contains an image is decided at render time (resultImageUrl).
 */
export function findEditPairs(messages: readonly MsgLike[]): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 1; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    const src = editSourceOf(messages[i - 1]);
    if (src) map.set(m.id, src.uri);
  }
  return map;
}

const HUI_BLOCK = /```hui[^\n]*\n([\s\S]*?)```/g;
const MD_IMAGE = /!\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/;

function huiImageUrl(json: string): string | null {
  try {
    const v: unknown = JSON.parse(json);
    const walk = (n: unknown, depth: number): string | null => {
      if (!n || typeof n !== 'object' || depth > 6) return null;
      if (Array.isArray(n)) {
        for (const x of n) {
          const r = walk(x, depth + 1);
          if (r) return r;
        }
        return null;
      }
      const o = n as Record<string, unknown>;
      if (o.type === 'image' && typeof o.url === 'string' && o.url) return o.url;
      if (typeof o.type === 'string' && o.type.includes('gallery') && Array.isArray(o.items)) {
        for (const it of o.items) {
          if (it && typeof it === 'object' && typeof (it as { url?: unknown }).url === 'string' && (it as { url: string }).url) return (it as { url: string }).url;
        }
      }
      for (const k of ['children', 'items', 'images', 'blocks', 'content']) {
        const r = walk(o[k], depth + 1);
        if (r) return r;
      }
      return null;
    };
    return walk(v, 0);
  } catch {
    return null;
  }
}

/** Local file/blob URLs (generated images, attachments) are kept; others go through resolveImageUrl. */
function usableUrl(u: string, base: string | null): string | null {
  const s = u.trim();
  if (/^(file|blob|content):/i.test(s) || /^data:image\//i.test(s)) return s;
  return resolveImageUrl(s, base);
}

/**
 * The (first) image of an assistant answer: generated attachment, ```hui image (also inside a
 * gallery/layout), or a markdown image. null = the answer has no image.
 */
export function resultImageUrl(m: { text: string; attachments?: readonly Attachment[] }, base: string | null): string | null {
  const att = (m.attachments ?? []).find((a) => a.kind === 'image');
  if (att) return att.uri;
  const text = m.text || '';
  HUI_BLOCK.lastIndex = 0;
  let hm: RegExpExecArray | null;
  while ((hm = HUI_BLOCK.exec(text))) {
    const u = huiImageUrl(hm[1]);
    if (u) {
      const r = usableUrl(u, base);
      if (r) return r;
    }
  }
  const md = MD_IMAGE.exec(text);
  return md ? usableUrl(md[1], base) : null;
}

// ------------------------------------------------------------------ capability gating

export type GateProfile = { kind: string; bridge?: boolean; imageGen?: boolean; attachmentsEnabled?: boolean };

export type EditGate =
  | { ok: true; target: AttachmentTarget }
  | { ok: false; reason: TKey; /** the sheet offers a one-tap fix (switch the backend's image generation on) */ fix?: 'enableImageGen' };

/**
 * Same targets as the composer (Composer.tsx): hermes (bridge or not), openai with server caps,
 * everything else Claude rules. `openaiCaps` null = openai profile with attachments switched off.
 */
export function editGate(profile: GateProfile, openaiCaps: OpenAIAttachmentCaps | null): EditGate {
  switch (profile.kind) {
    case 'demo':
      return { ok: false, reason: 'imageEdit.blocked.demo' };
    case 'openai':
      if (!openaiCaps) return { ok: false, reason: 'imageEdit.blocked.attachmentsOff' };
      if (!openaiCaps.images) return { ok: false, reason: 'imageEdit.blocked.noImages' };
      return { ok: true, target: { kind: 'openai', caps: openaiCaps } };
    case 'hermes':
      return { ok: true, target: { kind: 'hermes', bridge: !!profile.bridge } };
    default:
      return { ok: false, reason: 'imageEdit.blocked.demo' };
  }
}
