/**
 * Pure helpers to turn live ChatMessages into what we persist.
 */
import type { ChatMessage } from '../hermes/types.ts';
import { compactDetails } from '../hermes/trace.ts';
import { answerText } from '../hermes/progressNotes.ts';
import { MESSAGES_MAX_BYTES, MESSAGE_CAP, PREVIEW_MAX } from './types.ts';

/** Max stored reasoning per message (the "Gedankengang" row after reload / offline). */
export const REASONING_STORE_MAX = 4000;
/**
 * Max stored text per message: one huge answer must not push the whole transcript over MESSAGES_MAX_BYTES (and
 * evict every other message) or wedge the AsyncStorage row. Cut with an explicit marker + `textCapped`.
 */
export const STORED_TEXT_MAX = 256 * 1024;
/** marker at the end of a text cut for storage (stored data, language-neutral; the answer shows a translated notice) */
export const STORED_TEXT_MARKER = '\n\n[…]';

/** `text` cut to STORED_TEXT_MAX (surrogate pairs kept whole) + marker; unchanged when short enough */
export function capStoredText(text: string, max = STORED_TEXT_MAX): { text: string; capped: boolean } {
  if (text.length <= max) return { text, capped: false };
  let cut = max;
  const code = text.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut--;
  return { text: text.slice(0, cut) + STORED_TEXT_MARKER, capped: true };
}

/**
 * Drop transient/derived fields. A message that was still streaming when we persist it (app killed,
 * conversation switched, page reloaded offline) can never resume -> store it as `stopped`; its tools that were
 * still running are stored as cancelled ("abgebrochen", not "✓ fertig").
 * Dropped: statusNote, approval / pendingApprovals (runtime only – rebuilt from GET /v1/runs/{id} on open; the
 * persistent `approvalLog` history stays).
 * Reasoning is kept – also of an unfinished answer, so already streamed text stays visible after a reload –
 * capped to REASONING_STORE_MAX chars (stored Hermes sessions and offline viewing need it). Tool details /
 * trace (Werkzeug-Details) are kept but capped (each payload ≤ 4 KB, see hermes/trace.ts). Text over STORED_TEXT_MAX is
 * cut with a visible marker (`textCapped`).
 */
export function stripMessage(m: ChatMessage): ChatMessage {
  const { reasoning, statusNote, approval, pendingApprovals, ...rest } = compactDetails(m);
  const out: ChatMessage = { ...rest };
  if (reasoning) {
    out.reasoning = reasoning.length > REASONING_STORE_MAX ? reasoning.slice(0, REASONING_STORE_MAX) + '…' : reasoning;
  }
  const t = capStoredText(out.text ?? '');
  if (t.capped) {
    out.text = t.text;
    out.textCapped = true;
  }
  if (out.status === 'streaming') out.status = 'stopped';
  out.tools = (rest.tools ?? []).map((t) =>
    t.status === 'running' ? { ...t, status: 'done', endedAt: t.endedAt ?? m.createdAt, detail: { ...t.detail, cancelled: true } } : t
  );
  return out;
}

/** Keep the newest `maxCount` messages and at most ~`maxBytes` of JSON. Never returns an empty list for a non-empty input. */
export function capMessages(
  messages: ChatMessage[],
  maxCount: number = MESSAGE_CAP,
  maxBytes: number = MESSAGES_MAX_BYTES
): ChatMessage[] {
  let list = messages.length > maxCount ? messages.slice(messages.length - maxCount) : messages;
  let sizes = list.map((m) => JSON.stringify(m).length);
  let total = sizes.reduce((a, b) => a + b, 0);
  let drop = 0;
  while (total > maxBytes && drop < list.length - 1) {
    total -= sizes[drop];
    drop++;
  }
  if (drop > 0) list = list.slice(drop);
  sizes = [];
  return list;
}

export function prepareForStorage(messages: ChatMessage[]): ChatMessage[] {
  // same as capMessages(messages.map(stripMessage)), with the stripped form and its JSON size cached per message
  // object: a streaming answer is saved every ~2.5 s and only it changed – not every message re-stripped and
  // re-serialized each time (React state is immutable; hashOfPersisted relies on the same)
  // a message still waiting for its uploads (hermes/pendingSend.ts) was not sent: never stored
  const sent = messages.some((m) => m.sendPending) ? messages.filter((m) => !m.sendPending) : messages;
  const list = sent.length > MESSAGE_CAP ? sent.slice(sent.length - MESSAGE_CAP) : sent;
  const stored = list.map(storedForm);
  let total = 0;
  for (const e of stored) total += e.size;
  let drop = 0;
  while (total > MESSAGES_MAX_BYTES && drop < stored.length - 1) total -= stored[drop++].size;
  return (drop > 0 ? stored.slice(drop) : stored).map((e) => e.message);
}

const storedForms = new WeakMap<ChatMessage, { message: ChatMessage; size: number }>();

function storedForm(m: ChatMessage): { message: ChatMessage; size: number } {
  let e = storedForms.get(m);
  if (!e) {
    const message = stripMessage(m);
    e = { message, size: JSON.stringify(message).length };
    storedForms.set(m, e);
  }
  return e;
}

/** per message object (React state is immutable): hash of its persisted form, computed once */
const persistedHash = new WeakMap<ChatMessage, string>();

function hashOfPersisted(m: ChatMessage): string {
  let h = persistedHash.get(m);
  if (h === undefined) {
    const json = JSON.stringify(stripMessage(m));
    // two independent 32-bit string hashes (FNV-1a + ×31) → 64 bits
    let a = 0x811c9dc5;
    let b = 0;
    for (let i = 0; i < json.length; i++) {
      const c = json.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193);
      b = (Math.imul(b, 31) + c) | 0;
    }
    h = (a >>> 0).toString(36) + '.' + (b >>> 0).toString(36) + '.' + json.length.toString(36);
    persistedHash.set(m, h);
  }
  return h;
}

/**
 * Change signature: save() skips writes (and updatedAt bumps) when nothing changed.
 * Hashes the PERSISTED form of every message (what stripMessage keeps: text, status, tools + details,
 * reasoning, approvalLog, attachments, completion ids, recovery stamps …), so any change that would alter
 * the stored transcript – also a same-length text replacement or an approval outcome on an idle turn – is
 * saved. Unchanged message objects are not re-hashed (WeakMap by identity), so streaming stays cheap.
 */
export function messagesSignature(messages: ChatMessage[]): string {
  if (!messages.length) return '0';
  let a = 0;
  let b = 0x811c9dc5;
  for (const m of messages) {
    const h = hashOfPersisted(m);
    for (let i = 0; i < h.length; i++) {
      a = (Math.imul(a, 31) + h.charCodeAt(i)) | 0;
      b = Math.imul(b ^ h.charCodeAt(i), 0x01000193);
    }
  }
  return `${messages.length}|${(a >>> 0).toString(36)}|${(b >>> 0).toString(36)}`;
}

/** One-line preview of the conversation (last message with text). Fenced blocks (hui/html/code) become a short marker. */
export function previewOf(messages: ChatMessage[], max: number = PREVIEW_MAX): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    // agent turns: the final answer, not the first interim note ("Ich schaue kurz nach…")
    const p = flattenHead(m.role === 'assistant' ? answerText(m) : m.text, 2 * max + 16) || attachmentMarker(m);
    if (p) return truncate(p, max);
  }
  return '';
}

/**
 * `flatten(text)` – or, for a long text (a streaming answer on every save), `flatten` of a head of it that already
 * yields at least `need` chars: then `truncate(…, max)` is the same for `need >= 2 × max + 16`. Why: flattening a
 * head gives a prefix of flattening the whole text, except for constructs cut at the head's end, which only touch
 * its last ≤ 14 output chars (a fence cut to "```hu" becomes " [Code] " instead of " [Komponente] ", a cut "``" is
 * dropped); the first 2 × max chars (≥ the max code points truncate keeps) lie before that.
 */
function flattenHead(text: string, need: number): string {
  for (let k = need * 4; k < text.length; k *= 4) {
    const f = flatten(text.slice(0, k));
    if (f.length >= need) return f;
  }
  return flatten(text);
}

function flatten(text: string): string {
  // the fence patterns start with ``` – without one they cannot match (and Hermes' regex interpreter would still visit
  // every char of the text three times)
  const t = text.includes('```')
    ? text
        .replace(/```(?:hui-html|html)[\s\S]*?(?:```|$)/g, ' [Grafik] ')
        .replace(/```hui[\s\S]*?(?:```|$)/g, ' [Komponente] ')
        .replace(/```[\s\S]*?(?:```|$)/g, ' [Code] ')
    : text;
  return t.replace(/[`*_#>]+/g, '').replace(/\s+/g, ' ').trim();
}

/** flatten(m.text) per message object (searchTextOf runs on every save of a conversation) */
const flatTexts = new WeakMap<ChatMessage, string>();

function flatText(m: ChatMessage): string {
  let f = flatTexts.get(m);
  if (f === undefined) flatTexts.set(m, (f = flatten(m.text)));
  return f;
}

function truncate(s: string, max: number): string {
  // only the head is split into code points: previewOf runs on every save, Array.from over a whole streaming answer
  // costs ~10 ms per 50 K chars in Hermes. ≤ max UTF-16 units ⇒ ≤ max code points; > 2 × max units ⇒ > max code
  // points, and the first 2 × max units hold at least max of them (a pair cut at the end is never among the kept ones)
  if (s.length <= max) return s;
  const chars = Array.from(s.length > 2 * max ? s.slice(0, 2 * max) : s);
  return s.length <= 2 * max && chars.length <= max ? s : chars.slice(0, max - 1).join('').trimEnd() + '…';
}

/** `[Bild]` / `[Datei]` for messages that carry attachments but no text. */
export function attachmentMarker(m: Pick<ChatMessage, 'attachments'>): string {
  const first = m.attachments?.[0];
  if (!first) return '';
  return first.kind === 'image' ? '[Bild]' : '[Datei]';
}

export function firstUserText(messages: ChatMessage[]): string | undefined {
  for (const m of messages) {
    if (m.role !== 'user') continue;
    if (m.text.trim()) return m.text;
    const marker = attachmentMarker(m);
    if (marker) return m.attachments?.[0]?.name || marker;
  }
  return undefined;
}

/** Local file uris of all attachments in a transcript (cleanup on delete / prune on start). */
export function attachmentUris(messages: ChatMessage[]): string[] {
  const out: string[] = [];
  for (const m of messages) for (const a of m.attachments ?? []) if (a.uri) out.push(a.uri);
  return out;
}

/** Plain text of a conversation for search (lowercased + folded elsewhere), bounded. */
export function searchTextOf(messages: ChatMessage[], maxChars = 40_000): string {
  let out = '';
  for (const m of messages) {
    if (out.length > maxChars) break;
    out += flatText(m) + '\n';
  }
  return out;
}

/** Stored (German) preview markers -> i18n key suffix under `conversations.marker.*`. */
const MARKER_KEYS: Record<string, 'graphic' | 'component' | 'code' | 'image' | 'file'> = {
  Grafik: 'graphic',
  Komponente: 'component',
  Code: 'code',
  Bild: 'image',
  Datei: 'file',
};

type MarkerTr = (key: `conversations.marker.${'graphic' | 'component' | 'code' | 'image' | 'file' | 'images'}`, vars?: Record<string, string | number>) => string;

/**
 * Display-time localization of the markers persisted in `ConversationMeta.preview`
 * ("[Komponente]", "[Bild]", "[3 Bilder]" ...). Stored data stays German and unchanged.
 */
export function localizePreview(preview: string, tr: MarkerTr): string {
  return preview.replace(/\[(Grafik|Komponente|Code|Bild|Datei|(\d+) Bilder)\]/g, (all, word: string, n?: string) => {
    if (n) return `[${tr('conversations.marker.images', { count: Number(n) })}]`;
    const k = MARKER_KEYS[word];
    return k ? `[${tr(`conversations.marker.${k}`)}]` : all;
  });
}
