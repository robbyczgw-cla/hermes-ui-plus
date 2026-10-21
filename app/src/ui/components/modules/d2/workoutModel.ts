/**
 * `workout` node model (pure): normalisation, set progress, summary lines and the reply text.
 * Reply tags/keywords are PROTOCOL (German, not translated).
 */
import { oneLine } from '../a/replies.ts';
import { validSeconds, wholeMinutes } from './timerEngine.ts';

export const MAX_EXERCISES = 20;
export const MAX_SETS = 20;
export const DEFAULT_REST_SECONDS = 60;

export type WorkoutKind = 'strength' | 'cardio' | 'mobility' | 'mixed';

export type Exercise = {
  key: string;
  name: string;
  sets: number;
  reps?: string;
  seconds?: number;
  weight?: string;
  /** 0 = no rest timer */
  restSeconds: number;
  note?: string;
  imageQuery?: string;
};

export type WorkoutModel = { title: string; kind?: WorkoutKind; note?: string; warmup?: string; cooldown?: string; exercises: Exercise[] };

/** Per-set state. `reps`/`weight` override the plan values when edited. */
export type SetEntry = { done?: boolean; reps?: string; weight?: string };
export type SetsState = Record<string, SetEntry[] | undefined>;

const str = (v: unknown) => (typeof v === 'string' ? oneLine(v) : '');

export function normalizeWorkout(node: Record<string, unknown>): WorkoutModel {
  const exercises: Exercise[] = [];
  const used = new Set<string>();
  const raw = Array.isArray(node.exercises) ? node.exercises : [];
  for (const e of raw) {
    if (exercises.length >= MAX_EXERCISES) break;
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    const name = str(o.name).slice(0, 80);
    if (!name) continue;
    let key = str(o.id) || `e${exercises.length}`;
    for (let n = 2; used.has(key); n++) key = `${str(o.id) || `e${exercises.length}`}-${n}`;
    used.add(key);
    const sets = typeof o.sets === 'number' && Number.isFinite(o.sets) ? Math.min(MAX_SETS, Math.max(1, Math.round(o.sets))) : 1;
    const ex: Exercise = { key, name, sets, restSeconds: o.restSeconds === 0 ? 0 : (validSeconds(o.restSeconds) ?? DEFAULT_REST_SECONDS) };
    const reps = typeof o.reps === 'number' && Number.isFinite(o.reps) && o.reps > 0 ? String(Math.round(o.reps)) : str(o.reps).slice(0, 20);
    if (reps) ex.reps = reps;
    const sec = validSeconds(o.seconds);
    if (sec) ex.seconds = sec;
    const weight = str(o.weight).slice(0, 24);
    if (weight) ex.weight = weight;
    const note = str(o.note).slice(0, 300);
    if (note) ex.note = note;
    const iq = str(o.imageQuery).slice(0, 120);
    if (iq) ex.imageQuery = iq;
    exercises.push(ex);
  }
  const m: WorkoutModel = { title: str(node.title).slice(0, 120), exercises };
  if (node.kind === 'strength' || node.kind === 'cardio' || node.kind === 'mobility' || node.kind === 'mixed') m.kind = node.kind;
  const note = typeof node.note === 'string' ? node.note.trim().slice(0, 400) : '';
  if (note) m.note = note;
  const warm = typeof node.warmup === 'string' ? node.warmup.trim().slice(0, 600) : '';
  if (warm) m.warmup = warm;
  const cool = typeof node.cooldown === 'string' ? node.cooldown.trim().slice(0, 600) : '';
  if (cool) m.cooldown = cool;
  return m;
}

/** The (planned) sets of an exercise merged with the user's entries. */
export function setsOf(ex: Exercise, state: SetsState): SetEntry[] {
  const cur = state[ex.key] ?? [];
  return Array.from({ length: ex.sets }, (_, i) => cur[i] ?? {});
}

export function patchSet(state: SetsState, ex: Exercise, index: number, patch: SetEntry): SetsState {
  if (index < 0 || index >= ex.sets) return state;
  const list = setsOf(ex, state).slice();
  list[index] = { ...list[index], ...patch };
  return { ...state, [ex.key]: list };
}

/** Toggle a set; returns the new state and whether it is now done. */
export function toggleSet(state: SetsState, ex: Exercise, index: number): { state: SetsState; done: boolean } {
  const cur = setsOf(ex, state)[index];
  if (!cur) return { state, done: false };
  const done = !cur.done;
  return { state: patchSet(state, ex, index, { done }), done };
}

export function doneSets(ex: Exercise, state: SetsState): number {
  return setsOf(ex, state).filter((s) => s.done).length;
}

export function totals(m: WorkoutModel, state: SetsState): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const ex of m.exercises) {
    total += ex.sets;
    done += doneSets(ex, state);
  }
  return { done, total };
}

/** Is this the very last open set of the whole workout (→ no rest timer after it)? */
export function isLastOpenSet(m: WorkoutModel, state: SetsState): boolean {
  const { done, total } = totals(m, state);
  return done >= total;
}

/** Effective reps / weight of a set (edited value, else the plan). */
export function setReps(ex: Exercise, s: SetEntry): string | undefined {
  return (s.reps ?? '').trim() || ex.reps;
}
export function setWeight(ex: Exercise, s: SetEntry): string | undefined {
  return (s.weight ?? '').trim() || ex.weight;
}

/** "kg" when the plan weight is a bare number. */
function withUnit(w: string): string {
  return /^\d+(?:[.,]\d+)?$/.test(w) ? `${w} kg` : w;
}

/**
 * Done sets of one exercise as "3×10 @ 60 kg", "10/8/8 @ 60/62,5 kg", "3×45 s", "2 Sätze" (no reps).
 * Empty string when nothing was done.
 */
export function exerciseLine(ex: Exercise, state: SetsState): string {
  const done = setsOf(ex, state).filter((s) => s.done);
  if (!done.length) return '';
  const reps = done.map((s) => setReps(ex, s) ?? '');
  const sameReps = reps.every((r) => r === reps[0]);
  let core: string;
  if (sameReps && reps[0]) core = `${done.length}×${reps[0]}`;
  else if (!reps.some(Boolean)) core = ex.seconds ? `${done.length}×${ex.seconds} s` : done.length === 1 ? '1 Satz' : `${done.length} Sätze`;
  else core = reps.map((r) => r || '–').join('/');
  const weights = done.map((s) => setWeight(ex, s)).filter((w): w is string => !!w);
  const uniqW = weights.filter((w, i) => weights.indexOf(w) === i);
  if (!uniqW.length) return core;
  if (uniqW.length === 1) return `${core} @ ${withUnit(uniqW[0])}`;
  const nums = uniqW.every((w) => /^\d+(?:[.,]\d+)?(?:\s*kg)?$/i.test(w));
  return nums ? `${core} @ ${uniqW.map((w) => w.replace(/\s*kg$/i, '')).join('/')} kg` : `${core} @ ${uniqW.join('/')}`;
}

export type SummaryRow = { key: string; name: string; done: number; total: number; line: string };

export function summaryRows(m: WorkoutModel, state: SetsState): SummaryRow[] {
  return m.exercises.map((ex) => ({ key: ex.key, name: ex.name, done: doneSets(ex, state), total: ex.sets, line: exerciseLine(ex, state) }));
}

const MAX_REPLY = 700;

/** `[workout:<id>] 18/20 Sätze · 42 min · Kniebeuge 3×10 @ 60 kg · …` */
export function workoutReply(id: string, m: WorkoutModel, state: SetsState, durationMs: number): string {
  const { done, total } = totals(m, state);
  const head = `[workout:${oneLine(id) || 'workout'}] ${done}/${total} Sätze`;
  const parts = [head];
  const min = wholeMinutes(durationMs);
  if (min > 0) parts.push(`${min} min`);
  let out = parts.join(' · ');
  const rows = summaryRows(m, state).filter((r) => r.line);
  const skipped = m.exercises.length - rows.length;
  for (const r of rows) {
    const piece = ` · ${r.name} ${r.line}`;
    if (out.length + piece.length > MAX_REPLY) {
      out += ' …';
      return out;
    }
    out += piece;
  }
  if (skipped > 0 && done > 0) out += ` · ausgelassen: ${m.exercises.filter((e) => doneSets(e, state) === 0).map((e) => e.name).join(', ')}`.slice(0, Math.max(0, MAX_REPLY - out.length));
  return out;
}
