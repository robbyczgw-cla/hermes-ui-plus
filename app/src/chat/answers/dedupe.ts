/**
 * UX8: models sometimes write a translation as plain text AND as a `translation` card right after it.
 * A finished answer drops a plain paragraph (or a one-paragraph quote) directly before a `translation`
 * node when its normalized text equals one of the card's texts (any target, or all targets joined).
 * Display only; the stored text and copy stay unchanged.
 *
 * Pure TS (erasable syntax only) so `node --test` can run it.
 */
import type { Segment } from '../../protocol/types';
import { inlineToPlain, parseInline, parseMarkdown, type MdBlock } from '../markdown.ts';

/** lowercase, no markdown emphasis, quotes, end punctuation or extra whitespace */
export function normalizeForDedupe(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/["'“”„«»‚‘’`*_~]/g, '')
    .replace(/[\s.!?…:;,。！？]+$/u, '')
    .replace(/^[\s:;,–—-]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function translationTexts(node: unknown): string[] {
  if (!node || typeof node !== 'object') return [];
  const n = node as { type?: unknown; targets?: unknown };
  if (n.type !== 'translation' || !Array.isArray(n.targets)) return [];
  const texts = n.targets.map((t) => (t && typeof t === 'object' && typeof (t as { text?: unknown }).text === 'string' ? (t as { text: string }).text : '')).filter((t) => t.trim());
  const out = texts.map(normalizeForDedupe);
  if (texts.length > 1) out.push(normalizeForDedupe(texts.join(' ')));
  return out.filter(Boolean);
}

function blockText(b: MdBlock): string | null {
  if (b.type === 'paragraph') return inlineToPlain(parseInline(b.text));
  if (b.type === 'quote' && b.blocks.length === 1 && b.blocks[0].type === 'paragraph') return inlineToPlain(parseInline(b.blocks[0].text));
  return null;
}

const cache = new WeakMap<readonly Segment[], readonly Segment[]>();

/** Segments with duplicated translation paragraphs removed (same array when nothing changed). */
export function dedupeTranslations(segments: readonly Segment[]): readonly Segment[] {
  const hit = cache.get(segments);
  if (hit) return hit;
  let out: Segment[] | null = null;
  for (let i = 1; i < segments.length; i++) {
    const s = segments[i];
    const prev = segments[i - 1];
    if (s.kind !== 'hui' || !s.complete || prev.kind !== 'markdown') continue;
    const wanted = new Set(translationTexts(s.node));
    if (!wanted.size) continue;
    const blocks = parseMarkdown(prev.text);
    // only trailing paragraphs right before the card (the duplicate sits directly above it)
    let cut = blocks.length;
    while (cut > 0) {
      const t = blockText(blocks[cut - 1]);
      if (t === null || !wanted.has(normalizeForDedupe(t))) break;
      cut--;
    }
    if (cut === blocks.length) continue;
    out ??= segments.slice();
    out[i - 1] = { ...prev, text: blocks.slice(0, cut).map((b) => b.src).join('\n\n') };
  }
  const result = out ?? segments;
  cache.set(segments, result);
  return result;
}
