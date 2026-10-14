/**
 * Things the shell queued for the web app (`desktop_take_pending`): notification clicks / action buttons and files
 * opened via the dock icon. Fetched on the `pending` event and once at start (cold start by a click or a drop).
 * Each kind has one consumer; items arriving before their consumer is ready wait here.
 */
import { invokeDesktop, onDesktopEvent } from './bridge';

export type NotificationResponse = { id: string; action: string; data: unknown };
export type OpenedFile = { path: string; name: string; size: number };
type Kinds = { responses: NotificationResponse; files: OpenedFile };

const queues: { [K in keyof Kinds]: Kinds[K][] } = { responses: [], files: [] };
const consumers: { [K in keyof Kinds]?: (items: Kinds[K][]) => void } = {};
let bound = false;
let held = false;

function flush<K extends keyof Kinds>(kind: K): void {
  const c = consumers[kind] as ((items: Kinds[K][]) => void) | undefined;
  if (!c || held || !queues[kind].length) return;
  const items = queues[kind].splice(0) as Kinds[K][];
  c(items);
}

async function take(): Promise<void> {
  const p = await invokeDesktop<{ files?: OpenedFile[]; responses?: NotificationResponse[] }>('desktop_take_pending');
  if (!p) return;
  if (Array.isArray(p.responses)) queues.responses.push(...p.responses);
  if (Array.isArray(p.files)) queues.files.push(...p.files);
  flush('responses');
  flush('files');
}

function bind(): void {
  if (bound) return;
  bound = true;
  onDesktopEvent((e) => {
    if (e.cmd === 'pending') void take();
  });
  void take();
}

/** register the consumer of one kind (returns the unregister fn) */
export function consumePending<K extends keyof Kinds>(kind: K, fn: (items: Kinds[K][]) => void): () => void {
  (consumers as Record<string, unknown>)[kind] = fn;
  bind();
  flush(kind);
  return () => {
    if (consumers[kind] === (fn as unknown)) delete consumers[kind];
  };
}

/** the app lock holds everything back until it is unlocked */
export function holdPending(hold: boolean): void {
  held = hold;
  if (!hold) {
    flush('responses');
    flush('files');
  }
}
