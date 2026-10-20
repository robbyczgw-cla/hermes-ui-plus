// Live cards (app/src/live, skill references/live.md): the app appends the user's own card edits to the next user
// message as a trailer `[hui:live]{json}[/hui:live]`. For routing it is noise (and chat content the model router does
// not need): cut it from the routing context. A card the user asked about ("Hermes fragen", `"focus":true` in the
// trailer) gives a deterministic decision with `card=<id>` in the hint, like the `[reformat:…]` fast path.
//
// The app also lists the chat's open cards in the request header `X-HUI-Live: <id>:<type>[:f][:p<N>],…` (≤8 entries;
// f = focused in the app, p<N> = consecutive patches since the card's last full version). With it the focus decision
// follows the card type, and a plain edit request ("füg Milch hinzu") about exactly one fitting open card gets the
// same deterministic decision. Precision over recall: anything unclear routes normally.

import { fixListTypos } from './listtypos.mjs';

export const LIVE_CONFIDENCE = 0.95;
export const LIVE_REASON = 'live card';
const TRAILER = /\n*\[hui:live\](\{[\s\S]*\})\[\/hui:live\]\s*$/;
const CARD_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/;

/** @param {string} text @returns {{text: string, focus?: string}} the text without the trailer, the focused card */
export function splitLiveTrailer(text) {
  const m = TRAILER.exec(String(text ?? ''));
  if (!m) return { text };
  const out = { text: text.slice(0, m.index) };
  try {
    const batches = JSON.parse(m[1]);
    for (const [id, b] of Object.entries(batches && typeof batches === 'object' ? batches : {})) {
      if (CARD_ID.test(id) && b && typeof b === 'object' && b.focus === true) {
        out.focus = id;
        break;
      }
    }
  } catch {
    /* a broken trailer is still cut */
  }
  return out;
}

export const LIVE_EDIT_CONFIDENCE = 0.9;
export const LIVE_EDIT_REASON = 'live card edit';
/** Card type -> hint format. */
export const LIVE_TYPE_FORMAT = { checklist: 'checklist', trip: 'agenda', products: 'products' };
export const LIVE_HEADER_MAX_CARDS = 8;
const HEADER_MAX_CHARS = 1024;
/** From this many patches in a row the hint asks Hermes for a full version next (`card=<id> full`). */
export const LIVE_FULL_AFTER_PATCHES = 10;
const RESERVED_IDS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * `X-HUI-Live: <id>:<type>[:f][:p<N>]` (comma-separated). Defensive: junk entries are dropped, never throws.
 * @param {unknown} value @returns {{id: string, type: 'checklist'|'trip'|'products', focused: boolean, patches: number}[]}
 */
export function parseLiveHeader(value) {
  const out = [];
  const raw = Array.isArray(value) ? value.join(',') : typeof value === 'string' ? value : '';
  for (const entry of raw.slice(0, HEADER_MAX_CHARS).split(',')) {
    if (out.length >= LIVE_HEADER_MAX_CARDS) break;
    const [id = '', type = '', ...flags] = entry.trim().split(':');
    if (!CARD_ID.test(id) || RESERVED_IDS.has(id) || !Object.hasOwn(LIVE_TYPE_FORMAT, type) || out.some((c) => c.id === id)) continue;
    let patches = 0;
    for (const f of flags) {
      const m = /^p(\d{1,3})$/.exec(f);
      if (m) patches = Number(m[1]);
    }
    out.push({ id, type: /** @type {any} */ (type), focused: flags.includes('f'), patches });
  }
  return out;
}

// Edit phrases as data: [pattern, card types it fits]. `\b<` / `\b>` = letter-aware word boundaries (JS \b and umlauts).
const ANY = ['checklist', 'trip', 'products'];
const MOVE = ['trip', 'checklist'];
const PRICE = ['products'];
const LIST_NOUN = String.raw`\p{L}*(?:liste|list|lista|checklist|plan|trip|reise)`;
export const LIVE_EDIT_PHRASES = [
  // German
  [String.raw`\b<füg\p{L}*\b>.{0,40}\b<hinzu|\b<hinzufüg\p{L}*`, ANY],
  [String.raw`\b<streich(?:e|en)?\b>`, ANY],
  [String.raw`\b<ergänz(?:e|en|t)?\b>`, ANY],
  [String.raw`\b<aktualisier(?:e|en|t)?\b>`, ANY],
  [String.raw`\b<verschieb(?:e|en)?\b>`, MOVE],
  [String.raw`\b<tausch(?:e|en)?\b>`, MOVE],
  [String.raw`\b<auf (?:die|meine|unsere|deine|der) \p{L}*liste\b>`, ANY],
  [String.raw`\b<von (?:der|meiner|unserer|deiner) \p{L}*liste\b>`, ANY],
  [String.raw`\b<nimm\b>.{0,40}\b<raus\b>|\b<(?:her)?aus ?nehm\p{L}*|\b<raus ?nehm\p{L}*`, ANY],
  [String.raw`\b<lösch(?:e|en)?\b>`, ANY],
  [String.raw`\b<entfern(?:e|en)?\b>`, ANY],
  [String.raw`\b<(?:pack\p{L}*|tu|tue|setz\p{L}*|leg\p{L}*)\b>.{0,40}\b<dazu\b>|\b<noch\b>.{0,40}\b<dazu\b>|^(?!.*\b<(?:was|wie|meinst|sagst|denkst|hältst)\b>).{0,40}\b<dazu[\s.!]*$`, ANY],
  [String.raw`\b<brauch\p{L}*\b>.{0,40}\bnicht mehr\b>`, ANY],
  [String.raw`\b<änder(?:e|n|t)?\b>`, ANY],
  [String.raw`\b<preise? (?:neu )?(?:prüf|check)\p{L}*|\b<prüf\p{L}*\b>.{0,20}\b<preis\p{L}*`, PRICE],
  // English
  [String.raw`\b<update (?:the|my|our|this|that|it|prices|list|plan)\b>`, ANY],
  [String.raw`\b<add\b>.{0,60}\b<to (?:the|my|our|this|that|your) (?:\p{L}+ )?(?:list|plan|trip|itinerary|watchlist|checklist|card)\b>|\b<add\b>.{0,40}\b<to it\b>`, ANY],
  [String.raw`\b<remove\b>.{0,60}\b<(?:from|off)\b>`, ANY],
  [String.raw`\b<move\b>.{0,40}\b<(?:to|before|after|up|down|from)\b>`, MOVE],
  [String.raw`\b<swap\b>`, MOVE],
  [String.raw`\b<check (?:the |all )?prices?\b>`, PRICE],
  // Spanish
  [String.raw`\b<(?:añad|agreg)(?:e|a|ir|ar|id[oa]s?)\b>`, ANY],
  [String.raw`\b<quit(?:a|ar)\b>`, ANY],
  [String.raw`\b<elimin(?:a|ar)\b>`, ANY],
  [String.raw`\b<actualiz(?:a|ar)\b>`, ANY],
  [String.raw`\b<cambi(?:a|ar)\b>`, ANY],
  [String.raw`\b<mue(?:ve|vas)\b>|\b<mover\b>`, MOVE],
  [String.raw`\b<(?:comprueba|revisa|verifica|chequea)\p{L}*\b>.{0,20}\b<precios?\b>`, PRICE],
].map(([src, types]) => ({ re: letterRe(src), types }));

/** A request for a NEW or another list/plan is never an edit of an open card. */
const NEW_LIST = letterRe([
  String.raw`\b<(?:neu|ander|zweit|separat|weitere)\p{L}*\s+(?:\p{L}+\s+)?${LIST_NOUN}\b>`,
  String.raw`\b<(?:a |another |one more |a second )?(?:new|other|another|different|second|separate)\s+(?:\p{L}+\s+)?${LIST_NOUN}\b>`,
  String.raw`\b<(?:otra|nueva|segunda)\s+(?:\p{L}+\s+)?${LIST_NOUN}\b>`,
].join('|'));

function letterRe(src) {
  return new RegExp(src.replaceAll('\\b<', '(?<![\\p{L}\\p{N}])').replaceAll('\\b>', '(?![\\p{L}\\p{N}])'), 'iu');
}

/** Card types an edit request in `text` fits (empty = no edit phrase, or a new-list request). */
export function editTypes(text) {
  const t = fixListTypos(text);
  if (NEW_LIST.test(t)) return new Set();
  const types = new Set();
  for (const p of LIVE_EDIT_PHRASES) if (p.re.test(t)) for (const ty of p.types) types.add(ty);
  return types;
}

const cardDecision = (card, confidence, reason) => ({
  format: LIVE_TYPE_FORMAT[card.type] ?? 'checklist',
  confidence,
  reason,
  card: card.id,
  ...(card.patches >= LIVE_FULL_AFTER_PATCHES ? { full: true } : {}),
});

/**
 * Forced decision for a message about one live card, or null: "Hermes fragen" (trailer focus or `f` in the header),
 * else an edit request with exactly one fitting open card. Without header cards: checklist for a trailer focus (phase 1).
 * @param {{role: string, content: string, liveFocus?: string}[]} turns
 * @param {{id: string, type: string, focused?: boolean, patches?: number}[]} [cards] parsed `X-HUI-Live`
 */
export function liveCardDecision(turns, cards = []) {
  const latest = [...turns].reverse().find((t) => t.role === 'user');
  if (!latest) return null;
  const open = Array.isArray(cards) ? cards : [];
  const focusId = latest.liveFocus ?? open.find((c) => c.focused)?.id;
  if (focusId) {
    const card = open.find((c) => c.id === focusId) ?? { id: focusId, type: 'checklist', patches: 0 };
    return cardDecision(card, LIVE_CONFIDENCE, LIVE_REASON);
  }
  if (!open.length) return null;
  const types = editTypes(latest.content);
  const fitting = open.filter((c) => types.has(c.type));
  return fitting.length === 1 ? cardDecision(fitting[0], LIVE_EDIT_CONFIDENCE, LIVE_EDIT_REASON) : null;
}

/** Phase-1 form: the focus decision without header cards. */
export const liveFocusDecision = (turns) => liveCardDecision(turns);
