/// <reference types="node" />
// Settings → Chat → "Routinen" (routines/enabled.ts): default ON = today's Routines; OFF = no Routines surface anywhere
// (screen, "Über <Name>" part, result inbox, Routine pushes, demo routines). Reminders from the chat are not affected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PREFERENCES, migratePreferences, resetSection, sanitizePreferences, SECTION_KEYS, serializePreferences, type Preferences } from '../settings/preferences.ts';
import { routinesEnabled, setRoutinesEnabled } from './enabled.ts';
import { hiddenRoutinePush, registrationBody, streamSources, type PushProfile } from '../push/model.ts';
import { pickBotScenario } from '../onboarding/demo/scenes-bots.ts';
import type { DemoBotRole, DemoLang } from '../onboarding/demo/kit.ts';
import { makeT } from '../i18n/core.ts';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
/** source without comment lines (the checks look at code, not at the explanations) */
const code = (rel: string) =>
  read(rel)
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l))
    .join('\n');

// ── the switch ──────────────────────────────────────────────────────────────────────────────────────────────────────

test('switch: default ON, stored per device in the preferences, part of the Chat section and its reset', () => {
  assert.equal(DEFAULT_PREFERENCES.routines, true);
  assert.ok(SECTION_KEYS.chat.includes('routines'));
  assert.equal(sanitizePreferences({}).routines, true, 'missing (older app version): on');
  assert.equal(sanitizePreferences({ routines: false }).routines, false);
  assert.equal(sanitizePreferences({ routines: 'off' }).routines, true, 'invalid value: default');
  const off: Preferences = { ...DEFAULT_PREFERENCES, routines: false };
  assert.equal(migratePreferences(serializePreferences(off)).prefs.routines, false, 'survives a restart');
  assert.equal(resetSection(off, 'chat').routines, true);
});

test('switch: module copy for non-React callers starts on and follows the provider', () => {
  assert.equal(routinesEnabled(), true);
  setRoutinesEnabled(false);
  assert.equal(routinesEnabled(), false);
  setRoutinesEnabled(true);
  assert.equal(routinesEnabled(), true);
  const provider = code('../settings/PreferencesProvider.tsx');
  assert.match(provider, /setRoutinesEnabled\(prefs\.routines\)/);
});

test('switch: a row in Settings → Chat with title and explanation in every language', () => {
  assert.match(code('../settings/sections.tsx'), /sw\('routines', tr\('settings\.chat\.routines'\), tr\('settings\.chat\.routinesSub'\)\)/);
  for (const lang of ['de', 'en', 'es'] as const) {
    const t = makeT(lang, lang);
    for (const k of ['settings.chat.routines', 'settings.chat.routinesSub', 'routines.disabled.title', 'routines.disabled.body', 'routines.disabled.enable'] as const) {
      const v = t(k);
      assert.ok(v && v !== k, `${lang}: ${k}`);
    }
    assert.match(t('settings.chat.routinesSub'), lang === 'de' ? /Erinnerungen/ : lang === 'en' ? /Reminders/ : /recordatorios/, `${lang}: says that reminders stay`);
  }
});

// ── the Routines route ──────────────────────────────────────────────────────────────────────────────────────────────

test('route /routines: OFF shows the explanation with "Turn on Routines", ON the Routines screen', () => {
  const route = code('../app/routines.tsx');
  assert.match(route, /if \(!loaded\) return null;/, 'no flash of the screen before the stored value is read');
  assert.match(route, /if \(!prefs\.routines\) return <RoutinesHidden \/>;/);
  assert.ok(route.indexOf('<RoutinesHidden') < route.indexOf('<RoutinesScreen'), 'the screen only after the OFF branch');
  const hidden = code('./RoutinesHidden.tsx');
  assert.match(hidden, /testID="routines-hidden"/);
  assert.match(hidden, /onPress=\{\(\) => set\('routines', true\)\}[^>]*testID="routines-enable"/);
  assert.match(hidden, /testID="routines-done"/, 'a way back');
  assert.doesNotMatch(hidden, /routinesSource|RoutinesScreen/, 'loads nothing from the job API');
});

// ── "Über <Name>" ───────────────────────────────────────────────────────────────────────────────────────────────────

test('"Über <Name>": OFF = no routines part and no job API request; ON = the part as before', () => {
  const src = code('../bots/BotInfoSheet.tsx');
  assert.match(src, /const routinesOn = usePreference\('routines'\);/);
  assert.match(src, /const src = open && routinesOn \? routinesSource\(profile, bot, lang\) : null;/, 'no source (and so no refresh) when off');
  assert.match(src, /if \(open && srcKey\) void refresh\(\);/);
  // everything routines-related in the JSX sits inside the `routinesOn ? (…) : null` block
  const start = src.indexOf('{routinesOn ? (');
  assert.ok(start > 0, 'gated block');
  const end = src.indexOf('</>\n        ) : null}', start);
  assert.ok(end > start, 'end of the gated block');
  const jsx = src.slice(src.indexOf('return (\n    <SheetModal'));
  const inside = src.slice(start, end);
  for (const needle of ["tr('bots.info.routines')", 'bot-info-routines-more', 'openRoutines', "tr('bots.info.routinesHint'", 'bot-info-demo', '{routines}']) {
    assert.ok(inside.includes(needle), `${needle} inside the gated block`);
    assert.equal(jsx.split(needle).length - 1, 1, `${needle} only once in the sheet`);
  }
  // name, role and model stay outside
  assert.ok(jsx.indexOf("tr('bots.info.model')") < start, 'model row outside the gated block');
  assert.ok(jsx.indexOf('<BotAvatar') < start);
});

// ── pushes and the inbox stream ─────────────────────────────────────────────────────────────────────────────────────

const P: PushProfile = { id: 'p-h', kind: 'hermes', baseUrl: 'https://example.com/v1', apiKey: 'nca_test_token_000', bridge: true };
const S = { enabled: true, preview: 'auto' as const, quiet: null };
const ALL = ['api_server', 'cron', 'telegram', 'cli', 'routines'];

test('push: OFF = no `routines` source in the device scope and the inbox stream; ON = as before', () => {
  assert.deepEqual(registrationBody(P, S, { locale: 'de', serverSources: ALL }).scope, { sources: ['api_server', 'routines'] }, 'default: on');
  assert.deepEqual(registrationBody(P, S, { locale: 'de', serverSources: ALL, routines: true }).scope, { sources: ['api_server', 'routines'] });
  assert.deepEqual(registrationBody(P, S, { locale: 'de', serverSources: ALL, routines: false }).scope, { sources: ['api_server'] });
  assert.deepEqual(streamSources({ showCronReports: true }, ALL, false), ['api_server', 'cron'], 'cron reports keep their own switch');
  assert.deepEqual(streamSources({}, ALL, true), ['api_server', 'routines']);
});

test('push: a Routine push is hidden in the foreground only while Routines are off; approvals and chats never', () => {
  const routine = { src: 'hermes', profileId: 'p-h', kind: 'routine', itemId: 'ri_0123456789abcdef', jobId: 'aaaaaaaaaaaa' };
  assert.equal(hiddenRoutinePush(routine, false), true);
  assert.equal(hiddenRoutinePush(JSON.stringify(routine), false), true, 'Android: data as JSON string');
  assert.equal(hiddenRoutinePush({ body: routine }, false), true, 'iOS body wrapper');
  assert.equal(hiddenRoutinePush(routine, true), false);
  assert.equal(hiddenRoutinePush({ src: 'hermes', profileId: 'p-h', kind: 'approval', runId: 'r1' }, false), false);
  assert.equal(hiddenRoutinePush({ src: 'hermes', profileId: 'p-h', sessionId: 'hui-1', botChat: true }, false), false, 'a reminder delivered into a bot chat stays');
  assert.equal(hiddenRoutinePush({ src: 'turn', profileId: 'p-h', conversationId: 'c1' }, false), false);
  assert.equal(hiddenRoutinePush(null, false), false);
});

test('push: the app wires the switch into registration, stream, live events and the foreground handler', () => {
  assert.match(code('../push/registration.ts'), /registrationBody\(p, s, \{[^}]*routines: routinesEnabled\(\)/);
  const host = code('../push/PushHost.tsx');
  assert.match(host, /streamSources\(p, cfg\?\.sources, routinesOn\)/);
  assert.match(host, /if \(routinesOn\) emitRoutineEvent\(/);
  assert.match(host, /const scopeKey = `\$\{routinesOn \? 'r' : '-'\}\|`/, 'switching re-registers the device scope');
  assert.match(host, /const streamKey = `\$\{routinesOn \? 'r' : '-'\}\|`/, 'switching restarts the inbox stream');
  assert.match(host, /!prefsLoaded \|\| refreshed\.current/, 'the start registration waits for the stored switch');
  assert.match(code('../actions/notifications.ts'), /hiddenRoutinePush\(n\.request\.content\.data, routinesEnabled\(\)\)/);
});

// ── offline demo ────────────────────────────────────────────────────────────────────────────────────────────────────

test('demo: the "do this regularly" answer points at "Über <Name>" only while Routines are on', () => {
  const role: DemoBotRole = { template: 'own', name: 'Kiwi', job: 'Pflanzen gießen' };
  const about: Record<DemoLang, RegExp> = { de: /Über Kiwi/, en: /About Kiwi/, es: /Acerca de Kiwi/ };
  for (const lang of ['de', 'en', 'es'] as const) {
    const picked = pickBotScenario('jeden morgen um 8 gießen', role);
    assert.equal(picked.name, 'bot:routine');
    const text = (routines: boolean | undefined) =>
      picked.scenario
        .steps({ userText: 'jeden morgen um 8 gießen', turn: 1, sessionId: 's1', now: new Date(2026, 9, 20, 11, 40), lang, role, routines })
        .map((s) => ('text' in s ? s.text : ''))
        .join('');
    assert.match(text(true), about[lang], `${lang}: on`);
    assert.match(text(undefined), about[lang], `${lang}: default`);
    assert.doesNotMatch(text(false), about[lang], `${lang}: off`);
    assert.match(text(false), lang === 'de' ? /Hermes-Server/ : lang === 'en' ? /Hermes server/ : /servidor Hermes/, `${lang}: still honest about the server`);
  }
  assert.match(code('../onboarding/demo/transport.ts'), /routines: routinesEnabled\(\)/);
});
