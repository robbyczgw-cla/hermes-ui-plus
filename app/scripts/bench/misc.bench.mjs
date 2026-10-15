// One-shot hot paths: transcript mapping, table layout math, entity / media detection, finished-answer passes.
// Run from app/: scripts/bench/run.sh misc
import { mapRemoteMessages } from '../../src/hermes/sessionMapping.ts';
import { headerMinWidth, keepArrayIdentity, numericCellMinWidth, sortTableRows, tableLayoutMode } from '../../src/ui/lib/tableMath.ts';
import { detectEntities } from '../../src/chat/answers/entities.ts';
import { createMediaTagCache, extractMedia, extractMediaCached } from '../../src/chat/mediaTags.ts';
import { parseInline, parseMarkdown } from '../../src/chat/markdown.ts';
import { parseMessage } from '../../src/protocol/streamParser.ts';
import { withCitationSources } from '../../src/chat/answers/citations.ts';
import { dedupeTranslations } from '../../src/chat/answers/dedupe.ts';
import { plainCopyText } from '../../src/chat/format.ts';
import { header, perStep, prefixes, report, reportOnce } from './lib.mjs';
import { createMessageView, mountFinished } from './messageView.mjs';
import { clearParseCaches } from '../../src/chat/parseCache.ts';
import { initialRenderCount } from '../../src/chat/messageArea.ts';
import { hermesRows, longAnswer, longChat, longMarkdown, paragraph } from './fixtures.mjs';

header('sessionMapping');
for (const turns of [100, 500]) {
  const rows = hermesRows(turns);
  reportOnce(`mapRemoteMessages ${rows.length} rows (${turns} turns)`, () => mapRemoteMessages(rows));
}
{
  const rows = hermesRows(50, 20_000);
  reportOnce(`mapRemoteMessages ${rows.length} rows, 50 web extracts (5 × 20K chars)`, () => mapRemoteMessages(rows));
}

header('table layout math (Table.tsx derivations per streaming rebuild)');
{
  const isNum = (v) => typeof v === 'number' || (typeof v === 'string' && /^-?[\d.,\s€$%]+$/.test(v));
  const cellText = (c) => (c === null || c === undefined ? '' : String(c));
  const columns = ['Name', 'Price (€)', 'Rating', 'Distance (km)'];
  const allRows = Array.from({ length: 50 }, (_, i) => [`Place ${i}`, Math.round((i * 7.3 + 9) * 100) / 100, (i % 5) + 1, Math.round(i * 13) / 10]);
  // one rebuild per arriving row (rows keep identity → numeric/widths recomputed over all rows)
  const steps = allRows.map((_, i) => allRows.slice(0, i + 1));
  const run = () => {
    let numericRef;
    let widthsRef;
    return (rows) => {
      const ncols = Math.max(columns.length, ...rows.map((r) => r.length), 0);
      const numeric = (numericRef = keepArrayIdentity(
        numericRef,
        Array.from({ length: ncols }, (_, ci) => {
          const vals = rows.map((r) => r[ci]).filter((v) => v !== null && v !== undefined && v !== '');
          return vals.length > 0 && vals.filter(isNum).length / vals.length >= 0.8;
        }),
      ));
      const widths = (widthsRef = keepArrayIdentity(
        widthsRef,
        Array.from({ length: ncols }, (_, ci) => {
          const lens = rows.slice(0, 50).map((r) => cellText(r[ci]).length);
          const maxLen = Math.max((columns[ci] ?? '').length * 1.05, ...lens, 3);
          const minW = Math.max(Math.round(maxLen * 7.4 + 28), headerMinWidth(columns[ci] ?? ''));
          return numeric[ci] ? Math.max(minW, numericCellMinWidth(rows.map((r) => cellText(r[ci])))) : minW;
        }),
      ));
      tableLayoutMode(360, widths, numeric, columns, null);
    };
  };
  report('50-row table: numeric + widths + layout per row', perStep(run, steps));
  reportOnce('sortTableRows 50 rows (numeric column)', () => sortTableRows(allRows, 1, 1, true, 'de', (c) => (typeof c === 'number' ? c : NaN)));
}

header('entities / inline on long text');
for (const n of [5, 40]) {
  const text = Array.from({ length: n }, (_, i) => paragraph(i)).join(' ');
  reportOnce(`detectEntities ${(text.length / 1000).toFixed(1)}K chars`, () => detectEntities(text));
  reportOnce(`parseInline ${(text.length / 1000).toFixed(1)}K chars`, () => parseInline(text));
}

header('media tags (MessageItem: extractMedia on every streaming update)');
{
  const text = longMarkdown(16);
  reportOnce(`extractMedia ${(text.length / 1000).toFixed(0)}K chars, no tag`, () => extractMedia(text, true));
  const tagged = text + '\n\nMEDIA:/tmp/test/report.pdf\n';
  reportOnce(`extractMedia ${(tagged.length / 1000).toFixed(0)}K chars, one tag`, () => extractMedia(tagged, true));
  report('extractMedia per tick over a 43K answer (16 chars/tick)', perStep(() => (t) => extractMedia(t, true), prefixes(text, 16).filter((_, i) => i % 8 === 0)));
  // a tag (or just the word `media:`, e.g. a "Social Media:" heading) early in the answer: the mask path on every tick
  const early = 'Here is the chart. MEDIA:/tmp/test/chart.png\n\n' + text;
  report('… with a MEDIA tag in the first line', perStep(() => (t) => extractMedia(t, true), prefixes(early, 16).filter((_, i) => i % 8 === 0)));
  // what MessageItem runs while streaming: complete lines are frozen, only the tail is scanned again
  const cached = () => {
    const cache = createMediaTagCache();
    return (t) => extractMediaCached(t, true, cache);
  };
  report('extractMediaCached per tick over a 43K answer', perStep(cached, prefixes(text, 16).filter((_, i) => i % 8 === 0)));
  report('… with a MEDIA tag in the first line', perStep(cached, prefixes(early, 16).filter((_, i) => i % 8 === 0)));
}

header('finished answer (end of stream / history mount)');
{
  const text = longAnswer(16);
  reportOnce(`parseMessage ${(text.length / 1000).toFixed(0)}K chars`, () => parseMessage(text));
  const segs = parseMessage(text);
  reportOnce('withCitationSources(dedupeTranslations(segments))', () => withCitationSources(dedupeTranslations(segs)));
  const md43 = longMarkdown(16);
  reportOnce('parseMarkdown 43K markdown', () => parseMarkdown(md43));
  reportOnce('plainCopyText 55K', () => plainCopyText(text));
  // a stored answer mounting (chat opened / scrolled into view): the whole text in one update of the view emulation
  reportOnce(`mount: message view of a finished ${(text.length / 1000).toFixed(0)}K answer`, () => createMessageView()(text));
  reportOnce(`mount: message view of a finished ${(md43.length / 1000).toFixed(0)}K markdown answer`, () => createMessageView()(md43));
}

header('reopen a long chat: parse work of its finished answers (segments, markdown, inline, entities)');
{
  // first open = cold parse cache (cleared every run); reopen = the same chat mounted again (cache warm)
  const chats = [
    ['150 messages, 1.5K-char answers', longChat(150).filter((m) => m.role === 'assistant')],
    ['20 long answers (11K chars, hui blocks)', Array.from({ length: 20 }, (_, i) => ({ id: `a-${i}`, text: longAnswer(4).replaceAll(' the ', ` the${i} `) })) /* distinct texts */],
  ];
  for (const [name, answers] of chats) {
    const mount = (cached) => answers.forEach((m) => mountFinished(m.id, m.text, cached));
    reportOnce(`${name}: every mount parses (before)`, () => mount(false));
    reportOnce(`${name}: first open, cache cold`, () => {
      clearParseCaches();
      mount(true);
    });
    mount(true);
    reportOnce(`${name}: reopen, cache warm`, () => mount(true));
  }
}

header('first frame of a chat opened for the first time: parse work of the rows the list renders before the first paint');
{
  // cold parse cache (a chat never opened here); before: FlatList initialNumToRender 12; after: initialRenderCount
  // (newest messages up to a ~4K-char budget, ≥ 2); the remaining rows follow in the list's batches after the paint
  const answers = (n, text) => Array.from({ length: n }, (_, i) => text(i));
  const chats = [
    ['150 messages, 1.5K-char answers', longChat(150)],
    [
      '40 messages, 11K-char answers (hui blocks)',
      answers(40, (i) => (i % 2 ? { id: `a-${i}`, role: 'assistant', text: longAnswer(4).replaceAll(' the ', ` the${i} `) } : { id: `u-${i}`, role: 'user', text: `Question ${i}` })),
    ],
  ];
  for (const [name, list] of chats) {
    const firstFrame = (count) => {
      clearParseCaches();
      for (const m of list.slice(-count)) if (m.role === 'assistant') mountFinished(m.id, m.text, true);
    };
    const n = initialRenderCount(list);
    reportOnce(`${name}: 12 rows (before)`, () => firstFrame(12));
    reportOnce(`${name}: ${n} rows (after)`, () => firstFrame(n));
  }
}
