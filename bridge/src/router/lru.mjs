/** Tiny LRU map with TTL (Map preserves insertion order). */
export class LruCache {
  /** @param {{max?: number, ttlMs?: number, now?: () => number}} [o] */
  constructor(o = {}) {
    this.max = o.max ?? 1000;
    this.ttlMs = o.ttlMs ?? 3600_000;
    this.now = o.now ?? Date.now;
    /** @type {Map<string, {v: any, exp: number}>} */
    this.map = new Map();
  }
  /** @param {string} k */
  get(k) {
    const e = this.map.get(k);
    if (!e) return undefined;
    if (e.exp <= this.now()) {
      this.map.delete(k);
      return undefined;
    }
    this.map.delete(k);
    this.map.set(k, e);
    return e.v;
  }
  /** @param {string} k @param {any} v */
  set(k, v) {
    this.map.delete(k);
    this.map.set(k, { v, exp: this.now() + this.ttlMs });
    while (this.map.size > this.max) this.map.delete(/** @type {string} */ (this.map.keys().next().value));
  }
  get size() {
    return this.map.size;
  }
}
