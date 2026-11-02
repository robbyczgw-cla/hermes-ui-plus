/**
 * The bridge takes 2 uploads at a time per credential (uploads.mjs DEFAULT_MAX_INFLIGHT) and answers 429 to the rest:
 * picking more files than that waits here in order (pure, uploadQueue.test.ts). A 429 anyway (a second device on the
 * same token, a changed limit, a slot not yet freed) goes back into the queue after a backoff, then fails for the chip.
 */
export const UPLOAD_SLOTS = 2;
export const BUSY_BACKOFF_MS = [1000, 2000, 4000, 8000, 8000] as const;

export type UploadQueueOptions = {
  slots?: number;
  backoffMs?: readonly number[];
  isBusy(e: unknown): boolean;
  /** rejection for a job aborted while it was not running */
  aborted(): unknown;
};

export type UploadQueue = {
  /** Runs `job` once a slot of `key` is free. `signal` aborted: leaves the queue at once and frees its slot. */
  run<T>(key: string, signal: AbortSignal | undefined, job: () => Promise<T>): Promise<T>;
};

export function createUploadQueue(opts: UploadQueueOptions): UploadQueue {
  const slots = opts.slots ?? UPLOAD_SLOTS;
  const backoff = opts.backoffMs ?? BUSY_BACKOFF_MS;
  const lanes = new Map<string, { running: number; waiting: (() => void)[] }>();

  const acquire = (key: string, signal: AbortSignal | undefined): Promise<() => void> =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(opts.aborted());
      const lane = lanes.get(key) ?? { running: 0, waiting: [] };
      lanes.set(key, lane);
      const release = () => {
        lane.running--;
        const next = lane.waiting.shift();
        if (next) next();
        else if (lane.running === 0) lanes.delete(key);
      };
      const start = () => {
        signal?.removeEventListener('abort', onAbort);
        lane.running++;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          release();
        });
      };
      const onAbort = () => {
        lane.waiting.splice(lane.waiting.indexOf(start), 1);
        if (lane.running === 0 && lane.waiting.length === 0) lanes.delete(key);
        reject(opts.aborted());
      };
      if (lane.running < slots) return start();
      lane.waiting.push(start);
      signal?.addEventListener('abort', onAbort, { once: true });
    });

  const pause = (ms: number, signal: AbortSignal | undefined): Promise<void> =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(opts.aborted());
      const onAbort = () => {
        clearTimeout(timer);
        reject(opts.aborted());
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });

  return {
    async run(key, signal, job) {
      for (let attempt = 0; ; attempt++) {
        const release = await acquire(key, signal);
        // an abort frees the slot now, whatever the aborted request still does
        signal?.addEventListener('abort', release, { once: true });
        try {
          return await job();
        } catch (e) {
          if (signal?.aborted || !opts.isBusy(e) || attempt >= backoff.length) throw e;
        } finally {
          signal?.removeEventListener('abort', release);
          release();
        }
        await pause(backoff[attempt], signal);
      }
    },
  };
}
