// Streaming hot paths of one growing assistant answer.
// Run from app/: scripts/bench/run.sh stream   (or: node scripts/bench/stream.bench.mjs)
import { createStreamParser } from '../../src/protocol/streamParser.ts';
import { createMessageView } from './messageView.mjs';
import { chunks, growth, header, perStep, prefixes, report } from './lib.mjs';
import { bulletList, codeBlock, huiProducts, huiTable, longAnswer, longMarkdown, mdTable, paragraph } from './fixtures.mjs';

const TICK = 16; // chars per throttled React update (~30 fps at ~120 tokens/s); useSegments pushes one delta per update
const TICK_MS = 33;

// ---------------------------------------------------------------- 1. stream parser alone (one push per update)

header('streamParser.push per update (16 chars)');
const parserRuns = {};
for (const sections of [4, 16]) {
  const text = longAnswer(sections);
  const deltas = chunks(text, TICK);
  const r = perStep(() => {
    const p = createStreamParser({ now: () => 0 });
    return (d) => p.push(d);
  }, deltas);
  report(`answer ${(text.length / 1000).toFixed(0)}K chars, ${sections} hui blocks`, r);
  parserRuns[sections] = r;
}
growth('streamParser', parserRuns[4], parserRuns[16]);

header('streamParser.push per update: one big open hui block');
for (const [name, block] of [
  ['hui table 50 rows', huiTable(50, 1)],
  ['hui table 200 rows', huiTable(200, 1)],
  ['hui products 12 items', huiProducts(12, 1)],
  ['hui products 48 items', huiProducts(48, 1)],
]) {
  const text = 'Intro text.\n\n' + block + '\n';
  const deltas = chunks(text, TICK);
  let clock = 0;
  const r = perStep(() => {
    // one update per 33 ms (the rebuild rate limit of big blocks is time based)
    const p = createStreamParser({ now: () => (clock += TICK_MS) });
    return (d) => p.push(d);
  }, deltas);
  report(`${name} (${(text.length / 1000).toFixed(1)}K chars)`, r);
}

// ---------------------------------------------------------------- 2. full streaming tick of the message view (messageView.mjs)

header('streaming tick of the message view (16 chars per update)');
const tickRuns = {};
for (const sections of [4, 16]) {
  const text = longAnswer(sections);
  const r = perStep(createMessageView, prefixes(text, TICK));
  report(`answer ${(text.length / 1000).toFixed(0)}K chars with hui blocks`, r);
  tickRuns[sections] = r;
}
growth('message view tick (hui answer)', tickRuns[4], tickRuns[16]);
const mdRuns = {};
for (const sections of [4, 16]) {
  const text = longMarkdown(sections);
  const r = perStep(createMessageView, prefixes(text, TICK));
  report(`markdown-only answer ${(text.length / 1000).toFixed(0)}K chars`, r);
  mdRuns[sections] = r;
}
growth('message view tick (markdown)', mdRuns[4], mdRuns[16]);

header('streaming tick of the message view: append runs (the app) vs full-text "still extends?" compares');
for (const [name, text] of [['hui answer', longAnswer(16)], ['markdown-only answer', longMarkdown(16)]]) {
  const label = `${name} ${(text.length / 1000).toFixed(0)}K chars`;
  report(`${label}, full compares`, perStep(() => createMessageView({ appendRuns: false }), prefixes(text, TICK)));
  report(`${label}, append runs`, perStep(createMessageView, prefixes(text, TICK)));
}

header('streaming tick: one long block (worst case for the markdown tail)');
const single = [
  ['list 50 items', bulletList(50, 1), 'list 200 items', bulletList(200, 1)],
  ['md table 15 rows', mdTable(15, 1), 'md table 60 rows', mdTable(60, 1)],
  ['code 150 lines', codeBlock(150, 1), 'code 600 lines', codeBlock(600, 1)],
  [
    'paragraph 2K chars',
    Array.from({ length: 4 }, (_, i) => paragraph(i)).join(' '),
    'paragraph 8K chars',
    Array.from({ length: 16 }, (_, i) => paragraph(i)).join(' '),
  ],
];
for (const [sName, sText, lName, lText] of single) {
  const a = perStep(createMessageView, prefixes('Intro.\n\n' + sText + '\n', TICK));
  const b = perStep(createMessageView, prefixes('Intro.\n\n' + lText + '\n', TICK));
  report(sName, a);
  report(lName, b);
  growth(lName, a, b);
}
