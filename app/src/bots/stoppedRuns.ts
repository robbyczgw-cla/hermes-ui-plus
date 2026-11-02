/**
 * "Lauf hat an einer Stelle angehalten" (Bots v2 spec 2.4, slice 5): Hermes never asks for approvals in routine runs
 * (`approvals.cron_mode: deny`), it skips such a step. The bridge's routines inbox notes it on the run's entry
 * (`blocked`); the Bot Chat shows a card below that run's delivery marker. Pure (node:test).
 *
 * The delivery row only carries the job's name and its time, so a run is matched by name and by when it finished
 * (the delivery comes right after the run). No match, Routines off, or no inbox right: no card (spec: "Ohne Erkennung
 * gibt es keine Karte"), the marker stays as it is.
 */
import type { InboxSummary } from '../routines/inbox.ts';

/** a delivery lands shortly after its run finished; allow for clock skew and a slow bot comment */
const BEFORE_MS = 15 * 60_000;
const AFTER_MS = 5 * 60_000;

const norm = (s: string) => s.replace(/^\[bot:[^\]]*\]\s*/, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();

export type StoppedRun = { entryId: string; jobId: string; routine: string; description?: string; command?: string };

export function stoppedRunFor(entries: readonly InboxSummary[], delivery: { name: string; at?: number }): StoppedRun | null {
  if (!delivery.at || !delivery.name) return null;
  const at = delivery.at;
  const want = norm(delivery.name);
  let best: { e: InboxSummary; d: number } | null = null;
  for (const e of entries) {
    if (!e.stopped || norm(e.title) !== want) continue;
    const fin = Date.parse(e.finishedAt);
    if (!Number.isFinite(fin) || fin < at - BEFORE_MS || fin > at + AFTER_MS) continue;
    const d = Math.abs(at - fin);
    if (!best || d < best.d) best = { e, d };
  }
  if (!best) return null;
  const { e } = best;
  return { entryId: e.id, jobId: e.jobId, routine: e.title, ...(e.stopped?.description ? { description: e.stopped.description } : {}), ...(e.stopped?.command ? { command: e.stopped.command } : {}) };
}

/**
 * Every delivery of the chat with its stopped run, if any: each stopped run belongs to ONE delivery, the closest one with
 * its name (a routine every few minutes delivers several times within the window; only the stopped run gets the card).
 * key = the delivery row's message id.
 */
export function stoppedRunsByDelivery(entries: readonly InboxSummary[], deliveries: readonly { key: string; name: string; at?: number }[]): Map<string, StoppedRun> {
  const best = new Map<string, { key: string; run: StoppedRun; d: number }>(); // entry id -> its closest delivery
  for (const dl of deliveries) {
    const run = stoppedRunFor(entries, dl);
    if (!run || !dl.at) continue;
    const fin = Date.parse(entries.find((e) => e.id === run.entryId)!.finishedAt);
    const d = Math.abs(dl.at - fin);
    const had = best.get(run.entryId);
    if (!had || d < had.d) best.set(run.entryId, { key: dl.key, run, d });
  }
  return new Map([...best.values()].map((b) => [b.key, b.run]));
}

/** The "what" of the card text: the command, else Hermes' category, else null (generic wording). */
export function stoppedWhat(r: StoppedRun): string | null {
  return r.command ?? r.description ?? null;
}
