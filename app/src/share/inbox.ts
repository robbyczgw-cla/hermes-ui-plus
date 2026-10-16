/**
 * Share inbox (module state, no React): the share waiting for the sheet, and the hand-off of a confirmed share to the
 * composer of its target chat. Erasable TS (node:test).
 *
 *   offerShare(payload)          intake (native / web): the sheet shows it once the gate allows (ShareHost)
 *   dismissShare()               the user cancelled, or it was handed over
 *   deliverShare(convId, d)      Send in the sheet: the target chat's composer takes it (useShareDelivery)
 *
 * One share at a time: a newer share replaces the one still on screen (the user started it deliberately). A delivery
 * waits for its composer without a time limit; nothing is dropped silently.
 */
import type { SharedFile, SharedPayload } from './model.ts';

export type ShareDelivery = {
  /** message text (intent prompt + note + shared text) */
  text: string;
  files: SharedFile[];
  /** called once the composer has taken the files into its draft (web: frees the stored share) */
  release?: () => void;
};

export type OfferedShare = SharedPayload & {
  /** unique per arrival (a re-share of the same content opens a fresh sheet) */
  id: string;
  /** frees platform storage of an unsent share (web: the sw.js cache entry) */
  release?: () => void;
};

let current: OfferedShare | null = null;
const retries: OfferedShare[] = [];
const shareListeners = new Set<() => void>();
const deliveries = new Map<string, ShareDelivery[]>();
const deliveryListeners = new Set<() => void>();
let seq = 0;

function emit(set: Set<() => void>): void {
  for (const l of Array.from(set)) l();
}

export function offerShare(p: SharedPayload, release?: () => void): OfferedShare {
  const prev = current;
  seq += 1;
  current = { ...p, id: `s${Date.now().toString(36)}-${seq}`, ...(release ? { release } : {}) };
  if (prev?.release && prev.release !== release) prev.release();
  emit(shareListeners);
  return current;
}

export function currentShare(): OfferedShare | null {
  return current;
}

/** A failed import keeps its original files. A newer share already on screen keeps its place. */
export function retryShare(d: ShareDelivery): void {
  const payload = { text: d.text, files: d.files, refused: [] };
  if (!current) {
    offerShare(payload, d.release);
    return;
  }
  seq += 1;
  retries.push({ ...payload, id: `retry-${seq}`, release: d.release });
}

/** removes the share from the inbox; `keepStorage` = its files moved on to a delivery (do not free them yet) */
export function dismissShare(id?: string, opts: { keepStorage?: boolean } = {}): void {
  if (!current || (id && current.id !== id)) return;
  const prev = current;
  current = retries.shift() ?? null;
  if (!opts.keepStorage) prev.release?.();
  emit(shareListeners);
}

export function subscribeShare(fn: () => void): () => void {
  shareListeners.add(fn);
  return () => {
    shareListeners.delete(fn);
  };
}

/** queue a confirmed share for the composer of `conversationId` (every confirmed Send keeps its place) */
export function deliverShare(conversationId: string, d: ShareDelivery): void {
  if (!conversationId) return;
  const queue = deliveries.get(conversationId) ?? [];
  queue.push(d);
  deliveries.set(conversationId, queue);
  emit(deliveryListeners);
}

/** take (and remove) the share waiting for `conversationId` */
export function takeShareDelivery(conversationId: string | undefined): ShareDelivery | null {
  if (!conversationId) return null;
  const queue = deliveries.get(conversationId);
  const d = queue?.shift() ?? null;
  if (!queue?.length) deliveries.delete(conversationId);
  return d;
}

export function hasShareDelivery(conversationId: string | undefined): boolean {
  return !!conversationId && deliveries.has(conversationId);
}

export function subscribeDeliveries(fn: () => void): () => void {
  deliveryListeners.add(fn);
  return () => {
    deliveryListeners.delete(fn);
  };
}

type DeliveryTimers = { set(fn: () => void): unknown; clear(id: unknown): void };
const deliveryTimers: DeliveryTimers = {
  set: (fn) => setTimeout(fn, 0),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/** A mounting composer takes shares on the next tick. Unmount cancels the tick before anything is taken. */
export function consumeShareDeliveries(conversationId: string, onShare: (d: ShareDelivery) => void | Promise<void>, timers = deliveryTimers): () => void {
  let active = true;
  let timer: unknown = null;
  let busy = false;
  const check = () => {
    if (!active || busy || timer !== null || !hasShareDelivery(conversationId)) return;
    timer = timers.set(() => {
      timer = null;
      if (!active) return;
      const d = takeShareDelivery(conversationId);
      if (!d) return;
      busy = true;
      // One import at a time: two confirmed shares must not race to fill the same empty draft.
      void (async () => {
        try {
          await onShare(d);
        } catch {
          retryShare(d);
        } finally {
          busy = false;
          check();
        }
      })();
    });
  };
  const unsubscribe = subscribeDeliveries(check);
  check();
  return () => {
    active = false;
    unsubscribe();
    if (timer !== null) timers.clear(timer);
  };
}

/** tests only */
export function resetShareInbox(): void {
  current = null;
  retries.length = 0;
  deliveries.clear();
}
