/**
 * Web result card (docs/WSP-INTEGRATION.md): what one web search / extract call of a turn did, for the sheet that opens
 * from its chip or timeline row (WebResultCard.tsx). Built from the stored tool detail (hermes/webResults.ts parsed the
 * result before the output cap) and the answer text (which hits the answer cites).
 *
 * Progressive: Web Search Plus (WSP) fills in routing, cache age, freshness and the research summary; a generic
 * `web_search` gives the query and the hits at most; a tool without a parsed result gives no card (null) and keeps the
 * plain detail view. Titles and snippets stay untrusted plain text, links are http(s) only. Pure (node:test).
 */
import type { ChatMessage, ToolEvent, ToolWebMeta } from '../hermes/types.ts';
import { canonicalUrl } from '../hermes/webResults.ts';
import { formatDate, formatNumber, type TFn, type TKey } from '../i18n/core.ts';
import { findCitationList } from './answers/citations.ts';
import { hermesToolKind, toolInput } from './hermesTools.ts';
import { formatElapsed } from './toolTimeline.ts';
import { providerName } from './webProviders.ts';

export { providerName };

export type WebCardMode = 'search' | 'research' | 'extract';

export type WebCardHit = {
  title: string;
  url: string;
  domain: string;
  snippet?: string;
  /** localized date (`[published 2026-10-14]`) or the provider's own text ("3 days ago") */
  date?: string;
  /** number of the answer's citation list that points here; 0 = linked in the text without a number */
  cited?: number;
  /** extract: the page could not be read */
  failed?: string;
};

export type WebCardFact = { key: string; label: string; value: string };

export type WebCard = {
  mode: WebCardMode;
  /** search query, or the page hosts of an extract call */
  query?: string;
  provider?: string;
  /** one-line summary under the query: "Brave · automatically chosen · 6 results" */
  facts: WebCardFact[];
  hits: WebCardHit[];
  /** hits the answer cites */
  cited: number;
  /** hit count the tool itself reported (WSP `results=N`); the list may show fewer */
  reported?: number;
  /** the call failed: error line and the reason per provider */
  error?: string;
  providerErrors?: { provider: string; reason: string }[];
  /** WSP output (routing / cache / research facts), not just a generic list */
  rich: boolean;
};

const QUERY_TYPES: Record<string, TKey> = {
  academic: 'hermesTools.webCard.type.academic',
  community: 'hermesTools.webCard.type.community',
  docs: 'hermesTools.webCard.type.docs',
  general: 'hermesTools.webCard.type.general',
  local: 'hermesTools.webCard.type.local',
  news: 'hermesTools.webCard.type.news',
  security: 'hermesTools.webCard.type.security',
  shopping: 'hermesTools.webCard.type.shopping',
};

const FRESHNESS: Record<string, TKey> = {
  day: 'hermesTools.webCard.fresh.day',
  pd: 'hermesTools.webCard.fresh.day',
  week: 'hermesTools.webCard.fresh.week',
  pw: 'hermesTools.webCard.fresh.week',
  month: 'hermesTools.webCard.fresh.month',
  pm: 'hermesTools.webCard.fresh.month',
  year: 'hermesTools.webCard.fresh.year',
  py: 'hermesTools.webCard.fresh.year',
};

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const isHttp = (u: string) => /^https?:\/\/[^\s/?#]+/i.test(u);

function hostOf(url: string): string {
  return (/^https?:\/\/([^/?#:]+)/i.exec(url)?.[1] ?? url).replace(/^www\./i, '').toLowerCase();
}

/** extract-ish tool name (the same split as the chip icon in hermesTools.ts) */
const EXTRACT_RE = /extract|fetch|read|crawl/i;

/** search / research / extract, or null when the event is no web tool */
export function webToolMode(ev: Pick<ToolEvent, 'name' | 'detail'>): WebCardMode | null {
  const name = ev.detail?.tool ?? ev.name;
  if (hermesToolKind(name) !== 'web' && !ev.detail?.web) return null;
  if (EXTRACT_RE.test(name)) return 'extract';
  const mode = str(toolInput(ev)?.mode)?.toLowerCase();
  return mode === 'research' || ev.detail?.web?.research ? 'research' : 'search';
}

/** Does this tool event have a card (a web tool whose result was parsed)? */
export function hasWebCard(ev: Pick<ToolEvent, 'name' | 'detail'>): boolean {
  return webToolMode(ev) !== null && (!!ev.detail?.web || !!ev.detail?.links?.length);
}

/**
 * URLs the answer cites: canonical URL → number in the closing `[n]` / "Sources:" list (0 = only an inline link).
 * Runs on the finished answer text (O(text)).
 */
export function citedUrls(text: string): Map<string, number> {
  const out = new Map<string, number>();
  if (!text.includes('http')) return out;
  // blocks after the closing list (follow-up chips) are segments of their own: the list ends the last text segment
  const md = text.replace(/(?:\n*```[\w-]*\n[\s\S]*?\n```[ \t]*)+\s*$/, '');
  const list = findCitationList(md);
  list?.items.forEach((it, i) => {
    const k = canonicalUrl(it.url);
    if (!out.has(k)) out.set(k, i + 1);
  });
  const body = list?.body ?? md;
  for (const m of body.matchAll(/\]\(\s*<?(https?:\/\/[^\s)>]+)>?/g)) {
    const k = canonicalUrl(m[1]);
    if (!out.has(k)) out.set(k, 0);
  }
  for (const m of body.matchAll(/(?:^|[\s(<])(https?:\/\/[^\s<>)\]]+)/g)) {
    const k = canonicalUrl(m[1].replace(/[.,;:!?]+$/, ''));
    if (!out.has(k)) out.set(k, 0);
  }
  return out;
}

/** `2026-10-14` → "14 Oct 2026"; other text (a provider's "3 days ago") stays as it is */
function dateText(s: string | undefined, locale: string): string | undefined {
  if (!s) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(s);
  if (!m) return s;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return Number.isNaN(+d) ? s : formatDate(locale, d, { dateStyle: 'medium', timeZone: 'UTC' });
}

function newestIso(hits: readonly { age?: string }[]): string | undefined {
  let best: string | undefined;
  for (const h of hits) {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(h.age ?? '');
    if (m && (!best || m[1] > best)) best = m[1];
  }
  return best;
}

function ageText(s: number, t: TFn): string {
  if (s < 90) return t('hermesTools.webCard.ageSeconds', { count: Math.max(0, Math.round(s)) });
  if (s < 90 * 60) return t('hermesTools.webCard.ageMinutes', { count: Math.round(s / 60) });
  if (s < 36 * 3600) return t('hermesTools.webCard.ageHours', { count: Math.round(s / 3600) });
  return t('hermesTools.webCard.ageDays', { count: Math.round(s / 86400) });
}

function outcomeText(outcome: string, t: TFn): string {
  const o = outcome.toLowerCase();
  if (o === 'success') return t('hermesTools.webCard.attempt.ok');
  if (o === 'partial') return t('hermesTools.webCard.attempt.partial');
  if (o === 'empty') return t('hermesTools.webCard.attempt.empty');
  if (o === 'failed' || o === 'error') return t('hermesTools.webCard.attempt.failed');
  if (o.startsWith('skipped')) return t('hermesTools.webCard.attempt.skipped');
  return outcome;
}

/** The card of one web tool event, or null (no web tool / nothing parsed). */
export function buildWebCard(msg: Pick<ChatMessage, 'text'>, ev: ToolEvent, t: TFn, locale: string): WebCard | null {
  const mode = webToolMode(ev);
  if (!mode || !hasWebCard(ev)) return null;
  const d = ev.detail ?? {};
  const w: ToolWebMeta = d.web ?? {};
  const input = toolInput(ev);
  const links = d.links ?? [];

  // ---- query / pages
  let query: string | undefined;
  let requested: string[] = [];
  if (mode === 'extract') {
    requested = (Array.isArray(input?.urls) ? input.urls : str(input?.url) ? [input?.url] : []).filter((u): u is string => typeof u === 'string' && isHttp(u));
    const hosts = [...new Set((requested.length ? requested : links.map((l) => l.url)).map(hostOf))];
    query = hosts.length ? hosts.slice(0, 3).join(', ') + (hosts.length > 3 ? ` +${hosts.length - 3}` : '') : undefined;
  } else {
    query = str(input?.query) ?? str(input?.q) ?? (ev.label && ev.label !== ev.name ? ev.label : undefined);
  }

  // ---- hits + cited markers
  const cites = citedUrls(msg.text ?? '');
  // WSP 5.1 answers one page per requested URL, in request order: the requested spelling counts as cited too
  const paired = mode === 'extract' && requested.length === links.length;
  const hits: WebCardHit[] = links
    .filter((l) => isHttp(l.url))
    .map((l, i) => {
      const keys = [canonicalUrl(l.url), ...(paired ? [canonicalUrl(requested[i])] : [])];
      const n = keys.map((k) => cites.get(k)).find((v) => v !== undefined);
      return {
        title: l.title || hostOf(l.url),
        url: l.url,
        domain: hostOf(l.url),
        ...(l.snippet && !l.failed ? { snippet: l.snippet } : {}),
        ...(l.age ? { date: dateText(l.age, locale) } : {}),
        ...(n !== undefined && !l.failed ? { cited: n } : {}),
        ...(l.failed ? { failed: l.failed } : {}),
      };
    });

  // ---- facts (label / value rows; only what the output really said)
  const facts: WebCardFact[] = [];
  const add = (key: string, label: TKey, value: string | undefined) => {
    if (value) facts.push({ key, label: t(label), value });
  };
  const explicit = str(input?.provider) && str(input?.provider)?.toLowerCase() !== 'auto';
  const provider = w.provider && w.provider !== 'research' ? providerName(w.provider) : explicit ? providerName(str(input?.provider) as string) : undefined;
  const how = w.auto ? t('hermesTools.webCard.auto') : explicit || w.auto === false ? t('hermesTools.webCard.explicit') : undefined;
  const conf = w.confidence === 'high' || w.confidence === 'medium' || w.confidence === 'low' ? t(`hermesTools.webCard.confidence.${w.confidence}`) : undefined;
  add('provider', 'hermesTools.webCard.provider', provider ? [provider, how, w.auto && conf ? conf : undefined].filter(Boolean).join(' · ') : undefined);
  if (w.queryType && QUERY_TYPES[w.queryType]) add('type', 'hermesTools.webCard.queryType', t(QUERY_TYPES[w.queryType]));
  if (w.attempts && w.attempts.length > 1) {
    add('attempts', 'hermesTools.webCard.attempts', w.attempts.map((a) => `${providerName(a.provider)}: ${outcomeText(a.outcome, t)}${a.ms !== undefined ? ` (${formatElapsed(a.ms, locale)})` : ''}`).join(' → '));
  } else if (w.fallbackFrom?.length && w.provider && w.provider !== 'research') {
    // WSP 5.1.2 `fallback_from=a,b` names the providers that failed before the serving one: "Serper → Brave → Exa"
    add('fallback', 'hermesTools.webCard.fallback', [...w.fallbackFrom, w.provider].map(providerName).join(' → '));
  }
  if (mode === 'research' && w.research) add('pages', 'hermesTools.webCard.pagesRead', formatNumber(locale, w.research.pages));
  if (mode === 'research' && w.providers?.length) add('providers', 'hermesTools.webCard.providersUsed', w.providers.map(providerName).join(', '));
  // the tool's own wall time (`elapsed_ms`, JSON `elapsed_ms`) beats the gap between the stored call and result rows
  const dur = w.elapsedMs ?? (ev.endedAt !== undefined && ev.endedAt > ev.startedAt ? ev.endedAt - ev.startedAt : undefined);
  add('duration', 'hermesTools.webCard.duration', dur !== undefined ? formatElapsed(dur, locale) : undefined);
  if (w.cached) add('cache', 'hermesTools.webCard.cache', w.cacheAgeS !== undefined ? t('hermesTools.webCard.cachedAge', { age: ageText(w.cacheAgeS, t) }) : t('hermesTools.web.cached'));
  else if (d.web && (w.provider || w.auto !== undefined)) add('cache', 'hermesTools.webCard.cache', t('hermesTools.webCard.live'));
  const fresh: string[] = [];
  if (w.freshness) {
    const req = FRESHNESS[w.freshness.requested.toLowerCase()] ? t(FRESHNESS[w.freshness.requested.toLowerCase()]) : w.freshness.requested;
    fresh.push(w.freshness.appliedBy?.length ? t('hermesTools.webCard.freshApplied', { filter: req, by: w.freshness.appliedBy.map(providerName).join(', ') }) : req);
  } else if (w.recency) fresh.push(t('hermesTools.webCard.recency'));
  const newest = newestIso(links);
  if (newest) fresh.push(t('hermesTools.webCard.newest', { date: dateText(newest, locale) ?? newest }));
  add('freshness', 'hermesTools.webCard.freshness', fresh.join(' · ') || undefined);

  const cited = hits.filter((h) => h.cited !== undefined).length;
  const rich = !!(w.provider || w.auto !== undefined || w.cached || w.research || w.attempts || w.freshness);
  return {
    mode,
    ...(query ? { query } : {}),
    ...(provider ? { provider } : {}),
    facts,
    hits,
    cited,
    ...(w.reportedCount !== undefined ? { reported: w.reportedCount } : {}),
    ...(w.error ? { error: w.error } : {}),
    ...(w.providerErrors?.length ? { providerErrors: w.providerErrors.map((p) => ({ provider: providerName(p.provider), reason: p.reason })) } : {}),
    rich,
  };
}
