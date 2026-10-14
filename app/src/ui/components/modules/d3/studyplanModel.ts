/**
 * `studyplan` logic (docs/SPEC-modules-v4.md): defensive reader (same id scheme as normalizeNode,
 * so raw gallery/partial nodes and normalized nodes key the same), progress, "Heute" target,
 * reply text. Pure (node:test).
 */
import type { HuiStudyTaskKind } from '../../../types';
import { oneLine } from '../a/replies.ts';

type Rec = Record<string, unknown>;

export type StudyTask = { id: string; text: string; minutes?: number; kind?: HuiStudyTaskKind };
export type StudyDay = { id: string; label: string; tasks: StudyTask[] };
export type StudyWeek = { id: string; label: string; days: StudyDay[] };
export type StudyPlanModel = { title: string; goal?: string; weeks: StudyWeek[] };

const KINDS: readonly HuiStudyTaskKind[] = ['learn', 'practice', 'review', 'test'];

const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

export function readStudyPlan(node: Rec | null | undefined): StudyPlanModel {
  const n = node ?? {};
  const weeks: StudyWeek[] = [];
  const seen = new Set<string>();
  const uniq = (id: string) => {
    let k = id;
    let i = 2;
    while (seen.has(k)) k = `${id}~${i++}`;
    seen.add(k);
    return k;
  };
  const rawW = Array.isArray(n.weeks) ? n.weeks : [];
  rawW.forEach((w, wi) => {
    if (!isRec(w)) return;
    const days: StudyDay[] = [];
    (Array.isArray(w.days) ? w.days : []).forEach((d, di) => {
      if (!isRec(d)) return;
      const tasks: StudyTask[] = [];
      (Array.isArray(d.tasks) ? d.tasks : []).forEach((t, ti) => {
        const r: Rec = isRec(t) ? t : {};
        const text = typeof t === 'string' ? str(t) : str(r.text);
        if (!text) return;
        const task: StudyTask = { id: uniq(str(r.id) || `t${wi}-${di}-${ti}`), text };
        const m = typeof r.minutes === 'number' && Number.isFinite(r.minutes) ? Math.round(r.minutes) : 0;
        if (m >= 1) task.minutes = Math.min(1440, m);
        if (KINDS.includes(r.kind as HuiStudyTaskKind)) task.kind = r.kind as HuiStudyTaskKind;
        tasks.push(task);
      });
      const label = str(d.label);
      if (!label && !tasks.length) return;
      days.push({ id: str(d.id) || `d${wi}-${di}`, label, tasks });
    });
    const label = str(w.label);
    if (!label && !days.length) return;
    weeks.push({ id: str(w.id) || `w${wi}`, label, days });
  });
  const goal = str(n.goal);
  return { title: str(n.title), ...(goal ? { goal } : {}), weeks };
}

/** own-property check: task ids like "constructor" must not read Object.prototype members as state */
export const isDone = (done: Readonly<Record<string, 1>>, id: string): boolean => Object.prototype.hasOwnProperty.call(done, id) && done[id] === 1;

/** Persisted per node: done task ids (+ the last sent reply text, to show "gesendet"). */
export type StudyState = { done: Record<string, 1>; sent?: string };
export const INITIAL_STUDY_STATE: StudyState = { done: {} };

export function toggleTask(s: StudyState, taskId: string): StudyState {
  const done = { ...s.done };
  if (isDone(done, taskId)) delete done[taskId];
  else done[taskId] = 1;
  return { ...s, done };
}

/** Marks every task of a day done (or, if all are done already, undone). */
export function toggleDay(s: StudyState, day: StudyDay): StudyState {
  const all = day.tasks.length > 0 && day.tasks.every((t) => isDone(s.done, t.id));
  const done = { ...s.done };
  for (const t of day.tasks) {
    if (all) delete done[t.id];
    else done[t.id] = 1;
  }
  return { ...s, done };
}

export type Progress = { done: number; total: number; ratio: number; minutes: number; minutesDone: number };

export function progressOf(tasks: readonly StudyTask[], done: Readonly<Record<string, 1>>): Progress {
  let d = 0;
  let minutes = 0;
  let minutesDone = 0;
  for (const t of tasks) {
    minutes += t.minutes ?? 0;
    if (isDone(done, t.id)) {
      d++;
      minutesDone += t.minutes ?? 0;
    }
  }
  return { done: d, total: tasks.length, ratio: tasks.length ? d / tasks.length : 0, minutes, minutesDone };
}

export const dayTasks = (d: StudyDay) => d.tasks;
export const weekTasks = (w: StudyWeek): StudyTask[] => w.days.flatMap((d) => d.tasks);
export const planTasks = (p: StudyPlanModel): StudyTask[] => p.weeks.flatMap(weekTasks);

/* ───────────── "Heute" ───────────── */

const WEEKDAYS: readonly (readonly string[])[] = [
  // getDay(): 0 = Sunday. Lowercase, accent-free prefixes in de / en / es.
  ['so', 'sonntag', 'sun', 'sunday', 'do', 'dom', 'domingo'],
  ['mo', 'montag', 'mon', 'monday', 'lu', 'lun', 'lunes'],
  ['di', 'dienstag', 'tue', 'tues', 'tuesday', 'ma', 'mar', 'martes'],
  ['mi', 'mittwoch', 'wed', 'wednesday', 'mie', 'miercoles'],
  ['do', 'donnerstag', 'thu', 'thur', 'thurs', 'thursday', 'ju', 'jue', 'jueves'],
  ['fr', 'freitag', 'fri', 'friday', 'vi', 'vie', 'viernes'],
  ['sa', 'samstag', 'sonnabend', 'sat', 'saturday', 'sab', 'sabado'],
];

function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/[áàâä]/g, 'a')
    .replace(/[éèêë]/g, 'e')
    .replace(/[íìîï]/g, 'i')
    .replace(/[óòôö]/g, 'o')
    .replace(/[úùûü]/g, 'u');
}

/** Weekday (0 = Sunday) named at the start of a day label ("Mo", "Montag · Vokabeln", "Lunes"), or -1. */
export function weekdayOfLabel(label: string): number {
  const m = /^[a-zäöüéáíóúñ]+/.exec(fold(label.trim()));
  if (!m) return -1;
  const w = m[0];
  // "do" is ambiguous (de Donnerstag / es domingo) → German wins (the plan language is usually de)
  if (w === 'do') return 4;
  for (let d = 0; d < 7; d++) if (WEEKDAYS[d].includes(w)) return d;
  return -1;
}

/** "12.10.", "12.10.2026", "2026-10-12" in a label → does it name `now`'s date? */
export function labelMatchesDate(label: string, now: Date): boolean {
  const y = now.getFullYear();
  const mo = now.getMonth() + 1;
  const d = now.getDate();
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(label);
  if (iso) return +iso[1] === y && +iso[2] === mo && +iso[3] === d;
  const de = /(?:^|\D)(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/.exec(label);
  if (de) return +de[1] === d && +de[2] === mo && (!de[3] || +de[3] === y || +de[3] === y % 100);
  return false;
}

export type DayRef = { week: number; day: number };

/**
 * The day "Heute" jumps to:
 * 1. a day whose label names today's date;
 * 2. otherwise the current week (first week with open tasks): its day named like today's weekday;
 * 3. otherwise that week's first day with open tasks (= where the learner is);
 * 4. otherwise (all done) the last day.
 */
export function todayTarget(plan: StudyPlanModel, done: Readonly<Record<string, 1>>, now: Date): DayRef | null {
  const ws = plan.weeks;
  if (!ws.some((w) => w.days.length)) return null;
  for (let w = 0; w < ws.length; w++) for (let d = 0; d < ws[w].days.length; d++) if (labelMatchesDate(ws[w].days[d].label, now)) return { week: w, day: d };
  const open = (day: StudyDay) => day.tasks.some((t) => !isDone(done, t.id));
  const wi = ws.findIndex((w) => w.days.some(open));
  if (wi < 0) {
    for (let w = ws.length - 1; w >= 0; w--) if (ws[w].days.length) return { week: w, day: ws[w].days.length - 1 };
    return null;
  }
  const today = now.getDay();
  const byName = ws[wi].days.findIndex((d) => weekdayOfLabel(d.label) === today);
  if (byName >= 0) return { week: wi, day: byName };
  return { week: wi, day: Math.max(0, ws[wi].days.findIndex(open)) };
}

/* ───────────── reply ───────────── */

/** Readable week name for the reply (protocol text is German, like the other replies). */
function weekName(w: StudyWeek, i: number): string {
  const l = oneLine(w.label);
  // "Woche 1: Grundlagen" → "Woche 1" keeps the reply short; plain labels stay as they are
  const short = /^(.{1,40}?)\s*[:–—-]\s+\S/.exec(l);
  return short ? short[1] : l || `Woche ${i + 1}`;
}

/**
 * `[studyplan:<id>] Woche 1: 9/12 erledigt` – every week with progress (at least the current one),
 * plus `Gesamt: x/y` when the plan has more than one week.
 */
export function studyReply(id: string, plan: StudyPlanModel, done: Readonly<Record<string, 1>>): string {
  const parts: string[] = [];
  const cur = plan.weeks.findIndex((w) => weekTasks(w).some((t) => !isDone(done, t.id)));
  plan.weeks.forEach((w, i) => {
    const p = progressOf(weekTasks(w), done);
    if (!p.total) return;
    if (p.done > 0 || i === cur) parts.push(`${weekName(w, i)}: ${p.done}/${p.total} erledigt`);
  });
  const all = progressOf(planTasks(plan), done);
  if (!parts.length) parts.push(`${all.done}/${all.total} erledigt`);
  if (plan.weeks.length > 1) parts.push(`Gesamt: ${all.done}/${all.total}`);
  return `[studyplan:${oneLine(id) || 'studyplan'}] ${parts.join(' · ')}`;
}

/** "1 h 30 min" / "45 min" (language-neutral units). */
export function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
