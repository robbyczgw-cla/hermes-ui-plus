/**
 * What only this device knows about a chat's live cards (design §6.3): pending edits (precious: never evicted, written
 * at once, no debounce), which version the user last looked at per card (highlights), and which cards are unpinned
 * here (pinning is per device). One small record per chat under `hui.live.<conversationId>`. No React, storage
 * injected (unit-testable).
 */
import type { PendingMap } from './pending.ts';

export type KeyValueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export interface LiveLocalRecord {
  pending: PendingMap;
  /** card → version number last seen in the open card */
  seen: Record<string, number>;
  /** cards this device took out of the tray */
  unpinned: string[];
  /** batch ids sent from this device (newest last, capped): the history says "dieses Gerät" */
  own?: string[];
  /** plain lists this device made live cards ("<messageId>:<nodeId>" → card id): the old list points to the card */
  adopted?: Record<string, string>;
}

export const LIVE_PREFIX = 'hui.live.';
export const MAX_OWN = 200;
export const EMPTY_RECORD: LiveLocalRecord = Object.freeze({ pending: {}, seen: {}, unpinned: [] }) as LiveLocalRecord;

const isRec = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

export function parseRecord(raw: string | null): LiveLocalRecord {
  if (!raw) return EMPTY_RECORD;
  try {
    const x = JSON.parse(raw) as unknown;
    if (!isRec(x)) return EMPTY_RECORD;
    return {
      pending: isRec(x.pending) ? (x.pending as PendingMap) : {},
      seen: isRec(x.seen) ? (x.seen as Record<string, number>) : {},
      unpinned: Array.isArray(x.unpinned) ? x.unpinned.filter((s): s is string => typeof s === 'string') : [],
      ...(Array.isArray(x.own) ? { own: x.own.filter((s): s is string => typeof s === 'string').slice(-MAX_OWN) } : {}),
      ...(isRec(x.adopted) ? { adopted: x.adopted as Record<string, string> } : {}),
    };
  } catch {
    return EMPTY_RECORD;
  }
}

type Entry = { rec: LiveLocalRecord; loaded: boolean; loading: Promise<void> | null; chain: Promise<void>; listeners: Set<() => void> };

export class LiveLocalStore {
  private readonly entries = new Map<string, Entry>();
  private readonly storage: KeyValueStorage;
  private readonly onWriteError: (e: unknown) => void;
  constructor(storage: KeyValueStorage, onWriteError: (e: unknown) => void = () => {}) {
    this.storage = storage;
    this.onWriteError = onWriteError;
  }

  private entry(conv: string): Entry {
    let e = this.entries.get(conv);
    if (!e) {
      e = { rec: EMPTY_RECORD, loaded: false, loading: null, chain: Promise.resolve(), listeners: new Set() };
      this.entries.set(conv, e);
    }
    return e;
  }

  /** Current record (EMPTY_RECORD until loaded); identity changes on every update (useSyncExternalStore). */
  get(conv: string): LiveLocalRecord {
    return this.entry(conv).rec;
  }

  isLoaded(conv: string): boolean {
    return this.entry(conv).loaded;
  }

  load(conv: string): Promise<void> {
    const e = this.entry(conv);
    if (e.loaded) return Promise.resolve();
    e.loading ??= this.storage
      .getItem(LIVE_PREFIX + conv)
      .then((raw) => {
        // updates made before the load finished win over the stored copy, per card
        const stored = parseRecord(raw);
        const cur = e.rec;
        e.rec = cur === EMPTY_RECORD ? stored : { pending: { ...stored.pending, ...cur.pending }, seen: { ...stored.seen, ...cur.seen }, unpinned: Array.from(new Set([...stored.unpinned, ...cur.unpinned])), own: [...(stored.own ?? []), ...(cur.own ?? [])].slice(-MAX_OWN), adopted: { ...stored.adopted, ...cur.adopted } };
      })
      .catch(() => {})
      .then(() => {
        e.loaded = true;
        this.emit(e);
      });
    return e.loading;
  }

  /** Apply `fn` and write at once (writes of one chat are serialised). */
  update(conv: string, fn: (r: LiveLocalRecord) => LiveLocalRecord): void {
    const e = this.entry(conv);
    const next = fn(e.rec);
    if (next === e.rec) return;
    e.rec = next;
    this.emit(e);
    const empty = !Object.keys(next.pending).length && !Object.keys(next.seen).length && !next.unpinned.length && !Object.keys(next.adopted ?? {}).length;
    const json = JSON.stringify(next);
    e.chain = e.chain
      .then(() => (empty ? this.storage.removeItem(LIVE_PREFIX + conv) : this.storage.setItem(LIVE_PREFIX + conv, json)))
      .catch((err) => this.onWriteError(err));
  }

  subscribe(conv: string, fn: () => void): () => void {
    const e = this.entry(conv);
    e.listeners.add(fn);
    return () => {
      e.listeners.delete(fn);
    };
  }

  /** Wait for queued writes (tests, export). */
  flush(conv: string): Promise<void> {
    return this.entry(conv).chain;
  }

  deleteConversation(conv: string): Promise<void> {
    const e = this.entry(conv);
    e.rec = EMPTY_RECORD;
    this.emit(e);
    return this.storage.removeItem(LIVE_PREFIX + conv).catch(() => {});
  }

  private emit(e: Entry): void {
    for (const f of Array.from(e.listeners)) f();
  }
}
