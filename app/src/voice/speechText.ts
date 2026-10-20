/**
 * Assistant markdown → plain prose for text-to-speech (pure, speechText.test.ts).
 *
 * - ```hui blocks → short summary in the active language ("Hier ist eine Tabelle mit 8 Zeilen.") or nothing
 * - ```hui-html → "Hier ist eine interaktive Ansicht."; other code fences → "Hier ist ein Codeblock."
 *   (all spoken texts come from the `voice.speech.*` dictionary keys; `t` is passed in)
 * - Markdown syntax (headings, emphasis, links, lists, quotes, tables, HTML, emoji) is removed;
 *   headings and list items get a final period so the voice pauses.
 * - Raw tool-call markup a model wrote as text (chat/toolMarkup.ts) is spoken as the answer's notice line, never as JSON.
 * Paragraphs are separated by "\n\n" (chunking.ts uses them as boundaries).
 */

import type { TFn } from '../i18n/core.ts';
import { answerOutputText, TOOL_MARKUP_NOTICE_KEY } from '../chat/toolMarkup.ts';

export type SpeechTextOptions = {
  /** speak a short summary for hui / html / code / tables (default true); false = skip them silently */
  summarizeBlocks?: boolean;
};

type Node = Record<string, unknown>;

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

function withPeriod(text: string): string {
  const t = text.trim();
  if (!t) return '';
  return /[.!?…:;]["“”'’»)\]]*$/.test(t) ? t : `${t}.`;
}

/** Summary for one HuiNode (protocol v0), spoken in the active language. Unknown/invalid → ''. */
export function summarizeHuiNode(node: unknown, t: TFn, depth = 0): string {
  if (!node || typeof node !== 'object' || Array.isArray(node) || depth > 4) return '';
  const n = node as Node;
  const title = s(n.title);
  const named = (key: 'chart' | 'form') => (title ? t(`voice.speech.${key}Titled`, { title: inlineToSpeech(title) }) : t(`voice.speech.${key}`));
  switch (n.type) {
    case 'table': {
      const rows = arr(n.rows).length;
      const caption = s(n.caption);
      return caption ? t('voice.speech.tableCaption', { count: rows, caption: inlineToSpeech(caption) }) : t('voice.speech.table', { count: rows });
    }
    case 'chart':
      return named('chart');
    case 'stats': {
      const items = arr(n.items).filter((i): i is Node => !!i && typeof i === 'object');
      if (items.length > 0 && items.length <= 4) {
        const parts = items.map((i) => `${inlineToSpeech(s(i.label))}: ${s(i.value)}`).filter((p) => p.length > 2);
        if (parts.length) return `${parts.join(', ')}.`;
      }
      return t('voice.speech.stats', { count: items.length });
    }
    case 'list':
      return t('voice.speech.list', { count: arr(n.items).length });
    case 'steps':
      return t('voice.speech.steps', { count: arr(n.items).length });
    case 'timeline':
      return t('voice.speech.timeline', { count: arr(n.items).length });
    case 'compare':
      return t('voice.speech.compare', { count: arr(n.columns).length });
    case 'form':
      return named('form');
    case 'image': {
      const alt = s(n.alt) || s(n.caption);
      return alt ? t('voice.speech.imageAlt', { alt: withPeriod(inlineToSpeech(alt)) }) : t('voice.speech.image');
    }
    case 'code':
      return t('voice.speech.codeBlock');
    case 'progress': {
      const label = inlineToSpeech(s(n.label));
      const max = typeof n.max === 'number' ? n.max : 100;
      const v = typeof n.value === 'number' ? n.value : null;
      if (v === null) return label ? withPeriod(label) : '';
      if (max === 100) {
        return label ? t('voice.speech.progressPercentLabeled', { label, value: v }) : t('voice.speech.progressPercent', { value: v });
      }
      return label ? t('voice.speech.progressOfLabeled', { label, value: v, max }) : t('voice.speech.progressOf', { value: v, max });
    }
    case 'text':
      return withPeriod(inlineToSpeech(s(n.text)));
    case 'callout': {
      const heading = inlineToSpeech(s(n.title));
      const body = inlineToSpeech(s(n.text));
      return [heading ? withPeriod(heading) : '', body ? withPeriod(body) : ''].filter(Boolean).join(' ');
    }
    case 'card':
    case 'stack': {
      const head = n.type === 'card' ? [s(n.title), s(n.subtitle)].filter(Boolean).map((x) => withPeriod(inlineToSpeech(x))) : [];
      const kids = arr(n.children).map((c) => summarizeHuiNode(c, t, depth + 1)).filter(Boolean);
      return [...head, ...kids].join(' ');
    }
    // buttons / suggestions / unknown: nothing worth hearing
    default:
      return '';
  }
}

export function summarizeHuiJson(raw: string, t: TFn): string {
  try {
    return summarizeHuiNode(JSON.parse(raw), t);
  } catch {
    return '';
  }
}

// ── inline markdown ─────────────────────────────────────────────────────────

let EMOJI_RE: RegExp;
try {
  // hermes-compat-ok: try/catch with a surrogate-range fallback (Hermes V1 does know Extended_Pictographic)
  EMOJI_RE = new RegExp('[\\p{Extended_Pictographic}\\u{1F1E6}-\\u{1F1FF}\\u{FE0F}\\u{200D}\\u{20E3}\\u{1F3FB}-\\u{1F3FF}]', 'gu');
} catch {
  EMOJI_RE = /[☀-➿️‍]|[\uD83C-\uDBFF][\uDC00-\uDFFF]/g;
}

function host(url: string): string {
  const m = url.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:?#]+)/i);
  return m ? m[1].replace(/^www\./i, '') : url;
}

/** Remove inline markdown/HTML so the voice reads only words. */
export function inlineToSpeech(text: string): string {
  let t = text;
  t = t.replace(/\[\^[^\]]*\]/g, ''); // footnote refs
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1'); // images → alt
  t = t.replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, '$1'); // [text](url)
  t = t.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1'); // [text][ref]
  t = t.replace(/<((?:https?|mailto):[^>\s]+)>/gi, (_m, u: string) => (u.startsWith('mailto:') ? u.slice(7) : host(u)));
  t = t.replace(/\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"»“”]/gi, (u) => host(u));
  t = t.replace(/`+([^`]*?)`+/g, '$1'); // inline code
  t = t.replace(/<\/?[a-z][^>]*>/gi, ' '); // html tags
  t = t.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2'); // bold
  t = t.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1'); // strike
  t = t.replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, '$1$2'); // *italic*
  t = t.replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1$2'); // _italic_
  t = t.replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1'); // escapes
  t = t.replace(EMOJI_RE, '');
  t = t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  t = t.replace(/\s*(?:->|=>|→)\s*/g, ' – ');
  return t.replace(/[ \t ]+/g, ' ').trim();
}

// ── blocks ──────────────────────────────────────────────────────────────────

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function codeSummary(lang: string, body: string, summarize: boolean, t: TFn): string {
  const l = lang.toLowerCase();
  if (l === 'hui') return summarize ? summarizeHuiJson(body, t) : '';
  if (!summarize) return '';
  if (l === 'hui-html' || l === 'html') return t('voice.speech.interactive');
  if (l === 'mermaid') return t('voice.speech.chart');
  return t('voice.speech.codeBlock');
}

/** Convert one assistant message (markdown with hui fences) into speakable prose. */
export function toSpeechText(markdown: string, t: TFn, opts: SpeechTextOptions = {}): string {
  const summarize = opts.summarizeBlocks !== false;
  // every spoken output (read-aloud, auto-read, the screen-reader announcement) says what the answer shows
  const lines = answerOutputText(markdown, t(TOOL_MARKUP_NOTICE_KEY)).replace(/\r\n?/g, '\n').split('\n');
  const paragraphs: string[] = [];
  let para: string[] = [];
  const flush = () => {
    const p = para.join(' ').replace(/\s+/g, ' ').trim();
    if (p) paragraphs.push(p);
    para = [];
  };
  const block = (text: string) => {
    flush();
    if (text.trim()) paragraphs.push(text.trim());
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // fenced code (unclosed fence while streaming → runs to the end)
    const fm = line.match(FENCE_RE);
    if (fm) {
      const fence = fm[1];
      const body: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const close = lines[j].match(/^ {0,3}(`{3,}|~{3,})\s*$/);
        if (close && close[1][0] === fence[0] && close[1].length >= fence.length) break;
        body.push(lines[j]);
      }
      block(codeSummary(fm[2], body.join('\n'), summarize, t));
      i = j;
      continue;
    }

    // pipe table: header row + separator row
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      let j = i + 2;
      while (j < lines.length && lines[j].includes('|') && lines[j].trim()) j++;
      const rows = j - (i + 2);
      block(summarize ? t('voice.speech.table', { count: rows }) : '');
      i = j - 1;
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    // horizontal rule
    if (/^ {0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      continue;
    }
    // heading (ATX) → own sentence
    const hm = trimmed.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (hm) {
      block(withPeriod(inlineToSpeech(hm[1])));
      continue;
    }
    // setext underline: previous paragraph line was a heading
    if (/^(=+|-+)\s*$/.test(trimmed) && para.length) {
      const last = para.pop() as string;
      flush();
      block(withPeriod(last));
      continue;
    }
    let content = trimmed.replace(/^(>\s?)+/, ''); // blockquote
    const lm = content.match(/^(?:[-*+•]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/);
    if (lm) {
      // list item → its own sentence
      flush();
      const item = inlineToSpeech(lm[1]);
      if (item) paragraphs.push(withPeriod(item));
      continue;
    }
    content = inlineToSpeech(content);
    if (content) para.push(content);
  }
  flush();
  return paragraphs.join('\n\n');
}
