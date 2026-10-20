import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compliance as de } from '../i18n/ns/compliance.de.ts';
import { compliance as en } from '../i18n/ns/compliance.en.ts';
import { compliance as es } from '../i18n/ns/compliance.es.ts';
import {
  AI_CONSENT_VERSION,
  CONSENT_STORAGE_KEY,
  CONSENT_TEXT_FINGERPRINT,
  consentAudience,
  consentBodyKey,
  consentCurrent,
  consentProviderName,
  consentRequired,
  consentTextFingerprint,
  makeConsent,
  parseConsent,
  profileNeedsConsent,
  readConsent,
  writeConsent,
  type ConsentStorage,
} from './consent.ts';

function mem(): ConsentStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v) };
}

const hermes = { kind: 'hermes', baseUrl: 'http://192.0.2.10:8642/v1' };
const demo = { kind: 'demo', baseUrl: 'demo://local' };

test('consent texts unchanged (a change: bump AI_CONSENT_VERSION to ask everyone again, or keep it on purpose + new fingerprint)', () => {
  const texts = [de, en, es].flatMap((d) => {
    const c = d.consent;
    return [c.title, c.body, c.providers];
  });
  assert.equal(
    consentTextFingerprint(texts),
    CONSENT_TEXT_FINGERPRINT,
    `compliance.consent.* changed: decide whether everyone is asked again (bump AI_CONSENT_VERSION, now ${AI_CONSENT_VERSION}) or only new users see it (keep it), then set CONSENT_TEXT_FINGERPRINT to the new value`,
  );
});

test('consent body (Hermes wording) names the server and example providers in every language', () => {
  for (const d of [de, en, es]) {
    for (const p of ['Hermes', 'OpenAI', 'Anthropic', 'xAI']) assert.ok(d.consent.body.includes(p), `${p} in ${d.consent.body}`);
  }
});

test('parseConsent rejects garbage', () => {
  assert.equal(parseConsent(null), null);
  assert.equal(parseConsent('nope'), null);
  assert.equal(parseConsent('{}'), null);
  assert.equal(parseConsent('{"version":0}'), null);
  assert.equal(parseConsent('{"version":1.5}'), null);
  assert.deepEqual(parseConsent('{"version":2,"at":"x"}'), { version: 2, at: 0 });
});

test('versioning: an older accepted version asks again, same or newer does not', () => {
  assert.equal(consentCurrent(null), false);
  assert.equal(consentCurrent({ version: 1, at: 1 }, 1), true);
  assert.equal(consentCurrent({ version: 1, at: 1 }, 2), false);
  assert.equal(consentCurrent({ version: 3, at: 1 }, 2), true);
  assert.equal(consentRequired(hermes, { version: 1, at: 1 }, 2), true);
  assert.equal(consentRequired(hermes, { version: 2, at: 1 }, 2), false);
});

test('demo profile needs no consent', () => {
  assert.equal(profileNeedsConsent(demo), false);
  assert.equal(profileNeedsConsent({ kind: 'hermes', baseUrl: 'demo://local' }), false);
  assert.equal(profileNeedsConsent(hermes), true);
  assert.equal(profileNeedsConsent(null), false);
  assert.equal(consentRequired(demo, null), false);
  assert.equal(consentRequired(hermes, null), true);
});

test('read / write round trip', async () => {
  const s = mem();
  assert.equal(await readConsent(s), null);
  await writeConsent(s, makeConsent(AI_CONSENT_VERSION, 1234));
  assert.deepEqual(JSON.parse(s.data.get(CONSENT_STORAGE_KEY)!), { version: AI_CONSENT_VERSION, at: 1234 });
  const r = await readConsent(s);
  assert.deepEqual(r, { version: AI_CONSENT_VERSION, at: 1234 });
  assert.equal(consentRequired(hermes, r), false);
  // a later text version invalidates the stored record
  assert.equal(consentRequired(hermes, r, AI_CONSENT_VERSION + 1), true);
});

test('readConsent survives a failing storage', async () => {
  const broken: ConsentStorage = { getItem: () => Promise.reject(new Error('x')), setItem: () => Promise.resolve() };
  assert.equal(await readConsent(broken), null);
});

test('consent wording is accurate: local storage, own-key voice and OS recognition are disclosed (review part 5, finding 14)', () => {
  for (const d of [de, en, es]) {
    for (const s of [d.consent.body]) {
      assert.ok(!/speichert (oder sammelt )?nichts|stores nothing|does not store|no guarda ni recopila nada|no guarda nada/i.test(s), `false "stores nothing" claim: ${s}`);
    }
  }
  assert.match(en.consent.providers, /API key you entered yourself/);
  assert.match(en.consent.providers, /operating system/);
  assert.match(de.consent.providers, /API-Schlüssel/);
  assert.match(es.consent.providers, /clave API/);
});

test('the Hermes wording no longer claims the chats exist only on this device (Hermes keeps sessions server-side, PC-04)', () => {
  for (const d of [de, en, es]) {
    for (const s of [d.consent.body]) {
      assert.doesNotMatch(s, /nur auf diesem Gerät|only on this device|on this device only|solo en este dispositivo/i, s);
      assert.match(s, /Server|server|servidor/);
    }
  }
  assert.match(en.consent.body, /Hermes also keeps the conversations on your server/);
});

test('0.2 asks nobody again: the version stays 2, an existing acceptance stays valid', async () => {
  assert.equal(AI_CONSENT_VERSION, 2, 'a bump asks every existing user again: a product decision, not a side effect of a wording change');
  // stored by 0.1.x (and by 0.2 test builds, which wrote version 3 + the accepted audiences)
  for (const raw of ['{"version":2,"at":1700000000000}', '{"version":3,"at":1,"audiences":["hermes"]}', '{"version":3,"at":1,"audiences":["server"]}']) {
    const s = mem();
    s.data.set(CONSENT_STORAGE_KEY, raw);
    const r = await readConsent(s);
    assert.equal(consentCurrent(r), true, raw);
    assert.equal(consentRequired(hermes, r), false, raw);
  }
});

test('a fresh install is asked before the first message to a server, never for the demo', () => {
  assert.equal(consentRequired(hermes, null), true);
  assert.equal(consentRequired(demo, null), false);
  const accepted = makeConsent();
  assert.equal(consentRequired(hermes, accepted), false);
});

test('the public flavor: every connection is a Hermes one', () => {
  assert.equal(consentAudience({ kind: 'hermes', baseUrl: 'https://example.com/v1' }), 'hermes');
  assert.equal(consentAudience(demo), 'hermes');
  assert.equal(consentAudience(null), 'hermes');
  assert.equal(consentBodyKey('hermes'), 'compliance.consent.body');
});

