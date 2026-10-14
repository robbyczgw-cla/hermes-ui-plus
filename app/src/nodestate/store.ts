/**
 * NodeStateStore: per-conversation cache + debounced persistence. No React, no AsyncStorage import
 * (the storage is injected) so it is unit-testable with node:test.
 */
import {
  DEFAULT_LIMITS,
  evictLru,
  mergeLoaded,
  parseRecord,
  removeMessageNodes,
  removeNode,
  serializeRecord,
  setNode,
  storageKey,
  STORAGE_PREFIX,
  type ConversationRecord,
  type Limits,
  type NodeRecord,
} from './model.ts';

export type KeyValueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys?(): Promise<readonly string[]>;
};

export type StoreOptions = {
  storage: KeyValueStorage;
  debounceMs?: number;
  limits?: Limits;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** called when a write was refused (too large) – default: console.warn */
  onReject?: (info: { conversationId: string; key: string; reason: string }) => void;
  /** a storage write failed (e.g. storage full); the record stays dirty and is retried on the next write / flush */
  onWriteError?: (e: unknown, conversationId: string) => void;
};

type Entry = {
  rec: ConversationRecord;
  loaded: boolean;
  loading: Promise<void> | null;
  /** keys written/removed before the initial load finished */
  touched: Set<string>;
  dirty: boolean;
  timer: unknown;
  /** serialises storage writes of this conversation */
  chain: Promise<void>;
  deleted: boolean;
};

const SEP = '\u0000';

export class NodeStateStore {
  private readonly storage: KeyValueStorage;
  private readonly debounceMs: number;
  private readonly limits: Limits;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;
  private readonly onReject: NonNullable<StoreOptions['onReject']>;
  private readonly onWriteError: NonNullable<StoreOptions['onWriteError']>;
  private readonly entries = new Map<string, Entry>();
  private readonly subs = new Map<string, Set<() => void>>();

  constructor(o: StoreOptions) {
    this.storage = o.storage;
    this.debounceMs = o.debounceMs ?? 300;
    this.limits = o.limits ?? DEFAULT_LIMITS;
    this.now = o.now ?? Date.now;
    this.setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = o.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.onWriteError = o.onWriteError ?? (() => {});
    this.onReject =
      o.onReject ??
      ((i) => {
        console.warn(`[nodestate] write refused (${i.reason}): ${i.conversationId} ${i.key}`);
      });
  }

  // ---- reading -------------------------------------------------------------------------------

  /** Synchronous cache read (undefined while not loaded / missing). Stable reference between writes. */
  peek(conversationId: string, key: string): NodeRecord | undefined {
    return this.entries.get(conversationId)?.rec[key];
  }

  isLoaded(conversationId: string): boolean {
    return this.entries.get(conversationId)?.loaded === true;
  }

  /** Load a conversation's record from storage (idempotent, concurrent calls share one read). */
  load(conversationId: string): Promise<void> {
    const e = this.entry(conversationId);
    if (e.loaded) return Promise.resolve();
    if (e.loading) return e.loading;
    e.loading = (async () => {
      let raw: string | null = null;
      try {
        raw = await this.storage.getItem(storageKey(conversationId));
      } catch {
        raw = null;
      }
      if (e.deleted) return;
      const loaded = parseRecord(raw);
      const hadLocal = e.touched.size > 0;
      e.rec = mergeLoaded(loaded, e.rec, e.touched);
      const dropped = evictLru(e.rec, this.limits.maxConversationBytes);
      e.touched.clear();
      e.loaded = true;
      e.loading = null;
      if (hadLocal || dropped.length) this.markDirty(conversationId, e);
      this.notifyAll(conversationId);
    })();
    return e.loading;
  }

  /** The whole record of a conversation (loads it first). */
  async getRecord(conversationId: string): Promise<ConversationRecord> {
    await this.load(conversationId);
    return this.entries.get(conversationId)?.rec ?? {};
  }

  // ---- writing -------------------------------------------------------------------------------

  /** Write a node; the cache updates synchronously, storage after the debounce. Returns false if refused. */
  set(conversationId: string, key: string, data: unknown, version = 1): boolean {
    const e = this.entry(conversationId);
    const r = setNode(e.rec, key, data, version, this.now(), this.limits);
    if (r.rejected) {
      this.onReject({ conversationId, key, reason: r.rejected });
      return false;
    }
    e.rec = r.rec;
    if (!e.loaded) {
      e.touched.add(key);
      for (const k of r.evicted) e.touched.add(k);
    }
    this.markDirty(conversationId, e);
    this.notify(conversationId, key);
    for (const k of r.evicted) this.notify(conversationId, k);
    if (!e.loaded) void this.load(conversationId);
    return true;
  }

  remove(conversationId: string, key: string): void {
    const e = this.entry(conversationId);
    const next = removeNode(e.rec, key);
    if (next === e.rec) {
      if (!e.loaded) e.touched.add(key);
      return;
    }
    e.rec = next;
    if (!e.loaded) e.touched.add(key);
    this.markDirty(conversationId, e);
    this.notify(conversationId, key);
  }

  /** Drop all node state of one message (regenerate / edit). */
  removeMessage(conversationId: string, messageId: string): void {
    const e = this.entry(conversationId);
    const { rec, removed } = removeMessageNodes(e.rec, messageId);
    if (!removed.length) return;
    e.rec = rec;
    if (!e.loaded) for (const k of removed) e.touched.add(k);
    this.markDirty(conversationId, e);
    for (const k of removed) this.notify(conversationId, k);
  }

  /** Delete all node state of a conversation (cache + storage). Mounted hooks fall back to `initial`. */
  async deleteConversation(conversationId: string): Promise<void> {
    const e = this.entries.get(conversationId);
    if (e) {
      if (e.timer !== null) this.clearTimer(e.timer);
      e.timer = null;
      e.dirty = false;
      e.deleted = true;
      e.rec = {};
      e.touched.clear();
      this.entries.delete(conversationId);
      this.notifyAll(conversationId);
      await e.chain.catch(() => {});
    }
    try {
      await this.storage.removeItem(storageKey(conversationId));
    } catch {
      /* ignore */
    }
  }

  // ---- persistence ---------------------------------------------------------------------------

  /** Write everything pending right now (call when the app goes to the background). */
  async flush(): Promise<void> {
    const jobs: Promise<void>[] = [];
    await Promise.all([...this.entries.values()].map((e) => e.loading));
    for (const [id, e] of this.entries) {
      if (e.timer !== null) {
        this.clearTimer(e.timer);
        e.timer = null;
      }
      if (e.dirty) jobs.push(this.persist(id, e));
      else jobs.push(e.chain);
    }
    await Promise.all(jobs);
  }

  /** Conversation ids that have cached state (for tests / diagnostics). */
  cachedConversations(): string[] {
    return [...this.entries.keys()];
  }

  // ---- export --------------------------------------------------------------------------------

  async exportConversation(conversationId: string): Promise<{ conversationId: string; nodes: ConversationRecord }> {
    return { conversationId, nodes: { ...(await this.getRecord(conversationId)) } };
  }

  /** Needs `storage.getAllKeys`. */
  async exportAll(): Promise<{ conversations: Record<string, ConversationRecord> }> {
    await this.flush();
    const out: Record<string, ConversationRecord> = {};
    const keys = (await this.storage.getAllKeys?.()) ?? [];
    for (const k of keys) {
      if (!k.startsWith(STORAGE_PREFIX)) continue;
      const id = k.slice(STORAGE_PREFIX.length);
      out[id] = await this.getRecord(id);
    }
    return { conversations: out };
  }

  // ---- subscriptions -------------------------------------------------------------------------

  subscribe(conversationId: string, key: string, fn: () => void): () => void {
    const k = conversationId + SEP + key;
    let set = this.subs.get(k);
    if (!set) this.subs.set(k, (set = new Set()));
    set.add(fn);
    return () => {
      const s = this.subs.get(k);
      if (!s) return;
      s.delete(fn);
      if (!s.size) this.subs.delete(k);
    };
  }

  // ---- internals -----------------------------------------------------------------------------

  private entry(conversationId: string): Entry {
    let e = this.entries.get(conversationId);
    if (!e) {
      e = { rec: {}, loaded: false, loading: null, touched: new Set(), dirty: false, timer: null, chain: Promise.resolve(), deleted: false };
      this.entries.set(conversationId, e);
    }
    return e;
  }

  private markDirty(conversationId: string, e: Entry): void {
    e.dirty = true;
    if (!e.loaded) return; // persisted right after the load finished (load() re-marks)
    if (e.timer !== null) this.clearTimer(e.timer);
    e.timer = this.setTimer(() => {
      e.timer = null;
      void this.persist(conversationId, e);
    }, this.debounceMs);
  }

  private persist(conversationId: string, e: Entry): Promise<void> {
    if (!e.loaded) return e.chain; // never overwrite storage with a partial (not yet merged) record
    if (!e.dirty) return e.chain;
    e.dirty = false;
    const rec = e.rec;
    const empty = Object.keys(rec).length === 0;
    const body = empty ? null : serializeRecord(rec);
    e.chain = e.chain
      .catch(() => {})
      .then(async () => {
        if (e.deleted) return;
        try {
          if (body === null) await this.storage.removeItem(storageKey(conversationId));
          else await this.storage.setItem(storageKey(conversationId), body);
        } catch (err) {
          e.dirty = true; // retry on the next write / flush
          this.onWriteError(err, conversationId);
        }
      });
    return e.chain;
  }

  private notify(conversationId: string, key: string): void {
    const s = this.subs.get(conversationId + SEP + key);
    if (s) for (const f of [...s]) f();
  }

  private notifyAll(conversationId: string): void {
    const p = conversationId + SEP;
    for (const [k, s] of this.subs) if (k.startsWith(p)) for (const f of [...s]) f();
  }
}
