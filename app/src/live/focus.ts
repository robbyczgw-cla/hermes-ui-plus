/**
 * Is a message about one open live card? The same edit-phrase heuristic as the bridge router
 * (bridge/src/router/live.mjs `editTypes`, design §11.1; focus.test.ts keeps both in step): an edit request
 * ("Pack noch Grillkohle dazu", "Verschieb das Forum auf Sonntag", "Preise prüfen") with exactly one fitting open
 * card. The app uses it to decide whether a message re-sends the card's full state after Hermes may have lost it from
 * its context (design §9.3); the bridge uses it for `card=<id>` in the router hint.
 */
import type { LiveCardType } from './model.ts';

const ANY: LiveCardType[] = ['checklist', 'trip', 'products'];
const MOVE: LiveCardType[] = ['trip', 'checklist'];
const PRICE: LiveCardType[] = ['products'];
const LIST_NOUN = String.raw`\p{L}*(?:liste|list|lista|checklist|plan|trip|reise)`;

const PHRASES: [string, LiveCardType[]][] = [
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
];

/** `\b<` / `\b>` = letter-aware word boundaries (JS `\b` does not know umlauts). */
function letterRe(src: string): RegExp {
  try {
    // hermes-compat-ok: L and N are General_Category values (the app's literal regexes use them too); fallback below
    return new RegExp(src.replaceAll('\\b<', '(?<![\\p{L}\\p{N}])').replaceAll('\\b>', '(?![\\p{L}\\p{N}])'), 'iu');
  } catch {
    // an engine without these property escapes: Latin letters (the phrase list is German, English, Spanish)
    const L = 'A-Za-zÀ-ÖØ-öø-ÿ';
    // hermes-compat-ok: this pattern has no property escapes left (they are replaced here)
    return new RegExp(src.replaceAll('\\p{L}', `[${L}]`).replaceAll('\\b<', `(?<![${L}0-9])`).replaceAll('\\b>', `(?![${L}0-9])`), 'i');
  }
}

const EDIT = PHRASES.map(([src, types]) => ({ re: letterRe(src), types }));
/** A request for a NEW or another list/plan is never an edit of an open card. */
const NEW_LIST = letterRe(
  [
    String.raw`\b<(?:neu|ander|zweit|separat|weitere)\p{L}*\s+(?:\p{L}+\s+)?${LIST_NOUN}\b>`,
    String.raw`\b<(?:a |another |one more |a second )?(?:new|other|another|different|second|separate)\s+(?:\p{L}+\s+)?${LIST_NOUN}\b>`,
    String.raw`\b<(?:otra|nueva|segunda)\s+(?:\p{L}+\s+)?${LIST_NOUN}\b>`,
  ].join('|'),
);

/** Card types an edit request in `text` fits (empty = no edit phrase, or a new-list request). */
export function editTypes(text: string): Set<LiveCardType> {
  const types = new Set<LiveCardType>();
  if (NEW_LIST.test(text)) return types;
  for (const p of EDIT) if (p.re.test(text)) for (const t of p.types) types.add(t);
  return types;
}

/** The one open card an edit request is about, or undefined (no edit phrase, none or several fitting cards). */
export function editTarget(text: string, open: readonly { id: string; type: LiveCardType }[]): string | undefined {
  if (!open.length) return undefined;
  const types = editTypes(text);
  const fitting = open.filter((c) => types.has(c.type));
  return fitting.length === 1 ? fitting[0].id : undefined;
}

/** `X-HUI-Live` value: the chat's open cards for the bridge router (`<id>:<type>[:f][:p<N>]`, at most 8). */
export function liveHeader(open: readonly { id: string; type: LiveCardType; patches: number }[], focus: string | null): string {
  return open
    .slice(0, 8)
    .map((c) => [c.id, c.type, ...(c.id === focus ? ['f'] : []), ...(c.patches ? [`p${Math.min(999, c.patches)}`] : [])].join(':'))
    .join(',');
}

// ---- removing ticked items --------------------------------------------------------------------------------------

/** A removal verb ("streich", "lösch", "raus", "remove", "quita"): the clause asks to take something off the card. */
const REMOVE = letterRe(
  [
    String.raw`\b<(?:streich\p{L}*|gestrichen|lösch\p{L}*|gelöscht|entfern\p{L}*|raus|weg|runter)\b>`,
    String.raw`\b<brauch\p{L}*\b>.{0,40}\bnicht mehr\b>`,
    String.raw`\b<(?:remove\p{L}*|delete\p{L}*|drop\p{L}*|clear\p{L}*|cross\p{L}* (?:out|off)|take \p{L}+ off|don'?t need|no longer need)\b>`,
    String.raw`\b<(?:quit(?:a|ar|en)|elimin\p{L}*|borr(?:a|ar|en))\b>`,
  ].join('|'),
);
/** "die erledigten", "Abgehaktes", "the checked items", "completed ones", "los comprados": all ticked items at once. */
const TICKED_ITEMS = letterRe(
  [
    String.raw`\b<(?:erledigt|abgehakt|gekauft|eingepackt)(?:e|es|en|er)\b>`,
    String.raw`\b<(?:alles|alle) (?:erledigt|abgehakt|gekauft)\p{L}*`,
    String.raw`\b<(?:checked|completed|done|ticked|bought|packed|finished)\b> (?:items?|ones|things|stuff|entries)\b>`,
    String.raw`\b<everything (?:checked|completed|done|ticked|bought)\b>`,
    String.raw`\b<(?:completad|hech|marcad|comprad)(?:os|as)\b>`,
  ].join('|'),
);

const words = (s: string): string[] =>
  s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
/** Two words name the same thing: equal, or one starts with the other ("Tomate" / "Tomaten"), at least 4 letters. */
const sameWord = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));

/**
 * Which of `items` (ticked items a Hermes full version left out) the user's message asked to take off the card: a
 * clause (split at . ! ? ; , and line breaks) with a removal verb that names the item (or, naming none, the clause
 * before names it), or that names the ticked items as a whole ("Erledigtes streichen", "remove the checked items"). "Tomaten streichen. Brot habe ich abgehakt." asks
 * to remove the tomatoes, not the bread. Pure text, no clock: every device decides the same.
 */
export function removalAsked(text: string, items: readonly { id: string; text: string }[]): Set<string> {
  const out = new Set<string>();
  if (!text || !items.length) return out;
  const named = (clause: string) => {
    const cw = words(clause);
    return items.filter((it) => words(it.text).some((w) => w.length >= 3 && !/^\d+$/.test(w) && cw.some((c) => sameWord(c, w))));
  };
  let prev: typeof items = [];
  for (const clause of text.split(/[.!?;,\n]+/)) {
    const hit = named(clause);
    if (REMOVE.test(clause)) {
      if (TICKED_ITEMS.test(clause)) {
        for (const it of items) out.add(it.id);
        return out;
      }
      // "Brot habe ich, kannst du streichen": a removal without a name refers to the clause before
      for (const it of hit.length ? hit : prev) out.add(it.id);
    }
    prev = hit;
  }
  return out;
}
