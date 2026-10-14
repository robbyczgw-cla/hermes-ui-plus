import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeT } from '../../../../i18n/core.ts';
import {
  buildCompareTable,
  cleanPhone,
  cleanUrl,
  displayPrice,
  formatCount,
  formatPrice,
  formatRating,
  formatScore,
  scoresLine,
  normalizePlaces,
  normalizeProducts,
  openState,
  parseHoursLines,
  parseRanges,
  placeA11y,
  placeKind,
  placesMapNode,
  priceLevel,
  productA11y,
  productKind,
  productReply,
  starFills,
  toggleCompare,
  weekdayOf,
  type ProductItem,
} from './d1Model.ts';

const de = makeT('de', 'de-DE');
const en = makeT('en', 'en-US');
const es = makeT('es', 'es-ES');
const NB = ' ';

test('rating: one decimal, clamped, localised separator', () => {
  assert.equal(formatRating(4.56), '4,6');
  assert.equal(formatRating(4.56, 'en'), '4.6');
  assert.equal(formatRating(5), '5,0');
  assert.equal(formatRating(7), '5,0');
  assert.equal(formatRating(-1, 'en'), '0.0');
});

test('rating: star fills round to the nearest half', () => {
  assert.deepEqual(starFills(4.6), [1, 1, 1, 1, 0.5]);
  assert.deepEqual(starFills(4.8), [1, 1, 1, 1, 1]);
  assert.deepEqual(starFills(3.2), [1, 1, 1, 0, 0]);
  assert.deepEqual(starFills(0), [0, 0, 0, 0, 0]);
});

test('review counts: grouped, compact above 10k', () => {
  assert.equal(formatCount(2345), '2.345');
  assert.equal(formatCount(2345, 'en'), '2,345');
  assert.equal(formatCount(987), '987');
  assert.equal(formatCount(12500), `12,5${NB}Tsd.`);
  assert.equal(formatCount(12500, 'en'), '12.5K');
  assert.equal(formatCount(12500, 'es'), `12,5${NB}mil`);
  assert.equal(formatCount(2_400_000, 'en'), '2.4M');
});

test('price: app currency format, cents only when needed', () => {
  assert.equal(formatPrice(349, 'EUR'), `349${NB}€`);
  assert.equal(formatPrice(349, 'EUR', 'en'), '€349');
  assert.equal(formatPrice(1299, 'EUR'), `1.299${NB}€`);
  assert.equal(formatPrice(1299, 'EUR', 'es'), `1299${NB}€`);
  assert.equal(formatPrice(349.9, 'EUR'), `349,90${NB}€`);
  assert.equal(formatPrice(99.99, 'USD', 'en'), '$99.99');
  assert.equal(formatPrice(50, undefined), `50${NB}€`);
  assert.equal(formatPrice(50, '€'), `50${NB}€`);
  assert.equal(formatPrice(80, 'CHF'), `80${NB}CHF`);
});

test('price level: symbols or 1–4', () => {
  assert.deepEqual(priceLevel('€€'), { level: 2, symbol: '€' });
  assert.deepEqual(priceLevel('$$$'), { level: 3, symbol: '$' });
  assert.deepEqual(priceLevel(4), { level: 4, symbol: '€' });
  assert.equal(priceLevel('€$'), null);
  assert.equal(priceLevel('€€€€€'), null);
  assert.equal(priceLevel(0), null);
});

test('hours: ranges with split shifts, am/pm, after midnight', () => {
  const r = parseRanges('12:30–15:00, 19–23:30 Uhr');
  assert.deepEqual(r.map((x) => [x.start, x.end, x.startText, x.endText]), [
    [750, 900, '12:30', '15:00'],
    [1140, 1410, '19:00', '23:30'],
  ]);
  const am = parseRanges('9 AM – 5:30 PM');
  assert.deepEqual(am.map((x) => [x.start, x.end, x.endText]), [[540, 1050, `5:30${NB}PM`]]);
  const late = parseRanges('18:00–02:00');
  assert.equal(late[0].end, 26 * 60);
});

test('open state: text per language and time of day', () => {
  assert.deepEqual(openState({ openNow: true }, de), { kind: 'open', text: 'Jetzt geöffnet' });
  assert.deepEqual(openState({ openNow: true, hoursToday: '12:00–23:00' }, de), { kind: 'open', text: 'Geöffnet · bis 23:00' });
  assert.equal(openState({ openNow: true, hoursToday: '12:00–23:00' }, en)?.text, 'Open · until 23:00');
  assert.equal(openState({ openNow: false, hoursToday: '9:00–18:00' }, de)?.text, 'Geschlossen · öffnet 9:00');
  assert.equal(openState({ openNow: false, hoursToday: '9:00–18:00' }, es)?.text, 'Cerrado · abre a las 9:00');
  // split shift: at 16:00 the next opening is the evening one; at 13:00 it closes at 15:00
  const split = { hoursToday: '12:00–15:00, 19:00–23:00' };
  assert.equal(openState({ ...split, openNow: false }, de, 16 * 60)?.text, 'Geschlossen · öffnet 19:00');
  assert.equal(openState({ ...split, openNow: true }, de, 13 * 60)?.text, 'Geöffnet · bis 15:00');
  assert.equal(openState({ ...split, openNow: false }, de, 23 * 60 + 30)?.text, 'Geschlossen');
  assert.deepEqual(openState({ openNow: false, hoursToday: 'Ruhetag' }, de), { kind: 'closed', text: 'Heute geschlossen' });
  assert.deepEqual(openState({ hoursToday: '8–20 Uhr' }, de), { kind: 'unknown', text: 'Heute 8–20 Uhr' });
  assert.equal(openState({}, de), null);
  // model-written forms of hoursToday
  assert.equal(openState({ hoursToday: 'Heute 9:00–18:00' }, de)?.text, 'Heute 9:00–18:00');
  assert.equal(openState({ openNow: false, hoursToday: 'öffnet 9:00' }, de)?.text, 'Geschlossen · öffnet 9:00');
  assert.equal(openState({ openNow: false, hoursToday: 'opens 9 AM' }, en)?.text, `Closed · opens 9${NB}AM`);
  assert.equal(openState({ hoursToday: 'öffnet 9:00' }, de)?.text, 'öffnet 9:00');
});

test('hours table: weekday labels in de/en/es, ranges, free text', () => {
  assert.equal(weekdayOf('Mo'), 1);
  assert.equal(weekdayOf('Do.'), 4);
  assert.equal(weekdayOf('Dom'), 0);
  assert.equal(weekdayOf('Mar'), 2);
  assert.equal(weekdayOf('Sunday'), 0);
  assert.equal(weekdayOf('Sáb'), 6);
  const rows = parseHoursLines(['Mo: 12:00–23:00', 'Di–Fr 12–15, 19–23 Uhr', 'Sonntag geschlossen', 'Feiertags nach Absprache']);
  assert.deepEqual(rows[0], { day: 'Mo', hours: '12:00–23:00', weekday: 1, days: [1] });
  assert.deepEqual(rows[1].days, [2, 3, 4, 5]);
  assert.equal(rows[1].hours, '12–15, 19–23 Uhr');
  assert.deepEqual(rows[2], { day: 'Sonntag', hours: 'geschlossen', weekday: 0, days: [0] });
  assert.deepEqual(rows[3], { day: '', hours: 'Feiertags nach Absprache', weekday: null, days: [] });
  assert.deepEqual(parseHoursLines(['Fr–Mo 10–22'])[0].days, [5, 6, 0, 1]);
});

test('places: streaming keeps the last item as pending, dedupes keys, validates fields', () => {
  const node = {
    type: 'places',
    title: 'Rom',
    places: [
      { id: 'a', name: 'Roscioli', rating: 4.6, reviews: 2345, price: '€€€', lat: 41.89, lng: 12.47, openNow: true },
      { id: 'a', name: 'Armando', rating: 9, price: 'teuer', lat: 200, lng: 12 },
      { name: 'Da Enz' },
    ],
  };
  // the stream parser already dropped the open item: all three retained items are complete and shown
  const s = normalizePlaces(node, true);
  assert.equal(s.items.length, 3);
  assert.equal(s.pending, true);
  assert.deepEqual(s.items.map((p) => p.key), ['a', 'a_', 'p2']);
  assert.equal(s.items[1].rating, undefined);
  assert.equal(s.items[1].price, undefined);
  assert.equal(s.items[1].lat, undefined);
  const done = normalizePlaces(node, false);
  assert.equal(done.items.length, 3);
  assert.equal(done.pending, false);
  assert.equal(done.layout, 'carousel');
  assert.equal(normalizePlaces({ places: [] }, true).pending, false);
  const map = placesMapNode('m', done.items);
  assert.deepEqual((map?.markers as unknown[]).length, 1);
  assert.equal(map?.zoom, 16);
});

test('places: category icons and the one-sentence label', () => {
  assert.equal(placeKind('Trattoria'), 'food');
  assert.equal(placeKind('Weinbar'), 'bar');
  assert.equal(placeKind('Café & Bäckerei'), 'cafe');
  assert.equal(placeKind('Museo'), 'sight');
  assert.equal(placeKind(undefined, 'Hotel Artemide'), 'hotel');
  assert.equal(placeKind('Sonstiges'), 'pin');
  const p = normalizePlaces({ places: [{ name: 'Da Enzo al 29', category: 'Trattoria', price: '€€', distance: '0,8 km', rating: 4.6, reviews: 2345, openNow: true, hoursToday: '12:30–23:00', note: 'Cacio e pepe.' }] }).items[0];
  assert.equal(
    placeA11y(p, de, 'de'),
    'Da Enzo al 29. Trattoria, Preisniveau 2 von 4, 0,8 km entfernt. 4,6 von 5 Sternen, 2.345 Bewertungen. Geöffnet · bis 23:00. Cacio e pepe.',
  );
  assert.equal(placeA11y({ ...p, reviews: 1, category: undefined, price: undefined, distance: undefined, openNow: undefined, hoursToday: undefined, note: undefined }, en, 'en'), 'Da Enzo al 29. 4.6 out of 5 stars, 1 review.');
});

test('action helpers: phone + url cleaning', () => {
  assert.equal(cleanPhone('+39 06 687 5287'), '+39066875287');
  assert.equal(cleanPhone('0039 06 1234'), '+39061234');
  assert.equal(cleanPhone('12'), null);
  assert.equal(cleanUrl('www.roscioli.com'), 'https://www.roscioli.com');
  assert.equal(cleanUrl('https://x.it/a?b=1'), 'https://x.it/a?b=1');
  assert.equal(cleanUrl('javascript:alert(1)'), null);
  assert.equal(cleanUrl('ftp://x.it'), null);
});

const HEADPHONES = normalizeProducts({
  type: 'products',
  id: 'kh',
  products: [
    { id: 'sony', name: 'WH-1000XM6', brand: 'Sony', price: 449, rating: 4.7, reviews: 1203, specs: [{ label: 'ANC', value: 'sehr gut' }, { label: 'Akku', value: '30 h' }, { label: 'Gewicht', value: '254 g' }] },
    { id: 'bose', name: 'QuietComfort Ultra', brand: 'Bose', offers: [{ merchant: 'A', price: 399, url: 'a.de/x' }, { merchant: 'B', price: 379.99, url: 'https://b.de/x' }, { merchant: 'C', url: 'javascript:x' }], rating: 4.5, specs: [{ label: 'akku:', value: '24 h' }, { label: 'ANC', value: 'Sehr gut' }, { label: 'Multipoint', value: 'ja' }] },
    { id: 'apple', name: 'AirPods Max', brand: 'Apple', price: 579, specs: [{ label: 'Akku', value: '20 h' }] },
  ],
});

test('products: normalise offers, cheapest price as "ab"', () => {
  const bose = HEADPHONES.items[1];
  assert.equal(bose.offers.length, 2);
  const txt = normalizeProducts({ products: [{ name: 'X', offers: [{ merchant: 'M', price: 'ab 20 €', url: 'https://m.de' }, { merchant: 'N', price: '19.5', url: 'https://n.de' }] }] }).items[0];
  assert.deepEqual(txt.offers, [{ merchant: 'M', url: 'https://m.de', priceText: 'ab 20 €' }, { merchant: 'N', url: 'https://n.de', price: 19.5 }]);
  assert.equal(bose.offers[0].url, 'https://a.de/x');
  assert.deepEqual(displayPrice(bose), { price: 379.99, from: true });
  assert.deepEqual(displayPrice(HEADPHONES.items[0]), { price: 449, from: false });
  assert.equal(productKind('WH-1000XM6', 'Sony'), 'headphones');
  assert.equal(productKind('Galaxy S25'), 'phone');
  assert.equal(productKind('Thermomix TM7'), 'box');
  assert.equal(normalizeProducts({ products: [{ name: 'A' }, { name: 'B' }] }, true).items.length, 2);
});

test('products: compare table rows, best values and differences', () => {
  const tbl = buildCompareTable(HEADPHONES.items, { price: 'Preis', rating: 'Bewertung' }, 'de');
  assert.deepEqual(tbl.columns.map((c) => c.key), ['sony', 'bose', 'apple']);
  const byKey = Object.fromEntries(tbl.rows.map((r) => [r.key, r]));
  assert.deepEqual(byKey.price.cells, [`449${NB}€`, `379,99${NB}€`, `579${NB}€`]);
  assert.deepEqual(byKey.price.best, [1]);
  assert.deepEqual(byKey.rating.cells, ['4,7 ★', '4,5 ★', null]);
  assert.deepEqual(byKey.rating.best, [0]);
  // labels merge case-insensitively, first-seen spelling wins; order = first appearance
  assert.deepEqual(tbl.rows.map((r) => r.label), ['Preis', 'Bewertung', 'ANC', 'Akku', 'Gewicht', 'Multipoint']);
  assert.deepEqual(byKey['spec:akku'].cells, ['30 h', '24 h', '20 h']);
  assert.equal(byKey['spec:anc'].differs, true); // AirPods has no ANC value
  const two = buildCompareTable(HEADPHONES.items.slice(0, 2), { price: 'Price', rating: 'Rating' }, 'en');
  assert.equal(two.rows.find((r) => r.key === 'spec:anc')?.differs, false); // "sehr gut" vs "Sehr gut"
  assert.deepEqual(two.rows[0].cells, ['€449', '€379.99']);
});

test('products: compare selection max 3, reply + label', () => {
  assert.deepEqual(toggleCompare([], 'a'), { sel: ['a'], full: false });
  assert.deepEqual(toggleCompare(['a', 'b', 'c'], 'd'), { sel: ['a', 'b', 'c'], full: true });
  assert.deepEqual(toggleCompare(['a', 'b'], 'a'), { sel: ['b'], full: false });
  const sony = HEADPHONES.items[0];
  assert.equal(productReply('kh', sony, de), '[products:kh] Favorit: Sony WH-1000XM6');
  assert.equal(productReply('kh', HEADPHONES.items[1], en), '[products:kh] Pick: Bose QuietComfort Ultra');
  assert.equal(productA11y(sony, de, 'de'), `Sony WH-1000XM6. 449${NB}€. 4,7 von 5 Sternen, 1.203 Bewertungen. ANC: sehr gut, Akku: 30 h, Gewicht: 254 g.`);
  assert.equal(productA11y(HEADPHONES.items[1], en, 'en').startsWith('Bose QuietComfort Ultra. from $'), false);
  assert.ok(productA11y(HEADPHONES.items[1], en, 'en').startsWith('Bose QuietComfort Ultra. from €379.99.'));
});

test('products: ranked lists, verdict, category scores', () => {
  const m = normalizeProducts({
    type: 'products',
    id: 'retro',
    ranked: true,
    products: Array.from({ length: 12 }, (_, i) => ({ name: `Gerät ${i + 1}`, brand: 'Retroid', verdict: i === 0 ? 'Beste Ergonomie' : undefined, scores: i === 0 ? [{ label: 'Ergonomie', value: 9 }, { label: '2D', value: 7.5 }, { label: '3D', value: 11 }] : { Akku: 8 } })),
  });
  assert.equal(m.ranked, true);
  assert.equal(m.items.length, 10);
  assert.deepEqual(m.items[0].scores, [{ label: 'Ergonomie', value: 9 }, { label: '2D', value: 7.5 }, { label: '3D', value: 10 }]);
  assert.deepEqual(m.items[1].scores, [{ label: 'Akku', value: 8 }]);
  assert.equal(normalizeProducts({ products: [{ name: 'x' }] }).ranked, false);
  assert.equal(scoresLine(m.items[0].scores), 'Ergonomie 9 · 2D 7,5 · 3D 10');
  assert.equal(scoresLine(m.items[0].scores, 'en'), 'Ergonomie 9 · 2D 7.5 · 3D 10');
  assert.equal(formatScore(8.04), '8');
  assert.equal(
    productA11y(m.items[0], de, 'de', 1),
    'Platz 1: Retroid Gerät 1. Beste Ergonomie. Ergonomie 9 von 10, 2D 7,5 von 10, 3D 10 von 10.',
  );
  assert.equal(productKind('Pocket 5', 'Retroid'), 'gamepad');
  assert.equal(productKind('RG406H', 'Anbernic'), 'gamepad');
  assert.equal(productKind('Steam Deck OLED'), 'gamepad');
});

import { shouldResetRail } from './railReset.ts';
test('rail resets to the first card while streaming and on completion, never after a manual scroll', () => {
  assert.equal(shouldResetRail({ streaming: true, prevStreaming: true, userScrolled: false, x: 320 }), true);
  assert.equal(shouldResetRail({ streaming: false, prevStreaming: true, userScrolled: false, x: 640 }), true);
  assert.equal(shouldResetRail({ streaming: false, prevStreaming: true, userScrolled: true, x: 640 }), false);
  assert.equal(shouldResetRail({ streaming: false, prevStreaming: false, userScrolled: false, x: 640 }), false);
  assert.equal(shouldResetRail({ streaming: true, prevStreaming: true, userScrolled: false, x: 0 }), false);
});

// GPT review #19: through the real stream parser, a closed product followed by an open one shows the closed
// product (the parser drops the open one; the reader used to drop one more → lag by one completed item).
import { createStreamParser } from '../../../../protocol/streamParser.ts';
test('#19 streaming places/products: every completed item is visible', () => {
  const seg = createStreamParser()
    .push('```hui\n{"type":"products","products":[{"name":"Bose QC","price":379},{"name":"Son')
    .find((x) => x.kind === 'hui');
  assert.ok(seg && seg.kind === 'hui' && seg.node);
  const m = normalizeProducts(seg.node, true);
  assert.deepEqual(m.items.map((i) => i.name), ['Bose QC']);
  assert.equal(m.pending, true);
  const pl = createStreamParser()
    .push('```hui\n{"type":"places","places":[{"name":"Roscioli"},{"name":"Arm')
    .find((x) => x.kind === 'hui');
  assert.ok(pl && pl.kind === 'hui');
  assert.deepEqual(normalizePlaces(pl.node, true).items.map((i) => i.name), ['Roscioli']);
});
