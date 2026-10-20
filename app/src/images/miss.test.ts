import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockMissReason, browserImageSearchUrl, imageMissReason, missNoteAction, missSetting } from './miss.ts';

const base = { allowed: true, webOnly: true, webEnabled: false, mode: 'bridge' as const, status: 'none' as const };

test('imageMissReason: web-only query without any image search (the reported bug) → noSearch', () => {
  // production: bridge without Serper/Brave keys, no own key; gallery items {query, source:"web"}
  assert.equal(imageMissReason(base), 'noSearch');
  // own-key mode without a key is the same situation
  assert.equal(imageMissReason({ ...base, mode: 'own' }), 'noSearch');
  // user chose "Nur Wikipedia": named as such
  assert.equal(imageMissReason({ ...base, mode: 'wikipedia' }), 'wikiOnly');
});

test('imageMissReason: Wikipedia found nothing and there is no web search to fall back to → noSearch', () => {
  assert.equal(imageMissReason({ ...base, webOnly: false }), 'noSearch');
});

test('imageMissReason: search available but empty → notFound; lookup failures and slow lookups → error', () => {
  assert.equal(imageMissReason({ ...base, webEnabled: true }), 'notFound');
  assert.equal(imageMissReason({ ...base, webEnabled: true, status: 'error' }), 'error');
  assert.equal(imageMissReason({ ...base, webEnabled: true, status: 'expired' }), 'error');
  // a failed lookup is not blamed on the missing search
  assert.equal(imageMissReason({ ...base, status: 'error' }), 'error');
});

test('imageMissReason: images switched off wins over everything except a broken direct photo', () => {
  assert.equal(imageMissReason({ ...base, allowed: false }), 'off');
  assert.equal(imageMissReason({ ...base, allowed: false, webEnabled: true, status: 'error' }), 'off');
  assert.equal(imageMissReason({ ...base, status: 'broken' }), 'error');
  assert.equal(imageMissReason({ ...base, allowed: false, urlOnly: true }), 'error');
});

test('blockMissReason: the reason the user can act on is named once for the whole block', () => {
  assert.equal(blockMissReason([]), null);
  assert.equal(blockMissReason([null, undefined]), null);
  assert.equal(blockMissReason(['notFound', 'error']), 'error');
  assert.equal(blockMissReason(['notFound', 'noSearch', 'error']), 'noSearch');
  assert.equal(blockMissReason(['noSearch', 'off']), 'off');
});

test('missSetting: only reasons the user can change link to a setting', () => {
  assert.equal(missSetting('off'), 'loading');
  assert.equal(missSetting('noSearch'), 'search');
  assert.equal(missSetting('wikiOnly'), 'search');
  assert.equal(missSetting('error'), null);
  assert.equal(missSetting('notFound'), null);
});

test('browserImageSearchUrl: encoded, trimmed, capped; empty → undefined', () => {
  assert.equal(browserImageSearchUrl('Trimui Brick Hammer front'), 'https://duckduckgo.com/?q=Trimui%20Brick%20Hammer%20front&ia=images&iax=images');
  assert.equal(browserImageSearchUrl('  a &b  '), 'https://duckduckgo.com/?q=a%20%26b&ia=images&iax=images');
  assert.equal(browserImageSearchUrl('   '), undefined);
  assert.equal(browserImageSearchUrl(undefined), undefined);
  assert.ok(browserImageSearchUrl('x'.repeat(500))!.length < 300);
});

test('missNoteAction: a link where the app has the setting, a sentence where it has none (PC-05), nothing without a shell', () => {
  assert.deepEqual(missNoteAction('noSearch', 'settings'), { kind: 'link', target: 'search' });
  assert.deepEqual(missNoteAction('off', 'settings'), { kind: 'link', target: 'loading' });
  // reduced settings without image rows: never a link to a screen that cannot fix it
  assert.deepEqual(missNoteAction('noSearch', 'none'), { kind: 'hint' });
  assert.deepEqual(missNoteAction('wikiOnly', 'none'), { kind: 'hint' });
  assert.deepEqual(missNoteAction('off', 'none'), { kind: 'hint' });
  // nothing the user can change: no link and no sentence, in any shell
  for (const shell of ['settings', 'none', null] as const) {
    assert.equal(missNoteAction('error', shell), null);
    assert.equal(missNoteAction('notFound', shell), null);
  }
  assert.equal(missNoteAction('noSearch', null), null);
});

test('the no-settings sentence exists in every language and points at the tiles, not at Settings', async () => {
  const { makeT } = await import('../i18n/core.ts');
  for (const t of [makeT('de', 'de-DE'), makeT('en', 'en-US'), makeT('es', 'es-ES')]) {
    const s = t('ui.image.missNoSettingsHint');
    assert.ok(s && s !== 'ui.image.missNoSettingsHint', s);
    assert.doesNotMatch(s, /Einstellungen|Settings|Ajustes/i, s);
  }
});
