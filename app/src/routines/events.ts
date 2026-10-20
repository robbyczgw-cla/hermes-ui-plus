/**
 * Live hint "a Routine result arrived" (bridge inbox stream event `hui.routine`, routed by push/PushHost.tsx). Carries
 * ids only, no content: listeners refetch the unread count / the open inbox. Pure, erasable TS (no React).
 */
import { botOf } from '../hermes/bots.ts';

export type RoutineEvent = {
  /** app connection the stream belongs to */
  profileId: string;
  /** bot of the result; undefined = default profile */
  hermesProfile?: string;
  id?: string;
  jobId?: string;
  status?: string;
};

/** `event: hui.routine` data → fields (null when it is not one). */
export function parseRoutineEventData(data: string): Omit<RoutineEvent, 'profileId'> | null {
  try {
    const o = JSON.parse(data) as Record<string, unknown>;
    if (!o || typeof o !== 'object') return null;
    const s = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 80) : undefined);
    if (o.source !== undefined && o.source !== 'routines') return null;
    const id = s(o.id);
    if (!id) return null;
    const bot = botOf(s(o.hermesProfile));
    return { id, jobId: s(o.jobId), status: s(o.status), ...(bot ? { hermesProfile: bot } : {}) };
  } catch {
    return null;
  }
}

const listeners = new Set<(e: RoutineEvent) => void>();

export function emitRoutineEvent(e: RoutineEvent): void {
  for (const l of [...listeners]) {
    try {
      l(e);
    } catch {
      /* a listener must not break the others */
    }
  }
}

export function onRoutineEvent(l: (e: RoutineEvent) => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Does the event concern this connection + bot? (bots compared as the app stores them: default = undefined) */
export function routineEventMatches(e: RoutineEvent, profileId: string, bot: string | undefined): boolean {
  return e.profileId === profileId && botOf(e.hermesProfile) === botOf(bot);
}
