/**
 * Persistence for conversations.
 *
 * Keys (no version in the key; the version lives inside the payload so migrations run in place):
 *   hui.conv.index            { v, items: ConversationMeta[], activeId? }      `storage` (AsyncStorage: small)
 *   hui.conv.msgs.<id>        { v, messages: ChatMessage[] }                   `blobs` (files / IndexedDB, see storage/)
 *
 * Write order: on flush all pending message lists are written first, then the index, then removals. A crash
 * in between leaves a stale preview/title (harmless). A FAILED transcript write (storage full) never blocks
 * the rest: the index (new chats, renames, deletions, activeId) and the removals are written anyway, so
 * deleting chats always frees space. The failed list stays pending and is retried (backed off).
 * Orphaned message keys are swept on load. A corrupt index is copied to `hui.conv.index.corrupt`.
 * Transcripts are never swept while that backup exists (they are the only way to recover the lost chats), and
 * an index that could not be READ (I/O error, retried) blocks all index writes for this run: an empty fallback
 * state must never overwrite the real index. `trustedIndex()` tells callers (attachment prune) the same.
 * Likewise a transcript that could not be READ opens as an empty chat but refuses saves until a read succeeds;
 * a corrupt one is copied to `hui.conv.corrupt.<id>` first (a failed copy refuses saves the same way).
 *
 * Writes are throttled (default 400 ms) and strictly serialised.
 * No React / react-native imports so it runs under node:test with an in-memory storage.
 */
import type { ChatMessage } from '../hermes/types.ts';
import { migrateIndex, migrateMessages } from './migrate.ts';
import { attachmentUris, messagesFileJson, prepareForStorage, searchTextOf } from './messages.ts';
import { PERF, perfNow, perfSpan } from '../perf/probe.ts';
import { SCHEMA_VERSION } from './types.ts';
import type { IndexFile, IndexState, MessagesFile } from './types.ts';

export type StorageLike = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys?(): Promise<readonly string[]>;
};

export const INDEX_KEY = 'hui.conv.index';
export const MSGS_PREFIX = 'hui.conv.msgs.';
export const msgsKey = (id: string) => MSGS_PREFIX + id;
/** copy of a transcript that could not be parsed (kept for recovery; not under MSGS_PREFIX, so never swept) */
export const CORRUPT_PREFIX = 'hui.conv.corrupt.';

export type RepoOptions = {
  debounceMs?: number;
  /** where transcripts live (default: `storage`); the index always stays in `storage` */
  blobs?: StorageLike;
  onError?: (e: unknown, what: string) => void;
  /** a flush finished without any failed write (clears a "storage full" notice) */
  onFlushOk?: () => void;
  /** a failed transcript write is retried by throttled flushes at most this often (explicit flush(): always) */
  retryMs?: number;
  now?: () => number;
  /** max conversations kept in the in-memory message cache */
  cacheSize?: number;
};

export type ConversationRepo = ReturnType<typeof createRepo>;

export function createRepo(storage: StorageLike, options: RepoOptions = {}) {
  const debounceMs = options.debounceMs ?? 400;
  const onError = options.onError ?? (() => {});
  const now = options.now ?? Date.now;
  // the open chat + 4 recent chats (start-up prefetch) + 4 Hermes chats fetched ahead (remotePrefetch.ts)
  const cacheSize = options.cacheSize ?? 10;
  const blobs = options.blobs ?? storage;
  const retryMs = options.retryMs ?? 10_000;
  const onFlushOk = options.onFlushOk ?? (() => {});

  const pendingMessages = new Map<string, ChatMessage[]>();
  const pendingRemovals = new Set<string>();
  let pendingIndex: IndexState | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();
  /** id -> last failed write (exponential backoff for throttled flushes: retryMs, 2×, 4× … ≤ 5 min) */
  const failedAt = new Map<string, { at: number; n: number }>();
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const backoff = (n: number) => Math.min(retryMs * 2 ** Math.max(0, n - 1), 300_000);

  /** LRU: id -> stored (stripped+capped) messages */
  const cache = new Map<string, ChatMessage[]>();
  const searchText = new Map<string, string>();
  /** per-conversation mutation counter: a storage read that raced a save/remove is not trusted */
  const gen = new Map<string, number>();
  const bump = (id: string) => {
    gen.set(id, (gen.get(id) ?? 0) + 1);
    knownEmpty.delete(id);
  };
  /**
   * ids read from storage without any stored transcript (a Hermes chat only known from the session list): peeked as
   * empty without another read and without taking an LRU slot; a save / removal forgets it
   */
  const knownEmpty = new Set<string>();
  /** ids whose stored transcript could not be read (I/O error after retries, or corrupt and not quarantined) */
  const unreadable = new Set<string>();
  /** every id known since start (startup index, every saved index, every saved transcript): never swept */
  const liveIds = new Set<string>();
  /** false: the index was unreadable (empty fallback) → no index writes, no sweeps this run */
  let indexWritable = true;
  /** false: unreadable or corrupt index → orphan transcripts/attachments must not be pruned */
  let trusted = true;

  function remember(id: string, messages: ChatMessage[]) {
    cache.delete(id);
    cache.set(id, messages);
    while (cache.size > cacheSize) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    searchText.set(id, searchTextOf(messages));
  }

  async function loadIndex(): Promise<IndexState> {
    let raw: string | null = null;
    for (let attempt = 0; ; attempt++) {
      try {
        raw = await storage.getItem(INDEX_KEY);
        break;
      } catch (e) {
        if (attempt < 2) continue; // transient I/O error: try again
        onError(e, 'loadIndex');
        // NOT "no chats": never persist this empty fallback, never sweep against it
        indexWritable = false;
        trusted = false;
        return { items: [] };
      }
    }
    let state: IndexState = { items: [] };
    /** keep a copy of what was there and stop all sweeping (now and on later starts) until the user resets */
    const quarantine = async (copy: string) => {
      trusted = false; // the transcripts are all that is left of the lost chats: keep them
      try {
        await storage.setItem(INDEX_KEY + '.corrupt', copy);
      } catch {
        // ignore
      }
    };
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        const f = migrateIndex(parsed, now());
        state = { items: f.items, activeId: f.activeId, ...(f.hiddenRemote ? { hiddenRemote: f.hiddenRemote } : {}) };
        // valid JSON but not an index (`{}`, `null`, …) or entries that had to be dropped: not authoritative
        const items = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? (parsed as { items?: unknown }).items : undefined;
        if (!Array.isArray(items) || items.length !== f.items.length) {
          onError(new Error('index structurally invalid'), 'index corrupt');
          await quarantine(raw);
        }
      } catch (e) {
        onError(e, 'index corrupt');
        await quarantine(raw);
      }
    } else {
      // no index at all: a fresh install – or lost metadata next to intact transcripts (Astra F01)
      trusted = false;
      if (blobs.getAllKeys) {
        void blobs
          .getAllKeys()
          .then((keys) => (keys.some((k) => k.startsWith(MSGS_PREFIX)) ? quarantine('{"missing":true}') : undefined))
          .catch(() => {});
      }
    }
    for (const c of state.items) liveIds.add(c.id);
    if (trusted) {
      // an earlier corrupt index left its backup: its orphaned transcripts stay until the user resets storage
      try {
        if ((await storage.getItem(INDEX_KEY + '.corrupt')) !== null) trusted = false;
      } catch {
        trusted = false;
      }
    }
    if (trusted) void sweepOrphans();
    return state;
  }

  /**
   * Delete transcripts no conversation references. Keys are listed outside the write queue (may be slow), the
   * deletions run inside it and recheck every id against everything known by then (chats created/saved while
   * the listing was in flight are kept).
   */
  async function sweepOrphans() {
    if (!blobs.getAllKeys) return;
    let keys: readonly string[];
    try {
      keys = await blobs.getAllKeys();
    } catch (e) {
      onError(e, 'sweep');
      return;
    }
    const run = async () => {
      for (const k of keys) {
        if (!k.startsWith(MSGS_PREFIX)) continue;
        const id = k.slice(MSGS_PREFIX.length);
        if (!trusted || liveIds.has(id) || pendingMessages.has(id)) continue;
        try {
          await blobs.removeItem(k);
        } catch (e) {
          onError(e, 'sweep');
        }
      }
    };
    chain = chain.then(run, run);
    await chain;
  }

  /**
   * The transcript when it is already in memory (pending write or LRU cache), else undefined – synchronous, so a
   * chat whose messages were prefetched mounts with them on its first render (no blank frame, no storage hop).
   */
  function peekMessages(id: string): ChatMessage[] | undefined {
    const pending = pendingMessages.get(id);
    if (pending) return pending;
    const hit = cache.get(id);
    if (hit) remember(id, hit);
    else if (knownEmpty.has(id)) return [];
    return hit;
  }

  /** storage reads in flight per id: a prefetch and the chat opening right after it share one read + parse */
  const reading = new Map<string, Promise<ChatMessage[]>>();

  async function loadMessages(id: string): Promise<ChatMessage[]> {
    const mem = peekMessages(id);
    if (mem) return mem;
    const inflight = reading.get(id);
    if (inflight) return inflight;
    const p = readMessages(id).finally(() => {
      if (reading.get(id) === p) reading.delete(id);
    });
    reading.set(id, p);
    return p;
  }

  async function readMessages(id: string): Promise<ChatMessage[]> {
    const g = gen.get(id) ?? 0;
    // saved/removed while the read was in flight: the stored copy is older than what the app has now
    const raced = () => (gen.get(id) ?? 0) !== g;
    const newer = () => pendingMessages.get(id) ?? cache.get(id) ?? [];
    let raw: string | null;
    for (let attempt = 0; ; attempt++) {
      try {
        raw = await blobs.getItem(msgsKey(id));
        break;
      } catch (e) {
        if (raced()) return newer();
        if (attempt < 2) continue; // transient I/O error: try again
        onError(e, 'loadMessages');
        // NOT "no messages": the chat opens empty, but nothing may be saved over the real transcript (Sol F01)
        unreadable.add(id);
        return [];
      }
    }
    if (raced()) return newer();
    if (!raw) {
      unreadable.delete(id);
      knownEmpty.add(id);
      searchText.set(id, '');
      return [];
    }
    try {
      const f: MessagesFile = migrateMessages(JSON.parse(raw));
      unreadable.delete(id);
      remember(id, f.messages);
      return f.messages;
    } catch (e) {
      onError(e, 'loadMessages');
      // corrupt: keep a copy first; only then may the (empty) chat be saved over it
      unreadable.add(id);
      try {
        await blobs.setItem(CORRUPT_PREFIX + id, raw);
        unreadable.delete(id);
      } catch (e2) {
        onError(e2, 'quarantine');
      }
      return raced() ? newer() : [];
    }
  }

  /**
   * Queue a (debounced) write. Returns what will actually be stored (stripped + capped), or null when refused: the
   * stored transcript exists but could not be read, so `messages` grew from an empty fallback (Sol F01).
   */
  function saveMessages(id: string, messages: ChatMessage[]): ChatMessage[] | null {
    if (unreadable.has(id)) {
      onError(new Error('transcript unreadable'), 'saveMessages blocked');
      return null;
    }
    const prepared = prepareForStorage(messages);
    bump(id);
    liveIds.add(id);
    pendingRemovals.delete(id);
    pendingMessages.set(id, prepared);
    failedAt.delete(id); // new content: write it on the next flush
    remember(id, prepared);
    schedule();
    return prepared;
  }

  function saveIndex(state: IndexState) {
    for (const c of state.items) liveIds.add(c.id);
    if (!indexWritable) return; // the real index could not be read: never replace it with this run's view
    pendingIndex = state;
    schedule();
  }

  function removeMessages(id: string) {
    bump(id);
    unreadable.delete(id); // deleting the chat is explicit
    pendingMessages.delete(id);
    failedAt.delete(id);
    cache.delete(id);
    searchText.delete(id);
    pendingRemovals.add(id);
    schedule();
  }

  /** Throttled (not re-armed on every call) so a long stream still gets written every `debounceMs`. */
  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      chain = chain.then(() => doFlush(false), () => doFlush(false));
    }, debounceMs);
  }

  /** Write everything that is pending now (failed writes are retried at once); resolves when done. Call on app background. */
  function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    chain = chain.then(() => doFlush(true), () => doFlush(true));
    return chain;
  }

  async function doFlush(force: boolean) {
    let failures = 0;
    // 1) message lists (a failure is remembered and retried, it never holds back steps 2 and 3)
    for (const [id, list] of Array.from(pendingMessages)) {
      const last = failedAt.get(id);
      if (!force && last && now() - last.at < backoff(last.n)) {
        failures++;
        continue;
      }
      try {
        // = JSON.stringify({ v, messages }) with the JSON of unchanged messages reused (messages.ts)
        const t0 = PERF ? perfNow() : 0;
        const json = messagesFileJson(SCHEMA_VERSION, list);
        if (PERF) perfSpan('save.json', t0);
        await blobs.setItem(msgsKey(id), json);
        if (pendingMessages.get(id) === list) pendingMessages.delete(id);
        failedAt.delete(id);
      } catch (e) {
        failures++;
        failedAt.set(id, { at: now(), n: (failedAt.get(id)?.n ?? 0) + 1 });
        onError(e, 'saveMessages'); // stays pending
      }
    }
    // 2) index – always: new chats, titles, deletions and activeId must not depend on a big transcript
    if (pendingIndex) {
      const state = pendingIndex;
      try {
        const file: IndexFile = {
          v: SCHEMA_VERSION,
          items: state.items,
          activeId: state.activeId,
          ...(state.hiddenRemote?.length ? { hiddenRemote: state.hiddenRemote } : {}),
        };
        await storage.setItem(INDEX_KEY, JSON.stringify(file));
        if (pendingIndex === state) pendingIndex = null;
      } catch (e) {
        failures++;
        onError(e, 'saveIndex');
      }
    }
    // 3) removals – always: deleting chats is how the user frees space
    for (const id of Array.from(pendingRemovals)) {
      try {
        await blobs.removeItem(msgsKey(id));
        pendingRemovals.delete(id);
      } catch (e) {
        failures++;
        onError(e, 'remove');
      }
    }
    if (!failures) onFlushOk();
    // something failed and is still pending (transcript, index or removal): try again later without waiting
    // for the next change
    const remaining = pendingMessages.size > 0 || pendingIndex !== null || pendingRemovals.size > 0;
    if (failures && remaining && !retryTimer) {
      let wait = retryMs;
      for (const f of failedAt.values()) wait = Math.max(wait, backoff(f.n));
      retryTimer = setTimeout(() => {
        retryTimer = null;
        chain = chain.then(() => doFlush(false), () => doFlush(false));
      }, wait);
      (retryTimer as { unref?: () => void }).unref?.(); // node: never keep a test process alive
    }
  }

  /**
   * Attachment file uris referenced by a stored conversation, WITHOUT filling the message cache or the
   * search text (startup orphan prune): the raw JSON is scanned instead of parsed.
   */
  async function attachmentUrisOf(id: string): Promise<string[]> {
    const live = pendingMessages.get(id) ?? cache.get(id);
    if (live) return attachmentUris(live);
    let raw: string | null = null;
    try {
      raw = await blobs.getItem(msgsKey(id));
    } catch (e) {
      onError(e, 'attachmentUris');
      throw e; // the caller must not treat an unreadable chat as "no attachments"
    }
    return raw ? uriFieldsOf(raw) : [];
  }

  /** Make sure search text exists for these ids (reads from storage when needed). */
  async function ensureSearchTexts(ids: string[]) {
    for (const id of ids) {
      if (!searchText.has(id)) await loadMessages(id);
    }
  }

  return {
    loadIndex,
    saveIndex,
    loadMessages,
    peekMessages,
    saveMessages,
    removeMessages,
    flush,
    ensureSearchTexts,
    attachmentUrisOf,
    searchTextOf: (id: string) => searchText.get(id),
    /** false when the index was unreadable or corrupt: do not prune anything "unreferenced" (attachments) */
    trustedIndex: () => trusted,
    /** true when something has not reached storage yet */
    hasPending: () => pendingMessages.size > 0 || pendingIndex !== null || pendingRemovals.size > 0,
  };
}

/** Values of every `"uri":"…"` field in a JSON text (superset of the attachment uris; cheap, no parse). */
export function uriFieldsOf(raw: string): string[] {
  const out: string[] = [];
  const re = /"uri"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    try {
      out.push(JSON.parse(`"${m[1]}"`) as string);
    } catch {
      out.push(m[1]);
    }
  }
  return out;
}
