import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aboutLinkRows, joinSentences, personaHintKey, pushUnsupportedKey } from './flavorTexts.ts';
import { makeT } from '../i18n/core.ts';
import { brand } from '../brand.ts';

const LOCALES = [
  ['de', 'de-DE'],
  ['en', 'en-US'],
  ['es', 'es-ES'],
] as const;

test('hermes flavor never mentions other backends (notification hint, profile editor)', () => {
  for (const [l, loc] of LOCALES) {
    const t = makeT(l, loc);
    for (const key of [pushUnsupportedKey('hermes'), personaHintKey('hermes')]) {
      const s = t(key);
      assert.ok(s && s !== key, `${l} ${key}`);
      assert.ok(!/adapter/i.test(s), `${l} ${key}: ${s}`);
    }
  }
});

test('about links: unset links are hidden, set ones link out', () => {
  assert.deepEqual(aboutLinkRows({ homepage: 'https://hermesui.xyz', repoUrl: null, privacyUrl: null }), [{ key: 'website', url: 'https://hermesui.xyz' }]);
  assert.deepEqual(
    aboutLinkRows({ homepage: null, repoUrl: 'https://git.example.org/x/y', privacyUrl: 'https://example.org/privacy' }).map((r) => r.key),
    ['source', 'privacy'],
  );
  // the official identity: homepage set, never a "folgt" row
  const rows = aboutLinkRows(brand('hermes'));
  assert.ok(rows.some((r) => r.key === 'website'));
  for (const [l, loc] of LOCALES) for (const r of rows) assert.notEqual(makeT(l, loc)(`settings.about.${r.key}`), `settings.about.${r.key}`);
});

test('joinSentences adds the missing full stop between hints', () => {
  assert.equal(joinSentences('Knopf unter der Antwort', 'Nur in der App verfügbar.'), 'Knopf unter der Antwort. Nur in der App verfügbar.');
  assert.equal(joinSentences('Schon fertig.', 'Weiter.'), 'Schon fertig. Weiter.');
  assert.equal(joinSentences('', 'B.'), 'B.');
  assert.equal(joinSentences('A', ''), 'A');
});
