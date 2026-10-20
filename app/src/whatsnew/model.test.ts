import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeT } from '../i18n/core.ts';
import { PROMPTS } from '../onboarding/demo/prompts.ts';
import { pickScenario } from '../onboarding/demo/scenarios.ts';
import { applicableItems, compareVersions, decideWhatsNew, parseVersion, shortVersion, WHATS_NEW, type WhatsNewRelease } from './model.ts';

const R: WhatsNewRelease[] = [
  { version: '0.2.0', items: ['liveCards', 'skills', 'memory'] },
  { version: '0.3.0', items: ['skills'] },
];

/** what a device sees over several launches: storage starts empty and keeps what the decisions record */
function launches(versions: string[], existingUser: boolean, releases = R): (string | null)[] {
  let seen: string | null = null;
  return versions.map((current) => {
    const d = decideWhatsNew({ current, seen, existingUser: existingUser || seen !== null }, releases);
    if (d.record || d.show) seen = current; // shown → the sheet records the version (markWhatsNewShown)
    return d.show?.version ?? null;
  });
}

test('versions: parse and compare (prerelease and build suffixes ignored)', () => {
  assert.deepEqual(parseVersion('0.2.0'), [0, 2, 0]);
  assert.deepEqual(parseVersion('v1.2'), [1, 2, 0]);
  assert.deepEqual(parseVersion('0.2.0-beta.1'), [0, 2, 0]);
  assert.equal(parseVersion('dev'), null);
  assert.equal(compareVersions('0.1.3', '0.2.0'), -1);
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('0.2.0', '0.2'), 0);
  assert.equal(shortVersion('0.2.0'), '0.2');
  assert.equal(shortVersion('0.2.1'), '0.2.1');
});

test('fresh install: never shown, not even after onboarding, and the version is remembered', () => {
  assert.deepEqual(decideWhatsNew({ current: '0.2.0', seen: null, existingUser: false }, R), { show: null, record: true });
  // first launch (onboarding), second launch (set up now), a patch update: still nothing
  assert.deepEqual(launches(['0.2.0', '0.2.0', '0.2.1'], false), [null, null, null]);
});

test('update: shown once for the new version, then never again for it', () => {
  // 0.1.3 had no hint (nothing stored) → update to 0.2.0 on a set-up device
  assert.equal(decideWhatsNew({ current: '0.2.0', seen: null, existingUser: true }, R).show?.version, '0.2.0');
  assert.deepEqual(launches(['0.2.0', '0.2.0', '0.2.0'], true), ['0.2.0', null, null]);
  // a later release with notes shows its own once
  assert.deepEqual(launches(['0.1.3', '0.2.0', '0.2.1', '0.3.0', '0.3.0'], true), [null, '0.2.0', null, '0.3.0', null]);
});

test('update across several releases: only the newest notes; a release without notes is remembered silently', () => {
  assert.equal(decideWhatsNew({ current: '0.3.0', seen: '0.1.3', existingUser: true }, R).show?.version, '0.3.0');
  assert.deepEqual(decideWhatsNew({ current: '0.2.1', seen: '0.2.0', existingUser: true }, R), { show: null, record: true });
  assert.deepEqual(decideWhatsNew({ current: '0.1.3', seen: null, existingUser: true }, R), { show: null, record: true });
});

test('same version, downgrade and broken values: nothing', () => {
  assert.deepEqual(decideWhatsNew({ current: '0.2.0', seen: '0.2.0', existingUser: true }, R), { show: null, record: false });
  assert.deepEqual(decideWhatsNew({ current: '0.2.0', seen: '0.3.0', existingUser: true }, R), { show: null, record: false });
  assert.deepEqual(decideWhatsNew({ current: undefined, seen: null, existingUser: true }, R), { show: null, record: false });
  // garbage in storage counts as "never seen" on a set-up device
  assert.equal(decideWhatsNew({ current: '0.2.0', seen: 'garbage', existingUser: true }, R).show?.version, '0.2.0');
});

test('items: only those that apply to the open connection, in list order', () => {
  const rel = R[0];
  assert.deepEqual(applicableItems(rel, () => true), ['liveCards', 'skills', 'memory']);
  assert.deepEqual(applicableItems(rel, (id) => id !== 'liveCards'), ['skills', 'memory']);
  assert.deepEqual(applicableItems(rel, () => false), []);
});

test('the shipped list: 0.2 names live cards, skills and memory, with texts in every language; the live-card prompt works in the demo', () => {
  const r02 = WHATS_NEW.find((r) => r.version === '0.2.0');
  assert.deepEqual(r02?.items, ['liveCards', 'skills', 'memory']);
  for (const r of WHATS_NEW) assert.ok(r.items.length >= 1 && r.items.length <= 4, 'calm: at most four lines');
  for (const [lang, loc] of [['de', 'de-DE'], ['en', 'en-US'], ['es', 'es-ES']] as const) {
    const t = makeT(lang, loc);
    for (const r of WHATS_NEW) {
      for (const id of r.items) {
        for (const k of ['title', 'text'] as const) {
          const v = t(`whatsNew.items.${id}.${k}`);
          assert.ok(v && !v.startsWith('whatsNew.'), `${lang} ${id}.${k}`);
          assert.ok(!/[!]|—/.test(v), `${lang} ${id}.${k}: calm copy`);
        }
      }
    }
    assert.equal(t('whatsNew.items.liveCards.prompt'), PROMPTS.liveList[lang]);
    assert.equal(pickScenario(t('whatsNew.items.liveCards.prompt')).name, 'liveList');
  }
});

test('the shipped list on the real version path (real-user round 3): a 0.1.3 build shows nothing, 0.2.0 shows it once', () => {
  // the round-3 QA build said 0.1.3 and recorded it; nothing to show there (the sheet is registered for 0.2.0)
  assert.deepEqual(decideWhatsNew({ current: '0.1.3', seen: '0.1.2', existingUser: true }, WHATS_NEW), { show: null, record: true });
  // the same device updated to 0.2.0: the 0.2 notes once, then never again; a store 0.1.3 had no marker at all
  assert.deepEqual(launches(['0.1.3', '0.2.0', '0.2.0', '0.2.1'], true, [...WHATS_NEW]), [null, '0.2.0', null, null]);
  assert.equal(decideWhatsNew({ current: '0.2.0', seen: null, existingUser: true }, WHATS_NEW).show?.version, '0.2.0');
});
