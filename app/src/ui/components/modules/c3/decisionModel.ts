/**
 * `decision` – pure model (docs/SPEC-modules-v3.md): normalisation of (possibly partial) nodes,
 * weighted scores Σ w·s / Σ w (0–10), ranking with ties, per-criterion breakdown and the reply.
 * No React / native imports → node:test-able.
 */
import { fixed1, oneLine, tag, type NumLang } from './format.ts';

type Rec = Record<string, unknown>;

export const MAX_CRITERIA = 8;
export const MAX_OPTIONS = 6;
export const DEFAULT_WEIGHT = 5;

export type DecisionCriterion = { key: string; label: string; weight: number };
export type DecisionOption = { key: string; label: string; scores: Record<string, number>; note?: string };
export type DecisionModel = { id: string; title?: string; note?: string; criteria: DecisionCriterion[]; options: DecisionOption[] };

const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

export function clamp10(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(',', '.')) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(10, Math.max(0, n));
}

/** Unique key: explicit id or protocol fallback `<prefix><index>`; duplicates get a suffix. */
function uniqueKey(raw: string, fallback: string, used: Set<string>): string {
  let k = raw || fallback;
  let n = 2;
  while (used.has(k)) k = `${raw || fallback}~${n++}`;
  used.add(k);
  return k;
}

/** Tolerant normalisation; works on streaming partials (incomplete entries are skipped). */
export function normalizeDecision(node: unknown, fallbackId = 'decision'): DecisionModel {
  const n = isRec(node) ? node : {};
  const used = new Set<string>();
  const criteria: DecisionCriterion[] = [];
  for (const [i, c] of (Array.isArray(n.criteria) ? n.criteria : []).entries()) {
    if (!isRec(c)) continue;
    const label = str(c.label);
    if (!label) continue;
    criteria.push({ key: uniqueKey(str(c.id), `c${i}`, used), label, weight: Math.round(clamp10(c.weight) ?? DEFAULT_WEIGHT) });
    if (criteria.length >= MAX_CRITERIA) break;
  }
  // score keys may be criterion ids or labels (case-insensitive)
  const byLabel = new Map(criteria.map((c) => [c.label.toLowerCase(), c.key]));
  const byKey = new Set(criteria.map((c) => c.key));
  const usedO = new Set<string>();
  const options: DecisionOption[] = [];
  for (const [i, o] of (Array.isArray(n.options) ? n.options : []).entries()) {
    if (!isRec(o)) continue;
    const label = str(o.label);
    if (!label) continue;
    const scores: Record<string, number> = {};
    if (isRec(o.scores)) {
      for (const [k, v] of Object.entries(o.scores)) {
        const key = byKey.has(k) ? k : byLabel.get(k.trim().toLowerCase());
        const s = clamp10(v);
        if (key && s !== null) scores[key] = s;
      }
    }
    const note = str(o.note);
    options.push({ key: uniqueKey(str(o.id), `o${i}`, usedO), label, scores, ...(note ? { note } : {}) });
    if (options.length >= MAX_OPTIONS) break;
  }
  const title = str(n.title);
  const note = str(n.note);
  return { id: str(n.id) || fallbackId, ...(title ? { title } : {}), ...(note ? { note } : {}), criteria, options };
}

/** Effective weights: persisted override per criterion, else the node's weight. Clamped 0..10, integers. */
export function effectiveWeights(criteria: readonly DecisionCriterion[], saved: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of criteria) {
    const s = saved?.[c.key];
    out[c.key] = typeof s === 'number' && Number.isFinite(s) ? Math.round(Math.min(10, Math.max(0, s))) : c.weight;
  }
  return out;
}

/**
 * Σ w·s / Σ w over the criteria the option HAS a score for (a missing score neither helps nor hurts).
 * null when no weighted score exists (all relevant weights 0 / no scores).
 */
export function weightedScore(option: DecisionOption, criteria: readonly DecisionCriterion[], weights: Record<string, number>): number | null {
  let num = 0;
  let den = 0;
  for (const c of criteria) {
    const s = option.scores[c.key];
    const w = weights[c.key] ?? 0;
    if (typeof s !== 'number' || !(w > 0)) continue;
    num += w * s;
    den += w;
  }
  return den > 0 ? num / den : null;
}

/** Rounded to the displayed precision (1 decimal) – ties are decided on what the user sees. */
export const round1 = (v: number): number => Math.round(v * 10 + 1e-9) / 10;

export type RankedOption = {
  option: DecisionOption;
  /** original index (stable tie order) */
  index: number;
  score: number | null;
  /** competition rank: 1, 1, 3 … (null score → last, rank = count of scored + 1) */
  rank: number;
  winner: boolean;
};

/** Sort by rounded score desc; ties keep the original order and share a rank. */
export function rankOptions(options: readonly DecisionOption[], criteria: readonly DecisionCriterion[], weights: Record<string, number>): RankedOption[] {
  const rows = options.map((option, index) => {
    const raw = weightedScore(option, criteria, weights);
    return { option, index, score: raw === null ? null : round1(raw) };
  });
  rows.sort((a, b) => {
    if (a.score === null || b.score === null) return a.score === b.score ? a.index - b.index : a.score === null ? 1 : -1;
    return b.score - a.score || a.index - b.index;
  });
  const top = rows[0]?.score ?? null;
  let prev: number | null | undefined;
  let rank = 0;
  return rows.map((r, i) => {
    if (r.score !== prev) rank = i + 1;
    prev = r.score;
    return { ...r, rank, winner: top !== null && r.score === top };
  });
}

export type BreakdownRow = { key: string; label: string; weight: number; score: number | null; /** points contributed to the total (w·s/Σw) */ contribution: number | null; share: number };

/** Per-criterion breakdown of one option; contributions sum to its weighted score. */
export function breakdown(option: DecisionOption, criteria: readonly DecisionCriterion[], weights: Record<string, number>): BreakdownRow[] {
  let den = 0;
  for (const c of criteria) if (typeof option.scores[c.key] === 'number' && (weights[c.key] ?? 0) > 0) den += weights[c.key];
  return criteria.map((c) => {
    const s = option.scores[c.key];
    const w = weights[c.key] ?? 0;
    const has = typeof s === 'number';
    const contribution = has && den > 0 && w > 0 ? (w * s) / den : has ? 0 : null;
    return { key: c.key, label: c.label, weight: w, score: has ? s : null, contribution, share: den > 0 && has && w > 0 ? w / den : 0 };
  });
}

/**
 * `[decision:<id>] Gewinner: Wohnung B (7,8) · Gewichte: Preis 8, Lage 6, …` (protocol: German).
 * Tie: `Gleichstand: A, B (7,8)`. null when nothing can be decided yet.
 */
export function decisionReply(model: DecisionModel, weights: Record<string, number>, lang: NumLang = 'de'): string | null {
  const ranked = rankOptions(model.options, model.criteria, weights);
  const winners = ranked.filter((r) => r.winner);
  if (!winners.length || winners[0].score === null) return null;
  const names = winners.map((w) => oneLine(w.option.label)).join(', ');
  const head = winners.length > 1 ? `Gleichstand: ${names}` : `Gewinner: ${names}`;
  const ws = model.criteria.map((c) => `${oneLine(c.label)} ${weights[c.key] ?? c.weight}`).join(', ');
  return `${tag('decision', model.id)} ${head} (${fixed1(winners[0].score, lang)}) · Gewichte: ${ws}`;
}
