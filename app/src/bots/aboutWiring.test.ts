/// <reference types="node" />
// Slice 4 + 5 wiring: the push registration carries the per-bot levels, "Über <Name>" shows every new part (and keeps
// the routines part behind the switch), the Bot Chat shows the working card / stopped-run card, local notifications
// respect the level, and every new text exists in de / en / es.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PUSH_SETTINGS, registrationBody, type PushProfile } from '../push/model.ts';
import { makeT } from '../i18n/core.ts';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const bridge: PushProfile = { id: 'p-h', kind: 'hermes', baseUrl: 'https://hermes-host.example.com/v1', apiKey: 'nca_user_test_token_000', bridge: true };

test('the working card promises no notification push may not deliver (no FCM on the public Android APK)', () => {
  for (const lang of ['en', 'de', 'es']) {
    const src = readFileSync(new URL(`../i18n/ns/bots.${lang}.ts`, import.meta.url), 'utf8');
    const hint = /^ {4}hint: '(.*)',$/m.exec(src.slice(src.indexOf('working: {')))?.[1] ?? '';
    assert.match(hint, /push/i, lang);
  }
});

test('push registration: levels go into the scope as two lists, "all" never; adapters get none', () => {
  const b = registrationBody(bridge, { ...DEFAULT_PUSH_SETTINGS, enabled: true, bots: { scout: 'off', default: 'needed', writer: 'off' } }, { locale: 'de' });
  assert.deepEqual(b.scope, { sources: ['api_server'], quietBots: ['default'], offBots: ['scout', 'writer'] });
  assert.deepEqual(registrationBody(bridge, { ...DEFAULT_PUSH_SETTINGS, enabled: true }, { locale: 'de' }).scope, { sources: ['api_server'] });
  // a broken stored value never reaches the server
  assert.deepEqual(registrationBody(bridge, { ...DEFAULT_PUSH_SETTINGS, bots: { 'x y': 'off' } as never }, { locale: 'de' }).scope, { sources: ['api_server'] });
});

test('"Über <Name>": memory, skills, always-allowed, notifications, archive (non-default bridge bots only)', () => {
  const src = read('./BotInfoSheet.tsx');
  for (const part of ['<KnowsAndCan', '<AllowedSection', '<NotifySection', '<ArchiveSection']) assert.ok(src.includes(part), part);
  // archive: never the default bot, never without the bridge, the demo explains instead
  assert.match(src, /about\.demo \? \([\s\S]*bot-about-demo[\s\S]*\) : bot && profile\.kind === 'hermes' && profile\.bridge \? \(\s*<ArchiveSection/);
  // the new parts sit outside the routines switch (they are not routines UI)
  const gated = src.slice(src.indexOf('{routinesOn ? ('), src.indexOf('<KnowsAndCan'));
  assert.ok(!gated.includes('AllowedSection') && !gated.includes('NotifySection'));
  // taller than a phone screen with every part: capped, and the content scrolls inside (else the head is cut off on top)
  assert.match(src, /<SheetModal[^>]*maxHeight="88%"/);
  assert.match(src, /scroll: \{ flexGrow: 0, flexShrink: 1 \}/);
  const parts = read('./AboutParts.tsx');
  // every state of "Immer erlaubt" says something; revoke and archive ask inline
  for (const k of ['allowedDemo', 'allowedNoBridge', 'allowedUnsupported', 'allowedFailed', 'allowedEmpty', 'allowedRevokeTitle', 'archiveTitle']) assert.ok(parts.includes(`bots.info.${k}`), k);
  assert.ok(!parts.includes('Alert.alert('), 'no native-only alerts (no-op on the web)');
});

test('Bot Chat: working card for own and remote turns, stopped-run card only with Routines on', () => {
  const view = read('../chat/ChatView.tsx');
  assert.match(view, /streamingAnswer \? \([\s\S]*<LocalWorkingCard[\s\S]*\) : remoteTurn \? \([\s\S]*<RemoteWorkingCard/);
  assert.match(view, /<StoppedRunsProvider profile=\{profile\} bot=\{chatBot\} enabled=\{botChat && routinesOn\}/);
  assert.match(view, /status: botStatusKind\(\{ working: streaming \|\| !!botWorking/);
  assert.match(read('../chat/MessageItem.tsx'), /<CronDeliveryMarker delivery=\{cron\}[^]*<StoppedRunCard id=\{message\.id\}/);
  // the provider knows every delivery of the chat, so one stopped run gets one card (bots/stoppedRuns.ts)
  assert.match(view, /<StoppedRunsProvider [^>]*deliveries=\{deliveries\}/);
  // the card's hint follows the level: "only when needed" is not "switched off"
  const card = read('./BotWorkingCard.tsx');
  assert.match(card, /level === 'off' \? 'bots\.working\.hintQuiet' : level === 'needed' \? 'bots\.working\.hintNeeded' : 'bots\.working\.hint'/);
  assert.equal((view.match(/level=\{botLevel\}/g) ?? []).length, 2);
  // waiting for an approval is not working: no working card next to the approval card (it read "working … no steps yet")
  assert.match(view, /const streamingAnswer = botChat && streaming && !waitingApproval \?/);
  assert.match(view, /const remoteTurn = botChat && !waitingApproval \?/);
  // the running time ticks every second: only the step list is a live region (TalkBack would read the time out)
  assert.ok(!/testID="bot-working" accessibilityLiveRegion/.test(card));
  assert.match(card, /<View style=\{styles\.steps\} accessibilityLiveRegion="polite">/);
  // only archived bots left on a device without the create right: the empty box explains, the footnote does not repeat it
  assert.match(read('./BotRoster.tsx'), /\{onlyDefault && !tab\.demo && tab\.create\?\.kind !== 'create' \? null : \(/);
  // the roster takes routine runs only with Routines on
  assert.match(read('./useBotsTab.ts'), /workingOf\(activity, [^)]*routinesOn \}\)/);
});

test('local notices follow the level; the reminder never asks for a permission; web has none', () => {
  const host = read('../push/PushHost.tsx');
  assert.equal((host.match(/noticeAllowed\(levelOf\(allPushSettings\(\)\[p\.id\]\?\.bots, ev\.hermesProfile\), 'answer'\)/g) ?? []).length, 2);
  assert.ok(host.includes('<ApprovalReminders />'));
  assert.ok(host.includes('levelsKey(pushState.profiles[p.id]?.bots)'), 're-register when a level changes');
  const rem = read('./ApprovalReminders.tsx');
  assert.ok(rem.includes('ask: false'));
  assert.ok(rem.includes("Platform.OS === 'web'"));
});

test('new texts exist and differ per language (de / en / es)', () => {
  const keys = [
    'bots.info.memory', 'bots.info.skills', 'bots.info.allowed', 'bots.info.notify', 'bots.info.archive', 'bots.info.allowedLabels.rootDelete',
    'bots.info.manage.ownerOff', 'bots.info.fail.parkedElsewhere', 'bots.archivedList.restore', 'bots.working.title', 'bots.working.stepsUnknown', 'bots.working.hintNeeded',
    'bots.blocked.title', 'bots.blocked.retryPrompt', 'bots.reminder.title', 'bots.reminder.body',
  ] as const;
  const de = makeT('de', 'de-DE');
  const en = makeT('en', 'en-US');
  const es = makeT('es', 'es-ES');
  for (const k of keys) {
    const v = [de(k as never, { name: 'Scout' }), en(k as never, { name: 'Scout' }), es(k as never, { name: 'Scout' })];
    for (const x of v) assert.ok(x && x !== k, `${k} missing`);
    assert.notEqual(v[0], v[1], `${k} de = en`);
    assert.notEqual(v[1], v[2], `${k} en = es`);
  }
  assert.equal(en('bots.info.memoryCount', { count: 1 }), '1 entry');
  assert.equal(de('bots.info.memoryCount', { count: 3 }), '3 Einträge');
});
