import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeT } from '../../../../i18n/core.ts';
import { attributionText } from '../../../../images/attribution.ts';
import { makeS } from '../a/text.ts';
import { categoryLabel, inferCategory, checklistShareText } from '../a/checklistModel.ts';
import { readSlots } from '../a/slotsModel.ts';
import { slotReply } from '../a/replies.ts';
import { buildCalcReply, computeOutputs, formatInputValue, normalizeCalc, parseNumberInput } from './calcModel.ts';
import { scaleQuantity } from './quantity.ts';
import { formatMinutes, timeChips } from './timerMath.ts';

const en = makeS(makeT('en', 'en-US'));
const de = makeS(makeT('de', 'de-DE'));

test('quantity: EL/TL become tbsp/tsp only in English', () => {
  assert.equal(scaleQuantity(1, 'EL', 1.5).text, '1 ½ EL');
  assert.equal(scaleQuantity(1, 'EL', 1.5, '', 'en').text, '1 ½ tbsp');
  assert.equal(scaleQuantity(2, 'TL', 1, '', 'en').text, '2 tsp');
  assert.equal(scaleQuantity(1000, 'g', 1.5, '', 'en').text, '1.5 kg');
  assert.equal(scaleQuantity(1000, 'g', 1.5).text, '1,5 kg');
});

test('module strings: pluralisation + localisation', () => {
  assert.equal(en.sources.title(1), '1 source');
  assert.equal(en.sources.title(3), '3 sources');
  assert.equal(de.sources.title(3), '3 Quellen');
  assert.equal(en.timer.spoken(0, 1, 30), '1 minute 30 seconds');
  assert.equal(de.timer.spoken(0, 1, 30), '1 Minute 30 Sekunden');
  assert.equal(en.map.routeDisclaimer.startsWith('Route for orientation'), true);
});

test('checklist: english keywords added, german kept, category labels localised', () => {
  assert.equal(inferCategory('2 l Milch'), 'Kühlregal');
  assert.equal(inferCategory('2 l milk'), 'Kühlregal');
  assert.equal(inferCategory('toothpaste'), 'Drogerie');
  assert.equal(inferCategory('peanut butter'), 'Vorrat');
  assert.equal(categoryLabel('Kühlregal', en), 'Chilled');
  assert.equal(categoryLabel('Meine Kategorie', en), 'Meine Kategorie');
  const share = checklistShareText('Shop', [{ id: 'a', text: 'milk', checked: false }] as never, { kind: 'shopping', grouped: true }, en);
  assert.match(share, /Chilled/);
});

test('slots: protocol label stays German, display follows locale', () => {
  const raw = [{ start: '2027-10-14T10:00', end: '2027-10-14T11:00' }];
  const ref = new Date(2027, 0, 1);
  const [d] = readSlots(raw, ref);
  const [e] = readSlots(raw, ref, en, 'en-US');
  assert.equal(e.label, d.label);
  assert.notEqual(e.display, d.display);
  assert.match(e.display, /Oct/);
  assert.equal(slotReply('x', e.label), `[slot:x] ${d.label}`);
});

test('calc: display localised, protocol reply unchanged', () => {
  const model = normalizeCalc({
    type: 'calc',
    id: 'c',
    inputs: [{ name: 'a', label: 'Betrag', kind: 'number', default: 1234.5, unit: '€' }, { name: 'f', label: 'Fest', kind: 'toggle', default: true }],
    outputs: [{ label: 'Summe', expr: 'a * 2', format: 'number', unit: '€' }],
  });
  const values = { a: 1234.5, f: true };
  const rowsDe = computeOutputs(model, values);
  const rowsEn = computeOutputs(model, values, 'en-US');
  assert.notEqual(rowsEn[0].text, rowsDe[0].text);
  assert.equal(buildCalcReply(model, values, rowsDe)?.replace(/\u00a0/g, ' '), '[calc:c] Betrag 1.234,50 € · Fest: ja → Summe 2.469 €');
  assert.equal(formatInputValue(model.inputs[1], true, { text: en.calc }), 'yes');
  const r = parseNumberInput('', { min: 0 }, { text: en.calc });
  assert.deepEqual(r, { ok: false, error: 'Please enter a value' });
});

test('time + attribution helpers take the active language', () => {
  assert.equal(formatMinutes(75), '1 Std. 15 Min.');
  assert.equal(formatMinutes(75, en.time), '1 h 15 min');
  assert.equal(timeChips({ prep: 10 }, { prep: 'Prep', cook: 'Cook', total: 'Total', units: en.time })[0].label, 'Prep');
  const a = { provider: 'wikipedia', author: 'Jane', license: 'CC BY', sourceUrl: 'https://x.org' } as never;
  assert.equal(attributionText(a), 'Foto: Jane · CC BY · Wikimedia');
  assert.equal(attributionText(a, 28, makeT('en', 'en-US')), 'Photo: Jane · CC BY · Wikimedia');
});
