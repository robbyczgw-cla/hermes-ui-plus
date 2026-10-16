/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAT_CARD_MIN_WIDTH, scaledLineLimit, statCardMinWidth } from './fontScaleLayout.ts';

test('line cap grows with the text so the same message stays readable', () => {
  assert.equal(scaledLineLimit(4, 1), 4);
  assert.equal(scaledLineLimit(4, 0.9), 4); // never fewer lines than designed
  assert.equal(scaledLineLimit(4, Number.NaN), 4);
  assert.equal(scaledLineLimit(4, 1.3), 6);
  assert.equal(scaledLineLimit(4, 2), 8);
  assert.equal(scaledLineLimit(4, 1.25 * 2), 10); // in-app XL on top of system 2.0
});

// answer column on a 390 pt phone: 390 - 2 × 16 padding; stats grid gap 8 (spacing.s)
const PHONE_COLUMN = 358;
const GAP = 8;
const twoPerRow = (fontScale: number, width = PHONE_COLUMN) => 2 * statCardMinWidth(fontScale) + GAP <= width;

test('stat cards: base width at scale 1 and below, never smaller', () => {
  assert.equal(statCardMinWidth(1), STAT_CARD_MIN_WIDTH);
  assert.equal(statCardMinWidth(0.9), STAT_CARD_MIN_WIDTH);
  assert.equal(statCardMinWidth(Number.NaN), STAT_CARD_MIN_WIDTH);
  assert.equal(statCardMinWidth(0), STAT_CARD_MIN_WIDTH);
});

test('stat cards: two per row on a phone up to the in-app XL size, one per row at large system text', () => {
  assert.equal(twoPerRow(1), true);
  assert.equal(twoPerRow(1.25), true); // in-app XL (FONT_SCALE.xl) with system text at 1.0
  // system 1.3 and 2.0: a half-width card cut the value to "1,2…" / "68,…"
  assert.equal(twoPerRow(1.3), false);
  assert.equal(twoPerRow(2), false);
  assert.equal(statCardMinWidth(2), 280);
  // a tablet column (720) keeps two cards even at 2.0
  assert.equal(twoPerRow(2, 720 - 32), true);
});
