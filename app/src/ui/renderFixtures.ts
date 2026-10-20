/**
 * Degenerate answers for EVERY node type (protocol HUI_NODE_TYPES): bare node, empty lists, unknown fields, and the
 * image cases that failed in the wild (query-only web gallery without an image search, partially failing gallery,
 * broken URLs). Each fixture is the raw text of one ```hui block, so it runs through the same stream parser and
 * normalisation as a chat answer.
 *
 * Used by the render sweep (`/gallery?fixtures=render`, scripts/ux-check/render-sweep.mjs): every fixture must show
 * something visible (content, a placeholder with text, or the readable fallback), never nothing or an empty box.
 * Pure: no RN imports (renderFixtures.test.ts checks that every node type is covered).
 */
import { HUI_NODE_TYPES } from '../protocol/types.ts';
import { REAL_USER_014 } from '../protocol/realUser014.fixtures.ts';

export type RenderFixture = { id: string; type: string; raw: string; note?: string };

/** list field per type for the "empty list" variant (types not listed get `items: []`) */
const LIST_FIELD: Readonly<Record<string, string>> = {
  card: 'children',
  stack: 'children',
  table: 'rows',
  chart: 'series',
  compare: 'columns',
  blocks: 'columns',
  form: 'fields',
  choice: 'options',
  poll: 'options',
  decision: 'options',
  tabs: 'tabs',
  quiz: 'questions',
  flashcards: 'cards',
  map: 'markers',
  recipe: 'ingredients',
  products: 'products',
  places: 'places',
  guide: 'steps',
  workout: 'exercises',
  slots: 'slots',
  diff: 'files',
  changes: 'files',
  weather: 'days',
  agenda: 'items',
  summary: 'points',
};

/** Image hosts the sweep serves itself (trusted Wikimedia host; the harness answers these paths with a test photo). */
export const FIXTURE_PHOTO = 'https://upload.wikimedia.org/render-sweep/photo-ok.jpg';
export const FIXTURE_PHOTO_404 = 'https://upload.wikimedia.org/render-sweep/photo-404.jpg';

const j = (x: unknown) => JSON.stringify(x);

/** The gallery from the bug report (production, bridge without image search keys), verbatim. */
const REPORTED_GALLERY = {
  type: 'gallery',
  items: [
    { query: 'Trimui Brick Hammer front', source: 'web', caption: 'Trimui Brick Hammer (Alu, 3,2 Zoll)' },
    { query: 'Anbernic RG35XX Plus front', source: 'web', caption: 'Anbernic RG35XX Plus (3,5 Zoll)' },
    { query: 'Trimui Brick Hammer back RGB', source: 'web', caption: 'Hammer von hinten mit RGB-Rückseite' },
    { query: 'Anbernic RG35XX Plus GBA gameplay', source: 'web', caption: 'RG35XX Plus mit GBA-Spiel' },
  ],
};

const IMAGE_CASES: RenderFixture[] = [
  { id: 'gallery-reported-web-queries', type: 'gallery', raw: j(REPORTED_GALLERY), note: 'bug report: query-only web gallery, no image search' },
  {
    id: 'gallery-real-urls',
    type: 'gallery',
    raw: j({ type: 'gallery', items: [{ url: FIXTURE_PHOTO, caption: 'Front' }, { url: FIXTURE_PHOTO, caption: 'Back' }] }),
    note: 'urls from a tool',
  },
  {
    id: 'gallery-partial',
    type: 'gallery',
    raw: j({ type: 'gallery', items: [{ url: FIXTURE_PHOTO, caption: 'Trimui Brick Hammer' }, { query: 'Anbernic RG35XX Plus front', source: 'web', caption: 'Anbernic RG35XX Plus' }, { url: FIXTURE_PHOTO_404, caption: 'Broken link' }] }),
    note: 'one photo, one unresolvable query, one 404',
  },
  { id: 'gallery-wiki-offline', type: 'gallery', raw: j({ type: 'gallery', items: [{ query: 'Kolosseum', caption: 'Kolosseum' }, { query: 'Pantheon Rom' }] }), note: 'Wikipedia lookup fails (offline)' },
  { id: 'gallery-broken-urls', type: 'gallery', raw: j({ type: 'gallery', items: [{ url: FIXTURE_PHOTO_404, caption: 'A' }, { url: FIXTURE_PHOTO_404 }] }) },
  { id: 'image-web-query', type: 'image', raw: j({ type: 'image', query: 'Trimui Brick Hammer', source: 'web', caption: 'Trimui Brick Hammer' }) },
  { id: 'image-web-query-nocaption', type: 'image', raw: j({ type: 'image', query: 'Trimui Brick Hammer', source: 'web' }) },
  { id: 'image-wiki-offline', type: 'image', raw: j({ type: 'image', query: 'Kolosseum' }) },
  { id: 'image-url-404', type: 'image', raw: j({ type: 'image', url: FIXTURE_PHOTO_404, alt: 'Product photo' }) },
  { id: 'image-url-ok', type: 'image', raw: j({ type: 'image', url: FIXTURE_PHOTO, caption: 'Loaded photo' }) },
  {
    id: 'products-no-image-search',
    type: 'products',
    raw: j({ type: 'products', products: [{ name: 'Brick Hammer', brand: 'TrimUI', imageQuery: 'TrimUI Brick Hammer' }, { name: 'RG35XX Plus', brand: 'Anbernic', image: FIXTURE_PHOTO_404 }] }),
  },
  { id: 'places-no-image-search', type: 'places', raw: j({ type: 'places', places: [{ name: 'Café Example', address: 'Example Street 1, 12345 Example City', imageQuery: 'Café Example' }] }) },
  { id: 'compare-image-queries', type: 'compare', raw: j({ type: 'compare', columns: [{ title: 'A', imageQuery: 'Trimui Brick Hammer', items: ['3.2 in'] }, { title: 'B', imageQuery: 'RG35XX Plus', items: ['3.5 in'] }] }) },
];

/**
 * Blocks a weaker model actually wrote with field names from memory (0.1.4 real-user journeys): each must show its
 * content (choices, exercises, steps with times, quantities, places, words, a quiz without its answers, a translation
 * card), not "no data" or nothing. Plus the variants derived from them: a map without coordinates, an unknown type,
 * a quiz whose answers cannot be matched (readable list, solution hidden).
 */
const REAL_USER_CASES: RenderFixture[] = [
  ...Object.entries(REAL_USER_014).map(([k, v]) => ({ id: `real-${k}`, type: String(v.type), raw: j(v), note: '0.1.4 real-user journeys, verbatim' })),
  {
    id: 'real-map-no-coords',
    type: 'map',
    raw: j({ type: 'map', places: (REAL_USER_014['map-salzburg'].places as Record<string, unknown>[]).map(({ lat: _a, lng: _b, ...p }) => p) }),
  },
  {
    id: 'real-quiz-unmatched-answers',
    type: 'quiz',
    raw: j({ type: 'quiz', items: (REAL_USER_014.quiz.items as Record<string, unknown>[]).map((q) => ({ ...q, correct: 'none of these' })) }),
  },
];

function variants(type: string): RenderFixture[] {
  const field = LIST_FIELD[type] ?? 'items';
  return [
    { id: `${type}-bare`, type, raw: j({ type }) },
    { id: `${type}-empty-${field}`, type, raw: j({ type, [field]: [] }) },
    { id: `${type}-unknown-fields`, type, raw: j({ type, title: 'Example', foo: { bar: 1 }, [field]: 'not a list' }) },
  ];
}

export const RENDER_FIXTURES: readonly RenderFixture[] = [...IMAGE_CASES, ...REAL_USER_CASES, ...HUI_NODE_TYPES.flatMap(variants)];
