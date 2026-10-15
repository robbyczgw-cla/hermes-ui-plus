import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TABLE_CARDS_MAX_VIEWPORT, TEXT_COLUMN_FIT_MIN, canFitTable, cellMinWidth, isUnbreakableCell, keepArrayIdentity, keepTogether, markdownColumnWidth, fitMinWidth, headerMinWidth, longestWordLength, scrollEdges, tableCardMode, tableLayoutMode, visibleTableRows } from './tableMath.ts';

test('longestWordLength uses the longest word, not the whole label', () => {
  assert.equal(longestWordLength('Einwohner'), 9);
  assert.equal(longestWordLength('Fläche in km²'), 6);
  assert.equal(longestWordLength(''), 0);
});
test('headerMinWidth keeps long single words unbroken and grows with word length', () => {
  assert.ok(headerMinWidth('Einwohner') > headerMinWidth('Land'));
  assert.ok(headerMinWidth('Einwohner') >= 9 * 8 + 28 + 16);
  assert.equal(headerMinWidth('Fläche in km²'), headerMinWidth('Fläche'));
});

import { numericCellMinWidth, sortTableRows } from './tableMath.ts';
import { parseCellNumber } from './format.ts';

test('numeric column sorts by value, not as text; empty cells stay last', () => {
  const rows: (string | null)[][] = [['a', 'ca. 51.000'], ['b', '1,2 Mio.'], ['c', null], ['d', '300.000 €'], ['e', '9.500'], ['f', '−3,5']];
  const asc = sortTableRows(rows, 1, 1, true, 'de', parseCellNumber).map((r) => r[0]);
  assert.deepEqual(asc, ['f', 'e', 'a', 'd', 'b', 'c']);
  const desc = sortTableRows(rows, 1, -1, true, 'de', parseCellNumber).map((r) => r[0]);
  assert.deepEqual(desc, ['b', 'd', 'a', 'e', 'f', 'c']);
});
test('text column sorts by locale string, empty last', () => {
  const rows: (string | null)[][] = [['Österreich'], ['Zypern'], [null], ['Albanien'], ['Ägypten']];
  assert.deepEqual(sortTableRows(rows, 0, 1, false, 'de', parseCellNumber).map((r) => r[0]), ['Ägypten', 'Albanien', 'Österreich', 'Zypern', null]);
});
test('numericCellMinWidth grows with the widest value', () => {
  assert.ok(numericCellMinWidth(['300.000 €']) > numericCellMinWidth(['12']));
  assert.ok(numericCellMinWidth(['300.000 €']) >= 9 * 8 + 28);
});

test('UX7: tables up to 10 rows never collapse, longer ones show 8', () => {
  assert.equal(visibleTableRows(2, false), 2);
  assert.equal(visibleTableRows(10, false), 10);
  assert.equal(visibleTableRows(11, false), 8);
  assert.equal(visibleTableRows(40, false), 8);
  assert.equal(visibleTableRows(40, true), 40);
});

// GPT review #17: a horizontal scroll used to store every offset in state (≈30 full-table renders/s).
// Now only edge booleans are state; a full sweep changes them at most at the two edges.
test('scrollEdges: a full scroll sweep yields at most 3 distinct edge states (no per-event renders)', () => {
  const viewport = 360;
  const contentW = 2400;
  let renders = 0;
  let prev = scrollEdges(0, viewport, contentW);
  for (let x = 0; x <= contentW - viewport; x += 3) {
    const next = scrollEdges(x, viewport, contentW);
    if (next.scrolled !== prev.scrolled || next.atEnd !== prev.atEnd) renders++;
    prev = next;
  }
  assert.equal(renders, 2);
  assert.deepEqual(scrollEdges(0, viewport, contentW), { scrolled: false, atEnd: false });
  assert.deepEqual(scrollEdges(contentW - viewport, viewport, contentW), { scrolled: true, atEnd: true });
});

test('canFitTable: text columns wrap to fit a phone instead of scrolling', () => {
  // two long text columns (220 + 220) on a 340 px phone: fits at the text minimum → fill + wrap
  assert.equal(canFitTable(340, [220, 220], [false, false], ['Spiel', 'Was hakt']), true);
  // five text columns cannot fit at 110 each → keep horizontal scroll
  assert.equal(canFitTable(340, [200, 200, 200, 200, 200], [false, false, false, false, false], ['A', 'B', 'C', 'D', 'E']), false);
  // numbers are never shrunk
  assert.equal(canFitTable(300, [120, 200], [true, false], ['Preis', 'Notiz']), true);
  assert.equal(canFitTable(200, [150, 200], [true, false], ['Preis', 'Notiz']), false);
  assert.equal(canFitTable(0, [100], [false], ['A']), false);
});

test('tableCardMode: a table that cannot fit becomes cards only on a narrow viewport', () => {
  // phone (~390 dp), grid does not fit → cards by default
  assert.equal(tableCardMode(390, false, 5, null), true);
  // the grid fits (fill + wrap) → never cards
  assert.equal(tableCardMode(390, true, 5, null), false);
  assert.equal(tableCardMode(390, true, 5, 'cards'), false);
  // the toggle wins in both directions while cards are available
  assert.equal(tableCardMode(390, false, 5, 'grid'), false);
  assert.equal(tableCardMode(390, false, 5, 'cards'), true);
  // boundary: 519 dp is narrow, 520 dp is not (TABLE_CARDS_MAX_VIEWPORT)
  assert.equal(TABLE_CARDS_MAX_VIEWPORT, 520);
  assert.equal(tableCardMode(519, false, 5, null), true);
  assert.equal(tableCardMode(520, false, 5, null), false);
  assert.equal(tableCardMode(800, false, 5, 'cards'), false);
  // unmeasured viewport and one-column tables keep the grid
  assert.equal(tableCardMode(0, false, 5, null), false);
  assert.equal(tableCardMode(390, false, 1, null), false);
  assert.equal(tableCardMode(390, false, 2, null), true);
});

test('tableLayoutMode: the 3-column text table on a 411 dp phone fills the width (no sideways scroll)', () => {
  // "Spiel | Was ruckelt | Bericht" with long cells: every estimate hits the 220 cap, the outer width is ~379 dp
  const widths = [220, 220, 220];
  const numeric = [false, false, false];
  const heads = ['Spiel', 'Was ruckelt', 'Bericht'];
  assert.equal(tableLayoutMode(379, widths, numeric, heads, null), 'fill');
  // also at a slightly larger font (the 110 dp text minimum scales with it: 3 × 121 dp still fit)
  assert.equal(tableLayoutMode(379, widths, numeric, heads, null, 1.1), 'fill');
  // the per-cell minWidth in fill mode sums to what canFitTable checked, so the row never exceeds the viewport
  const sum = widths.reduce((s, _w, ci) => s + fitMinWidth(widths, numeric, heads, ci, 1.1), 0);
  assert.ok(sum <= 379, `min sum ${sum}`);
  // at Android font scale 1.3 three wrapping text columns need 3 × 143 dp: cards instead of cramped columns
  assert.equal(tableLayoutMode(379, widths, numeric, heads, null, 1.3), 'cards');
});

test('tableLayoutMode: not measured yet → measuring; too wide → cards on a phone, scroll on a wide screen', () => {
  const six = [220, 220, 220, 220, 220, 220];
  const text6 = six.map(() => false);
  const heads6 = ['Gerät', 'Einsatz', 'Akku', 'Gewicht', 'Besonderheit', 'Fazit'];
  assert.equal(tableLayoutMode(0, six, text6, heads6, null), 'measuring');
  assert.equal(tableLayoutMode(Number.NaN, six, text6, heads6, null), 'measuring');
  assert.equal(tableLayoutMode(379, six, text6, heads6, null), 'cards');
  // the user's "Als Tabelle" toggle → sideways-scrolling grid
  assert.equal(tableLayoutMode(379, six, text6, heads6, 'grid'), 'scroll');
  assert.equal(tableLayoutMode(TABLE_CARDS_MAX_VIEWPORT, six, text6, heads6, null), 'scroll');
  // a narrow table that is smaller than the viewport always fills
  assert.equal(tableLayoutMode(379, [90, 90], [false, true], ['A', 'B'], 'cards'), 'fill');
});

test('font scale widens header and number minimums (Android accessibility font size)', () => {
  assert.ok(headerMinWidth('Hintergrundbeleuchtung', 1.3) > headerMinWidth('Hintergrundbeleuchtung'));
  // a smaller font really needs less room (only non-finite / ≤ 0 scales fall back to 1)
  assert.ok(headerMinWidth('Hintergrundbeleuchtung', 0.85) < headerMinWidth('Hintergrundbeleuchtung'));
  assert.equal(headerMinWidth('Akku', Number.NaN), headerMinWidth('Akku'));
  assert.equal(headerMinWidth('Akku', 0), headerMinWidth('Akku'));
  assert.equal(headerMinWidth('Akku', -2), headerMinWidth('Akku'));
  assert.ok(numericCellMinWidth(['1.234.567'], 1.3) > numericCellMinWidth(['1.234.567']));
  // text columns: fit minimum is 110 dp unless the header word needs more
  assert.equal(fitMinWidth([220], [false], ['Spiel'], 0), TEXT_COLUMN_FIT_MIN);
  assert.equal(fitMinWidth([90], [false], ['Spiel'], 0), 90);
  assert.equal(fitMinWidth([130], [true], ['Preis'], 0), 130);
  // the 110 dp text minimum scales with the same factor as the glyphs
  assert.equal(fitMinWidth([400], [false], ['Spiel'], 0, 1.5), Math.round(TEXT_COLUMN_FIT_MIN * 1.5));
  assert.equal(fitMinWidth([400], [false], ['Spiel'], 0, 0.85), Math.round(TEXT_COLUMN_FIT_MIN * 0.85));
  assert.equal(fitMinWidth([400], [false], ['Spiel'], 0, Number.POSITIVE_INFINITY), TEXT_COLUMN_FIT_MIN);
  // at 1.3 the fit check gets stricter for long header words
  assert.equal(canFitTable(300, [220, 220], [false, false], ['Bildschirmtyp', 'Helligkeit']), true);
  assert.equal(canFitTable(300, [220, 220], [false, false], ['Bildschirmtyp', 'Helligkeit'], 1.3), false);
});

test('keepArrayIdentity: unchanged values keep the previous array (memoised rows skip streaming rebuilds)', () => {
  const prev = [true, false];
  assert.equal(keepArrayIdentity(prev, [true, false]), prev);
  const next = [true, true];
  assert.equal(keepArrayIdentity(prev, next), next);
  const longer = [true, false, false];
  assert.equal(keepArrayIdentity(prev, longer), longer);
  const fresh = [1, 2];
  assert.equal(keepArrayIdentity(undefined, fresh), fresh);
});

// E2E round 11, F2: at font scale 1.3 a markdown table broke "c. 1011–1021" mid-number ("c. 1011–1 / 021")
test('isUnbreakableCell: numbers, ranges, years and short labels stay on one line; prose may wrap', () => {
  for (const c of ['c. 1011–1021', '1670s', '1.299 €', '12–15 %', 'ca. 229–244 USD', 'Ja', 'Robo X1']) assert.equal(isUnbreakableCell(c), true, c);
  for (const c of ['', 'Theory of optics and light', 'Micrographia, term "cell"', 'between 1590 and 1610 in the Netherlands']) assert.equal(isUnbreakableCell(c), false, c);
});

test('keepTogether glues spaces and dashes of unbreakable cells only, never links or code', () => {
  assert.equal(keepTogether('c. 1011–1021'), 'c.\u00a01011\u2060–\u20601021');
  assert.equal(keepTogether('Theory of optics and light'), 'Theory of optics and light');
  assert.equal(keepTogether('[a](b/c)'), '[a](b/c)');
  assert.equal(keepTogether('`1-2`'), '`1-2`');
});

test('cellMinWidth: the whole unbreakable cell, else the longest word; grows with the font scale', () => {
  assert.equal(cellMinWidth(['c. 1011–1021', '1665'], 1, 8, 22), 12 * 8 + 22);
  assert.equal(cellMinWidth(['Theory of optics and light'], 1, 8, 22), 6 * 8 + 22);
  assert.ok(cellMinWidth(['c. 1011–1021'], 1.3, 8, 22) > cellMinWidth(['c. 1011–1021'], 1, 8, 22));
  assert.equal(cellMinWidth([], 1.3), 0);
});

test('markdownColumnWidth scales with the font: the round-11 period column fits "c. 1011–1021" at 1.3', () => {
  const period = ['Period', 'c. 1011–1021', 'c. 1590', '1665', '1670s'];
  const at1 = markdownColumnWidth(period, 1);
  const at13 = markdownColumnWidth(period, 1.3);
  assert.equal(at1, 118); // unchanged at scale 1
  // 12 glyphs at 14.5 px × 1.3 (≈ 0.55 em each) + 20 px padding need ≈ 145 dp; the old width stayed 118
  assert.ok(at13 >= Math.ceil(12 * 14.5 * 0.55 * 1.3) + 22, String(at13));
  // a long prose column is capped (it wraps), the cap grows with the scale
  const prose = ['Development', 'Electron microscopes resolve structures far below the wavelength of visible light'];
  assert.equal(markdownColumnWidth(prose, 1), 260);
  assert.equal(markdownColumnWidth(prose, 1.3), 338);
});

test('fill mode never squeezes a text column below its unbreakable content (keep)', () => {
  const widths = [160, 300];
  const numeric = [false, false];
  const heads = ['Period', 'Development'];
  // without keep a text column may shrink to TEXT_COLUMN_FIT_MIN × scale
  assert.equal(fitMinWidth(widths, numeric, heads, 0, 1.3), Math.round(TEXT_COLUMN_FIT_MIN * 1.3));
  assert.equal(fitMinWidth(widths, numeric, heads, 0, 1.3, [158, 0]), 158);
  // never above the column's own width
  assert.equal(fitMinWidth(widths, numeric, heads, 0, 1.3, [400, 0]), 160);
  // and the fit decision accounts for it
  assert.equal(canFitTable(400, widths, numeric, heads, 1.3), true);
  assert.equal(canFitTable(300, widths, numeric, heads, 1.3, [158, 158]), false);
});
