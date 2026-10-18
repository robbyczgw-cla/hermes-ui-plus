/**
 * Tool-call input helpers for the "Werkzeuge & Ablauf" timeline: domain of a URL and a one-line preview of a tool's
 * input. Pure.
 */
import type { TFn } from '../i18n/core.ts';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** "https://www.spiegel.de/a/b" -> "spiegel.de" */
export function domainOf(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(url.trim());
  return (m ? m[1] : url).replace(/^www\./i, '').toLowerCase();
}

export function firstLine(s: string, max = 70): string {
  const line = s.split('\n').find((l) => l.trim()) ?? '';
  const t = line.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** One-line input preview for the timeline row (quoted query in the UI language's quotation marks / url / first code line / path). */
export function inputSummary(input: unknown, t: TFn): string | undefined {
  if (!isObj(input)) return undefined;
  const q = str(input.query);
  if (q) return t('chat.toolTimeline.queryQuoted', { query: q });
  const url = str(input.url);
  if (url) return url;
  const code = str(input.code);
  if (code) return firstLine(code);
  const path = str(input.path);
  const cmd = str(input.command);
  if (path) return cmd && cmd !== path ? `${cmd} ${path}` : path;
  if (cmd) return firstLine(cmd);
  return undefined;
}
