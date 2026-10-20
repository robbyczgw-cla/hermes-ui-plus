/// <reference types="node" />
// QA R2-05: a `map` without coordinates ("Altstadt (Zentrum)", Salzburg) became a places card whose automatic image
// query found the old town of Warsaw. Generic place names get no automatic query without a city, and the Wikipedia
// ranking no longer trusts a top search hit that does not mention what the query names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNode } from '../protocol/validate.ts';
import { peekItemImage, placeImageQuery, placeModelQuery, planItemImage, resolveItemImage, sharedPlaceCity } from './itemImage.ts';
import { coversSpecific, isGenericPlaceName, pickCommonsFile, pickWikiPage } from './rank.ts';
import { createImageResolver } from './resolver.ts';
import { slotMode, slotStatus } from './slot.ts';
import { imageLoadDecision } from './trust.ts';
import type { FetchLike, WikiFile, WikiPage } from './types.ts';

// the payload Hermes sent (default bridge, no image-search keys)
const SALZBURG_MAP = {
  type: 'map',
  markers: [
    { title: 'Altstadt (Zentrum)', description: 'Getreidegasse, Residenzplatz, Dom – Herz von Salzburg, alles zu Fuß erreichbar, kostenlos' },
    { title: 'Schloss Mirabell', description: 'Mirabellplatz 4 – wunderschöne Gärten, kostenlos, 10 min Fußweg von der Altstadt' },
    { title: 'Hohensalzburg', description: 'Hohensalzburg 1 – Festung mit Panoramablick, €16–18, 30 min zu Fuß oder Bus 3' },
  ],
};

const page = (index: number, title: string, file: string): WikiPage => ({
  title,
  index,
  disambiguation: false,
  file,
  thumb: { url: `https://upload.wikimedia.org/wikipedia/commons/thumb/x/xx/${file}/960px-${file}`, width: 960, height: 640 },
});

// dewiki generator=search for "Altstadt (Zentrum)", in index order (recorded 2026-10-20)
const ALTSTADT_SEARCH: WikiPage[] = [
  page(1, 'Warschauer Altstadt', 'Castle_Square_(Plac_Zamkowy).JPG'),
  page(2, 'Altstadt (Salzburg)', '2018-05-02_10-43-19_IMG_5533.jpg'),
  page(3, 'Altstadt (München)', 'München_Marienplatz_Rathaus_Frauenkirche_Liebfrauendom.jpg'),
  page(4, 'Prager Altstadt', 'Praha_KÚ_Staré_Město.png'),
  page(5, 'Altstädter Ring', 'Prague_07-2016_View_from_Old_Town_Hall_Tower_img3.jpg'),
];

test('R2-05 real payload: map without coords → places; "Altstadt (Zentrum)" gets no auto query, unique names keep theirs', () => {
  const node = normalizeNode(SALZBURG_MAP) as unknown as { type: string; places: { name: string; address?: string; category?: string; imageQuery?: string }[] };
  assert.equal(node.type, 'places');
  const byName = Object.fromEntries(node.places.map((p) => [p.name, p]));
  assert.equal(byName['Altstadt (Zentrum)'].imageQuery, undefined);
  assert.equal(sharedPlaceCity(node.places), ''); // no addresses → no shared city
  const city = sharedPlaceCity(node.places);
  assert.equal(placeImageQuery(byName['Altstadt (Zentrum)'], { city }), undefined);
  assert.equal(placeImageQuery(byName['Schloss Mirabell'], { city }), 'Schloss Mirabell');
  assert.equal(placeImageQuery(byName['Hohensalzburg'], { city }), 'Hohensalzburg');
});

test('generic place names: no query without a city; with one, "name city" (generic qualifiers dropped)', () => {
  for (const n of ['Altstadt (Zentrum)', 'Altstadt', 'Innenstadt', 'Hauptbahnhof', 'Dom', 'Old Town', 'City Centre', 'Main Square', 'Town Hall', 'Casco Antiguo', 'Plaza Mayor', 'Catedral', 'Playa', 'Strand']) {
    assert.ok(isGenericPlaceName(n), n);
    assert.equal(placeImageQuery({ name: n }), undefined, n);
    assert.equal(placeImageQuery({ name: n, category: 'Sehenswürdigkeit' }), undefined, `${n} + category`);
  }
  // city from the item's own address, or the one city all items of the answer share
  assert.equal(placeImageQuery({ name: 'Altstadt (Zentrum)', address: 'Getreidegasse 9, 5020 Salzburg' }), 'Altstadt Salzburg');
  assert.equal(placeImageQuery({ name: 'Altstadt (Zentrum)', category: 'Sehenswürdigkeit' }, { city: 'Salzburg' }), 'Altstadt Salzburg');
  assert.equal(placeImageQuery({ name: 'Plaza Mayor' }, { city: 'Salamanca' }), 'Plaza Mayor Salamanca');
  // specific names are unchanged (the shared city is only a fallback for generic names)
  for (const n of ['Schloss Mirabell', 'Hohensalzburg', 'Festung Hohensalzburg', 'Kolosseum', 'Wien Museum', 'Pantheon (Rom)', 'Museo del Prado', 'Hyde Park']) {
    assert.ok(!isGenericPlaceName(n), n);
    assert.equal(placeImageQuery({ name: n }, { city: 'Salzburg' }), n);
  }
  // a generic parenthetical is dropped, a specific one kept
  assert.equal(placeImageQuery({ name: 'Schloss Mirabell (Zentrum)' }), 'Schloss Mirabell');
  assert.equal(placeImageQuery({ name: 'Altstadt (Salzburg)' }), 'Altstadt (Salzburg)');
});

test('sharedPlaceCity: one city across the addresses, else none', () => {
  assert.equal(sharedPlaceCity([{ address: 'Mirabellplatz 4, 5020 Salzburg' }, { name: 'x' } as { address?: string }, { address: 'Getreidegasse 9, 5020 Salzburg' }]), 'Salzburg');
  assert.equal(sharedPlaceCity([{ address: 'Mirabellplatz 4, 5020 Salzburg' }, { address: 'Kärntner Str. 38, 1010 Wien' }]), '');
  assert.equal(sharedPlaceCity([]), '');
});

test('pickWikiPage: the five real search hits for "Altstadt (Zentrum)" → not Warsaw (nothing)', () => {
  const p = pickWikiPage(ALTSTADT_SEARCH, 'Altstadt (Zentrum)');
  assert.notEqual(p?.title, 'Warschauer Altstadt');
  assert.equal(p, null);
  assert.equal(pickWikiPage(ALTSTADT_SEARCH, 'Altstadt'), null);
  // a generic query still takes the article of exactly that name
  assert.equal(pickWikiPage([page(1, 'Strand', 'Beach.jpg'), page(2, 'Strand (Sylt)', 'Sylt.jpg')], 'Strand')?.title, 'Strand');
  // with the city, the right article wins even when it is not the top hit
  assert.equal(pickWikiPage(ALTSTADT_SEARCH, 'Altstadt Salzburg')?.title, 'Altstadt (Salzburg)');
});

test('pickWikiPage: generic words alone do not match a query that names a place', () => {
  const plaza = [page(1, 'Plaza Mayor (Madrid)', 'Plaza_Mayor_Madrid.jpg'), page(2, 'Plaza Mayor (Salamanca)', 'Plaza_Mayor_Salamanca.jpg')];
  assert.equal(pickWikiPage(plaza, 'Plaza Mayor Salamanca')?.title, 'Plaza Mayor (Salamanca)');
  assert.equal(pickWikiPage(plaza.slice(0, 1), 'Plaza Mayor Salamanca'), null);
  // blind trust in the top hit survives when it mentions the subject ("Mirabellgarten" for "Mirabell Gardens") …
  assert.equal(pickWikiPage([page(1, 'Mirabellgarten', 'Mirabellgarten.jpg')], 'Mirabell Gardens')?.title, 'Mirabellgarten');
  // … but not for an unrelated top hit
  assert.equal(pickWikiPage([page(1, 'Warschauer Altstadt', 'Castle_Square.jpg')], 'Altstadt Salzburg'), null);
  // exact / redirect-style matches unchanged
  assert.equal(pickWikiPage([page(1, 'Haushund', 'Hund.jpg')], 'Hund')?.title, 'Haushund');
  assert.equal(pickWikiPage([page(1, 'Schloss Mirabell', 'Mirabell.jpg'), page(4, 'Mirabellplatz', 'Platz.jpg')], 'Schloss Mirabell')?.title, 'Schloss Mirabell');
  assert.equal(pickWikiPage([page(1, 'Festung Hohensalzburg', 'Fortress.jpg')], 'Hohensalzburg')?.title, 'Festung Hohensalzburg');
  assert.ok(coversSpecific('Hamburger Hafen', 'Hafen Hamburg'));
  assert.ok(!coversSpecific('Warschauer Altstadt', 'Altstadt (Zentrum)'));
});

test('pickCommonsFile: a file named only with the generic words is no match for a named place', () => {
  const file = (index: number, name: string): WikiFile => ({ name, index, mime: 'image/jpeg', width: 1200, height: 800, thumb: { url: `https://upload.wikimedia.org/x/${index}.jpg`, width: 960, height: 640 } });
  assert.equal(pickCommonsFile([file(1, 'Plaza Mayor Madrid 2019.jpg')], 'Plaza Mayor Salamanca'), null);
  assert.equal(pickCommonsFile([file(1, 'Plaza Mayor Madrid 2019.jpg'), file(2, 'Plaza Mayor de Salamanca.jpg')], 'Plaza Mayor Salamanca')?.name, 'Plaza Mayor de Salamanca.jpg');
});

test('resolver: recorded search hits for "Altstadt (Zentrum)" → no photo (null), never Warsaw', async () => {
  const toApi = (pages: WikiPage[]) =>
    JSON.stringify({
      query: { pages: pages.map((p) => ({ pageid: p.index, ns: 0, title: p.title, index: p.index, thumbnail: { source: p.thumb!.url, width: 960, height: 640 }, pageimage: p.file })) },
    });
  const fetch: FetchLike = async (url) => {
    const p = new URL(url).searchParams;
    const body = p.get('generator') === 'search' && new URL(url).host === 'de.wikipedia.org' ? toApi(ALTSTADT_SEARCH) : '{"batchcomplete":true}';
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => body };
  };
  const r = createImageResolver({ fetch, batchWindowMs: 1, storage: null });
  assert.equal(await r.resolve('Altstadt (Zentrum)'), null);
  assert.equal((await r.resolve('Altstadt Salzburg'))?.title, 'Altstadt (Salzburg)');
});

test('no auto query → no search, the card shows its category glyph / collapses to its text (never an empty box)', async () => {
  const autoQuery = placeImageQuery({ name: 'Altstadt (Zentrum)' });
  const plan = planItemImage({ autoQuery }, imageLoadDecision);
  assert.deepEqual(plan.queries, []);
  // answered synchronously: nothing to wait for, no shimmer
  assert.deepEqual(peekItemImage(plan, () => undefined, true), { kind: 'icon' });
  let searched = 0;
  assert.deepEqual(
    await resolveItemImage(plan, async () => (searched++, null), true),
    { kind: 'icon' },
  );
  assert.equal(searched, 0);
  const self = slotStatus({ hasImage: false, pending: false });
  // next to a card with a photo: the calm category tile; alone: no image area, the card starts with name + note
  assert.equal(slotMode(self, ['image']), 'fallback');
  assert.equal(slotMode(self, ['none']), 'collapse');
});

test('a model-written imageQuery of only generic words gets the same rule (city or no photo)', () => {
  assert.equal(placeModelQuery('Altstadt'), undefined);
  assert.equal(placeModelQuery('Altstadt', { city: 'Salzburg' }), 'Altstadt Salzburg');
  assert.equal(placeModelQuery('Schloss Mirabell'), 'Schloss Mirabell');
  assert.equal(placeModelQuery(undefined), undefined);
});
