/**
 * Display side of protocol replies (`[choice:id] …`, `[checklist:id] erledigt: … · offen: …`, `[form:id] {json}`,
 * …; see ui/components/modules/a/replies.ts, chat/ask.ts, chat/format.ts). The STORED message text stays the
 * protocol string the model needs; the user bubble shows a short localized summary chip instead
 * ("↩ Reisezeit, Klima"). Pure (node:test).
 */
import type { TFn } from '../i18n/core.ts';
import { formSummary } from './format.ts';
import { languageName } from '../ui/components/modules/c1/languages.ts';

/** Machine tags the app sends as (part of) a user message. */
export const REPLY_KINDS = ['choice', 'slot', 'confirm', 'poll', 'decision', 'rank', 'scale', 'calc', 'agenda', 'checklist', 'quiz', 'form', 'reaction', 'ask', 'node', 'reformat', 'guide', 'workout', 'studyplan', 'vocab', 'mindmap', 'products', 'paths'] as const;
export type ReplyKind = (typeof REPLY_KINDS)[number];

export type ReplyPart = { kind: ReplyKind; id: string; display: string };
/** `head` = free text before the tags (an `ask` button text), `replies` = one chip per tag line. */
export type ParsedReply = { head: string; replies: ReplyPart[] };

const TAG = /^\[([a-z]+)(?::([^\]\n]*))?\]\s*(.*)$/;
const isKind = (k: string): k is ReplyKind => (REPLY_KINDS as readonly string[]).includes(k);

/** "a, b, c" / "–" → item count */
const countList = (s: string) => (!s.trim() || s.trim() === '–' ? 0 : s.split(/,\s*/).filter(Boolean).length);

/** Text after the last "→" (question / inputs before it are context the card already shows). */
function afterArrow(s: string): string {
  const i = s.lastIndexOf('→');
  return (i >= 0 ? s.slice(i + 1) : s).trim();
}

function jsonSummary(rest: string, t: TFn): string | null {
  if (!/^\{[\s\S]*\}$/.test(rest)) return null;
  try {
    const v: unknown = JSON.parse(rest);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    return formSummary(v as Record<string, unknown>, t);
  } catch {
    return null;
  }
}

const REFORMAT_KEYS = {
  shorter: 'chat.reply.rfShorter',
  longer: 'chat.reply.rfLonger',
  list: 'chat.reply.rfList',
  table: 'chat.reply.rfTable',
  simpler: 'chat.reply.rfSimpler',
  expert: 'chat.reply.rfExpert',
} as const;

/** `[reformat:<kind>]` → "Als Tabelle", `translate:en` → "Übersetzt: Englisch" (the chip itself adds the arrow). */
function reformatDisplay(id: string, t: TFn): string {
  const kind = id.trim();
  if (Object.prototype.hasOwnProperty.call(REFORMAT_KEYS, kind)) return t(REFORMAT_KEYS[kind as keyof typeof REFORMAT_KEYS]);
  const m = /^translate:(.+)$/.exec(kind);
  if (m) {
    const ui = t('chat.reply.uiLang');
    return t('chat.reply.rfTranslate', { lang: languageName(m[1], ui === 'en' || ui === 'es' ? ui : 'de') });
  }
  return t('chat.reply.rfOther');
}

/**
 * Readable, localized summary of one tag line's payload (the German protocol words are mapped).
 * `id` = the tag's id part; only `reformat` needs it (its kind lives there).
 */
export function replyDisplay(kind: ReplyKind, rest: string, t: TFn, id = ''): string {
  const r = rest.trim();
  if (r === 'noch keine Auswahl') return t('chat.reply.none');
  if (r === '(keine Angaben)') return t('chat.reply.noValues');
  switch (kind) {
    case 'choice': {
      const a = afterArrow(r);
      if (a === 'noch keine Auswahl') return t('chat.reply.none');
      return a.replace(/(^|,\s*)Andere:\s*/g, (_, p: string) => `${p}${t('chat.reply.other')}: `);
    }
    case 'slot':
      return r === 'keiner passt' ? t('chat.reply.slotNone') : r;
    case 'confirm':
      if (r === 'ja') return t('chat.fmt.yes');
      if (r === 'nein') return t('chat.fmt.no');
      if (r === 'noch offen') return t('chat.reply.pending');
      return r;
    case 'checklist': {
      const both = /^erledigt:\s*(.*?)\s*·\s*offen:\s*(.*)$/.exec(r);
      if (both) {
        const done = countList(both[1]);
        return t('chat.reply.checklist', { done, total: done + countList(both[2]) });
      }
      const open = /^offen:\s*(.*)$/.exec(r);
      if (open) return t('chat.reply.checklist', { done: 0, total: countList(open[1]) });
      return r;
    }
    case 'quiz': {
      const score = /^(\d+)\/(\d+|\?) richtig/.exec(r);
      if (score) return t('chat.reply.quizScore', { correct: score[1], total: score[2] });
      const answered = /^(\d+)\/(\d+|\?) beantwortet/.exec(r);
      if (answered) return t('chat.reply.quizAnswered', { answered: answered[1], total: answered[2] });
      return r;
    }
    case 'poll':
      // "Pizza 3 · Sushi 1 (4 Stimmen) — Anna: Pizza" → "Pizza 3 · Sushi 1"
      return r.replace(/\s+—\s+.*$/, '').replace(/\s*\(\d+ Stimmen?(?: · \d+ Personen?)?\)\s*$/, '').trim();
    case 'decision': {
      const m = /^(Gewinner|Gleichstand):\s*(.*?)\s*\([^)]*\)/.exec(r);
      if (m) return m[1] === 'Gewinner' ? t('chat.reply.winner', { name: m[2] }) : t('chat.reply.tie', { names: m[2] });
      return r;
    }
    case 'calc':
      return afterArrow(r);
    case 'agenda':
      return r === '–' ? t('chat.reply.none') : r;
    case 'form':
      return jsonSummary(r, t) ?? r;
    case 'reformat':
      return reformatDisplay(id, t);
    case 'guide': {
      if (/^Fertig\b/i.test(r)) return t('chat.reply.guideDone');
      // "Schritt 3 („Eier trennen“): Ich hänge fest – Dotter ist gerissen"
      const m = /^Schritt (\d+)\b[\s\S]*?:\s*Ich hänge fest(?:\s*[–-]\s*([\s\S]*))?$/.exec(r);
      if (m) {
        const detail = (m[2] ?? '').trim();
        return detail ? t('chat.reply.guideStuckDetail', { step: m[1], detail }) : t('chat.reply.guideStuck', { step: m[1] });
      }
      return r;
    }
    case 'workout': {
      // "18/20 Sätze · 42 min · Kniebeuge 3×10 @ 60 kg …" → the exercise list stays out of the chip
      const m = /^(\d+)\/(\d+) Sätze(?:\s*·\s*(\d+) min)?/.exec(r);
      if (!m) return r;
      return m[3] === undefined
        ? t('chat.reply.workoutNoTime', { done: m[1], total: m[2] })
        : t('chat.reply.workout', { done: m[1], total: m[2], min: m[3] });
    }
    case 'studyplan':
      // "Woche 1: 9/12 erledigt" (several weeks joined by " · ")
      return r.replace(/Woche (\d+):\s*(\d+)\/(\d+) erledigt/g, (_, w: string, d: string, tot: string) => t('chat.reply.studyWeek', { week: w, done: d, total: tot }));
    case 'vocab': {
      const m = /^(\d+)\/(\d+|\?) richtig(?:\s*·\s*schwierig:\s*([\s\S]*))?$/.exec(r);
      if (!m) return r;
      const score = t('chat.reply.quizScore', { correct: m[1], total: m[2] });
      const hard = (m[3] ?? '').trim();
      return hard ? `${score} · ${t('chat.reply.hard')}: ${hard}` : score;
    }
    case 'mindmap': {
      const m = /„([^“\n]+)“/.exec(r);
      return m ? t('chat.reply.mindmap', { label: m[1] }) : r;
    }
    case 'products': {
      const m = /^Favorit:\s*([\s\S]*)$/.exec(r);
      return m ? t('chat.reply.winner', { name: m[1].trim() }) : r;
    }
    default:
      return jsonSummary(r, t) ?? r;
  }
}

/**
 * Splits a user message into free text + protocol reply lines. Returns null for ordinary messages.
 * Accepted shapes: a single reply line, or free text followed by reply lines (`ask`); tag lines mixed
 * into the middle of free text are left alone (could be the user's own writing).
 */
export function parseReplyMessage(text: string, t: TFn): ParsedReply | null {
  const lines = text.split('\n');
  const replies: ReplyPart[] = [];
  const head: string[] = [];
  for (const line of lines) {
    const m = TAG.exec(line.trim());
    if (m && isKind(m[1])) {
      const kind = m[1];
      const display = replyDisplay(kind, m[3] ?? '', t, (m[2] ?? '').trim()).trim() || (kind === 'form' ? '–' : t('chat.reply.sent'));
      replies.push({ kind, id: (m[2] ?? '').trim(), display });
      continue;
    }
    if (replies.length && line.trim()) return null; // free text after a tag line → not ours
    head.push(line);
  }
  if (!replies.length) return null;
  return { head: head.join('\n').trim(), replies };
}

/** Plain text for "copy" of a reply message (summary instead of the protocol string). */
export function replyCopyText(p: ParsedReply): string {
  return [p.head, ...p.replies.map((r) => r.display)].filter(Boolean).join('\n');
}
