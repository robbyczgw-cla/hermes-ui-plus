/**
 * "Arbeitet im Hintergrund" (Bots v2 slice 5): what the bridge knows about running work per bot, pure (node:test).
 *
 * `GET /bridge/bots/activity` lists the chat turns the bridge is running upstream right now (from any device, with the
 * steps it saw in the turn's stream) and, for bots whose routines this device may read, the routines Hermes reports as
 * running. The app adds its own running chats (bots/core.ts rosterRows) and shows a green dot with the current step.
 *
 * Honest states: no bridge / an older bridge → `known: false` (only this device's own turns show); routines the bridge
 * cannot see (not enabled by the owner, no right) → `routines.known: false`, the app shows nothing for them rather than
 * "idle". With Routines switched off on this device the app ignores routine runs entirely.
 */
import { DEFAULT_BOT } from '../hermes/bots.ts';

export type ActivityStep = { name: string; label?: string; state: 'done' | 'running' };
export type ActivityTurn = { sessionId: string; since: number; steps: ActivityStep[] };
export type ActivityRoutine = { jobId: string; name: string; since?: number };
export type BotActivity = { bot: string; turns: ActivityTurn[]; routines: ActivityRoutine[] };

export type ActivitySnapshot = {
  /** false: this server cannot tell (direct Hermes, bridge without the route, request failed) */
  known: boolean;
  at: number;
  routines: { known: boolean; reason?: string };
  bots: Map<string, BotActivity>;
};

export const UNKNOWN_ACTIVITY: ActivitySnapshot = Object.freeze({ known: false, at: 0, routines: { known: false, reason: 'unknown' }, bots: new Map() }) as ActivitySnapshot;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const SAFE = /^[A-Za-z0-9._:-]{1,128}$/;
const BOT = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : undefined);
const ms = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

export function parseActivity(json: unknown, now = Date.now()): ActivitySnapshot {
  if (!isObj(json) || json.object !== 'bots.activity' || !Array.isArray(json.data)) return UNKNOWN_ACTIVITY;
  const bots = new Map<string, BotActivity>();
  // start times come in on the server's clock: moved onto this device's clock by the server's `at` (a phone whose
  // clock is off by a minute showed "for 1 min 18 s" for a turn 25 s old), never in the future
  const skew = (ms(json.at) ?? now) - now;
  const local = (v: number | undefined) => (v === undefined ? undefined : Math.min(now, v - skew));
  for (const raw of json.data) {
    if (!isObj(raw) || typeof raw.bot !== 'string' || !BOT.test(raw.bot) || bots.has(raw.bot)) continue;
    const turns: ActivityTurn[] = (Array.isArray(raw.turns) ? raw.turns : []).flatMap((t): ActivityTurn[] => {
      if (!isObj(t) || typeof t.sessionId !== 'string' || !SAFE.test(t.sessionId)) return [];
      const steps = (Array.isArray(t.steps) ? t.steps : []).flatMap((s): ActivityStep[] => {
        const name = isObj(s) ? text(s.name, 80) : undefined;
        if (!name || !isObj(s)) return [];
        const label = text(s.label, 160);
        return [{ name, ...(label ? { label } : {}), state: s.state === 'running' ? 'running' : 'done' }];
      });
      return [{ sessionId: t.sessionId, since: local(ms(t.since)) ?? now, steps: steps.slice(-12) }];
    });
    const routines: ActivityRoutine[] = (Array.isArray(raw.routines) ? raw.routines : []).flatMap((r): ActivityRoutine[] => {
      if (!isObj(r) || typeof r.jobId !== 'string' || !SAFE.test(r.jobId)) return [];
      const since = local(ms(r.since));
      return [{ jobId: r.jobId, name: text(r.name, 120) ?? r.jobId, ...(since ? { since } : {}) }];
    });
    if (turns.length || routines.length) bots.set(raw.bot, { bot: raw.bot, turns, routines });
  }
  const r = isObj(json.routines) ? json.routines : {};
  const reason = typeof r.reason === 'string' && /^[a-z_]{2,40}$/.test(r.reason) ? r.reason : undefined;
  return { known: true, at: ms(json.at) ?? now, routines: { known: r.known === true, ...(reason ? { reason } : {}) }, bots };
}

export type WorkingState = {
  working: boolean;
  /** the bot's own Bot Chat runs a turn somewhere (this device or another) */
  chatTurn: ActivityTurn | null;
  /** what to show instead of the last line: the current step, a routine, or nothing (plain "arbeitet …") */
  line: { kind: 'step'; text: string } | { kind: 'routine'; name: string } | null;
};

/**
 * Working state of one bot for the roster and the Bot Chat. `localRunning`: this device streams a turn of the bot's
 * Bot Chat; `botChatSession`: its session id (a turn of another session of this profile counts too: the profile is
 * busy). Routine runs only count with Routines on.
 */
export function workingOf(snap: ActivitySnapshot, bot: string | null | undefined, o: { localRunning: boolean; botChatSession?: string; routinesOn: boolean }): WorkingState {
  const a = snap.bots.get(bot || DEFAULT_BOT);
  const turns = a?.turns ?? [];
  const chatTurn = (o.botChatSession && turns.find((t) => t.sessionId === o.botChatSession)) || null;
  const routines = o.routinesOn ? (a?.routines ?? []) : [];
  const working = o.localRunning || turns.length > 0 || routines.length > 0;
  const turn = chatTurn ?? turns[0] ?? null;
  const step = turn ? [...turn.steps].reverse().find((s) => s.state === 'running') ?? turn.steps.at(-1) : undefined;
  const line: WorkingState['line'] = step ? { kind: 'step', text: step.label ?? step.name } : !turns.length && !o.localRunning && routines[0] ? { kind: 'routine', name: routines[0].name } : null;
  return { working, chatTurn, line };
}

/** Is a remote turn of this Bot Chat running that this device does not stream itself (show the card, offer Stop)? */
export function remoteTurnOf(snap: ActivitySnapshot, bot: string | null | undefined, sessionId: string | undefined, localRunning: boolean): ActivityTurn | null {
  if (!sessionId || localRunning || !snap.known) return null;
  return snap.bots.get(bot || DEFAULT_BOT)?.turns.find((t) => t.sessionId === sessionId) ?? null;
}

/** Steps of this device's own streaming answer (its tool events), newest last, at most 12. */
export function stepsOfMessage(m: { tools: readonly { name: string; label: string; status: string }[] } | null | undefined): ActivityStep[] {
  return (m?.tools ?? []).slice(-12).map((x) => {
    const label = x.label && x.label !== x.name ? x.label.replace(/\s+/g, ' ').trim().slice(0, 160) : undefined;
    return { name: x.name, ...(label ? { label } : {}), state: x.status === 'running' ? 'running' : 'done' };
  });
}

/**
 * The "<Name> arbeitet" card's running time: whole seconds (at least 1 s; a sub-second value stood still as "6 ms")
 * for the first minute, then whole minutes. `tickMs`: how often the card refreshes (every second, then every 15 s:
 * less churn for the eye and for screen readers).
 */
export function workingElapsed(now: number, since: number): { text: string; tickMs: number } {
  const ms = Math.max(0, now - since);
  if (ms < 60_000) return { text: `${Math.max(1, Math.floor(ms / 1000))} s`, tickMs: 1000 };
  return { text: `${Math.floor(ms / 60_000)} min`, tickMs: 15_000 };
}
