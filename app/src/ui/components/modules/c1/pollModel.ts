/**
 * `poll` node model (docs/SPEC-modules-v3.md): option/voter reading, vote state transitions,
 * tallying (rounded shares sum to 100 % for single choice), pass-the-phone voter flow and the
 * reply message. Pure (no React / RN) → node:test-able.
 *
 * The reply is PROTOCOL (machine tag + readable German text, like modules-a replies.ts) and is not
 * translated: `[poll:<id>] Pizza 3 · Sushi 1 (4 Stimmen)`.
 */
import { oneLine } from '../a/replies.ts';

export type PollOption = { id: string; label: string; emoji?: string; added?: boolean };

export type PollNode = {
  question: string;
  options: PollOption[];
  multiple: boolean;
  /** unique, trimmed pass-the-phone names (≤ 12); empty → anonymous ballot mode */
  voters: string[];
  allowAdd: boolean;
  anonymous: boolean;
};

/** Persisted state (useNodeState). */
export type PollState = {
  status: 'open' | 'sent';
  /** voter name → chosen option ids. Ballot mode (no `voters`): keys `#1`, `#2`, … */
  votes: Record<string, string[]>;
  /** options added by the users (allowAdd) */
  added: PollOption[];
  /** pass-the-phone: name currently voting (null → name picker / hand-off screen) */
  active: string | null;
  /** hand-off suggestion after a vote ("Gib das Handy an Ben") */
  next: string | null;
  /** ballot counter (ballot mode) */
  seq: number;
  /** last sent reply */
  sentText?: string;
};

export const MAX_VOTERS = 12;
export const MAX_OPTIONS = 12;
export const MAX_LABEL = 60;

export const INITIAL_POLL_STATE: PollState = { status: 'open', votes: {}, added: [], active: null, next: null, seq: 0 };

function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
}

/** Read a raw/partial node defensively (option ids: explicit or `o<index>`, de-duplicated). */
export function readPoll(node: unknown): PollNode {
  const n = node && typeof node === 'object' && !Array.isArray(node) ? (node as Record<string, unknown>) : {};
  const seen = new Set<string>();
  const options: PollOption[] = [];
  (Array.isArray(n.options) ? n.options : []).forEach((raw, i) => {
    const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : typeof raw === 'string' ? { label: raw } : null;
    if (!o) return;
    const label = oneLine(str(o.label));
    if (!label) return;
    let id = oneLine(str(o.id)) || `o${i}`;
    while (seen.has(id)) id = `${id}_`;
    seen.add(id);
    const emoji = oneLine(str(o.emoji)).slice(0, 16);
    options.push({ id, label, ...(emoji ? { emoji } : {}) });
  });
  const names: string[] = [];
  for (const v of Array.isArray(n.voters) ? n.voters : []) {
    const name = oneLine(str(v)).slice(0, 40);
    if (name && !names.some((x) => x.toLowerCase() === name.toLowerCase()) && names.length < MAX_VOTERS) names.push(name);
  }
  return {
    question: oneLine(str(n.question)),
    options,
    multiple: n.multiple === true,
    voters: names,
    allowAdd: n.allowAdd === true,
    anonymous: n.anonymous === true,
  };
}

export function allOptions(node: PollNode, st: Pick<PollState, 'added'>): PollOption[] {
  const ids = new Set(node.options.map((o) => o.id));
  return [...node.options, ...st.added.filter((a) => !ids.has(a.id))];
}

/* ───────────── draft / votes ───────────── */

/** Tap on an option while voting: single → replace (tap again clears), multiple → toggle. */
export function toggleDraft(draft: readonly string[], id: string, multiple: boolean): string[] {
  if (!multiple) return draft.length === 1 && draft[0] === id ? [] : [id];
  return draft.includes(id) ? draft.filter((x) => x !== id) : [...draft, id];
}

function cleanIds(ids: readonly string[], valid: readonly PollOption[], multiple: boolean): string[] {
  const ok = new Set(valid.map((o) => o.id));
  const out = [...new Set(ids)].filter((x) => ok.has(x));
  return multiple ? out : out.slice(0, 1);
}

/** Store a voter's choice (empty choice = remove the vote). */
export function setVote(st: PollState, voter: string, ids: readonly string[], options: readonly PollOption[], multiple: boolean): PollState {
  const clean = cleanIds(ids, options, multiple);
  const votes = { ...st.votes };
  if (clean.length) votes[voter] = clean;
  else delete votes[voter];
  return { ...st, votes };
}

/** Ballot mode: add one anonymous ballot `#<seq>`. Empty → unchanged. */
export function castBallot(st: PollState, ids: readonly string[], options: readonly PollOption[], multiple: boolean): PollState {
  const clean = cleanIds(ids, options, multiple);
  if (!clean.length) return st;
  const seq = st.seq + 1;
  return { ...st, seq, votes: { ...st.votes, [`#${seq}`]: clean } };
}

/** Ballot mode: take back the most recent ballot. */
export function undoLastBallot(st: PollState): PollState {
  const keys = Object.keys(st.votes).filter((k) => k.startsWith('#'));
  if (!keys.length) return st;
  const last = keys.reduce((a, b) => (Number(b.slice(1)) > Number(a.slice(1)) ? b : a));
  const votes = { ...st.votes };
  delete votes[last];
  return { ...st, votes };
}

/* ───────────── pass-the-phone voter flow ───────────── */

/** First voter after `after` (wrapping) who has not voted yet; null when everyone voted. */
export function nextVoter(voters: readonly string[], votes: Readonly<Record<string, string[]>>, after: string | null): string | null {
  if (!voters.length) return null;
  const start = after ? voters.indexOf(after) + 1 : 0;
  for (let i = 0; i < voters.length; i++) {
    const v = voters[(start + i) % voters.length];
    if (v !== after && !votes[v]?.length) return v;
  }
  return null;
}

export type VoterPhase = 'pick' | 'handoff' | 'vote' | 'done';

/** Which screen the pass-the-phone flow shows. */
export function voterPhase(voters: readonly string[], st: Pick<PollState, 'active' | 'next' | 'votes'>): VoterPhase {
  if (st.active && voters.includes(st.active)) return 'vote';
  if (voters.length && voters.every((v) => st.votes[v]?.length)) return 'done';
  if (st.next && voters.includes(st.next) && !st.votes[st.next]?.length) return 'handoff';
  return 'pick';
}

/** Start voting as `name` (from the name chips or "Ich bin Ben"). */
export function startVoting(st: PollState, name: string): PollState {
  return { ...st, active: name, next: null };
}

/** Finish `st.active`'s vote and suggest the next voter. */
export function finishVoting(st: PollState, ids: readonly string[], node: PollNode, options: readonly PollOption[]): PollState {
  const who = st.active;
  if (!who) return st;
  const voted = setVote(st, who, ids, options, node.multiple);
  return { ...voted, active: null, next: nextVoter(node.voters, voted.votes, who) };
}

export function cancelVoting(st: PollState): PollState {
  return { ...st, active: null };
}

/* ───────────── added options ───────────── */

export type AddResult = { state: PollState; error?: 'empty' | 'exists' | 'max'; id?: string };

/** "🍕 Pizza" → {emoji:'🍕', label:'Pizza'} (leading emoji split off), else the plain label. */
export function splitEmoji(input: string): { label: string; emoji?: string } {
  const s = oneLine(input);
  const m = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*)\s*(.+)$/u.exec(s);
  return m ? { emoji: m[1], label: m[2].trim() } : { label: s };
}

export function addOption(st: PollState, node: PollNode, input: string): AddResult {
  const { label: raw, emoji } = splitEmoji(input);
  const label = raw.slice(0, MAX_LABEL).trim();
  if (!label) return { state: st, error: 'empty' };
  const opts = allOptions(node, st);
  if (opts.some((o) => o.label.toLowerCase() === label.toLowerCase())) return { state: st, error: 'exists' };
  if (opts.length >= MAX_OPTIONS) return { state: st, error: 'max' };
  const used = new Set(opts.map((o) => o.id));
  let k = st.added.length + 1;
  while (used.has(`a${k}`)) k++;
  const id = `a${k}`;
  return { state: { ...st, added: [...st.added, { id, label, ...(emoji ? { emoji } : {}), added: true }] }, id };
}

/** Remove a user-added option (and its votes; voters left without a choice lose their vote). */
export function removeOption(st: PollState, id: string): PollState {
  if (!st.added.some((a) => a.id === id)) return st;
  const votes: Record<string, string[]> = {};
  for (const [k, ids] of Object.entries(st.votes)) {
    const rest = ids.filter((x) => x !== id);
    if (rest.length) votes[k] = rest;
  }
  return { ...st, added: st.added.filter((a) => a.id !== id), votes };
}

/* ───────────── tally ───────────── */

export type TallyRow = PollOption & { count: number; percent: number; voters: string[] };
export type Tally = {
  rows: TallyRow[];
  /** people / ballots with at least one valid choice */
  participants: number;
  /** sum of all counts (= participants for single choice) */
  totalVotes: number;
  /** ids with the highest count (> 0); several → tie */
  leaders: string[];
  max: number;
};

/**
 * Integer percentages. Single choice: shares of all votes via largest remainder, so they sum to
 * exactly 100. Multiple: share of participants who picked the option (may sum to > 100).
 */
export function percentages(counts: readonly number[], base: number, sumTo100: boolean): number[] {
  if (base <= 0) return counts.map(() => 0);
  const exact = counts.map((c) => (c / base) * 100);
  if (!sumTo100) return exact.map((x) => Math.round(x));
  const floor = exact.map(Math.floor);
  let rest = 100 - floor.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (rest <= 0) break;
    if (counts[i] > 0) {
      floor[i]++;
      rest--;
    }
  }
  return floor;
}

export function tally(options: readonly PollOption[], votes: Readonly<Record<string, string[]>>, multiple: boolean): Tally {
  const valid = new Set(options.map((o) => o.id));
  const counts = new Map<string, string[]>(options.map((o) => [o.id, []]));
  let participants = 0;
  for (const [who, ids] of Object.entries(votes)) {
    const mine = [...new Set(ids)].filter((x) => valid.has(x));
    const used = multiple ? mine : mine.slice(0, 1);
    if (!used.length) continue;
    participants++;
    for (const id of used) counts.get(id)?.push(who);
  }
  const cs = options.map((o) => counts.get(o.id)?.length ?? 0);
  const totalVotes = cs.reduce((a, b) => a + b, 0);
  const pct = percentages(cs, multiple ? participants : totalVotes, !multiple);
  const max = Math.max(0, ...cs);
  const rows = options.map((o, i) => ({ ...o, count: cs[i], percent: pct[i], voters: counts.get(o.id) ?? [] }));
  return { rows, participants, totalVotes, max, leaders: max > 0 ? rows.filter((r) => r.count === max).map((r) => r.id) : [] };
}

/** Rows ordered for the reply: count desc, ties in option order. */
export function rankedRows(t: Tally): TallyRow[] {
  return t.rows.map((r, i) => ({ r, i })).sort((a, b) => b.r.count - a.r.count || a.i - b.i).map((x) => x.r);
}

/* ───────────── reply ───────────── */

/**
 * `[poll:<id>] Pizza 3 · Sushi 1 · Burger 0 (4 Stimmen)`.
 * Multiple choice: `(5 Stimmen · 3 Personen)`. Named, non-anonymous voters are appended:
 * ` — Anna: Pizza; Ben: Pizza, Sushi`.
 */
export function pollReply(id: string, node: Pick<PollNode, 'multiple' | 'voters' | 'anonymous'>, t: Tally): string {
  const head = `[poll:${oneLine(id) || 'poll'}]`;
  const parts = rankedRows(t).map((r) => `${r.label} ${r.count}`);
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const count = node.multiple
    ? `(${n(t.totalVotes, 'Stimme', 'Stimmen')} · ${n(t.participants, 'Person', 'Personen')})`
    : `(${n(t.totalVotes, 'Stimme', 'Stimmen')})`;
  let out = `${head} ${parts.join(' · ')} ${count}`;
  if (node.voters.length && !node.anonymous) {
    const label = new Map(t.rows.map((r) => [r.id, r.label]));
    const who = node.voters
      .map((v) => {
        const picks = t.rows.filter((r) => r.voters.includes(v)).map((r) => label.get(r.id) ?? r.id);
        return picks.length ? `${v}: ${picks.join(', ')}` : '';
      })
      .filter(Boolean);
    if (who.length) out += ` — ${who.join('; ')}`;
  }
  return out;
}
