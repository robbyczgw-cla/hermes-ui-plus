import assert from 'node:assert/strict';
import test from 'node:test';
import { makeT } from '../i18n/core.ts';
import { pickScenario } from '../onboarding/demo/scenarios.ts';
import { STARTER_ICONS, STARTER_KINDS, avatarInitial, chatStarters, dayPart, greeting } from './starters.ts';
import { STARTERS } from '../onboarding/starters.ts';

const de = makeT('de', 'de-DE');
const en = makeT('en', 'en-US');
const es = makeT('es', 'es-ES');

test('dayPart: boundaries and wrap-around', () => {
  assert.equal(dayPart(4), 'night');
  assert.equal(dayPart(5), 'morning');
  assert.equal(dayPart(10.9), 'morning');
  assert.equal(dayPart(11), 'day');
  assert.equal(dayPart(17), 'day');
  assert.equal(dayPart(18), 'evening');
  assert.equal(dayPart(22), 'evening');
  assert.equal(dayPart(23), 'night');
  assert.equal(dayPart(0), 'night');
  assert.equal(dayPart(24 + 8), 'morning');
  assert.equal(dayPart(-1), 'night');
});

test('greeting: time of day, optional name, all languages', () => {
  assert.equal(greeting(de, 20), 'Guten Abend.');
  assert.equal(greeting(de, 20, ' Alice '), 'Guten Abend, Alice.');
  assert.equal(greeting(de, 2, 'Alice'), 'Noch wach, Alice?');
  assert.equal(greeting(de, 8, ''), 'Guten Morgen.');
  assert.equal(greeting(en, 14), 'Good afternoon.');
  assert.equal(greeting(es, 9, 'Ana'), 'Buenos días, Ana.');
});

test('starters: six distinct card types, each with icon and translated texts', () => {
  assert.equal(STARTER_KINDS.length, 6);
  for (const t of [de, en, es]) {
    const list = chatStarters(t);
    assert.deepEqual(list.map((s) => s.key), [...STARTER_KINDS]);
    for (const s of list) {
      assert.ok(STARTER_ICONS[s.key]);
      for (const v of [s.title, s.subtitle, s.prompt]) {
        assert.ok(v && !v.startsWith('chat.empty'), `${s.key}: missing text`);
        // stroke icons only in chrome: no emoji in tile texts
        assert.doesNotMatch(v, /\p{Extended_Pictographic}/u);
      }
      assert.ok(s.title.length <= 20, `${s.key}: title too long for a half tile: ${s.title}`);
    }
  }
});

test('starters: the prompts of every language hit the matching demo scenarios', () => {
  for (const t of [de, en, es]) {
    const byKey = Object.fromEntries(chatStarters(t).map((s) => [s.key, pickScenario(s.prompt).name]));
    assert.deepEqual(byKey, { checklist: 'checklist', agenda: 'trip', compare: 'reiseChoice', chart: 'charts3', recipe: 'recipe', explain: 'explain' });
  }
});

// A tile is the first message of a chat with a real Hermes: if the prompt lacks details or asks to be asked, the
// model answers with a plain-text question instead of a card (fresh-user test: "What are you cooking tonight?").
const ASK_BACK = /\bask me\b|\bfrag mich\b|pregúntame|\bfor me first\b|\bzuerst\b|\bprimero\b|\bfirst ask\b/i;

test('starters: chat tiles and onboarding starters are self-contained (no "ask me first", no missing place)', () => {
  for (const t of [de, en, es]) {
    const prompts = [...chatStarters(t).map((s) => [`chat.${s.key}`, s.prompt]), ...STARTERS.map((s) => [`onboarding.${s.id}`, t(s.promptKey!)])];
    for (const [id, prompt] of prompts) {
      assert.ok(prompt && !prompt.startsWith('onboarding.') && !prompt.startsWith('chat.'), `${id}: missing text`);
      assert.doesNotMatch(prompt, ASK_BACK, `${id}: asks to be asked back: ${prompt}`);
      // weather/forecast needs a place, or the model asks where the user is
      if (/weather|wetter|tiempo de los|el tiempo/i.test(prompt)) assert.match(prompt, /Berlin|Berlín/, `${id}: weather without a place: ${prompt}`);
    }
  }
});

test('starters: the shopping-list tile names a dish and the number of people', () => {
  const expected = { de: [/Lasagne/, /\bvier Personen\b/], en: [/lasagne/, /\bfor four\b/], es: [/lasaña/, /\bpara cuatro\b/] } as const;
  for (const [lang, t] of [['de', de], ['en', en], ['es', es]] as const) {
    const prompt = chatStarters(t).find((s) => s.key === 'checklist')!.prompt;
    for (const re of expected[lang]) assert.match(prompt, re, `${lang}: ${prompt}`);
  }
});

test('avatar initial: first letter or digit, upper-cased', () => {
  assert.equal(avatarInitial('kiwi'), 'K');
  assert.equal(avatarInitial('  🌼 émile'), 'É');
  assert.equal(avatarInitial('🌼'), '?');
});
