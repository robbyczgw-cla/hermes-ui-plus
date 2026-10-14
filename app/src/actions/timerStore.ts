/**
 * TimerStore: multiple concurrent timers, persisted (absolute end timestamps) and mirrored by a
 * local "done" notification per running timer. No React / RN imports: storage + notifier injected.
 */
import {
  createTimer,
  parseTimers,
  pauseTimer,
  pruneTimers,
  resetTimer,
  resumeTimer,
  serializeTimers,
  settleAll,
  sortTimers,
  TIMERS_STORAGE_KEY,
  type TimerRecord,
} from './timerModel.ts';

export type TimerNotifier = {
  /**
   * Schedule the "timer finished" notification; resolves to its id, or null if not possible (no
   * permission, web). The adapter owns the (localised) title.
   */
  schedule(o: { body: string; at: Date }): Promise<string | null>;
  cancel(id: string): Promise<void>;
};

export type TimerStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export type TimerStoreOptions = {
  storage: TimerStorage;
  notifier: TimerNotifier;
  now?: () => number;
  newId?: () => string;
  storageKey?: string;
};

export type StartResult = { timer: TimerRecord; notified: boolean };

let idCounter = 0;
const defaultId = () => `t-${Date.now().toString(36)}-${(idCounter++).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

export class TimerStore {
  private readonly storage: TimerStorage;
  private readonly notifier: TimerNotifier;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly key: string;
  private timers: readonly TimerRecord[] = [];
  private loaded: Promise<void> | null = null;
  private readonly subs = new Set<() => void>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(o: TimerStoreOptions) {
    this.storage = o.storage;
    this.notifier = o.notifier;
    this.now = o.now ?? Date.now;
    this.newId = o.newId ?? defaultId;
    this.key = o.storageKey ?? TIMERS_STORAGE_KEY;
  }

  // ---- reading --------------------------------------------------------------------------------

  /** Immutable snapshot, sorted for display. Replaced on every change (useSyncExternalStore-safe). */
  getSnapshot = (): readonly TimerRecord[] => this.timers;

  subscribe = (fn: () => void): (() => void) => {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  };

  get(id: string): TimerRecord | undefined {
    return this.timers.find((t) => t.id === id);
  }

  /** Load persisted timers once (idempotent). Timers that ended while the app was closed come back as `done`. */
  load(): Promise<void> {
    if (!this.loaded) {
      this.loaded = (async () => {
        let raw: string | null = null;
        try {
          raw = await this.storage.getItem(this.key);
        } catch {
          raw = null;
        }
        const disk = parseTimers(raw, this.now());
        // timers started before the load finished stay
        const ids = new Set(this.timers.map((t) => t.id));
        this.timers = sortTimers([...this.timers, ...disk.filter((t) => !ids.has(t.id))]);
        this.emit();
      })();
    }
    return this.loaded;
  }

  // ---- mutations ------------------------------------------------------------------------------

  async start(o: { label: string; seconds: number; source?: string }): Promise<StartResult> {
    await this.load();
    const now = this.now();
    // one timer per source: starting again restarts it
    if (o.source) {
      const prev = this.timers.find((t) => t.source === o.source);
      if (prev) await this.remove(prev.id);
    }
    const timer = createTimer({ id: this.newId(), label: o.label, seconds: o.seconds, now, source: o.source });
    this.replaceAll(pruneTimers([...this.timers, timer], now));
    const notified = await this.arm(timer.id);
    return { timer: this.get(timer.id) ?? timer, notified };
  }

  async pause(id: string): Promise<void> {
    await this.load();
    const t = this.get(id);
    if (!t) return;
    const nid = t.notificationId;
    this.patch(id, pauseTimer(t, this.now()));
    if (nid) await this.safeCancel(nid);
  }

  /** Resume a paused timer (or restart a reset one). Returns whether the done-notification is armed. */
  async resume(id: string): Promise<boolean> {
    await this.load();
    const t = this.get(id);
    if (!t) return false;
    if (t.status === 'done') return false;
    this.patch(id, resumeTimer(t, this.now()));
    return this.arm(id);
  }

  async reset(id: string): Promise<void> {
    await this.load();
    const t = this.get(id);
    if (!t) return;
    const nid = t.notificationId;
    this.patch(id, resetTimer(t));
    if (nid) await this.safeCancel(nid);
  }

  async remove(id: string): Promise<void> {
    await this.load();
    const t = this.get(id);
    if (!t) return;
    this.replaceAll(this.timers.filter((x) => x.id !== id));
    if (t.notificationId) await this.safeCancel(t.notificationId);
  }

  async clearDone(): Promise<void> {
    await this.load();
    this.replaceAll(this.timers.filter((t) => t.status !== 'done'));
  }

  /** Call about once a second while anything runs. Returns timers that just finished. */
  tick(now: number = this.now()): TimerRecord[] {
    const { list, newlyDone } = settleAll(this.timers, now);
    if (newlyDone.length) this.replaceAll(pruneTimers(list, now));
    return newlyDone;
  }

  // ---- internals ------------------------------------------------------------------------------

  /** Schedule the notification for a running timer and remember its id. */
  private async arm(id: string): Promise<boolean> {
    const t = this.get(id);
    if (!t || t.status !== 'running' || t.endsAt === null) return false;
    const endsAt = t.endsAt;
    let nid: string | null = null;
    try {
      nid = await this.notifier.schedule({ body: t.label, at: new Date(endsAt) });
    } catch {
      nid = null;
    }
    const cur = this.get(id);
    if (nid && (!cur || cur.status !== 'running' || cur.endsAt !== endsAt)) {
      // paused / removed / restarted while scheduling → drop the stale notification
      await this.safeCancel(nid);
      return false;
    }
    if (nid && cur) this.patch(id, { ...cur, notificationId: nid });
    return nid !== null;
  }

  private async safeCancel(nid: string): Promise<void> {
    try {
      await this.notifier.cancel(nid);
    } catch {
      /* ignore */
    }
  }

  private patch(id: string, next: TimerRecord): void {
    this.replaceAll(this.timers.map((t) => (t.id === id ? next : t)));
  }

  private replaceAll(list: readonly TimerRecord[]): void {
    this.timers = sortTimers(list);
    this.emit();
    this.persist();
  }

  private emit(): void {
    for (const f of [...this.subs]) f();
  }

  private persist(): void {
    const body = serializeTimers(this.timers);
    this.writeChain = this.writeChain
      .catch(() => {})
      .then(() => this.storage.setItem(this.key, body))
      .catch(() => {});
  }

  /** Wait for pending storage writes (tests / app background). */
  flush(): Promise<void> {
    return this.writeChain;
  }
}
