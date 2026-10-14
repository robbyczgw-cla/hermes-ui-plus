/**
 * Model picker search, grouping, favorites and recents. Pure (node-tested), no React.
 *
 * - `scoreEntry`: every whitespace-separated query token must match id, label or group; exact /
 *   prefix / word-boundary substring hits beat in-word hits, which beat fuzzy subsequences
 *   ("gpt5m" → "gpt-5-mini"). Higher = better, null = no match.
 * - `buildRows`: empty query → pinned (default) entries, favorites, recents, then one section per
 *   group (provider prefix `anthropic/` or Hermes provider name). With a query → one ranked list.
 * - favorites / recents per profile (`ModelPrefs`), persisted by useModelPrefs.
 */

export type ModelBadge = 'vision' | 'tools' | 'reasoning' | 'web' | 'fast';

export type ModelEntry = {
  /** value handed to onPick; undefined = server / profile default */
  id: string | undefined;
  label: string;
  /** second line (raw id, context size, "nicht mehr gelistet", …) */
  detail?: string;
  /** section title when the list is grouped */
  group?: string;
  badges?: ModelBadge[];
  /** always on top, never part of favorites / recents (the "Standard" row) */
  pinned?: boolean;
  /** listed but not usable with this connection (OpenCode Go models on other APIs) */
  disabled?: boolean;
};

export type ModelPrefs = { favorites: string[]; recents: string[] };

export const EMPTY_PREFS: ModelPrefs = { favorites: [], recents: [] };
export const MAX_RECENTS = 6;
export const MAX_FAVORITES = 50;

// ── favorites / recents ───────────────────────────────────────────────────────────────────────────

export function toggleFavorite(prefs: ModelPrefs, id: string): ModelPrefs {
  const has = prefs.favorites.includes(id);
  const favorites = has ? prefs.favorites.filter((x) => x !== id) : [id, ...prefs.favorites].slice(0, MAX_FAVORITES);
  return { ...prefs, favorites };
}

/** most recent first, unique, capped; the "Standard" pick (undefined) is not recorded */
export function pushRecent(prefs: ModelPrefs, id: string | undefined, max = MAX_RECENTS): ModelPrefs {
  if (!id) return prefs;
  if (prefs.recents[0] === id) return prefs;
  return { ...prefs, recents: [id, ...prefs.recents.filter((x) => x !== id)].slice(0, max) };
}

/** last model used with this profile (= newest recent) */
export function lastModel(prefs: ModelPrefs): string | undefined {
  return prefs.recents[0];
}

export function parsePrefs(raw: string | null | undefined): ModelPrefs {
  if (!raw) return EMPTY_PREFS;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof ModelPrefs, unknown>>;
    const list = (x: unknown, max: number) =>
      Array.isArray(x) ? Array.from(new Set(x.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length < 300))).slice(0, max) : [];
    return { favorites: list(v.favorites, MAX_FAVORITES), recents: list(v.recents, MAX_RECENTS) };
  } catch {
    return EMPTY_PREFS;
  }
}

// ── grouping ──────────────────────────────────────────────────────────────────────────────────────

/** `anthropic/claude-…` → `anthropic`; ids without a vendor prefix → undefined */
export function vendorPrefix(id: string): string | undefined {
  const i = id.indexOf('/');
  return i > 0 ? id.slice(0, i) : undefined;
}

// ── fuzzy search ──────────────────────────────────────────────────────────────────────────────────

export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

const BOUNDARY = /[\s/:._\-()[\],]/;

/** score of one token against one text; 0 = no match */
export function tokenScore(token: string, text: string): number {
  if (!token) return 1;
  if (!text) return 0;
  if (text === token) return 120;
  const i = text.indexOf(token);
  if (i === 0) return 100 - Math.min(20, text.length - token.length) * 0.2;
  if (i > 0) {
    // the best occurrence: a word start beats an in-word hit
    let at = i;
    while (at >= 0) {
      if (BOUNDARY.test(text[at - 1])) return 80 - Math.min(20, at) * 0.3;
      at = text.indexOf(token, at + 1);
    }
    return 55 - Math.min(20, i) * 0.3;
  }
  // subsequence with bonus for consecutive / boundary hits; separators in the token are optional
  const tk = token.replace(/[\s/:._-]+/g, '');
  if (!tk) return 0;
  let ti = 0;
  let score = 0;
  let run = 0;
  for (let k = 0; k < text.length && ti < tk.length; k++) {
    if (text[k] === tk[ti]) {
      run++;
      score += 1 + run + (k === 0 || BOUNDARY.test(text[k - 1]) ? 3 : 0);
      ti++;
    } else {
      run = 0;
    }
  }
  if (ti < tk.length) return 0;
  // normalise into 10…45, so any substring hit ranks above a fuzzy one
  return 10 + Math.min(35, (score / (tk.length * 6)) * 35);
}

/** null = no match */
export function scoreEntry(entry: Pick<ModelEntry, 'id' | 'label' | 'group'>, query: string): number | null {
  const tokens = normalizeText(query).trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  const id = normalizeText(entry.id ?? '');
  const label = normalizeText(entry.label);
  const group = normalizeText(entry.group ?? '');
  let total = 0;
  for (const tk of tokens) {
    const s = Math.max(tokenScore(tk, id), tokenScore(tk, label), tokenScore(tk, group) * 0.6);
    if (s <= 0) return null;
    total += s;
  }
  return total / tokens.length;
}

/** matching entries, best first (ties: favorites, then shorter id, then alphabetical) */
export function rankEntries(entries: readonly ModelEntry[], query: string, favorites: readonly string[] = []): ModelEntry[] {
  const fav = new Set(favorites);
  const scored: { e: ModelEntry; s: number }[] = [];
  for (const e of entries) {
    const s = scoreEntry(e, query);
    if (s === null) continue;
    scored.push({ e, s: s + (e.id && fav.has(e.id) ? 4 : 0) - (e.disabled ? 30 : 0) });
  }
  scored.sort((a, b) => b.s - a.s || (a.e.id ?? '').length - (b.e.id ?? '').length || (a.e.id ?? '').localeCompare(b.e.id ?? ''));
  return scored.map((x) => x.e);
}

// ── rows for the virtualised list ─────────────────────────────────────────────────────────────────

export type ModelRow =
  | { type: 'header'; key: string; title: string; count?: number }
  | { type: 'model'; key: string; entry: ModelEntry; favorite: boolean };

export type RowTitles = { favorites: string; recents: string; other: string };

/** Drops repeated (group, id) pairs, keeping the first. The same id under another provider is kept. */
export function dedupeEntries(entries: readonly ModelEntry[]): ModelEntry[] {
  const seen = new Set<string>();
  const out: ModelEntry[] = [];
  for (const e of entries) {
    if (e.id === undefined) {
      out.push(e);
      continue;
    }
    const k = `${e.group ?? ''}\u0000${e.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

/**
 * Search result rows: ranked, but still sectioned by group (header + count) so the provider stays
 * visible. Groups are ordered by their best hit; pinned entries come first without a header. A model
 * name that occurs in several providers gets the provider in its detail line.
 */
export function searchRows(ranked: readonly ModelEntry[], prefs: ModelPrefs, titles: RowTitles): ModelRow[] {
  const fav = new Set(prefs.favorites);
  const labelCount = new Map<string, number>();
  for (const e of ranked) labelCount.set(e.label, (labelCount.get(e.label) ?? 0) + 1);
  const out: ModelRow[] = [];
  const mk = (e: ModelEntry, section: string): ModelRow => {
    const dup = (labelCount.get(e.label) ?? 0) > 1 && e.group;
    const entry = dup ? { ...e, detail: [e.group, e.detail].filter(Boolean).join(' · ') } : e;
    return { type: 'model', key: `${section}:${e.id ?? '__default'}`, entry, favorite: !!e.id && fav.has(e.id) };
  };
  for (const e of ranked) if (e.pinned) out.push(mk(e, 'pin'));
  const groups = new Map<string, ModelEntry[]>();
  for (const e of ranked) {
    if (e.pinned) continue;
    const g = e.group ?? '';
    const list = groups.get(g);
    if (list) list.push(e);
    else groups.set(g, [e]);
  }
  const named = [...groups.keys()].some((g) => g);
  for (const [g, list] of groups) {
    if (named) out.push({ type: 'header', key: `h:q:${g}`, title: g || titles.other, count: list.length });
    for (const e of list) out.push(mk(e, `q:${g}`));
  }
  return out;
}

/**
 * Flat row list (section headers + models) for a FlatList. Empty query: pinned entries first, then
 * favorites, recents (those not already favorites), then groups in first-seen order (entries without
 * group under `titles.other`, or without a header when nothing is grouped). A model may appear in
 * favorites/recents AND in its group; row keys stay unique.
 */
export function buildRows(entries: readonly ModelEntry[], query: string, prefs: ModelPrefs, titles: RowTitles): ModelRow[] {
  const fav = new Set(prefs.favorites);
  const row = (e: ModelEntry, section: string): ModelRow => ({ type: 'model', key: `${section}:${e.id ?? '__default'}`, entry: e, favorite: !!e.id && fav.has(e.id) });
  if (query.trim()) return searchRows(rankEntries(dedupeEntries(entries), query, prefs.favorites), prefs, titles);

  const out: ModelRow[] = [];
  const byId = new Map<string, ModelEntry>();
  for (const e of entries) if (e.id && !byId.has(e.id)) byId.set(e.id, e);
  for (const e of entries) if (e.pinned) out.push(row(e, 'pin'));

  const favs = prefs.favorites.map((id) => byId.get(id)).filter((e): e is ModelEntry => !!e && !e.pinned);
  if (favs.length) {
    out.push({ type: 'header', key: 'h:fav', title: titles.favorites, count: favs.length });
    for (const e of favs) out.push(row(e, 'fav'));
  }
  const recents = prefs.recents
    .filter((id) => !fav.has(id))
    .map((id) => byId.get(id))
    .filter((e): e is ModelEntry => !!e && !e.pinned);
  if (recents.length) {
    out.push({ type: 'header', key: 'h:recent', title: titles.recents, count: recents.length });
    for (const e of recents) out.push(row(e, 'recent'));
  }

  const rest = dedupeEntries(entries).filter((e) => !e.pinned);
  const groups = new Map<string, ModelEntry[]>();
  for (const e of rest) {
    const g = e.group ?? '';
    const list = groups.get(g);
    if (list) list.push(e);
    else groups.set(g, [e]);
  }
  const named = [...groups.keys()].some((g) => g);
  const showHeaders = named || favs.length > 0 || recents.length > 0;
  for (const [g, list] of groups) {
    if (showHeaders) out.push({ type: 'header', key: `h:g:${g}`, title: g || titles.other, count: list.length });
    for (const e of list) out.push(row(e, `g:${g}`));
  }
  return out;
}

/** index of the next selectable model row from `from` in direction `dir` (keyboard navigation) */
export function nextModelRow(rows: readonly ModelRow[], from: number, dir: 1 | -1): number {
  for (let i = from + dir; i >= 0 && i < rows.length; i += dir) {
    const r = rows[i];
    if (r.type === 'model' && !r.entry.disabled) return i;
  }
  return from;
}

// ── formatting ────────────────────────────────────────────────────────────────────────────────────

/** 200000 → "200K", 1048576 → "1M" */
export function formatContext(tokens: number | undefined): string {
  if (!tokens || tokens <= 0) return '';
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${m >= 10 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}
