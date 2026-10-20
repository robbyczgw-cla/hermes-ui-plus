// Pure answer check for the live conversation test (run.mjs): parses one answer with the APP's own stream parser
// (app/src/protocol, the code the phone runs) and reports what the user would see per ```hui block.
//
//   failures  the answer shows less than it should: empty answer, a block that is neither a node nor a readable
//             fallback (only an error line), a list node without entries, a query-only web image although the
//             bridge has no image search (the skill rule from [hermes-ui-caps] image_search=off)
//   warnings  shown, but worth a look: the block fell back to the readable list view
//   images    every image the answer asks for (gallery / image items, product / place photos), so the runner can
//             fetch the URLs through the bridge's image proxy: resolved photo, or the visible placeholder
import { createStreamParser } from '../../../app/src/protocol/streamParser.ts';
import { isEmptyCollection } from '../../../app/src/protocol/validate.ts';

const isHttps = (u) => typeof u === 'string' && /^https:\/\/[^\s/]+\.[^\s/]+/i.test(u);

/** All nodes of a tree (card/stack children, tabs, accordion sections …): any nested object with a string `type`. */
function walk(node, out = [], depth = 0) {
  if (!node || typeof node !== 'object' || depth > 12) return out;
  if (Array.isArray(node)) {
    for (const x of node) walk(x, out, depth + 1);
    return out;
  }
  if (typeof node.type === 'string') out.push(node);
  for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, out, depth + 1);
  return out;
}

/** Image requests of one node: {kind, url?, query?, web} */
function imagesOf(n) {
  const out = [];
  if (n.type === 'image') out.push({ kind: 'image', url: n.url, query: n.query, web: n.source === 'web' });
  if (n.type === 'gallery' && Array.isArray(n.items)) {
    for (const it of n.items) if (it && typeof it === 'object') out.push({ kind: 'gallery', url: it.url, query: it.query, web: n.source === 'web' || it.source === 'web', caption: it.caption });
  }
  for (const [kind, list] of [['products', n.products], ['places', n.places]]) {
    if (n.type !== kind || !Array.isArray(list)) continue;
    // cards always render (category icon fallback); `image` URLs are fetched like gallery URLs
    for (const it of list) if (it && typeof it === 'object' && (it.image || it.imageQuery)) out.push({ kind, url: it.image, query: it.imageQuery, web: true, card: true });
  }
  return out;
}

/**
 * @param {string} text  the full answer text (Markdown + ```hui blocks)
 * @param {{imageSearch?: 'on'|'off'|null}} [o]  the bridge's capability (null: unknown)
 */
export function checkAnswer(text, o = {}) {
  const failures = [];
  const warnings = [];
  const blocks = [];
  const images = [];
  if (!String(text ?? '').trim()) failures.push('empty answer');
  const p = createStreamParser();
  p.push(String(text ?? ''));
  p.end();
  for (const seg of p.segments()) {
    if (seg.kind !== 'hui') continue;
    const type = seg.node && typeof seg.node.type === 'string' ? seg.node.type : null;
    blocks.push({ type: type ?? '(none)', fallback: !!seg.fallback, error: seg.error ?? null });
    if (!seg.node) {
      failures.push(`block without content (${seg.error ?? 'no node'})`);
      continue;
    }
    if (seg.fallback) warnings.push(`block shown as readable fallback (${seg.error ?? 'not a node'})`);
    for (const n of walk(seg.node)) {
      if (isEmptyCollection(n)) failures.push(`${n.type}: empty list`);
      for (const img of imagesOf(n)) {
        const url = isHttps(img.url) ? img.url : undefined;
        const query = typeof img.query === 'string' && img.query.trim() ? img.query.trim() : undefined;
        images.push({ ...img, url, query });
        if (!img.card && !url && query && img.web && o.imageSearch === 'off') {
          failures.push(`${img.kind}: query-only web image "${query.slice(0, 60)}" although the bridge has no image search (skill rule)`);
        }
      }
    }
  }
  return { failures, warnings, blocks, images };
}
