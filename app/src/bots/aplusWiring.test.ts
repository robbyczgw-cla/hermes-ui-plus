/** The screen's wiring where a React render isn't available in node: what must stay visible or stay out. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const screen = read('../chat/ChatScreen.tsx');
const item = read('../chat/MessageItem.tsx');

test('a source that cannot be loaded shows a notice with a retry', () => {
  assert.match(screen, /notice=\{botFeed\.error \?\? transcript\.error/);
  assert.match(screen, /botFeed\.error \? \{ label: tr\('bots\.feed\.retry'\), onPress: botFeed\.retry \}/);
  for (const lang of ['de', 'en', 'es']) {
    const ns = read(`../i18n/ns/bots.${lang}.ts`);
    for (const k of ['deliveriesFailed', 'talkFailed', 'retry']) assert.match(ns, new RegExp(`\\b${k}:`), `${lang}: ${k}`);
  }
});

test('the engine, storage and live cards only ever see the talk, the view gets the merged list', () => {
  assert.match(screen, /chat=\{onScreen\}/);
  assert.match(screen, /usePersistOnNewMessage\(conv, chat\.messages/);
  assert.match(screen, /useApplyRemoteTranscript\(chat, transcript, conv\)/);
  assert.match(screen, /<LiveProvider conversationId=\{convId\} messages=\{chat\.messages\}/);
  assert.match(screen, /replaceTalk\?\.\(withoutFeed\(m\)\)/);
});

test('a Bot Chat row offers no retry', () => {
  assert.match(item, /const local = ownLocal \|\| !!message\.feed/);
  assert.match(item, /isLast && !message\.feed \? \(/);
  // reformat chips go into the talk (bots/feedActions.ts), the delivery marker can be answered
  assert.match(item, /isLast && !ownLocal && !actions\?\.quick/);
  assert.match(item, /<CronDeliveryMarker delivery=\{cron\}[^>]*onReply=\{canReply && message\.feed/);
  assert.match(read('../chat/ChatView.tsx'), /feedActionDeps\(deps, \(\) => live\.current\.messages, messageId\)/);
  assert.match(item, /<CutNotice message=\{message\} isLast=\{isLast && !message\.feed\}/);
});

test("a talk event of a session this device doesn't know opens and marks the bot's talk", () => {
  const host = read('../push/PushHost.tsx');
  assert.match(host, /!conv && p\.kind === 'hermes' && isBotTalkSessionId\(target\.sessionId\)\) conv = ctl\.ensureBotTalk/);
  assert.match(host, /isBotTalkSessionId\(ev\.sessionId\) && !pickConversation[\s\S]{0,240}markUnread\(talk\.id\)/);
});

test('nothing unsent is lost on the way to the talk: a Bot Chat draft goes along, composer files hold a move', () => {
  assert.match(screen, /if \(id\) moveReadingDraft\(id, talk\.id\);\s*setActiveId\(talk\.id\);/);
  assert.match(read('./useBotFeed.ts'), /holdTalkMove: \(\) => liveDraftUris\(\)\.length > 0/);
});

test('the desktop app may read a picked file through its blob URL, like the web app the bridge serves', () => {
  const csp = JSON.parse(read('../../../desktop/src-tauri/tauri.conf.json')).app.security.csp;
  assert.match(csp['connect-src'], /(^| )blob:( |$)/);
});
