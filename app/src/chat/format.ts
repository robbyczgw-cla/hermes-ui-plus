// Pure helpers for the chat shell (unit-tested).
import { formatNumber, makeT, type TFn, type TKey } from '../i18n/core.ts';

/** `[form:<id>] <compact JSON of values>` – SPEC HuiAction submit. */
export function formMessage(formId: string, values: Record<string, unknown>): string {
  return `[form:${formId}] ${JSON.stringify(values)}`;
}

/** Parse a form submission back for nicer display of the user bubble. */
export function parseFormMessage(text: string): { formId: string; values: Record<string, unknown> } | null {
  const m = /^\[form:([^\]]+)\]\s*(\{[\s\S]*\})\s*$/.exec(text);
  if (!m) return null;
  try {
    const values: unknown = JSON.parse(m[2]);
    if (!values || typeof values !== 'object' || Array.isArray(values)) return null;
    return { formId: m[1], values: values as Record<string, unknown> };
  } catch {
    return null;
  }
}

/** Human readable form summary: "Budget: 500 · Ziel: Rom" (booleans as yes/no in the UI language). */
export function formSummary(values: Record<string, unknown>, t: TFn): string {
  return Object.entries(values)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'boolean' ? (v ? t('chat.fmt.yes') : t('chat.fmt.no')) : String(v)}`)
    .join(' · ');
}

/** "3,2 s" / "850 ms" (decimal separator of the active locale) */
export function formatDuration(ms: number, locale: string): string {
  if (ms < 1000) return `${formatNumber(locale, Math.max(0, Math.round(ms)))} ms`;
  const s = ms / 1000;
  return `${s < 10 ? formatNumber(locale, s, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : formatNumber(locale, Math.round(s))} s`;
}

/**
 * Text for "copy message": strips hui / hui-html fences so the clipboard gets readable text.
 * hui blocks are dropped, html blocks are dropped.
 */
export function plainCopyText(text: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of text.split('\n')) {
    if (fence) {
      const tt = line.trim();
      if (/^`+$/.test(tt) && tt.length >= fence.length) fence = null;
      continue;
    }
    const m = /^ {0,3}(`{3,})hui(?:-html)?[ \t]*$/.exec(line);
    if (m) {
      fence = m[1];
      continue;
    }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const TOOL_LABELS: Record<string, TKey> = {
  web_search: 'chat.toolTimeline.webSearch',
  search: 'chat.toolTimeline.search',
  browser: 'chat.toolTimeline.browser',
  browse: 'chat.toolTimeline.browser',
  fetch: 'chat.toolTimeline.fetchPage',
  web_fetch: 'chat.toolTimeline.fetchPage',
  terminal: 'chat.toolTimeline.terminal',
  shell: 'chat.toolTimeline.terminal',
  bash: 'chat.toolTimeline.terminal',
  python: 'chat.toolTimeline.python',
  code: 'chat.toolTimeline.runCode',
  execute_code: 'chat.toolTimeline.runCode',
  read_file: 'chat.toolTimeline.readFile',
  write_file: 'chat.toolTimeline.writeFile',
  memory: 'chat.toolTimeline.memory',
  image: 'chat.toolTimeline.image',
  image_generate: 'chat.toolTimeline.imageGenerate',
  calendar: 'chat.toolTimeline.calendar',
  email: 'chat.toolTimeline.email',
};

const labelKey = (name: string): TKey | null => {
  const key = name.toLowerCase();
  if (TOOL_LABELS[key]) return TOOL_LABELS[key];
  for (const [k, v] of Object.entries(TOOL_LABELS)) if (key.includes(k)) return v;
  return null;
};

/** Display name for a tool function name ("web_search" → "Web search" / "Websuche"). */
export function toolLabel(t: TFn, name: string): string {
  const k = labelKey(name);
  return k ? t(k) : name.replace(/[_-]+/g, ' ').trim().replace(/^\w/, (c) => c.toUpperCase());
}

const deT = makeT('de', 'de-DE');

/**
 * Argument preview shown next to the tool name. Hermes sends e.g. the shell command as `label`;
 * the Claude client sends full (German) labels ("Websuche…", "Websuche: wetter wien") – those are
 * reduced to the argument part so the chip reads "🔍 Web search  wetter wien".
 */
export function toolPreview(t: TFn, name: string, label?: string): string | null {
  let l = label?.replace(/\s+/g, ' ').trim().replace(/(…|\.\.\.)$/, '').trim();
  if (!l) return null;
  const k = labelKey(name);
  // the label may come in the UI language or in German (backend clients)
  const titles = [toolLabel(t, name), ...(k ? [deT(k)] : [])].map((x) => x.toLowerCase());
  const lower = l.toLowerCase();
  if (lower === name.toLowerCase() || titles.includes(lower)) return null;
  const prefix = titles.find((x) => lower.startsWith(x + ':'));
  if (prefix) l = l.slice(prefix.length + 1).trim();
  if (!l) return null;
  return l.length > 60 ? l.slice(0, 59) + '…' : l;
}

/** Emoji for a tool chip (Hermes' own emoji wins). */
export function toolEmoji(name: string, emoji?: string): string {
  if (emoji) return emoji;
  const k = name.toLowerCase();
  if (/search|such/.test(k)) return '🔍';
  if (/browse|fetch|web|url|http/.test(k)) return '🌐';
  if (/terminal|shell|bash|exec|command/.test(k)) return '💻';
  if (/python|code/.test(k)) return '🧮';
  if (/file|read|write|doc/.test(k)) return '📄';
  if (/memory|remember/.test(k)) return '🧠';
  if (/image|vision|photo/.test(k)) return '🖼️';
  if (/calendar|termin/.test(k)) return '📅';
  if (/mail/.test(k)) return '✉️';
  return '🛠️';
}
