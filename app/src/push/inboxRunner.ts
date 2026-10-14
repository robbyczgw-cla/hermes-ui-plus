/**
 * One live inbox runner (pure, node:test; PushHost wires the I/O). Review M7: a transient failure of the
 * initial config fetch is retried with the same abortable backoff as the stream itself – only a server without
 * inbox support (config null / `inbox: false`) or an auth/route error ends the runner. The caller removes a
 * finished runner, so a later start can create a new one.
 */
export type InboxRunnerDeps = {
  signal: AbortSignal;
  /** null = no push/inbox support (404/405); throws = transient (offline) or fatal (`isFatal`) */
  loadConfig: () => Promise<{ inbox: boolean } | null>;
  /** one stream connection until it ends/fails; `ready()` resets the backoff */
  connect: (ready: () => void) => Promise<void>;
  /** errors that make retrying pointless (401/403/404) */
  isFatal: (e: unknown) => boolean;
  backoff: (attempt: number) => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

export type InboxRunnerEnd = 'aborted' | 'unsupported' | 'fatal';

const abortableSleep = (ms: number, signal: AbortSignal) =>
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

export async function runInbox(d: InboxRunnerDeps): Promise<InboxRunnerEnd> {
  const sleep = d.sleep ?? abortableSleep;
  let attempt = 0;
  // 1) config (retried while transient)
  for (;;) {
    if (d.signal.aborted) return 'aborted';
    try {
      const cfg = await d.loadConfig();
      if (!cfg?.inbox) return 'unsupported';
      break;
    } catch (e) {
      if (d.isFatal(e)) return 'fatal';
    }
    await sleep(d.backoff(attempt++), d.signal);
  }
  attempt = 0;
  // 2) stream (reconnect with backoff)
  while (!d.signal.aborted) {
    try {
      await d.connect(() => {
        attempt = 0;
      });
    } catch (e) {
      if (d.isFatal(e)) return 'fatal';
    }
    if (d.signal.aborted) break;
    await sleep(d.backoff(attempt++), d.signal);
  }
  return 'aborted';
}
