/**
 * Pure node-state logic (no React / AsyncStorage): record shape, size accounting, LRU eviction,
 * (de)serialization. Only erasable TS so node:test can run it.
 */

export const STORAGE_PREFIX = 'hui.nodestate.';
export const RECORD_FORMAT = 1;

export const MAX_NODE_BYTES = 32 * 1024;
export const MAX_CONVERSATION_BYTES = 512 * 1024;

export type NodeRecord = {
  /** schema version chosen by the component (bump to discard incompatible old state) */
  v: number;
  data: unknown;
  /** epoch ms of the last write (LRU key) */
  updatedAt: number;
};

/** `{[messageId:nodeId]: NodeRecord}` */
export type ConversationRecord = Record<string, NodeRecord>;

export type Limits = { maxNodeBytes: number; maxConversationBytes: number };
export const DEFAULT_LIMITS: Limits = { maxNodeBytes: MAX_NODE_BYTES, maxConversationBytes: MAX_CONVERSATION_BYTES };

export function storageKey(conversationId: string): string {
  return STORAGE_PREFIX + conversationId;
}

export function nodeKey(messageId: string, nodeId: string): string {
  return `${messageId}:${nodeId}`;
}

/** Split a node key at the FIRST colon (message ids never contain one; node ids might). */
export function splitNodeKey(key: string): { messageId: string; nodeId: string } {
  const i = key.indexOf(':');
  return i < 0 ? { messageId: '', nodeId: key } : { messageId: key.slice(0, i), nodeId: key.slice(i + 1) };
}

/** UTF-8 byte length of a string (no TextEncoder dependency). */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** Records are treated as immutable, so their size can be cached per object. */
const sizeCache = new WeakMap<NodeRecord, number>();

/** Approximate persisted size of one node (key + JSON). */
export function nodeBytes(key: string, rec: NodeRecord): number {
  const hit = sizeCache.get(rec);
  if (hit !== undefined) return hit;
  let n: number;
  try {
    n = utf8Length(key) + utf8Length(JSON.stringify(rec)) + 4;
  } catch {
    n = Number.MAX_SAFE_INTEGER;
  }
  sizeCache.set(rec, n);
  return n;
}

export function recordBytes(rec: ConversationRecord): number {
  let n = 32;
  for (const k of Object.keys(rec)) n += nodeBytes(k, rec[k]);
  return n;
}

/** Functional update: `next` is a value or an updater of the previous value. */
export function resolveUpdate<T>(prev: T, next: T | ((prev: T) => T)): T {
  return typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
}

export type SetResult = {
  rec: ConversationRecord;
  /** keys removed by LRU eviction */
  evicted: string[];
  /** set when the write was refused (existing value stays) */
  rejected?: 'too_large' | 'not_serializable';
};

/**
 * Write one node. Refuses data over `maxNodeBytes`. Afterwards evicts the least recently updated
 * OTHER nodes until the conversation fits `maxConversationBytes`.
 */
export function setNode(rec: ConversationRecord, key: string, data: unknown, v: number, now: number, limits: Limits = DEFAULT_LIMITS): SetResult {
  const node: NodeRecord = { v, data, updatedAt: now };
  let bytes: number;
  try {
    if (JSON.stringify(data) === undefined) return { rec, evicted: [], rejected: 'not_serializable' };
    bytes = nodeBytes(key, node);
  } catch {
    return { rec, evicted: [], rejected: 'not_serializable' };
  }
  if (bytes > limits.maxNodeBytes) return { rec, evicted: [], rejected: 'too_large' };
  const next: ConversationRecord = { ...rec, [key]: node };
  const evicted = evictLru(next, limits.maxConversationBytes, key);
  return { rec: next, evicted };
}

/** Mutates `rec`: drops oldest nodes (never `protectKey`) until it fits. Returns the dropped keys. */
export function evictLru(rec: ConversationRecord, maxBytes: number, protectKey?: string): string[] {
  let total = recordBytes(rec);
  if (total <= maxBytes) return [];
  const order = Object.keys(rec)
    .filter((k) => k !== protectKey)
    .sort((a, b) => rec[a].updatedAt - rec[b].updatedAt || (a < b ? -1 : 1));
  const evicted: string[] = [];
  for (const k of order) {
    if (total <= maxBytes) break;
    total -= nodeBytes(k, rec[k]);
    delete rec[k];
    evicted.push(k);
  }
  return evicted;
}

export function removeNode(rec: ConversationRecord, key: string): ConversationRecord {
  if (!(key in rec)) return rec;
  const next = { ...rec };
  delete next[key];
  return next;
}

/** Remove every node of a message (e.g. regenerate / edit). */
export function removeMessageNodes(rec: ConversationRecord, messageId: string): { rec: ConversationRecord; removed: string[] } {
  const prefix = messageId + ':';
  const removed = Object.keys(rec).filter((k) => k.startsWith(prefix));
  if (!removed.length) return { rec, removed };
  const next = { ...rec };
  for (const k of removed) delete next[k];
  return { rec: next, removed };
}

export function serializeRecord(rec: ConversationRecord): string {
  return JSON.stringify({ f: RECORD_FORMAT, nodes: rec });
}

function isNodeRecord(x: unknown): x is NodeRecord {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return typeof o.v === 'number' && 'data' in o && typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt);
}

/** Tolerant parse: corrupt JSON / unknown format → empty; invalid nodes are dropped. */
export function parseRecord(raw: string | null | undefined): ConversationRecord {
  if (!raw) return {};
  try {
    const j = JSON.parse(raw) as unknown;
    if (typeof j !== 'object' || j === null) return {};
    const o = j as { f?: unknown; nodes?: unknown };
    if (o.f !== RECORD_FORMAT || typeof o.nodes !== 'object' || o.nodes === null || Array.isArray(o.nodes)) return {};
    const out: ConversationRecord = {};
    for (const [k, v] of Object.entries(o.nodes as Record<string, unknown>)) if (isNodeRecord(v)) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

/**
 * Merge a freshly loaded record with writes made while loading (`local` wins for `touched` keys;
 * touched keys missing in `local` were removed meanwhile).
 */
export function mergeLoaded(loaded: ConversationRecord, local: ConversationRecord, touched: ReadonlySet<string>): ConversationRecord {
  const out = { ...loaded };
  for (const k of touched) {
    if (k in local) out[k] = local[k];
    else delete out[k];
  }
  return out;
}
