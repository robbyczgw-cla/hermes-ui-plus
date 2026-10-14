// Emulation of the per-update work of the streaming message view, shared by the benchmarks.
import { createStreamParser, parseMessage } from '../../src/protocol/streamParser.ts';
import { dropFinalNewline, parseInline, parseMarkdownIncremental } from '../../src/chat/markdown.ts';
import { extractMedia } from '../../src/chat/mediaTags.ts';
import { detectEntities } from '../../src/chat/answers/entities.ts';
import { advanceSegments, detectEntitiesCached, finishedInline, finishedMarkdown } from '../../src/chat/parseCache.ts';

/**
 * Emulates the per-update work of AssistantBody + Markdown + BlockView/ListItemView/TableRow memo for the
 * streaming message: extractMedia, useSegments (parser push of the delta), incremental markdown of every
 * markdown segment whose text changed, and inline parsing / entity detection of every block whose `src`
 * changed (BlockView memo), list items / table rows by content (ListItemView / TableRow memo).
 */
export function createMessageView() {
  const parser = createStreamParser({ now: () => 0 });
  let fed = '';
  const md = new Map(); // seg key → { text, st, srcs }
  const inlineMemo = new Map(); // `${partial}|${text}` → nodes (InlineText useMemo per mounted text, approximated)
  const detectMemo = new Map();
  const inline = (text, partial) => {
    const k = (partial ? 'p|' : 'f|') + text;
    let v = inlineMemo.get(k);
    if (!v) inlineMemo.set(k, (v = parseInline(text, { partial })));
    return v;
  };
  const detect = (text) => {
    let v = detectMemo.get(text);
    if (!v) detectMemo.set(text, (v = detectEntities(text)));
    return v;
  };
  const renderBlock = (b, prev, live) => {
    switch (b.type) {
      case 'paragraph':
      case 'heading':
        inline(b.text, live);
        if (!live) detect(b.text);
        break;
      case 'list': {
        const prevItems = prev && prev.type === 'list' ? prev.items : [];
        b.items.forEach((it, i) => {
          const p = prevItems[i];
          if (p && p.text === it.text && i !== b.items.length - 1) return; // ListItemView memo
          inline(it.text, live && i === b.items.length - 1);
        });
        break;
      }
      case 'table': {
        // TableView: widths over all rows on every change, TableRow memo by content
        for (let ci = 0; ci < b.header.length; ci++) Math.max(...[b.header[ci], ...b.rows.map((r) => r[ci] ?? '')].map((c) => c.replace(/[*_`]/g, '').length), 3);
        const prevRows = prev && prev.type === 'table' ? prev.rows : [];
        b.rows.forEach((row, ri) => {
          const p = prevRows[ri];
          if (p && p.length === row.length && p.every((x, i) => x === row[i])) return;
          for (const c of row) inline(c, false);
        });
        break;
      }
      case 'code': {
        const code = dropFinalNewline(b.code); // BlockView → CodeBlock
        const lines = code.split('\n');
        if (lines.length > 60) for (let i = 0; i < lines.length; i += 40) lines.slice(i, i + 40).join('\n');
        break;
      }
      default:
        break;
    }
  };
  return (text) => {
    const media = extractMedia(text, true);
    const t = media.text;
    const segs = t.length > fed.length ? parser.push(t.slice(fed.length)) : parser.segments();
    fed = t;
    // AssistantBody per render
    segs.some((s) => s.kind !== 'markdown');
    segs.some((s) => s.kind === 'markdown');
    segs.forEach((s, i) => {
      if (s.kind !== 'markdown') return;
      const live = i === segs.length - 1;
      const cur = md.get(s.key);
      if (cur && cur.text === s.text && cur.live === live) return; // SegmentView / Markdown memo
      const st = parseMarkdownIncremental(s.text, cur?.st);
      const srcs = cur?.blocks ?? [];
      st.blocks.forEach((b, bi) => {
        const prev = srcs[bi];
        const blockLive = live && bi === st.blocks.length - 1;
        if (prev && prev.src === b.src && !(cur.live && bi === srcs.length - 1)) return; // BlockView memo
        renderBlock(b, prev, blockLive);
        // (no collapse plan: Markdown only measures blocks for `collapse` answers – after a summary node / research)
      });
      md.set(s.key, { text: s.text, st, blocks: st.blocks, live });
    });
    return segs;
  };
}

/**
 * Parse work of one finished answer mounting (chat opened, scrolled back into view): useSegments, Markdown per
 * markdown segment, InlineText per paragraph / heading / list item / table cell, DetectedText per text node of a
 * finished run. `cached`: the app's path since the parse cache (parseCache.ts), else the pre-cache path (every
 * mount parses everything). Rendering itself (React / native views) is not part of it.
 */
export function mountFinished(id, text, cached) {
  const segs = cached ? advanceSegments(null, text, true, id).segs : parseMessage(text);
  const inl = (t) => (cached ? finishedInline(t, 0) : parseInline(t, { partial: false, cites: 0 }));
  const det = (t) => (cached ? detectEntitiesCached(t) : detectEntities(t));
  const runs = (t) => {
    const visit = (nodes) => {
      for (const n of nodes) {
        if (n.t === 'text') det(n.s);
        else if (n.c && n.t !== 'link') visit(n.c);
      }
    };
    visit(inl(t));
  };
  const block = (b) => {
    if (b.type === 'paragraph' || b.type === 'heading') runs(b.text);
    else if (b.type === 'list') for (const it of b.items) runs(it.text);
    else if (b.type === 'table') for (const r of b.rows) for (const c of r) inl(c);
    else if (b.type === 'quote') b.blocks.forEach(block);
  };
  for (const s of segs) {
    if (s.kind !== 'markdown') continue;
    const blocks = cached ? finishedMarkdown(s.text).blocks : parseMarkdownIncremental(s.text).blocks;
    blocks.forEach(block);
  }
  return segs.length;
}
