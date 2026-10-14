import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampServings, formatFraction, ingredientLine, scaledItem, scaleQuantity, snapFraction, unitInfo } from './quantity.ts';

test('fractions: snapping and glyphs', () => {
  assert.equal(formatFraction(0.5), '½');
  assert.equal(formatFraction(0.25), '¼');
  assert.equal(formatFraction(0.75), '¾');
  assert.equal(formatFraction(1.5), '1 ½');
  assert.equal(formatFraction(2), '2');
  assert.equal(formatFraction(1 / 3), '⅓');
  assert.equal(formatFraction(1.2), '1,2');
  assert.equal(snapFraction(1.3), 1 + 1 / 3);
  assert.equal(snapFraction(1.3, false), 1.25);
  assert.equal(snapFraction(0.9), 1);
  assert.equal(snapFraction(0), 0);
});

test('units are recognised case-insensitively', () => {
  assert.equal(unitInfo('EL').canonical, 'EL');
  assert.equal(unitInfo('el').kind, 'spoon');
  assert.equal(unitInfo('Esslöffel').canonical, 'EL');
  assert.equal(unitInfo('Gramm').canonical, 'g');
  assert.equal(unitInfo('Prisen').kind, 'pinch');
  assert.equal(unitInfo(undefined).kind, 'count');
  assert.equal(unitInfo('Schachtel').known, false);
});

test('grams: kitchen rounding and kg conversion', () => {
  assert.equal(scaleQuantity(200, 'g', 1.5).text, '300 g');
  assert.equal(scaleQuantity(250, 'g', 0.5).text, '130 g'); // 125 → 10 g steps
  assert.equal(scaleQuantity(30, 'g', 0.75).text, '25 g'); // 22.5 → 5 g steps (half up)
  assert.equal(scaleQuantity(5, 'g', 0.5).text, '3 g');
  assert.equal(scaleQuantity(800, 'g', 2).text, '1,6 kg');
  assert.equal(scaleQuantity(500, 'g', 2.5).text, '1,25 kg');
  assert.equal(scaleQuantity(1, 'kg', 0.5).text, '500 g');
  assert.equal(scaleQuantity(1, 'kg', 1.5).text, '1,5 kg');
});

test('millilitres and litres', () => {
  assert.equal(scaleQuantity(200, 'ml', 2).text, '400 ml');
  assert.equal(scaleQuantity(600, 'ml', 2).text, '1,2 l');
  assert.equal(scaleQuantity(0.5, 'l', 0.5).text, '¼ l');
  assert.equal(scaleQuantity(1, 'l', 0.75).text, '¾ l');
  assert.equal(scaleQuantity(1, 'l', 1.5).text, '1 ½ l');
  assert.equal(scaleQuantity(0.1, 'l', 0.5).text, '50 ml');
  assert.equal(scaleQuantity(5, 'cl', 2).text, '100 ml');
});

test('spoons: fractions, min ¼', () => {
  assert.equal(scaleQuantity(1, 'EL', 0.75).text, '¾ EL');
  assert.equal(scaleQuantity(2, 'EL', 0.75).text, '1 ½ EL');
  assert.equal(scaleQuantity(1, 'TL', 0.5).text, '½ TL');
  assert.equal(scaleQuantity(1, 'TL', 0.1).text, '¼ TL');
  assert.equal(scaleQuantity(2, 'EL', 2 / 3).text, '1 ⅓ EL');
  assert.equal(scaleQuantity(1, 'Tasse', 2).text, '2 Tassen');
});

test('pinch scales sub-linearly, whole numbers, plural', () => {
  assert.equal(scaleQuantity(1, 'Prise', 0.5).text, '1 Prise');
  assert.equal(scaleQuantity(1, 'Prise', 4).text, '2 Prisen');
  assert.equal(scaleQuantity(1, 'Prise', 1).text, '1 Prise');
});

test('countables: halves below 3, whole above, eggs never halved', () => {
  assert.equal(scaleQuantity(1, undefined, 1.5, 'Zwiebel').text, '1 ½');
  assert.equal(scaleQuantity(3, undefined, 1.5, 'Tomaten').text, '5'); // 4.5 → round
  assert.equal(scaleQuantity(1, '', 0.25, 'Zitrone').text, '½'); // min ½
  assert.equal(scaleQuantity(3, undefined, 0.5, 'Eier').text, '2'); // 1.5 → 2 (indivisible)
  assert.equal(scaleQuantity(1, undefined, 0.25, 'Ei').text, '1');
  assert.equal(scaleQuantity(2, 'Zehe', 1.5).text, '3 Zehen');
  assert.equal(scaleQuantity(1, 'Dose', 1.5).text, '2 Dosen');
  assert.equal(scaleQuantity(0.5, 'Bund', 1).text, '½ Bund');
});

test('no quantity → unchanged; unknown unit → decimal', () => {
  assert.deepEqual(scaleQuantity(undefined, undefined, 2), { qty: null, unit: '', text: '' });
  assert.equal(scaleQuantity(null, 'Prise', 2).text, 'Prise');
  assert.equal(scaleQuantity(1.5, 'Schachtel', 1.5).text, '2,25 Schachtel');
  assert.equal(scaleQuantity(200, 'g', NaN).text, '200 g'); // invalid factor → 1
});

test('ingredientLine and servings clamp', () => {
  assert.equal(ingredientLine(250, 'g', 'Mehl', 2), '500 g Mehl');
  assert.equal(ingredientLine(undefined, undefined, 'Salz', 2), 'Salz');
  assert.equal(ingredientLine(2, undefined, 'Eier', 2), '4 Eier');
  assert.equal(clampServings(0), 1);
  assert.equal(clampServings(100), 24);
  assert.equal(clampServings(3.4), 3);
});

test('scaled countables: plural item names', () => {
  // English: regular plural of the last word when a single item becomes several
  assert.equal(ingredientLine(1, undefined, 'onion', 2, 'en'), '2 onions');
  assert.equal(ingredientLine(1, undefined, 'red pepper', 2, 'en'), '2 red peppers');
  assert.equal(scaledItem('berry', 1, undefined, 3, 'en'), 'berries');
  assert.equal(scaledItem('tomato', 1, undefined, 2, 'en'), 'tomatoes');
  assert.equal(scaledItem('onion', 1, undefined, 1, 'en'), 'onion');
  // already plural / units carry the plural / no quantity
  assert.equal(scaledItem('eggs', 4, undefined, 2, 'en'), 'eggs');
  assert.equal(scaledItem('parsley', 1, 'bund', 2, 'en'), 'parsley');
  assert.equal(scaledItem('salt', undefined, undefined, 2, 'en'), 'salt');
  // other languages only change with an explicit plural form, in both directions
  assert.equal(scaledItem('Zwiebel', 1, undefined, 2, 'de'), 'Zwiebel');
  assert.equal(ingredientLine(1, undefined, 'Zwiebel', 2, 'de', 'Zwiebeln'), '2 Zwiebeln');
  assert.equal(scaledItem('Zwiebel', 2, undefined, 0.5, 'de', 'Zwiebeln'), 'Zwiebel');
});
