import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTextWidth, segmentedFits } from './segmentedLayout.ts';
import { settings as de } from '../i18n/ns/settings.de.ts';
import { settings as en } from '../i18n/ns/settings.en.ts';
import { settings as es } from '../i18n/ns/settings.es.ts';

// content width of the settings list on a typical phone (411 dp wide, 16 dp padding on each side)
const PHONE = 379;

test('E2E round 4, B4: the unknown-images and image-search options do not fit as segments → option list (de/en/es)', () => {
  for (const s of [de, en, es]) {
    const unknown = [s.media.unknownBridge, s.media.unknownTap, s.media.unknownAlways];
    const search = [s.media.imageSearch.bridge, s.media.imageSearch.own, s.media.imageSearch.wiki];
    for (const scale of [1, 1.3]) {
      assert.equal(segmentedFits(unknown, PHONE, scale), false, `${unknown.join(' / ')} @${scale}`);
      assert.equal(segmentedFits(search, PHONE, scale), false, `${search.join(' / ')} @${scale}`);
    }
  }
  // "Erst nach Tippen" alone was cut at font scale 1.3
  assert.equal(segmentedFits(['Erst nach Tippen', 'Immer', 'Nie'], PHONE, 1.3), false);
});

test('short options stay a segmented control, also with large system text', () => {
  for (const s of [de, en, es]) {
    const images = [s.media.always, s.media.wifi, s.media.never];
    assert.equal(segmentedFits(images, PHONE, 1), true, images.join(' / '));
    assert.equal(segmentedFits(images, PHONE, 1.3), true, images.join(' / '));
  }
  assert.equal(segmentedFits(['S', 'M', 'L', 'XL'], PHONE, 2), true);
});

test('narrow screens / huge text flip a control that fits elsewhere; no layout yet → assume it fits', () => {
  const opts = ['Kompakt', 'Normal', 'Luftig'];
  assert.equal(segmentedFits(opts, PHONE, 1), true);
  assert.equal(segmentedFits(opts, 200, 1.3), false);
  assert.equal(segmentedFits(opts, PHONE, 3), false);
  assert.equal(segmentedFits(opts, 0, 1), true, 'width unknown (first render)');
  assert.equal(segmentedFits([], PHONE, 1), true);
});

test('width estimate: wide letters cost more than narrow ones, scales with the font size', () => {
  assert.ok(estimateTextWidth('MMMM', 10) > estimateTextWidth('iiii', 10));
  assert.ok(Math.abs(estimateTextWidth('Hallo', 20) - 2 * estimateTextWidth('Hallo', 10)) < 1e-9);
  assert.equal(estimateTextWidth('', 13), 0);
});
