/**
 * Android: keep a running answer alive while the app is in the background (pure controller, node:test; the native
 * part is modules/stream-keepalive, wired in BackgroundTurnHost).
 *
 * The dataSync foreground service runs for exactly as long as ANY turn runs (all backends: direct ones have no
 * server-side continuation; for Hermes it saves the recovery round trip). It is started when the turn starts –
 * the app is visible then, which Android 12+ requires for starting a foreground service – and stopped on
 * finish / error / stop – once the ended turns' final transcript writes are done (`registry.settle`): a stopped
 * service lets Android freeze or kill the app at once. Android shows the notification only after ~10 s, so short
 * answers never show one.
 *
 * While it runs, a headless JS task is active: React Native pauses JS timers in the background otherwise
 * (JavaTimerManager), which would freeze throttled saves and stream watchdogs.
 */
import type { RunningTurn, TurnRegistry } from './turnRegistry.ts';
import { keepAliveText } from './turnRegistry.ts';
import type { StreamKeepAliveModule } from './keepAliveNative.ts';

export type KeepAliveTexts = {
  title(vars: { name: string }): string;
  one(vars: { name: string }): string;
  many(vars: { count: number }): string;
  stop: string;
  channel: string;
};

export type KeepAliveDeps = {
  module: Pick<StreamKeepAliveModule, 'start' | 'update' | 'stop' | 'addListener'>;
  registry: Pick<TurnRegistry, 'snapshot' | 'subscribe' | 'stopAll'> & Partial<Pick<TurnRegistry, 'saving'>>;
  /** setting "Antworten im Hintergrund fertigstellen" */
  enabled(): boolean;
  texts(): KeepAliveTexts;
  log?(msg: string): void;
};

/**
 * The service's headless task body: one per JS runtime (AppRegistry.registerHeadlessTask), handed between keep-alive
 * controllers. Android relaunches the activity on a configuration change (system dark mode): the new React surface
 * mounts BEFORE the old one unmounts, so the old host's cleanup must not reset the body the new host already claimed.
 * Otherwise the next service's task ends at once and Android stops the service right after it started.
 */
export function createTaskSlot() {
  const idle = () => Promise.resolve();
  let body: () => Promise<void> = idle;
  return {
    /** the registered headless task: the current owner's body, or end at once */
    run: () => body(),
    /** install `fn`; the returned release resets the slot only while `fn` still owns it */
    claim(fn: () => Promise<void>): () => void {
      body = fn;
      return () => {
        if (body === fn) body = idle;
      };
    },
  };
}

export function createKeepAliveController(d: KeepAliveDeps) {
  let state: 'idle' | 'starting' | 'running' = 'idle';
  let lastText = '';
  /** after "Stopp" / the time limit: no restart until every turn has ended */
  let suppressed = false;
  /** resolvers of the headless task promise(s): resolved when the last turn ends */
  const taskDone: (() => void)[] = [];

  const textFor = (running: readonly RunningTurn[]) => {
    const tx = d.texts();
    return {
      ...keepAliveText(running, (k, v) => (k === 'title' ? tx.title(v as { name: string }) : k === 'one' ? tx.one(v as { name: string }) : tx.many(v as { count: number }))),
      stop: tx.stop,
      channel: tx.channel,
    };
  };

  const releaseTask = () => {
    while (taskDone.length) taskDone.shift()?.();
  };

  const sync = async () => {
    const running = d.registry.snapshot();
    const saving = d.registry.saving?.() ?? 0;
    if (!running.length) suppressed = false;
    const want = running.length > 0 && d.enabled() && !suppressed;
    // the last turn ended, its final write is still in flight: keep the service (and the headless task) until it is done
    if (!want && saving > 0 && (state === 'running' || state === 'starting')) return;
    if (want && state === 'idle') {
      state = 'starting';
      const t = textFor(running);
      lastText = `${t.title}|${t.text}`;
      let ok = false;
      try {
        ok = await d.module.start(t.title, t.text, t.stop, t.channel);
      } catch (e) {
        d.log?.(`start failed: ${String(e)}`);
      }
      if (!ok) d.log?.('foreground service refused (background start / time limit)');
      state = ok ? 'running' : 'idle';
      // turns may have ended (or the setting flipped) while starting
      if (ok && (!d.registry.snapshot().length || !d.enabled())) void sync();
      return;
    }
    if (want && state === 'running') {
      const t = textFor(running);
      const key = `${t.title}|${t.text}`;
      if (key !== lastText) {
        lastText = key;
        const ok = await d.module.update(t.title, t.text).catch(() => false);
        // false = the service is no longer running (stopped by the system): reflect it instead of believing it runs
        if (!ok && state === 'running') {
          d.log?.('keep-alive service no longer running');
          state = 'idle';
          lastText = '';
          releaseTask();
        }
      }
      return;
    }
    if (!want && state === 'running') {
      state = 'idle';
      lastText = '';
      releaseTask();
      await d.module.stop().catch(() => false);
      return;
    }
    if (!want) releaseTask();
  };

  const unsubscribe = d.registry.subscribe(() => void sync());
  const subs = [
    // notification "Stopp": abort every running turn (each hook persists its partial answer as stopped)
    d.module.addListener('onStopRequested', () => {
      state = 'idle';
      suppressed = true;
      releaseTask();
      d.registry.stopAll();
    }),
    // Android 15 dataSync budget (6 h / 24 h) used up: the service stopped itself, the turns keep running
    d.module.addListener('onTimeout', () => {
      state = 'idle';
      suppressed = true;
      releaseTask();
    }),
    // start() was acknowledged, but foreground promotion / the headless task failed and the service stopped:
    // no protection is running. No retry loop until every turn has ended (a retry from the background fails too).
    d.module.addListener('onStartFailed', () => {
      d.log?.('keep-alive service failed to start (foreground promotion / headless task)');
      state = 'idle';
      lastText = '';
      suppressed = true;
      releaseTask();
    }),
  ];
  void sync();

  return {
    /** setting changed */
    sync: () => void sync(),
    /** body of the headless JS task: resolves when no turn is running anymore */
    task(): Promise<void> {
      if (!d.registry.snapshot().length && !(d.registry.saving?.() ?? 0)) return Promise.resolve();
      return new Promise<void>((resolve) => taskDone.push(resolve));
    },
    state: () => state,
    dispose() {
      unsubscribe();
      for (const s of subs) s.remove();
      releaseTask();
      if (state !== 'idle') void d.module.stop().catch(() => false);
      state = 'idle';
    },
  };
}
