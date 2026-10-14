import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDocumentLang, dictionaries, formatRelative, interpolate, makeT, resolveLocale } from './core.ts';

test('interpolation', () => {
  assert.equal(interpolate('Hallo {name}!', { name: 'Rob' }, 'de-DE'), 'Hallo Rob!');
  assert.equal(interpolate('Hi {missing}', {}, 'en'), 'Hi {missing}');
  assert.equal(interpolate('{a}{a}', { a: 1 }, 'en'), '11');
});

test('plural en/de', () => {
  const tpl = '{count, plural, =0 {none} one {# item} other {# items}}';
  assert.equal(interpolate(tpl, { count: 0 }, 'en'), 'none');
  assert.equal(interpolate(tpl, { count: 1 }, 'en'), '1 item');
  assert.equal(interpolate(tpl, { count: 1500 }, 'en-US'), '1,500 items');
  assert.equal(interpolate(tpl, { count: 1500 }, 'de-DE'), '1.500 items');
  assert.equal(makeT('de', 'de-DE')('time.minutes', { count: 1 }), '1 Minute');
  assert.equal(makeT('de', 'de-DE')('time.minutes', { count: 5 }), '5 Minuten');
  assert.equal(makeT('en', 'en-US')('time.days', { count: 2 }), '2 days');
});

test('nested vars inside plural branch', () => {
  assert.equal(interpolate('{n, plural, one {{who} has # cat} other {{who} has # cats}}', { n: 2, who: 'Ann' }, 'en'), 'Ann has 2 cats');
});

test('fallback: missing en key -> de -> key', () => {
  const en = dictionaries.en as unknown as Record<string, Record<string, string>>;
  const saved = en.actions.save;
  delete en.actions.save;
  try {
    assert.equal(makeT('en', 'en-US')('actions.save'), 'Speichern');
  } finally {
    en.actions.save = saved;
  }
  assert.equal(makeT('en', 'en-US')('nope.nothing' as never), 'nope.nothing');
});

test('de and en have identical key sets', () => {
  const keys = (o: object, p = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [p + k] : keys(v, `${p}${k}.`)));
  assert.deepEqual(keys(dictionaries.en).sort(), keys(dictionaries.de).sort());
});

test('locale resolution', () => {
  assert.deepEqual(resolveLocale('de'), { lang: 'de', locale: 'de-DE' });
  assert.deepEqual(resolveLocale('en', ['de-DE']), { lang: 'en', locale: 'en-US' });
  assert.deepEqual(resolveLocale('system', ['de-AT', 'en-US']), { lang: 'de', locale: 'de-AT' });
  assert.deepEqual(resolveLocale('system', ['fr-FR', 'de-DE']), { lang: 'de', locale: 'de-DE' });
  assert.deepEqual(resolveLocale('system', ['fr-FR']), { lang: 'en', locale: 'en-US' });
  assert.deepEqual(resolveLocale('system', []), { lang: 'en', locale: 'en-US' });
});

test('formatRelative', () => {
  const now = 1_000_000_000_000;
  assert.equal(formatRelative('en-US', now - 5 * 60_000, now), '5 minutes ago');
  assert.equal(formatRelative('de-DE', now - 5 * 60_000, now), 'vor 5 Minuten');
});

test('plural + relative time work without Intl.PluralRules / RelativeTimeFormat (Hermes)', async () => {
  const { pluralCategory, relativeFallback } = await import('./core.ts');
  assert.equal(pluralCategory('de-DE', 1, false), 'one');
  assert.equal(pluralCategory('de-DE', 2, false), 'other');
  assert.equal(pluralCategory('en-US', 0, false), 'other');
  assert.equal(relativeFallback('de-DE', -5, 'minute'), 'vor 5 Minuten');
  assert.equal(relativeFallback('de-DE', -1, 'day'), 'vor 1 Tag');
  assert.equal(relativeFallback('en-US', -2, 'hour'), '2 hours ago');
  assert.equal(relativeFallback('en-US', 0, 'day'), 'today');
});

test('spanish: locale resolution + relative fallback', async () => {
  const { resolveLocale, relativeFallback } = await import('./core.ts');
  assert.deepEqual(resolveLocale('es'), { lang: 'es', locale: 'es-ES' });
  assert.equal(resolveLocale('system', ['es-MX']).lang, 'es');
  assert.equal(relativeFallback('es-ES', -3, 'day'), 'hace 3 días');
  assert.equal(relativeFallback('es-ES', -1, 'hour'), 'hace 1 hora');
});

test('lazy dictionaries API: loadDictionary resolves, hasDictionary true (eager in Node)', async () => {
  const core = await import('./core.ts');
  await core.loadDictionary('en');
  await core.loadDictionary('de');
  assert.equal(core.hasDictionary('en'), true);
  assert.equal(core.hasDictionary('de'), true);
  const app = await import('./dicts.app.ts');
  assert.deepEqual(app.EAGER_DICTS, {});
  assert.equal((await app.importDictionary('es')).actions.save, core.dictionaries.es.actions.save);
});

test('Intl formatters are cached per (locale, options)', async () => {
  const core = await import('./core.ts');
  assert.equal(core.numberFormat('de-DE'), core.numberFormat('de-DE'));
  assert.equal(core.dateTimeFormat('en-US', { timeStyle: 'short' }), core.dateTimeFormat('en-US', { timeStyle: 'short' }));
  assert.notEqual(core.dateTimeFormat('en-US', { timeStyle: 'short' }), core.dateTimeFormat('en-US', { dateStyle: 'short' }));
  assert.equal(core.formatNumber('de-DE', 1234.5), '1.234,5');
});

test('applyDocumentLang: <html lang> follows the UI language on the web; no document is a no-op', () => {
  const doc = { documentElement: { lang: 'de' } };
  applyDocumentLang(doc, 'en');
  assert.equal(doc.documentElement.lang, 'en');
  applyDocumentLang(undefined, 'es');
  applyDocumentLang({ documentElement: null }, 'es');
});
