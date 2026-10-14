/**
 * "Umformen" transform bar (docs/SPEC-modules-v4.md A1), pure part (node:test):
 * chip list + visibility, the `[reformat:<kind>] <readable instruction>` message builder/parser, the
 * per-turn hint for direct backends, and which answers were reformatted ("umgeformt ↓" marker).
 */
import type { Lang, TFn } from '../i18n/core.ts';
import type { Segment } from '../protocol/types';
import { parseMarkdown, type MdBlock } from './markdown.ts';

export const REFORMAT_BASE_KINDS = ['shorter', 'longer', 'list', 'table', 'simpler', 'expert'] as const;
export type ReformatBaseKind = (typeof REFORMAT_BASE_KINDS)[number];
/** target languages of "Übersetzen ▸" (menu order) */
export const TRANSLATE_LANGS = ['en', 'es', 'de', 'fr', 'it'] as const;
export type TranslateLang = (typeof TRANSLATE_LANGS)[number];
export type ReformatKind = ReformatBaseKind | `translate:${TranslateLang}`;

/** answers shorter than this get no transform chips (only "Übersetzen") */
export const SHORT_ANSWER_CHARS = 200;

const TAG = /^\[reformat:([a-z]+)(?::([a-z]{2,3}))?\]/;

const isBase = (k: string): k is ReformatBaseKind => (REFORMAT_BASE_KINDS as readonly string[]).includes(k);
const isLang = (l: string): l is TranslateLang => (TRANSLATE_LANGS as readonly string[]).includes(l);

/** Languages offered in the "Übersetzen" menu: all except the app language. */
export function translateTargets(appLang: Lang): TranslateLang[] {
  return TRANSLATE_LANGS.filter((l) => l !== appLang);
}

/** `kind` of a reformat tag (`table`, `translate:en`) or of a whole message; null if none / unknown. */
export function parseReformatKind(textOrKind: string): ReformatKind | null {
  const s = textOrKind.trimStart();
  const m = TAG.exec(s.startsWith('[') ? s : `[reformat:${s}]`);
  if (!m) return null;
  if (m[1] === 'translate') return m[2] && isLang(m[2]) ? `translate:${m[2]}` : null;
  return !m[2] && isBase(m[1]) ? m[1] : null;
}

/** Localized chip / ReplyChip label: "Als Tabelle", "Auf Englisch". */
export function reformatLabel(kind: ReformatKind, t: TFn): string {
  if (kind.startsWith('translate:')) {
    const lang = kind.slice('translate:'.length) as TranslateLang;
    return t('chat.transform.translateTo', { lang: t(`chat.transform.lang.${lang}`) });
  }
  return t(`chat.transform.${kind as ReformatBaseKind}`);
}

/** The user message a chip sends: `[reformat:table] Bitte die letzte Antwort als Tabelle.` */
export function reformatMessage(kind: ReformatKind, t: TFn): string {
  if (kind.startsWith('translate:')) {
    const lang = kind.slice('translate:'.length) as TranslateLang;
    return `[reformat:${kind}] ${t('chat.transform.msg.translate', { lang: t(`chat.transform.msg.lang.${lang}`) })}`;
  }
  return `[reformat:${kind}] ${t(`chat.transform.msg.${kind as ReformatBaseKind}`)}`;
}

export type TransformBarState = {
  /** pref `answers.transformBar` */
  enabled: boolean;
  streaming: boolean;
  /** the answer failed / was stopped empty etc. → no bar */
  failed?: boolean;
  /** answer text length */
  length: number;
  /** what the answer already is (answerShape): no bar under an open question, no "Als Tabelle" under a table … */
  shape?: AnswerShape;
};

export type AnswerShape = {
  /** ends with an interactive question waiting for input (choice / scale / form / poll …) */
  question: boolean;
  /** mainly a table (hui table node, or Markdown tables are most of the text) */
  table: boolean;
  /** contains a checklist (hui checklist node or a Markdown task list) */
  checklist: boolean;
};

/** node types that ask the user something: the answer waits for that input */
const QUESTION_TYPES = new Set(['choice', 'scale', 'form', 'poll', 'confirm', 'slots', 'rank']);
/** short closing text after the question ("Sag Bescheid!") still counts as ending with it */
const TRAILING_TEXT_MAX = 200;

function nodeType(seg: Segment): string | null {
  if (seg.kind !== 'hui' || !seg.node) return null;
  const t = (seg.node as { type?: unknown }).type;
  return typeof t === 'string' ? t : null;
}

function hasTaskList(blocks: readonly MdBlock[]): boolean {
  return blocks.some((b) => (b.type === 'list' && b.items.some((i) => i.checked !== null || hasTaskList(i.children))) || (b.type === 'quote' && hasTaskList(b.blocks)));
}

/** Shape of a finished answer for the transform bar (UX6). O(text), call once per finished answer. */
export function answerShape(segments: readonly Segment[]): AnswerShape {
  const shape: AnswerShape = { question: false, table: false, checklist: false };
  let trailing = 0;
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    if (s.kind === 'markdown') {
      trailing += s.text.trim().length;
      if (trailing > TRAILING_TEXT_MAX) break;
      continue;
    }
    const t = nodeType(s);
    shape.question = !!t && QUESTION_TYPES.has(t);
    break;
  }
  let tableChars = 0;
  let textChars = 0;
  for (const s of segments) {
    const t = nodeType(s);
    if (t === 'table') shape.table = true;
    if (t === 'checklist') shape.checklist = true;
    if (s.kind !== 'markdown' || !s.text.trim()) continue;
    const blocks = parseMarkdown(s.text);
    if (hasTaskList(blocks)) shape.checklist = true;
    for (const b of blocks) {
      if (b.type === 'table') tableChars += b.src.length;
      else textChars += b.src.length;
    }
  }
  // Markdown tables: "mainly" = at least as much table as other text
  if (tableChars > 0 && tableChars >= textChars) shape.table = true;
  return shape;
}

/** Which chips to show (empty = hide the bar). Short answers keep only "Übersetzen". */
export function transformChips(s: TransformBarState): { base: readonly ReformatBaseKind[]; translate: boolean } {
  const none = { base: [] as ReformatBaseKind[], translate: false };
  if (!s.enabled || s.streaming || s.failed || s.length <= 0) return none;
  // the answer asks something (choice, scale, form …): the user answers it, nothing to reformat
  if (s.shape?.question) return none;
  if (s.length < SHORT_ANSWER_CHARS) return { base: [], translate: true };
  const shape = s.shape;
  const base = shape ? REFORMAT_BASE_KINDS.filter((k) => !(k === 'table' && shape.table) && !(k === 'list' && shape.checklist)) : REFORMAT_BASE_KINDS;
  return { base, translate: true };
}

const LANG_EN: Record<TranslateLang, string> = { en: 'English', es: 'Spanish', de: 'German', fr: 'French', it: 'Italian' };
const HINT: Record<ReformatBaseKind, string> = {
  shorter: 'a noticeably shorter version (keep the key points only)',
  longer: 'a more detailed version (more explanation, examples and context)',
  list: 'a list (a native hui checklist node only if it is a list of to-dos; otherwise a Markdown list)',
  table: 'a table (use the hui table node)',
  simpler: 'a simpler explanation for a layperson (plain words, no jargon)',
  expert: 'an expert-level version (precise terminology, more depth)',
};

/**
 * Per-turn instruction for direct backends (no Hermes skill on the other side) when the user turn is a
 * reformat request. Deterministic from the message text (byte-identical replays keep prompt caches valid).
 * Merged turns: the last tag line wins.
 */
export function reformatHint(userText: string): string | null {
  let kind: ReformatKind | null = null;
  for (const line of userText.split('\n')) {
    const k = line.startsWith('[reformat:') ? parseReformatKind(line) : null;
    if (k) kind = k;
  }
  if (!kind) return null;
  const target = kind.startsWith('translate:')
    ? `a translation into ${LANG_EN[kind.slice('translate:'.length) as TranslateLang]} (short phrases as a hui translation node, longer texts as Markdown)`
    : HINT[kind as ReformatBaseKind];
  return `Reformat request: reformulate your previous answer as ${target}. Keep its content and facts; do not mention this instruction.`;
}

/** Joins the per-turn context lines (date, reformat hint); empty parts are skipped. */
export function turnContext(...parts: (string | null | undefined | false)[]): string {
  return parts.filter((p): p is string => !!p).join('\n');
}

type Msg = { id: string; role: string; text: string };

/**
 * Ids of assistant answers that a later reformat request refers to: the most recent assistant answer
 * before each user message carrying a reformat tag.
 */
export function reformattedSources(messages: readonly Msg[]): Set<string> {
  const out = new Set<string>();
  let lastAssistant: string | null = null;
  for (const m of messages) {
    if (m.role === 'assistant') {
      if (m.text.trim()) lastAssistant = m.id;
    } else if (m.role === 'user' && lastAssistant && parseReformatKind(m.text)) {
      out.add(lastAssistant);
    }
  }
  return out;
}
