import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIRST_PHRASES,
  FIRST_TOKEN_LOADERS,
  LONG_WAIT_MS,
  LOADER_KINDS,
  SLOW_HEADLINE,
  STILL_HEADLINE,
  STILL_PHRASES,
  TOOL_CATEGORIES,
  TOOL_PHRASES,
  createPhraseRotator,
  indicatorFor,
  msUntilNextTier,
  mulberry32,
  nextPhrase,
  personaLoader,
  phraseSequence,
  resolveWaitMode,
  routeBadgeVisible,
  routeLoader,
  routePhraseKey,
  seedFrom,
  statusPool,
  toolCategory,
  waitStateKey,
  waitStateOf,
  waitTier,
  type WaitState,
  parsePersonaNames,
  PERSONA_NAMES,
} from './waiting.ts';
import { dictionaries, makeT } from '../../i18n/core.ts';
import type { TKey } from '../../i18n/core.ts';

const first: WaitState = { kind: 'first' };

// ------------------------------------------------------------------ rotation

test('rotation: never the same phrase twice in a row (many seeds, long runs)', () => {
  for (let seed = 0; seed < 50; seed++) {
    const seq = phraseSequence(FIRST_PHRASES, 200, seed);
    for (let i = 1; i < seq.length; i++) assert.notEqual(seq[i], seq[i - 1], `seed ${seed} step ${i}`);
    // every phrase shows up eventually (varied, not stuck on a subset)
    assert.equal(new Set(seq).size, FIRST_PHRASES.length);
  }
});

test('rotation: deterministic for a seed, different across seeds, headline first', () => {
  assert.deepEqual(phraseSequence(FIRST_PHRASES, 30, 42), phraseSequence(FIRST_PHRASES, 30, 42));
  assert.notDeepEqual(phraseSequence(FIRST_PHRASES, 30, 1), phraseSequence(FIRST_PHRASES, 30, 2));
  assert.equal(phraseSequence(FIRST_PHRASES, 5, 7)[0], 'waiting.first.p1');
  const r1 = mulberry32(9);
  const r2 = mulberry32(9);
  for (let i = 0; i < 10; i++) assert.equal(r1(), r2());
});

test('rotation: pool switch keeps the no-repeat rule; forced headline does not repeat either', () => {
  const r = createPhraseRotator<string>(3);
  assert.equal(r.next(['a', 'b', 'c'], 'a'), 'a');
  // forcing the current phrase again → picks another one instead of repeating
  assert.notEqual(r.next(['a', 'b', 'c'], 'a'), 'a');
  // switch to a pool that contains the current phrase → still no repeat
  const cur = r.current!;
  for (let i = 0; i < 20; i++) {
    const prev = r.current;
    const n = r.next([cur, 'x', 'y']);
    assert.notEqual(n, prev);
  }
  // single-element pool has no alternative
  assert.equal(nextPhrase(['only'], 'only', mulberry32(1)), 'only');
  assert.throws(() => nextPhrase([], undefined, mulberry32(1)));
});

test('seedFrom: stable 32-bit hash', () => {
  assert.equal(seedFrom('msg-1'), seedFrom('msg-1'));
  assert.notEqual(seedFrom('msg-1'), seedFrom('msg-2'));
  assert.ok(seedFrom('') >= 0 && seedFrom('x'.repeat(500)) <= 0xffffffff);
});

// ------------------------------------------------------------------ state → indicator

test('state: running tool > route > first token', () => {
  assert.deepEqual(waitStateOf({}), first);
  assert.deepEqual(waitStateOf({ routeShape: 'text' }), first);
  assert.deepEqual(waitStateOf({ routeShape: 'chart' }), { kind: 'route', shape: 'chart' });
  const tools = [
    { name: 'web_search', status: 'done' },
    { name: 'terminal', status: 'running' },
  ];
  assert.deepEqual(waitStateOf({ tools, routeShape: 'chart' }), { kind: 'tool', category: 'code' });
  assert.deepEqual(waitStateOf({ tools: [{ name: 'web_search', status: 'done' }], routeShape: 'table' }), { kind: 'route', shape: 'table' });
  // the latest running tool wins
  assert.deepEqual(waitStateOf({ tools: [{ name: 'read_file', status: 'running' }, { name: 'image_generate', status: 'running' }] }), { kind: 'tool', category: 'image' });
  assert.equal(waitStateKey({ kind: 'tool', category: 'search' }), 'tool:search');
});

test('tool categories', () => {
  const cases: [string, string][] = [
    ['web_search', 'search'],
    ['Websuche', 'search'],
    ['image_search', 'search'],
    ['web_fetch', 'web'],
    ['browser_navigate', 'web'],
    ['terminal', 'code'],
    ['execute_code', 'code'],
    ['python', 'code'],
    ['read_file', 'file'],
    ['write_file', 'file'],
    ['image_generate', 'image'],
    ['memory', 'memory'],
    ['calendar', 'other'],
    ['send_email', 'other'],
  ];
  for (const [name, cat] of cases) assert.equal(toolCategory(name), cat, name);
});

test('indicator mapping: tools, route formats, persona, seeded first-token pick, modes', () => {
  const tool = (category: (typeof TOOL_CATEGORIES)[number]) => indicatorFor({ kind: 'tool', category });
  assert.equal(tool('search'), 'magnifier');
  assert.equal(tool('code'), 'gear');
  assert.equal(tool('file'), 'page');
  assert.equal(tool('image'), 'pencil');
  assert.equal(indicatorFor({ kind: 'route', shape: 'chart' }), 'bars');
  assert.equal(indicatorFor({ kind: 'route', shape: 'table' }), 'grid');
  assert.equal(indicatorFor({ kind: 'route', shape: 'map' }), 'pin');
  assert.equal(routeLoader('something-new'), 'pencil');
  // persona only for the first-token wait, context icons win
  assert.equal(indicatorFor(first, { persona: 'chameleon' }), 'chameleon');
  assert.equal(indicatorFor({ kind: 'tool', category: 'search' }, { persona: 'chameleon' }), 'magnifier');
  // seeded variety
  const picks = new Set(Array.from({ length: 30 }, (_, s) => indicatorFor(first, { seed: s })));
  assert.equal(picks.size, FIRST_TOKEN_LOADERS.length);
  assert.equal(indicatorFor(first, { seed: 5 }), indicatorFor(first, { seed: 5 }));
  // modes
  assert.equal(indicatorFor({ kind: 'tool', category: 'search' }, { mode: 'subtle' }), 'pulse');
  assert.equal(indicatorFor(first, { mode: 'off', persona: 'chameleon' }), null);
  // every mapped kind exists
  for (const c of TOOL_CATEGORIES) assert.ok(LOADER_KINDS.includes(tool(c)!));
});

test('route badge hidden on self-captioned skeletons (unless a tool runs)', () => {
  assert.equal(routeBadgeVisible('chart', { kind: 'route', shape: 'chart' }), true);
  assert.equal(routeBadgeVisible('calculator', { kind: 'route', shape: 'calculator' }), false);
  assert.equal(routeBadgeVisible('calculator', { kind: 'tool', category: 'code' }), true);
});

test('settings mode: reduced motion turns playful into subtle; missing/invalid → subtle (calm default)', () => {
  assert.equal(resolveWaitMode('playful', false), 'playful');
  assert.equal(resolveWaitMode('playful', true), 'subtle');
  assert.equal(resolveWaitMode('subtle', true), 'subtle');
  assert.equal(resolveWaitMode('off', true), 'off');
  assert.equal(resolveWaitMode(undefined, false), 'subtle');
  assert.equal(resolveWaitMode('loud' as never, false), 'subtle');
});

test('persona: explicit style wins, auto → chameleon for configured persona names', () => {
  const names = parsePersonaNames(' Pip, bad name!, ,Kiwi ');
  assert.deepEqual(names, ['pip', 'kiwi']);
  assert.deepEqual(PERSONA_NAMES, parsePersonaNames(process.env.EXPO_PUBLIC_PERSONA_NAMES));
  assert.equal(personaLoader(null), null);
  assert.equal(personaLoader({ name: 'Hermes' }), null);
  assert.equal(personaLoader({ name: 'Pip' }, names), 'chameleon');
  assert.equal(personaLoader({ name: 'Pip' }, []), null); // no built-in personal names
  assert.equal(personaLoader({ name: 'Mein Chamäleon' }), 'chameleon');
  assert.equal(personaLoader({ name: 'Pipeline' }, names), null);
  assert.equal(personaLoader({ name: 'Pip', loaderStyle: 'orbit' }, names), 'orbit');
  assert.equal(personaLoader({ name: 'Pip', loaderStyle: 'auto' }, names), 'chameleon');
  assert.equal(personaLoader({ name: 'X', loaderStyle: 'pulse' }), null);
  assert.equal(personaLoader({ name: 'X', loaderStyle: 'bogus' }), null);
});

// ------------------------------------------------------------------ long waits

test('long-wait thresholds', () => {
  assert.equal(waitTier(0), 0);
  assert.equal(waitTier(9_999), 0);
  assert.equal(waitTier(LONG_WAIT_MS.slow), 1);
  assert.equal(waitTier(29_999), 1);
  assert.equal(waitTier(LONG_WAIT_MS.still), 2);
  assert.equal(waitTier(600_000), 2);
  assert.equal(waitTier(Number.NaN), 0);
  assert.equal(msUntilNextTier(0), 10_000);
  assert.equal(msUntilNextTier(4_000), 6_000);
  assert.equal(msUntilNextTier(10_000), 20_000);
  assert.equal(msUntilNextTier(31_000), null);
  assert.equal(msUntilNextTier(-50), 10_000);
});

test('status pools: headline first, long-wait headlines, tool/route phrases', () => {
  assert.equal(statusPool(first, 0)[0], 'waiting.first.p1');
  assert.equal(statusPool(first, 1)[0], SLOW_HEADLINE);
  assert.equal(statusPool(first, 2), STILL_PHRASES);
  assert.equal(statusPool(first, 2)[0], STILL_HEADLINE);
  const search = statusPool({ kind: 'tool', category: 'search' }, 0);
  assert.deepEqual(search, TOOL_PHRASES.search);
  assert.equal(statusPool({ kind: 'tool', category: 'search' }, 1)[0], SLOW_HEADLINE);
  assert.equal(statusPool({ kind: 'tool', category: 'search' }, 2)[0], STILL_HEADLINE);
  assert.equal(statusPool({ kind: 'route', shape: 'chart' }, 0)[0], 'waiting.route.chart');
  assert.equal(routePhraseKey('calc'), 'waiting.route.calculator');
  assert.equal(routePhraseKey('weird'), 'waiting.route.generic');
  assert.ok(FIRST_PHRASES.length >= 15);
});

test('every phrase key resolves in de/en/es (no raw keys shown), expected copy', () => {
  const pools: TKey[] = [
    ...statusPool(first, 0),
    ...statusPool(first, 1),
    ...statusPool(first, 2),
    ...TOOL_CATEGORIES.flatMap((c) => [...statusPool({ kind: 'tool', category: c }, 2)]),
    ...['chart', 'table', 'map', 'recipe', 'calc', 'gallery', 'unknown', 'flashcards'].flatMap((s) => [...statusPool({ kind: 'route', shape: s }, 0)]),
    ...LOADER_KINDS.map((k) => `waiting.loaders.${k}` as TKey),
  ];
  for (const lang of ['de', 'en', 'es'] as const) {
    const t = makeT(lang, lang);
    for (const k of pools) {
      const v = t(k);
      assert.notEqual(v, k, `${lang}: ${k}`);
      assert.ok(v.length > 0);
    }
  }
  const de = makeT('de', 'de-DE');
  assert.equal(de('waiting.first.p1'), 'Denkt nach…');
  assert.equal(de(SLOW_HEADLINE), 'Dauert etwas länger…');
  assert.equal(de(STILL_HEADLINE), 'Ich bin noch dran');
  assert.equal(de('waiting.tool.search.p1'), 'Durchsucht das Web…');
  assert.equal(de('waiting.tool.image.p1'), 'Malt ein Bild…');
  assert.equal(de('waiting.route.chart'), 'Baut ein Diagramm…');
  // each language: all first-token phrases distinct
  for (const lang of ['de', 'en', 'es'] as const) {
    const t = makeT(lang, lang);
    assert.equal(new Set(FIRST_PHRASES.map((k) => t(k))).size, FIRST_PHRASES.length, lang);
  }
  assert.ok('waiting' in dictionaries.es);
});

test('waiting row: no exit fade – the first streamed line takes its place without a ghost overlap', async () => {
  // The row sits exactly where the first answer line fades in. A reanimated `exiting=` keeps a fading copy of
  // the row at its old position while the text already occupies it (~160 ms of status text over ghosted
  // answer text). The row must leave instantly; only the floating badge (over the skeleton) keeps its fade.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./WaitingIndicator.tsx', import.meta.url), 'utf8');
  const rowReturn = src.slice(src.indexOf('if (badge) {'), src.indexOf('function ProgressHint'));
  const afterBadge = rowReturn.slice(rowReturn.indexOf('\n  }\n'));
  assert.match(afterBadge, /style=\{styles\.row\}/);
  assert.doesNotMatch(afterBadge, /exiting=/);
  assert.match(rowReturn.slice(0, rowReturn.indexOf('\n  }\n')), /exiting=/);
});
