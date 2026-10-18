/**
 * After a turn with tools: one GET of the stored session (latest page) fills the turn's ToolEvent.detail
 * (+ reasoning). Retries once when Hermes has not persisted the turn yet. Silent on failure.
 *
 * Lifecycle-safe (review H6): the job is cancelled by `signal` (hook unmount / new session) and `alive()` is
 * rechecked after EVERY await, so a retired hook never applies its late result to its own (stale) message list
 * and never persists it over a newer transcript. Pure (no React) for node:test.
 */
import { hermesToolKind } from '../chat/hermesTools.ts';
import { enrichTurn } from './sessionMapping.ts';
import type { RemoteMessage } from './sessions.ts';
import type { ChatMessage, HermesEvent } from './types.ts';

/**
 * Mid-turn: a web tool just finished and its result is not here yet. Hermes (0.22) stores each tool row as soon as the
 * tool returns, so one fetch now fills the web card while the model is still writing (the live `completed` frame
 * carries no result). Other tools wait for the end of the turn.
 */
export function wantsLiveDetails(ev: HermesEvent, msg: ChatMessage | undefined): boolean {
  if (ev.type !== 'tool' || ev.status === 'running' || hermesToolKind(ev.name) !== 'web') return false;
  if (!msg || msg.role !== 'assistant') return false;
  const t = msg.tools.find((x) => x.id === ev.callId);
  return !!t && t.detail?.output === undefined;
}

export type ToolDetailJob = {
  messageId: string;
  /** latest stored rows of the session; throws on network / unsupported errors */
  fetchRows: () => Promise<RemoteMessage[]>;
  /** still the same mounted hook and session */
  alive: () => boolean;
  get: () => ChatMessage[];
  commit: (next: ChatMessage[]) => void;
  signal: AbortSignal;
  /** waits before each attempt (default 400 ms, 2.5 s) */
  delays?: number[];
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  onError?: (e: unknown) => void;
};

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(t);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const t = setTimeout(done, ms);
    signal.addEventListener('abort', done);
  });

/** true when details were applied */
export async function loadToolDetails(job: ToolDetailJob): Promise<boolean> {
  const sleep = job.sleep ?? defaultSleep;
  const ok = () => !job.signal.aborted && job.alive();
  for (const delay of job.delays ?? [400, 2500]) {
    await sleep(delay, job.signal);
    if (!ok()) return false;
    let rows: RemoteMessage[];
    try {
      rows = await job.fetchRows();
    } catch (e) {
      job.onError?.(e);
      return false;
    }
    if (!ok()) return false;
    const list = job.get();
    const idx = list.findIndex((m) => m.id === job.messageId);
    if (idx === -1) return false;
    let userText: string | undefined;
    for (let i = idx - 1; i >= 0; i--) {
      if (list[i].role === 'user') {
        userText = list[i].text;
        break;
      }
    }
    const enriched = enrichTurn(list[idx], rows, userText);
    if (enriched === list[idx]) continue; // not persisted yet → retry once
    const next = list.slice();
    next[idx] = enriched;
    job.commit(next);
    return true;
  }
  return false;
}
