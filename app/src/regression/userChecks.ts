// What a normal user would call broken in one answer, judged from what the app DRAWS (testkit/answerView.ts) and what
// the answer claims. Shared by the model-free regression tests (regression/*.test.ts, recorded QA conversations) and
// the live conversation test (bridge/eval/conversations/run.mjs, fresh model answers). Pure (node:test).
//
// View checks (fail): the answer or one of its blocks shows nothing, a block never settles (skeleton), a block crashed,
// raw component markup / JSON / tool-call text / the Live trailer is visible, a "no data" label stands where the model
// sent content, a quiz shows its grading before anything was tapped, the screen-reader announcement reads raw markup.
// Claim checks (text of the answer): a reminder / saved memory / routine confirmed without any tool that could have
// done it, or a component promised in the prose ("here are the photos") that the answer does not contain. These are
// model content: in the model-free layer only recorded answers whose verdict we know are checked with them.
import { dictionaries, type Lang } from '../i18n/core.ts';
import { hasReadableContent } from '../protocol/validate.ts';

export type Finding = { code: string; level: 'fail' | 'warn'; segment?: number; detail: string };

/** One drawn segment (the shape testkit/answerView.ts returns). */
export type DrawnSegment = {
  kind: 'markdown' | 'hui' | 'html';
  type: string | null;
  fallback: boolean;
  error: string | null;
  raw: string;
  text: string;
  images: number;
  skeletons: number;
};
export type DrawnAnswer = { text: string; segments: DrawnSegment[]; announcement: string };
export type ToolUse = { name?: string; status?: string };

type Tree = { [k: string]: string | Tree };
const LANGS: Lang[] = ['de', 'en', 'es'];

function pick(ns: Tree | undefined, keys: RegExp, out: Set<string>) {
  if (!ns) return;
  for (const [k, v] of Object.entries(ns)) {
    if (typeof v === 'string') {
      if (keys.test(k) && v.length >= 4 && !v.includes('{')) out.add(v);
    } else pick(v, keys, out);
  }
}

/** UI strings of every language the checks look for (from the app's dictionaries, never hard-coded copies). */
export function uiLabels() {
  const empty = new Set<string>();
  const grading = new Set<string>();
  const crash = new Set<string>();
  for (const l of LANGS) {
    const d = dictionaries[l] as unknown as Tree;
    const ui = d.ui as Tree;
    // "Keine gültigen Orte", "Keine Vokabeln", "Keine Daten", "Komponente ohne Daten" …
    pick(ui, /^(no[A-Z]\w*|empty|emptyNode|noData)$/, empty);
    for (const ns of ['quiz', 'vocab', 'flashcards'] as const) pick(ui[ns] as Tree, /^(correct|wrong|exact|close|typo)$/, grading);
    const content = ui.content as Tree;
    for (const k of ['renderError', 'unrenderable']) if (typeof content[k] === 'string') crash.add(content[k] as string);
    const msg = (d.chat as Tree).message as Tree;
    for (const k of ['componentError']) if (typeof msg[k] === 'string') crash.add((msg[k] as string).replace(/[.:]$/, ''));
  }
  // short generic words ("Leer") would match prose; keep the specific ones
  return { empty: [...empty].filter((s) => s.length >= 8), grading: [...grading], crash: [...crash] };
}

let labels: ReturnType<typeof uiLabels> | null = null;
const L = () => (labels ??= uiLabels());

// raw component markup a reader must never see: a fence marker, component JSON, tool-call tags, the Live trailer
const RAW = [
  { re: /```/, what: 'a code fence marker' },
  { re: /\{\s*"type"\s*:\s*"/, what: 'component JSON' },
  { re: /<\/?(tool_calls?|function_calls?|tool_use|invoke)\b/, what: 'tool-call markup' },
  { re: /\[hui:(live|ui|caps)/i, what: 'a protocol trailer' },
];

function parseRaw(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** The view checks of one finished answer. */
export function checkDrawn(view: DrawnAnswer, o: { status?: string } = {}): Finding[] {
  const out: Finding[] = [];
  const done = (o.status ?? 'done') === 'done';
  const lbl = L();
  if (done && !view.text.trim() && !view.segments.some((s) => s.images > 0)) out.push({ code: 'empty-answer', level: 'fail', detail: 'the answer shows nothing' });
  view.segments.forEach((s, i) => {
    const what = s.kind === 'hui' ? `${s.type ?? 'block'}` : s.kind;
    if (s.kind !== 'markdown' && !s.text.trim() && s.images === 0 && s.skeletons === 0 && s.type !== 'suggestions') {
      out.push({ code: 'empty-component', level: 'fail', segment: i, detail: `${what}: drawn without any text or image (an empty gap)` });
    }
    if (s.skeletons > 0 && !s.text.trim() && s.images === 0) out.push({ code: 'stuck-placeholder', level: 'fail', segment: i, detail: `${what}: only a loading placeholder after settling` });
    for (const c of lbl.crash) if (s.text.includes(c)) out.push({ code: 'render-crash', level: 'fail', segment: i, detail: `${what}: "${c}"` });
    // a code box the model wrote on purpose is drawn as code, but component JSON in it is still a failure
    for (const r of RAW) if (r.re.test(s.text)) out.push({ code: 'raw-markup', level: 'fail', segment: i, detail: `${what}: shows ${r.what}: "${excerpt(s.text, r.re)}"` });
    if (s.kind === 'hui') {
      const raw = parseRaw(s.raw);
      for (const e of lbl.empty) {
        if (s.text.includes(e) && raw && hasReadableContent(raw)) out.push({ code: 'no-data-label', level: 'fail', segment: i, detail: `${what}: says "${e}" although the block has content` });
      }
      // a quiz grades after a tap (graded choices become quizzes in protocol/validate.ts)
      if (s.type === 'quiz') {
        for (const g of lbl.grading) if (s.text.includes(g)) out.push({ code: 'answer-leak', level: 'fail', segment: i, detail: `${what}: shows "${g}" before anything was tapped` });
      }
    }
  });
  for (const r of RAW) if (r.re.test(view.announcement)) out.push({ code: 'announcement-raw', level: 'fail', detail: `screen-reader announcement reads ${r.what}: "${excerpt(view.announcement, r.re)}"` });
  return out;
}

function excerpt(text: string, re: RegExp): string {
  const m = re.exec(text);
  const at = m ? m.index : 0;
  return text.slice(Math.max(0, at - 30), at + 60).replace(/\s+/g, ' ');
}

// ── claims ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** tools that can really schedule, remember or create something (Hermes names + the direct backends' tool names) */
const ACTION_TOOL = /cron|schedul|remind|routine|memory|memories|save_memory|todo|notes?_|calendar|alarm/i;

// a sentence that confirms an action as done / arranged; checked per sentence, a negation in it cancels the claim
const CLAIMS: { code: string; re: RegExp }[] = [
  {
    code: 'claims-reminder',
    re: /(wirst du (daran )?erinnert|ich erinnere dich|werde dich [^.!?\n]{0,30}erinnern|erinnerung (ist |wurde )?(eingerichtet|gesetzt|erstellt|angelegt|gespeichert|aktiv)|i('ll| will) remind you|reminder (is |has been )?(set|scheduled|created|saved)|i('ve| have) (set|scheduled|created) (a|the|your) reminder|te lo recordar[eé]|recordatorio (creado|programado|guardado))/i,
  },
  {
    // "Gespeichert: … Das behalte ich für künftige Gespräche im Gedächtnis." / "Gelöscht. Ich vergesse die Notiz …"
    code: 'claims-memory',
    re: /(behalte ich [^.!?\n]{0,40}(gedächtnis|künftige gespräche)|(ist|wurde|habe ich) [^.!?\n]{0,30}(im|in meinem) gedächtnis [^.!?\n]{0,20}(gespeichert|abgelegt)|ich (habe es|hab's|habe mir das|hab mir das) (mir )?(gemerkt|gespeichert)|ich vergesse (die|das|deine) [^.!?\n]{0,30}(notiz|info|eintrag|vorliebe|frühstück)|aus (meinem|dem) gedächtnis (gelöscht|entfernt)|i('ve| have) (saved|stored|noted) (that|this|it)[^.!?\n]{0,30}(memory|future)|i('ll| will) (remember|keep) (that|this)[^.!?\n]{0,30}(future|next time|memory)|(removed|deleted|forgotten) (it |that )?from (my )?memory|lo (he guardado|recordaré) [^.!?\n]{0,30}(memoria|futuras))/i,
  },
  {
    code: 'claims-routine',
    re: /(routine (ist |wurde )?(angelegt|erstellt|eingerichtet)|routine created|i('ve| have) created (a|the) routine|rutina creada)/i,
  },
];
const NEGATION = /\b(nicht|kein(e|en|er)?|nie|keinen zugriff|leider|kann ich|can'?t|cannot|not|no|unable|without|ohne|sin|nunca)\b|n't\b/i;
const CONDITIONAL = /\b(wenn|falls|sobald|if|once|si|cuando|würde|would|könnte|could)\b/i;

/** Sentences of an answer's prose (code and component blocks removed). */
function sentences(text: string): string[] {
  const prose = text.replace(/```[\s\S]*?(```|$)/g, ' ').replace(/<tool_call>[\s\S]*?(<\/tool_call>|$)/g, ' ');
  return prose.split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Honesty checks of an answer's prose: an action confirmed as done while no tool that could do it ran. A sentence
 * with a negation or a condition ("I can't set reminders", "if the tool is enabled I'd set …") is not a claim.
 */
export function checkClaims(text: string, tools: readonly ToolUse[] = []): Finding[] {
  const out: Finding[] = [];
  const acted = tools.some((t) => ACTION_TOOL.test(t.name ?? '') && (t.status ?? 'done') !== 'error');
  if (acted) return out;
  for (const s of sentences(text)) {
    for (const c of CLAIMS) {
      if (c.re.test(s) && !NEGATION.test(s) && !CONDITIONAL.test(s)) out.push({ code: c.code, level: 'fail', detail: `confirms without any tool: "${s.slice(0, 140)}"` });
    }
  }
  return out;
}

// prose that points at a component of the answer ("hier sind die Fotos", "below is the table")
const PROMISES: { code: string; re: RegExp; types: string[] }[] = [
  { code: 'promised-photos', re: /(hier (sind|siehst du) [^.!?\n]{0,40}(fotos|bilder|galerie)|so siehst du [^.!?\n]{0,40}direkt|here are [^.!?\n]{0,30}(photos|pictures|images)|below are [^.!?\n]{0,30}(photos|pictures)|aquí (tienes|están) [^.!?\n]{0,30}(fotos|imágenes))/i, types: ['gallery', 'image', 'products', 'places'] },
  { code: 'promised-map', re: /(hier (ist|siehst du) [^.!?\n]{0,30}karte|auf der karte (unten|siehst)|here('s| is) [^.!?\n]{0,20}map|aquí (tienes|está) [^.!?\n]{0,20}mapa)/i, types: ['map', 'places'] },
  { code: 'promised-table', re: /(hier (ist |sind )?[^.!?\n]{0,30}(als )?tabelle|here('s| is) [^.!?\n]{0,20}table|aquí (tienes|está) [^.!?\n]{0,20}tabla)/i, types: ['table', 'compare'] },
];

/** A component announced in the prose that the drawn answer does not contain (no block of that kind, no picture). */
export function checkPromises(text: string, view: DrawnAnswer): Finding[] {
  const out: Finding[] = [];
  const types = new Set(view.segments.map((s) => s.type).filter(Boolean) as string[]);
  // a photo the app drew, or blocks whose items carry an image query: the phone looks those up (Wikipedia, keyless)
  const pics = view.segments.some((s) => s.images > 0 || (s.kind === 'hui' && /"(imageQuery|image|query)"\s*:\s*"/.test(s.raw)));
  const tableMd = /\n\s*\|.*\|\s*\n\s*\|\s*:?-{2,}/.test(text);
  for (const s of sentences(text)) {
    for (const p of PROMISES) {
      if (!p.re.test(s) || NEGATION.test(s)) continue;
      const has = p.types.some((t) => types.has(t)) || (p.code === 'promised-photos' && pics) || (p.code === 'promised-table' && tableMd);
      if (!has) out.push({ code: p.code, level: 'fail', detail: `announces it, the answer has none: "${s.slice(0, 140)}"` });
    }
  }
  return out;
}

// ── content the model sent that the reader cannot reach ──────────────────────────────────────────────────────────

/** keys whose strings are not reading content (ids, kinds, URLs, image queries, formulas, enum values …) */
const NOT_CONTENT = new Set([
  'id', 'type', 'kind', 'style', 'variant', 'tone', 'status', 'mode', 'layout', 'format', 'lang', 'language', 'source', 'icon', 'emoji', 'color',
  'image', 'images', 'imageQuery', 'query', 'url', 'href', 'src', 'thumb', 'action', 'value', 'name', 'symbol', 'expr', 'expression', 'formula',
  'groupBy', 'category', 'unit', 'currency', 'aspect', 'xKey', 'yKey', 'key', 'sound', 'input', 'basis', 'card', 'compare',
]);

/**
 * Reading content that sits behind a tap the explorer does not make (flip a card, answer a quiz, tap an agenda block
 * or a map pin): skipped per node type. Everything else must be reachable on screen.
 */
const BEHIND_TAP: Record<string, ReadonlySet<string> | '*'> = {
  quiz: '*', // one question at a time, explanations after answering
  vocab: '*', // one card at a time, the back after flipping
  flashcards: '*',
  agenda: new Set(['detail', 'note', 'description', 'location', 'address']), // a block's sheet
  map: new Set(['subtitle', 'hours', 'note', 'description', 'address', 'detail']), // a pin's card
  decision: new Set(['note']), // an option's note is in its breakdown ("tap an option"); the node note shows too, rarely missed
};

/** Subtrees that are instructions for the app, not text to show: a live-card patch (its ops name item ids). */
const NOT_SHOWN = new Set(['livePatch']);

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[​-‍⁠﻿]/g, '')
    .match(/[\p{L}\p{N}]{3,}/gu) ?? [];

function leaves(x: unknown, type: string, key: string, out: { key: string; value: string }[], depth = 0): void {
  if (depth > 12) return;
  if (typeof x === 'string') {
    if (NOT_CONTENT.has(key) || /^https?:\/\//.test(x) || /^[\w-]+$/.test(x) && /[_-]/.test(x)) return;
    if (words(x).length === 0) return;
    out.push({ key, value: x });
    return;
  }
  if (Array.isArray(x)) {
    for (const y of x) leaves(y, type, key, out, depth + 1);
    return;
  }
  if (x && typeof x === 'object') {
    const n = x as Record<string, unknown>;
    const t = typeof n.type === 'string' ? n.type : type;
    const gate = BEHIND_TAP[t];
    if (gate === '*') return;
    // a recipe ingredient shows `item` or its `plural`, whichever fits the amount ("1 Zwiebel", "2 Knoblauchzehen")
    const alt = typeof n.plural === 'string' && typeof n.item === 'string' ? (typeof n.qty === 'number' && n.qty !== 1 ? 'item' : 'plural') : '';
    for (const [k, v] of Object.entries(n)) {
      if ((gate && gate.has(k)) || NOT_SHOWN.has(k) || k === alt) continue;
      leaves(v, t, k, out, depth + 1);
    }
  }
}

/**
 * Strings of a block (as the model sent it) whose words are not on screen: at least 60 % of a string's words must be
 * visible somewhere in the block (the app reformats: "45 Sekunden" → "45 s", day names move into tab labels, …).
 * `seen`: the block's text after opening every tab / section / "show all" (answerView `explore`).
 */
export function missingContent(raw: string, type: string | null, seen: string): { key: string; value: string }[] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  const out: { key: string; value: string }[] = [];
  // the app may turn the block into another type (a graded choice into a quiz): the drawn type decides what is behind a tap
  if (type && BEHIND_TAP[type] === '*') return [];
  leaves(json, type ?? '', '', out);
  const vis = new Set(words(seen));
  return out.filter((l) => {
    const w = words(l.value);
    const hit = w.filter((x) => vis.has(x)).length;
    return hit / w.length < 0.6;
  });
}

// ── language ──────────────────────────────────────────────────────────────────────────────────────────────────────

const STOP: Record<'de' | 'en' | 'es', RegExp> = {
  de: /\b(und|ich|du|nicht|ist|der|die|das|mit|für|bitte|ein|eine|auf|zu|noch|hier|deine?)\b/gi,
  en: /\b(and|the|you|your|is|are|with|for|please|this|that|here|to|of|it|can)\b/gi,
  es: /\b(y|el|la|los|las|de|que|es|para|con|por|una?|aquí|tu|puedes)\b/gi,
};

/** Dominant language of prose (code and blocks removed), or null when too short / unclear. */
export function proseLanguage(text: string, minHits = 4): 'de' | 'en' | 'es' | null {
  const prose = sentences(text).join(' ');
  const counts = (Object.keys(STOP) as ('de' | 'en' | 'es')[]).map((l) => [l, (prose.match(STOP[l]) ?? []).length] as const).sort((a, b) => b[1] - a[1]);
  const [best, second] = counts;
  return best[1] >= minHits && best[1] >= 2 * second[1] ? best[0] : null;
}

/**
 * The answer is in another language than the question (soft: a tester's mixed-language prompt can be intended).
 * Seen live: direct Claude answered an English prompt in German.
 */
export function checkLanguage(prompt: string, answer: string): Finding[] {
  const a = proseLanguage(prompt, 3); // a question is short: three function words decide
  const b = proseLanguage(answer);
  return a && b && a !== b ? [{ code: 'answer-language', level: 'warn', detail: `asked in ${a}, answered in ${b}` }] : [];
}
