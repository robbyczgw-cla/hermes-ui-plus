/**
 * Image strategy for `products` / `places` items (ChatGPT-like): every item gets a real photo through OUR image
 * search instead of depending on model-written shop/CDN URLs (which the trust policy turns into tap-to-load).
 *
 * Resolution order per item:
 *   0. `image` (https, from Hermes' tools) through the user's bridge image proxy when it advertises one (proxy.ts):
 *      loads at once (unless Settings says "Erst nach Tippen": then only after a tap), the image host only sees the
 *      bridge. If it fails, the caller drops `image` → steps 2-5.
 *   1. `image` when it may load now (trusted host / own search result / session unlock / "Immer laden")
 *   2. `imageQuery` through our image search (bridge web search → own key → Wikimedia; results are trusted)
 *   3. an automatic query derived from the item (products: brand + name · places: name + city + category)
 *   4. the untrusted `image` as tap-to-load ("Bild von <host> laden") – where the caller allows it (cards + detail sheet)
 *   5. category icon
 * Searches go through a small shared queue (max 3 concurrent, identical queries deduplicated); callers only
 * enqueue once the card is (nearly) visible. Pure: no RN imports (tested in itemImage.test.ts).
 */
import { normalizeImageQuery } from '../protocol/validate.ts';
import type { ResolvedImage } from './types.ts';

const isHttpUrl = (u: string | undefined): u is string => !!u && /^https?:\/\/\S+\.\S+/i.test(u);
const lc = (s: string) => s.toLocaleLowerCase();
const words = (s: string) => lc(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** every word of `part` already appears in `whole` */
const covered = (whole: string, part: string) => {
  const w = new Set(words(whole));
  const p = words(part);
  return p.length > 0 && p.every((x) => w.has(x));
};

/** Products: "brand name" (brand dropped when the name already contains it). */
export function productImageQuery(p: { brand?: string; name?: string }): string | undefined {
  const name = p.name?.trim() ?? '';
  const brand = p.brand?.trim() ?? '';
  if (!name) return normalizeImageQuery(brand);
  return normalizeImageQuery(brand && !covered(name, brand) ? `${brand} ${name}` : name);
}

const POSTCODE = /\b(?:[A-Z]{1,2}-)?\d{4,6}\b|\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}\b/g;

/**
 * City part of a free-form address: the segment holding the postcode (postcode / region code stripped),
 * else the second-to-last segment of a 3+ part address, else the last of two. '' when unknown.
 * "Via dei Fori Imperiali 1, 00184 Roma RM, Italien" → "Roma" · "1 Main St, Springfield, IL 62701" → "Springfield".
 */
export function addressCity(address: string | undefined): string {
  if (!address) return '';
  const segs = address.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  if (segs.length < 2) return '';
  const tidy = (s: string) =>
    s
      .replace(POSTCODE, ' ')
      .replace(/\b[A-Z]{1,3}\b/g, ' ') // "RM", "IL", "NY"
      .replace(/\s+/g, ' ')
      .trim();
  const usable = (s: string) => s.length >= 3 && !/\d/.test(s);
  const pc = segs.findIndex((s, i) => i > 0 && /\d{4,6}|[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}/.test(s));
  if (pc > 0) {
    const c = tidy(segs[pc]);
    if (usable(c)) return c;
    const prev = tidy(segs[pc - 1]);
    return pc - 1 > 0 && usable(prev) ? prev : '';
  }
  const c = tidy(segs.length >= 3 ? segs[segs.length - 2] : segs[1]);
  return usable(c) ? c : '';
}

/** Places: "name city category" (parts already contained in the name are skipped). */
export function placeImageQuery(p: { name?: string; address?: string; category?: string }): string | undefined {
  const name = p.name?.trim() ?? '';
  if (!name) return undefined;
  const parts = [name];
  for (const extra of [addressCity(p.address), p.category?.trim() ?? '']) {
    if (extra && !covered(parts.join(' '), extra)) parts.push(extra);
  }
  return normalizeImageQuery(parts.join(' '));
}

export type LoadDecision = (url: string) => 'load' | 'ask';

export type ItemImagePlan = {
  /** step 0/1: loads directly (step 0: the bridge proxy URL) */
  direct?: string;
  /** step 0: the answer's original URL behind the proxy URL (attribution) */
  directSource?: string;
  /** steps 2 + 3, deduplicated, in order */
  queries: { query: string; step: 'query' | 'auto' }[];
  /** step 4: untrusted model URL (tap-to-load placeholder where the caller allows it) */
  askUrl?: string;
};

/**
 * `opts.proxy`: answer URL → bridge proxy URL, or null (no proxy / not proxyable). Pass it only when images may
 * load (Settings → Medien → Bilder laden); without it the trust policy decides as before.
 * `opts.proxyAuto` (default true; false for "Erst nach Tippen", trust.proxiedImagesAutoLoad): a proxied image loads
 * without a tap. When false, `decide(url)` of the answer URL is respected: it waits (tap-to-load) and, once unlocked,
 * still loads through the proxy.
 */
export function planItemImage(
  item: { image?: string; imageQuery?: string; autoQuery?: string },
  decide: LoadDecision,
  opts: { searchAllowed?: boolean; proxy?: (url: string) => string | null; proxyAuto?: boolean } = {},
): ItemImagePlan {
  const url = isHttpUrl(item.image) ? item.image : undefined;
  const proxied = url && opts.proxy ? opts.proxy(url) : null;
  if (url && proxied && ((opts.proxyAuto ?? true) || decide(url) === 'load')) return { direct: proxied, directSource: url, queries: [] };
  if (url && decide(url) === 'load') return { direct: url, queries: [] };
  const queries: ItemImagePlan['queries'] = [];
  if (opts.searchAllowed ?? true) {
    const seen = new Set<string>();
    for (const [raw, step] of [
      [item.imageQuery, 'query'],
      [item.autoQuery, 'auto'],
    ] as const) {
      const q = normalizeImageQuery(raw);
      if (!q || seen.has(lc(q))) continue;
      seen.add(lc(q));
      queries.push({ query: q, step });
    }
  }
  return { queries, ...(url ? { askUrl: url } : {}) };
}

export type ItemImageResult =
  | { kind: 'image'; image: ResolvedImage; step: 'direct' | 'query' | 'auto' }
  | { kind: 'ask'; url: string }
  | { kind: 'icon' };

export function directImage(url: string, source?: string): ResolvedImage {
  return { url, thumbUrl: url, width: 0, height: 0, title: '', attribution: { sourceUrl: source ?? url, provider: 'source' } };
}

/** Steps 4/5 once the searches found nothing. */
export function fallbackResult(plan: ItemImagePlan, allowAsk: boolean): ItemImageResult {
  return allowAsk && plan.askUrl ? { kind: 'ask', url: plan.askUrl } : { kind: 'icon' };
}

/**
 * Synchronous answer from the caches: a result, or undefined when a search still has to run.
 * `peek(q)`: image / null (known miss) / undefined (unknown).
 */
export function peekItemImage(plan: ItemImagePlan, peek: (q: string) => ResolvedImage | null | undefined, allowAsk: boolean): ItemImageResult | undefined {
  if (plan.direct) return { kind: 'image', image: directImage(plan.direct, plan.directSource), step: 'direct' };
  for (const { query, step } of plan.queries) {
    const hit = peek(query);
    if (hit === undefined) return undefined;
    if (hit) return { kind: 'image', image: hit, step };
  }
  return fallbackResult(plan, allowAsk);
}

/** Full chain. Search errors count as "nothing found" for that query (the next step is tried). */
export async function resolveItemImage(plan: ItemImagePlan, search: (q: string) => Promise<ResolvedImage | null>, allowAsk: boolean): Promise<ItemImageResult> {
  if (plan.direct) return { kind: 'image', image: directImage(plan.direct, plan.directSource), step: 'direct' };
  for (const { query, step } of plan.queries) {
    const img = await search(query).catch(() => null);
    if (img) return { kind: 'image', image: img, step };
  }
  return fallbackResult(plan, allowAsk);
}

/**
 * Search budget: at most `concurrency` searches run at once; identical keys share one run while queued/running.
 * (Finished results live in the image caches, so a later call is a cache hit, not a request.)
 */
export function createSearchQueue(concurrency = 3) {
  const max = Math.max(1, concurrency);
  let active = 0;
  const waiting: (() => void)[] = [];
  const shared = new Map<string, Promise<unknown>>();
  // a finished run hands its slot directly to the next waiter (active stays the same)
  const next = () => {
    const w = waiting.shift();
    if (w) w();
    else active--;
  };
  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const k = lc(key);
      const existing = shared.get(k);
      if (existing) return existing as Promise<T>;
      const p = new Promise<void>((res) => {
        if (active < max) {
          active++;
          res();
        } else waiting.push(res);
      })
        .then(() => task())
        .finally(() => {
          next();
          shared.delete(k);
        });
      shared.set(k, p);
      return p;
    },
    stats: () => ({ active, queued: waiting.length }),
  };
}
