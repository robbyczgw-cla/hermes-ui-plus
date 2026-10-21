/**
 * `vocab` logic (docs/SPEC-modules-v4.md): reader, Leitner boxes + session scheduling, tolerant
 * answer compare (case / accents / articles / punctuation optional, one typo forgiven on longer
 * words), multiple-choice options, session summary + reply. Pure (node:test), Hermes-safe
 * (no String#normalize / Intl).
 */
import type { HuiVocabMode } from '../../../types';
import { oneLine } from '../a/replies.ts';
import { parseLang } from '../c1/languages.ts';

type Rec = Record<string, unknown>;

export type VocabItem = { id: string; term: string; translation: string; example?: string; note?: string; romanization?: string };
export type VocabModel = { title?: string; from: string; to: string; items: VocabItem[]; mode: HuiVocabMode };

export const MAX_VOCAB = 40;
export const SESSION_SIZE = 20;
export const BOXES = 5;
export const MODES: readonly HuiVocabMode[] = ['cards', 'quiz', 'type'];

const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/**
 * The language codes of the header ("EN → DE") and the languages they stand for: a language the model did not name
 * (`und`) is left out instead of showing "EN → UND"; none known → no header line.
 */
export function vocabRoute(from: string, to: string): { label: string; codes: string[] } {
  const codes = [from, to].filter((c) => !!c && c !== 'und');
  const short = codes.map((c) => c.split('-')[0].toUpperCase());
  return { label: short.join(' → '), codes };
}

export function readVocab(node: Rec | null | undefined): VocabModel {
  const n = node ?? {};
  const items: VocabItem[] = [];
  const used = new Set<string>();
  (Array.isArray(n.items) ? n.items : []).forEach((r, i) => {
    if (!isRec(r) || items.length >= MAX_VOCAB) return;
    const term = str(r.term);
    const translation = str(r.translation);
    if (!term || !translation) return;
    let id = str(r.id) || `v${i}`;
    while (used.has(id)) id = `${id}~`;
    used.add(id);
    const it: VocabItem = { id, term, translation };
    for (const k of ['example', 'note', 'romanization'] as const) {
      const v = str(r[k]);
      if (v) it[k] = v;
    }
    items.push(it);
  });
  const mode = MODES.includes(n.mode as HuiVocabMode) ? (n.mode as HuiVocabMode) : 'cards';
  const title = str(n.title);
  return { ...(title ? { title } : {}), from: str(n.from) || 'und', to: str(n.to) || 'und', items, mode };
}

/* ───────────── Leitner ───────────── */

/** Box 1..5. Review interval in sessions per box: 1, 2, 4, 8, 16. */
export function boxInterval(box: number): number {
  return 2 ** (clampBox(box) - 1);
}

export function clampBox(b: unknown): number {
  return typeof b === 'number' && Number.isFinite(b) ? Math.min(BOXES, Math.max(1, Math.round(b))) : 1;
}

/** Correct → next box (max 5); wrong → back to box 1. */
export function nextBox(box: number, correct: boolean): number {
  return correct ? Math.min(BOXES, clampBox(box) + 1) : 1;
}

export type Run = {
  mode: HuiVocabMode;
  /** item ids in session order */
  queue: string[];
  i: number;
  /** id → answered correctly (first answer counts) */
  results: Record<string, boolean>;
  finished: boolean;
  sent: boolean;
  /** RNG seed (option order) */
  seed: number;
};

/** own-property check: item ids like "constructor" must not read inherited members as state */
const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Persisted per node. `seen[id]` = session number the item was last asked in. */
export type VocabState = { boxes: Record<string, number>; seen: Record<string, number>; session: number; mode?: HuiVocabMode; run: Run | null };
export const INITIAL_VOCAB_STATE: VocabState = { boxes: {}, seen: {}, session: 0, run: null };

export function boxOf(s: VocabState, id: string): number {
  return clampBox(own(s.boxes, id) ? s.boxes[id] : undefined);
}

/** Item count per box (index 0 = box 1). */
export function boxCounts(items: readonly VocabItem[], s: VocabState): number[] {
  const c = Array.from({ length: BOXES }, () => 0);
  for (const it of items) c[boxOf(s, it.id) - 1]++;
  return c;
}

/**
 * Items for session number `session` (1-based): every item whose box interval has elapsed since it
 * was last seen (never-seen items are always due), lowest box first, max `size`. When fewer than 5
 * are due, the session is topped up with the least-recently-seen items so practice never dead-ends.
 */
export function pickSession(items: readonly VocabItem[], s: VocabState, session: number, size = SESSION_SIZE): string[] {
  const info = items.map((it, idx) => {
    const box = boxOf(s, it.id);
    const last = own(s.seen, it.id) ? s.seen[it.id] : undefined;
    const due = last === undefined || session - last >= boxInterval(box);
    return { id: it.id, idx, box, last: last ?? -1, due };
  });
  const order = (a: (typeof info)[number], b: (typeof info)[number]) => a.box - b.box || a.last - b.last || a.idx - b.idx;
  const due = info.filter((x) => x.due).sort(order);
  const pick = due.slice(0, size);
  const min = Math.min(5, items.length, size);
  if (pick.length < min) {
    const rest = info.filter((x) => !x.due).sort((a, b) => a.last - b.last || a.box - b.box || a.idx - b.idx);
    for (const x of rest) {
      if (pick.length >= min) break;
      pick.push(x);
    }
  }
  return pick.map((x) => x.id);
}

export function startRun(items: readonly VocabItem[], s: VocabState, mode: HuiVocabMode, seed: number): VocabState {
  const session = s.session + 1;
  const ids = pickSession(items, s, session);
  const queue = shuffle(ids, rng(seed));
  return { ...s, session, mode, run: { mode, queue, i: 0, results: {}, finished: false, sent: false, seed } };
}

/** Record the answer for the current item (first answer counts) and move its Leitner box. */
export function answerCurrent(s: VocabState, correct: boolean): VocabState {
  const r = s.run;
  if (!r || r.finished) return s;
  const id = r.queue[r.i];
  if (id === undefined || own(r.results, id)) return s;
  return {
    ...s,
    boxes: { ...s.boxes, [id]: nextBox(boxOf(s, id), correct) },
    seen: { ...s.seen, [id]: s.session },
    run: { ...r, results: { ...r.results, [id]: correct } },
  };
}

export function advanceRun(s: VocabState): VocabState {
  const r = s.run;
  if (!r) return s;
  if (r.i + 1 >= r.queue.length) return { ...s, run: { ...r, finished: true } };
  return { ...s, run: { ...r, i: r.i + 1 } };
}

/** Drop queue entries whose items vanished (e.g. the node was edited) – keeps old state usable. */
export function syncRun(s: VocabState, items: readonly VocabItem[]): VocabState {
  const r = s.run;
  if (!r) return s;
  const ids = new Set(items.map((x) => x.id));
  if (r.queue.every((id) => ids.has(id))) return s;
  const queue = r.queue.filter((id) => ids.has(id));
  if (!queue.length) return { ...s, run: null };
  return { ...s, run: { ...r, queue, i: Math.min(r.i, queue.length - 1) } };
}

export type Summary = { correct: number; total: number; hard: VocabItem[] };

export function summarize(items: readonly VocabItem[], r: Run): Summary {
  const byId = new Map(items.map((x) => [x.id, x]));
  let correct = 0;
  const hard: VocabItem[] = [];
  for (const id of r.queue) {
    const it = byId.get(id);
    if (!it || !own(r.results, id)) continue;
    if (r.results[id] === true) correct++;
    else hard.push(it);
  }
  return { correct, total: r.queue.filter((id) => byId.has(id)).length, hard };
}

/** `[vocab:<id>] 18/20 richtig · schwierig: perro, gato` (≤ 8 hard words named). */
export function vocabReply(id: string, sum: Summary): string {
  const head = `[vocab:${oneLine(id) || 'vocab'}] ${sum.correct}/${sum.total} richtig`;
  if (!sum.hard.length) return head;
  const names = sum.hard.slice(0, 8).map((h) => oneLine(h.term));
  return `${head} · schwierig: ${names.join(', ')}${sum.hard.length > 8 ? ' …' : ''}`;
}

/* ───────────── multiple choice ───────────── */

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(xs: readonly T[], rnd: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Up to 4 translation options for `item`: the right one + distractors from other items (distinct
 * after tolerant normalisation), stably shuffled by `seed` + item id. `answer` = index of the right one.
 */
export function choiceOptions(items: readonly VocabItem[], item: VocabItem, seed: number, count = 4): { options: string[]; answer: number } {
  const rnd = rng((seed ^ hashStr(item.id)) >>> 0);
  const seen = new Set([foldAnswer(item.translation, '')]);
  const pool: string[] = [];
  for (const x of shuffle(items, rnd)) {
    if (x.id === item.id) continue;
    const k = foldAnswer(x.translation, '');
    if (seen.has(k)) continue;
    seen.add(k);
    pool.push(x.translation);
    if (pool.length >= count - 1) break;
  }
  const options = shuffle([item.translation, ...pool], rnd);
  return { options, answer: options.indexOf(item.translation) };
}

/* ───────────── tolerant compare ───────────── */

const FOLD: Record<string, string> = {
  á: 'a', à: 'a', â: 'a', ä: 'a', ã: 'a', å: 'a', ā: 'a',
  é: 'e', è: 'e', ê: 'e', ë: 'e', ē: 'e',
  í: 'i', ì: 'i', î: 'i', ï: 'i', ī: 'i',
  ó: 'o', ò: 'o', ô: 'o', ö: 'o', õ: 'o', ø: 'o', ō: 'o',
  ú: 'u', ù: 'u', û: 'u', ü: 'u', ū: 'u',
  ñ: 'n', ç: 'c', ý: 'y', ÿ: 'y', ś: 's', š: 's', ž: 'z', č: 'c', ł: 'l',
  ß: 'ss', œ: 'oe', æ: 'ae',
};

/** Leading articles that may be left out, per language base (plus a shared fallback). */
const ARTICLES: Record<string, readonly string[]> = {
  es: ['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'lo'],
  de: ['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer'],
  en: ['the', 'a', 'an', 'to'],
  fr: ['le', 'la', 'les', 'l', 'un', 'une', 'des', 'du'],
  it: ['il', 'lo', 'la', 'i', 'gli', 'le', 'l', 'un', 'uno', 'una'],
  pt: ['o', 'a', 'os', 'as', 'um', 'uma'],
  nl: ['de', 'het', 'een'],
};
const ALL_ARTICLES = new Set(Object.values(ARTICLES).flat());

function lower(s: string): string {
  return s.toLowerCase().replace(/[’`´]/g, "'");
}

/** lowercase, accents folded, punctuation dropped, whitespace collapsed (keeps letters of all scripts). */
export function foldText(s: string): string {
  let out = '';
  for (const ch of lower(s)) out += FOLD[ch] ?? ch;
  return out
    .replace(/[¿¡?!.,;:"„“”«»()[\]{}…·–—\-_/\\]+/g, ' ')
    .replace(/'/g, "' ")
    .replace(/\s+/g, ' ')
    .trim();
}

/** foldText + optional leading article removed (language-specific, else any known article). */
export function foldAnswer(s: string, lang: string): string {
  const f = foldText(s);
  const base = parseLang(lang).base;
  const arts = ARTICLES[base] ? new Set(ARTICLES[base]) : ALL_ARTICLES;
  const words = f.split(' ');
  if (words.length > 1) {
    const w0 = words[0].replace(/'$/, '');
    if (arts.has(w0)) return words.slice(1).join(' ').replace(/^' /, '');
  }
  return f.replace(/' /g, "'");
}

/** Accepted variants: "el coche / el carro", "Auto; Wagen", "car (vehicle)" → parenthesised part optional. Commas stay (phrases). */
export function answerVariants(expected: string): string[] {
  const parts = expected.split(/\s*[/;|]\s*/).map((p) => p.trim()).filter(Boolean);
  const out = new Set<string>();
  for (const p of parts.length ? parts : [expected]) {
    out.add(p);
    const noParen = p.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    if (noParen) out.add(noParen);
  }
  return [...out];
}

/** Levenshtein distance with an early exit above `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * - `exact`: same text (case and surrounding whitespace ignored)
 * - `close`: right once accents / articles / punctuation are ignored → counts as correct, shows the spelling
 * - `typo`: one letter off on a word of ≥ 5 letters → counts as correct, shows the spelling
 * - `wrong`
 */
export type Verdict = 'exact' | 'close' | 'typo' | 'wrong';

export function compareAnswer(input: string, expected: string, lang: string): Verdict {
  const raw = lower(input).replace(/\s+/g, ' ').trim();
  if (!raw) return 'wrong';
  let best: Verdict = 'wrong';
  for (const v of answerVariants(expected)) {
    if (lower(v).replace(/\s+/g, ' ').trim() === raw) return 'exact';
    const a = foldAnswer(input, lang);
    const b = foldAnswer(v, lang);
    if (!a || !b) continue;
    if (a === b) best = 'close';
    else if (best === 'wrong' && b.replace(/\s/g, '').length >= 5 && editDistance(a, b, 1) <= 1) best = 'typo';
  }
  return best;
}

export const isAccepted = (v: Verdict) => v !== 'wrong';
