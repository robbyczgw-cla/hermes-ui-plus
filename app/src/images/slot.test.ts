import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASK_EDGE_CLEARANCE, ASK_GAP, IMAGE_SLOT_CAP_MS, askPlaceholderLayout, fallbackHeight, groupHasImages, monogram, slotMode, slotNeedsVisibility, slotShimmer, slotStatus } from './slot.ts';

test('slotStatus: photo, resolving, nothing; expiry is sticky', () => {
  assert.equal(slotStatus({ hasImage: true, pending: false }), 'image');
  assert.equal(slotStatus({ hasImage: false, pending: true }), 'pending');
  assert.equal(slotStatus({ hasImage: false, pending: false }), 'none');
  assert.equal(slotStatus({ hasImage: false, pending: true, expired: true }), 'none');
  assert.equal(slotStatus({ hasImage: true, pending: false, expired: true }), 'none'); // late photo does not re-open the slot
  assert.equal(IMAGE_SLOT_CAP_MS, 3000);
});

test('slotMode: a single card without photo collapses, with one it shows the photo / shimmer', () => {
  assert.equal(slotMode('none', []), 'collapse');
  assert.equal(slotMode('image', []), 'image');
  assert.equal(slotMode('pending', []), 'skeleton');
});

test('slotMode: neither of two cards has a photo → both collapse (no image row at all)', () => {
  assert.equal(slotMode('none', ['none']), 'collapse');
  assert.equal(slotMode('none', ['none', 'none', 'none']), 'collapse');
});

test('slotMode: one card has a photo, the other none → aligned fallback for the one without', () => {
  assert.equal(slotMode('none', ['image']), 'fallback');
  assert.equal(slotMode('image', ['none']), 'image');
  assert.equal(slotMode('none', ['none', 'image']), 'fallback');
});

test('slotMode: a sibling that is still resolving keeps the area until it gives up', () => {
  assert.equal(slotMode('none', ['pending']), 'fallback');
  assert.equal(slotMode('none', [slotStatus({ hasImage: false, pending: true, expired: true })]), 'collapse');
});

test('groupHasImages', () => {
  assert.equal(groupHasImages([]), false);
  assert.equal(groupHasImages(['none', 'none']), false);
  assert.equal(groupHasImages(['none', 'pending']), true);
  assert.equal(groupHasImages(['image']), true);
});

test('fallbackHeight: thumbnails keep their size, big areas shrink', () => {
  assert.equal(fallbackHeight(56), 56);
  assert.equal(fallbackHeight(72), 72);
  assert.equal(fallbackHeight(120), 60);
  assert.equal(fallbackHeight(180), 90);
  assert.equal(fallbackHeight(240), 120);
  assert.equal(fallbackHeight(92), 48);
  assert.equal(fallbackHeight(100), 50);
  assert.equal(fallbackHeight(0), 0);
});

test('monogram: first letter or digit, upper-cased', () => {
  assert.equal(monogram('8 GB'), '8');
  assert.equal(monogram('  iPhone 15'), 'I');
  assert.equal(monogram('éclair'), 'É');
  assert.equal(monogram('— ?'), '');
  assert.equal(monogram(undefined), '');
});

test('slotNeedsVisibility: only a rendered slot that still waits for its first lookup watches the viewport', () => {
  const base = { enabled: true, seen: false, status: 'loading' as const, mode: 'skeleton' as const };
  assert.equal(slotNeedsVisibility(base), true);
  assert.equal(slotNeedsVisibility({ ...base, mode: 'image' }), true);
  // collapsed / fallback slots render no measurable box
  assert.equal(slotNeedsVisibility({ ...base, mode: 'collapse' }), false);
  assert.equal(slotNeedsVisibility({ ...base, mode: 'fallback' }), false);
  // already seen, cached / resolved, or still streaming (idle): nothing to detect
  assert.equal(slotNeedsVisibility({ ...base, seen: true }), false);
  assert.equal(slotNeedsVisibility({ ...base, status: 'done' }), false);
  assert.equal(slotNeedsVisibility({ ...base, status: 'idle' }), false);
  assert.equal(slotNeedsVisibility({ ...base, enabled: false }), false);
});

// E2E round 4, B5: with "Erst nach Tippen" list cards had no image area at all, and in the detail hero the
// tap-to-load button sat at the bottom edge (clipped on the left, under the "Preis-Leistung" badge).
test('tap-to-load counts as content: the slot keeps its full image size (cards and hero)', () => {
  const ask = slotStatus({ hasImage: true, pending: false });
  assert.equal(slotMode(ask, []), 'image');
  assert.equal(slotMode(ask, ['none', 'none']), 'image');
});

test('tap-to-load placeholder: centred, clear of the corner badges; glyph only where it fits; compact thumbnails icon-only', () => {
  for (const [h, icon] of [
    [240, 56], // product detail hero
    [220, 48], // place detail hero
    [150, 34], // product / place card
  ] as const) {
    const l = askPlaceholderLayout(h, icon);
    assert.equal(l.compact, false);
    const column = (l.glyph ? icon + ASK_GAP : 0) + l.buttonH;
    assert.ok((h - column) / 2 >= ASK_EDGE_CLEARANCE, `${h}: the column stays out of the top/bottom badge rows`);
  }
  assert.equal(askPlaceholderLayout(240, 56).glyph, true);
  assert.equal(askPlaceholderLayout(150, 34).glyph, true);
  assert.equal(askPlaceholderLayout(130, 34).glyph, false, 'lower slots: the button alone (the glyph would reach a badge)');
  const thumb = askPlaceholderLayout(76, 26);
  assert.equal(thumb.compact, true);
  assert.equal(thumb.glyph, false);
  assert.ok(thumb.buttonH <= 76);
});

// E2E round 5, N2: a restored product card whose slot waited for its first visibility report showed the shimmer
// (glyph suppressed) with nothing able to end it: the lookup and the cap both waited for that report.
test('slotShimmer: a slot never reported visible shimmers at most for the cap, then shows its category glyph', () => {
  // waiting for the viewport watcher, within the cap: looks like loading
  assert.equal(slotShimmer({ loading: true, seen: false, lookupCapPassed: false, waitCapPassed: false }), true);
  // still not reported visible after the cap: calm glyph tile (the size stays, a later lookup may still fill it)
  assert.equal(slotShimmer({ loading: true, seen: false, lookupCapPassed: false, waitCapPassed: true }), false);
  // seen (scrolled in later): the lookup runs → shimmer again, capped from that moment
  assert.equal(slotShimmer({ loading: true, seen: true, lookupCapPassed: false, waitCapPassed: true }), true);
  assert.equal(slotShimmer({ loading: true, seen: true, lookupCapPassed: true, waitCapPassed: true }), false);
  // resolved / idle: never
  assert.equal(slotShimmer({ loading: false, seen: true, lookupCapPassed: false, waitCapPassed: false }), false);
  assert.equal(slotShimmer({ loading: false, seen: false, lookupCapPassed: false, waitCapPassed: false }), false);
});

test('product photos: card thumbnails fill their tile (no letterbox bars), detail sheet / lightbox show the whole shot', async () => {
  const { productImageFit, photoInset } = await import('./slot.ts');
  for (const ctx of ['card', 'rank'] as const) assert.equal(productImageFit(ctx), 'cover', ctx);
  // wide, short compare tiles cut tall products: whole photo there
  for (const ctx of ['compare', 'detail', 'lightbox'] as const) assert.equal(productImageFit(ctx), 'contain', ctx);
  // a covering photo sits edge to edge; an inset (tile margin) is only for whole-product 'contain' tiles
  assert.equal(photoInset({ tile: true, fit: 'cover', height: 150 }), 0);
  assert.equal(photoInset({ tile: true, fit: 'contain', height: 150 }), 12);
  assert.equal(photoInset({ tile: true, fit: 'contain', height: 40 }), 4);
  assert.equal(photoInset({ tile: false, fit: 'contain', height: 150 }), 0);
});

test('product photos: every product card thumbnail uses the cover policy, the detail hero stays contain', async () => {
  const { readFileSync } = await import('node:fs');
  const src = (p: string) => readFileSync(new URL(`../ui/components/${p}`, import.meta.url), 'utf8');
  const products = src('modules/d1/Products.tsx');
  const fits = [...products.matchAll(/<CardImage [^>]*?fit=\{productImageFit\('(\w+)'\)\}/g)].map((m) => m[1]);
  assert.deepEqual(fits.sort(), ['card', 'compare', 'detail', 'rank']);
  assert.doesNotMatch(products, /fit="contain"/);
  assert.match(src('content.tsx'), /fit=\{productImageFit\('compare'\)\}/);
});
