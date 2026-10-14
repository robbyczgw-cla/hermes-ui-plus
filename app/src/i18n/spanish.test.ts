// Spanish behaviour of the non-dictionary code (formatting, units, categories, relative time, voice).
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatNumber, formatCompact, withUnit } from '../ui/lib/format.ts';
import { formatValue, NBSP } from '../calc/format.ts';
import { displayUnit, formatDecimal, ingredientLine, scaleQuantity } from '../ui/components/modules/b/quantity.ts';
import { inferCategory } from '../ui/components/modules/a/checklistModel.ts';
import { formatRelative, relativeFallback, resolveLocale } from './core.ts';
import { normalizeVoiceSettings } from '../voice/format.ts';
import { sortVoices } from '../voice/bridgeCore.ts';
import { formatBytes } from '../attachments/mime.ts';

test('formatNumber es: comma decimals, min grouping 2 like Intl es-ES', () => {
  assert.equal(formatNumber(1234.5, 2, 'es'), '1234,5');
  assert.equal(formatNumber(12345.5, 2, 'es'), '12.345,5');
  assert.equal(formatNumber(1234567, 0, 'es'), '1.234.567');
  assert.equal(formatNumber(1234.5, 2, 'de'), '1.234,5');
  assert.equal(formatNumber(12345.5, 2, 'es'), new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(12345.5));
});

test('formatCompact / withUnit es', () => {
  assert.equal(formatCompact(12_000, 'es'), '12 mil');
  assert.equal(formatCompact(3_400_000, 'es'), '3,4 M');
  assert.equal(formatCompact(2_500_000_000, 'es'), '2,5 mil M');
  assert.equal(withUnit('5', '%', 'es'), '5 %');
  assert.equal(withUnit('5', '%', 'en'), '5%');
});

test('calc formatValue es-ES', () => {
  assert.equal(formatValue(1234.56, { format: 'currency', locale: 'es-ES' }), `1234,56${NBSP}€`);
  assert.equal(formatValue(1234567.891, { format: 'number', locale: 'es-ES' }), '1.234.567,89');
  assert.equal(formatValue(0.045, { format: 'percent', locale: 'es-ES' }), `4,5${NBSP}%`);
  assert.equal(formatValue(63, { format: 'duration', locale: 'es-ES' }), '5 a 3 m');
  assert.equal(formatValue(63, { format: 'duration' }), '5 J 3 M');
});

test('recipe units in Spanish', () => {
  assert.equal(displayUnit('EL', 'es'), 'cda.');
  assert.equal(displayUnit('TL', 'es'), 'cdta.');
  assert.equal(displayUnit('Prise', 'es'), 'pizca');
  assert.equal(displayUnit('Prisen', 'es'), 'pizcas');
  assert.equal(displayUnit('g', 'es'), 'g');
  assert.equal(displayUnit('EL', 'de'), 'EL');
  assert.equal(scaleQuantity(1, 'EL', 1.5, '', 'es').text, '1 ½ cda.');
  assert.equal(scaleQuantity(1, 'TL', 1, '', 'es').text, '1 cdta.');
  assert.equal(scaleQuantity(1, 'Prise', 4, '', 'es').text, '2 pizcas');
  assert.equal(scaleQuantity(1, 'Prise', 1, '', 'es').text, '1 pizca');
  assert.equal(scaleQuantity(800, 'g', 2, '', 'es').text, '1,6 kg');
  assert.equal(scaleQuantity(1, 'Zehe', 4, '', 'es').text, '4 dientes');
  assert.equal(formatDecimal(1234.5, 2, 'es'), '1234,5');
});

test('Spanish unit input aliases and indivisible items', () => {
  assert.equal(scaleQuantity(2, 'cucharadas', 1, '', 'es').text, '2 cda.');
  assert.equal(scaleQuantity(1, 'diente', 3, '', 'es').text, '3 dientes');
  assert.equal(ingredientLine(2, undefined, 'huevos', 0.5, 'es'), '1 huevos');
  assert.equal(ingredientLine(250, 'g', 'harina', 1, 'es'), '250 g harina');
});

test('shopping categories from Spanish keywords', () => {
  assert.equal(inferCategory('manzanas'), 'Obst & Gemüse');
  assert.equal(inferCategory('2 plátanos'), 'Obst & Gemüse');
  assert.equal(inferCategory('leche entera'), 'Kühlregal');
  assert.equal(inferCategory('huevos'), 'Kühlregal');
  assert.equal(inferCategory('pan de molde'), 'Brot & Backwaren');
  assert.equal(inferCategory('pechuga de pollo'), 'Fleisch & Fisch');
  assert.equal(inferCategory('arroz'), 'Vorrat');
  assert.equal(inferCategory('aceite de oliva'), 'Vorrat');
  assert.equal(inferCategory('cerveza'), 'Getränke');
  assert.equal(inferCategory('pasta de dientes'), 'Drogerie');
  assert.equal(inferCategory('detergente'), 'Haushalt');
  assert.equal(inferCategory('helado'), 'Tiefkühl');
  assert.equal(inferCategory('Milch'), 'Kühlregal');
  assert.equal(inferCategory('bread'), 'Brot & Backwaren');
});

test('relative time es', () => {
  const now = Date.UTC(2026, 9, 11, 12, 0, 0);
  assert.match(formatRelative('es-ES', now - 5 * 60_000, now), /hace 5 minutos/);
  assert.match(formatRelative('es-ES', now + 2 * 86400_000, now), /pasado mañana|dentro de 2 días|en 2 días/);
  assert.equal(relativeFallback('es-ES', -5, 'minute'), 'hace 5 minutos');
  assert.equal(relativeFallback('es-ES', 1, 'day'), 'en 1 día');
  assert.equal(relativeFallback('es-ES', 0, 'day'), 'hoy');
});

test('resolveLocale picks Spanish from device tags', () => {
  assert.deepEqual(resolveLocale('system', ['es-MX', 'en-US']), { lang: 'es', locale: 'es-MX' });
  assert.deepEqual(resolveLocale('es'), { lang: 'es', locale: 'es-ES' });
});

test('voice: Spanish STT language and Spanish-first voice sort', () => {
  assert.equal(normalizeVoiceSettings({ sttLanguage: 'es' }).sttLanguage, 'es');
  assert.equal(normalizeVoiceSettings({ sttLanguage: 'xx' }).sttLanguage, 'auto');
  const v = (id: string, lang: string) => ({ id, name: id, lang, provider: 'p' });
  const list = [v('b', 'en'), v('c', 'es-ES'), v('a', 'de')];
  assert.deepEqual(sortVoices(list, 'es').map((x) => x.id), ['c', 'a', 'b']);
  assert.deepEqual(sortVoices(list).map((x) => x.id), ['a', 'b', 'c']);
  assert.deepEqual(sortVoices(list, 'en').map((x) => x.id), ['b', 'a', 'c']);
});

test('formatBytes locale decimal', () => {
  assert.equal(formatBytes(2_500_000), '2,5 MB');
  assert.equal(formatBytes(2_500_000, 'es'), '2,5 MB');
  assert.equal(formatBytes(2_500_000, 'en'), '2.5 MB');
});
