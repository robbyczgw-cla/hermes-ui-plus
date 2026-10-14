/**
 * Sequential chunk playback with prefetch (pure orchestration, queue.test.ts).
 * `load` fetches chunk i (e.g. POST /bridge/tts → cache file) while chunk i-1 plays;
 * `play` resolves when the chunk finished playing. Every loaded item is released exactly once
 * (played, aborted, or after an error), so cache files never leak.
 */

export type ChunkQueueDeps<T> = {
  /**
   * number of chunks known now; a function for a growing feed (read-aloud while the answer streams), called with
   * the index the queue needs – a feed only cuts new chunks when asked for one it does not have yet, so text that
   * arrives meanwhile is batched into fewer, fuller chunks
   */
  count: number | ((need: number) => number);
  /**
   * growing feed: called when every known chunk was played; resolves once the feed changed (true) or will
   * never grow again (false). Without it the queue ends after `count` chunks.
   */
  waitMore?(signal: AbortSignal): Promise<boolean>;
  /** growing feed: `onGrow` is called when chunks were added, so the next ones are prefetched at once; returns unsubscribe */
  watch?(onGrow: () => void): () => void;
  load(index: number, signal: AbortSignal): Promise<T>;
  play(item: T, index: number, signal: AbortSignal): Promise<void>;
  release?(item: T, index: number): void;
  /** called right before chunk `index` starts playing */
  onChunkStart?(index: number): void;
  /** called when chunk `index` is needed but still loading (→ show a spinner) */
  onWaiting?(index: number): void;
  /** chunks fetched ahead of the playing one (default 1) */
  prefetch?: number;
  /** first chunk to play (resume) */
  startAt?: number;
};

export type QueueResult = 'done' | 'aborted';

/** Runs the queue; throws the first load/play error (after cleaning up). */
export async function runChunkQueue<T>(deps: ChunkQueueDeps<T>, signal?: AbortSignal): Promise<QueueResult> {
  const inner = new AbortController();
  const onOuterAbort = () => inner.abort();
  if (signal) {
    if (signal.aborted) return 'aborted';
    signal.addEventListener('abort', onOuterAbort);
  }
  const ahead = Math.max(0, deps.prefetch ?? 1);
  const loads = new Map<number, Promise<T>>();
  const released = new Set<number>();
  const settledLoads = new Map<number, T>();

  const release = (i: number) => {
    if (released.has(i) || !settledLoads.has(i)) return;
    released.add(i);
    try {
      deps.release?.(settledLoads.get(i) as T, i);
    } catch {
      // ignore cleanup errors
    }
  };

  const count = typeof deps.count === 'function' ? deps.count : () => deps.count as number;
  const has = (i: number) => i < count(i);
  let playing = Math.max(0, deps.startAt ?? 0);
  const ensure = (i: number) => {
    if (loads.has(i) || !has(i)) return;
    const p = deps.load(i, inner.signal).then((item) => {
      settledLoads.set(i, item);
      // finished loading after the queue ended → release immediately
      if (inner.signal.aborted) release(i);
      return item;
    });
    p.catch(() => undefined); // awaited later; avoid unhandled rejection for prefetched chunks
    loads.set(i, p);
  };

  const start = Math.max(0, deps.startAt ?? 0);
  const unwatch = deps.watch?.(() => {
    if (!inner.signal.aborted) for (let k = playing; k <= playing + ahead; k++) ensure(k);
  });
  try {
    for (let i = start; ; i++) {
      while (!has(i)) {
        if (inner.signal.aborted) return 'aborted';
        if (deps.waitMore) deps.onWaiting?.(i); // the answer is still being written
        const more = deps.waitMore ? await deps.waitMore(inner.signal) : false;
        if (!more && !has(i)) return inner.signal.aborted ? 'aborted' : 'done';
      }
      if (inner.signal.aborted) return 'aborted';
      playing = i;
      for (let k = i; k <= i + ahead; k++) ensure(k);
      if (!settledLoads.has(i)) deps.onWaiting?.(i);
      const item = await (loads.get(i) as Promise<T>);
      if (inner.signal.aborted) return 'aborted';
      deps.onChunkStart?.(i);
      await deps.play(item, i, inner.signal);
      release(i);
    }
  } catch (e) {
    if (inner.signal.aborted) return 'aborted';
    throw e;
  } finally {
    unwatch?.();
    signal?.removeEventListener('abort', onOuterAbort);
    inner.abort();
    for (const i of settledLoads.keys()) release(i);
  }
}
