/// <reference types="node" />
// Hermes v0.22.3+ (session authority): a bot's Bot Chat is the gateway's own chat. The app shows it read-only with a
// visible reason and a way on (a new chat with the bot); on v0.22.2 it stays writable. Capability shapes as the two
// Hermes versions send them (`GET /v1/capabilities`, boolean features only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { botChatReadOnly } from './core.ts';
import { parseCapabilities } from '../hermes/capabilities.ts';
import { bots as en } from '../i18n/ns/bots.en.ts';
import { bots as de } from '../i18n/ns/bots.de.ts';
import { bots as es } from '../i18n/ns/bots.es.ts';

const FEATURES_0222 = {
  chat_completions: true, chat_completions_streaming: true, responses_api: true, responses_streaming: true, run_submission: true,
  run_status: true, run_events_sse: true, run_stop: true, run_steer: true, run_approval_response: true, tool_progress_events: true,
  approval_events: true, session_resources: true, model_options: true, session_chat: true, session_chat_streaming: true,
  session_fork: true, session_model_lock: true, reasoning_streaming: true, skills_api: true, audio_api: false, cors: false,
};
const caps = (features: Record<string, boolean>) => parseCapabilities({ object: 'hermes.api_server.capabilities', platform: 'hermes-agent', model: 'hermes-agent', features, endpoints: { sessions: { method: 'GET', path: '/api/sessions' } } });

test('v0.22.2: the Bot Chat stays writable', () => {
  assert.equal(botChatReadOnly(caps(FEATURES_0222)?.flags), false);
});

test('v0.22.5: run_unknown_resolution (session authority) makes the Bot Chat read-only', () => {
  assert.equal(botChatReadOnly(caps({ ...FEATURES_0222, run_unknown_resolution: true })?.flags), true);
});

test('unknown capabilities (bridge or Hermes without /v1/capabilities, still loading): writable, the old behaviour', () => {
  assert.equal(botChatReadOnly(undefined), false);
  assert.equal(botChatReadOnly(caps({ run_unknown_resolution: false })?.flags), false);
});

test('the read-only note and the way on are worded in every language and name the bot', () => {
  for (const ns of [en, de, es]) {
    for (const k of ['readOnly', 'readOnlyNewChat'] as const) {
      assert.ok(ns.chat[k].includes('{name}'), `${k} names the bot`);
      assert.ok(ns.chat[k].trim().length > 10);
    }
  }
});

test('ChatView puts the note in place of the composer and sends starters to a new chat with the bot', () => {
  const src = readFileSync(new URL('../chat/ChatView.tsx', import.meta.url), 'utf8');
  assert.match(src, /botReadOnly \? \(\s*<BotChatReadOnly/);
  assert.match(src, /onPick=\{botReadOnly \? chatWithBot : sendText\}/);
  const bar = readFileSync(new URL('./BotChatReadOnly.tsx', import.meta.url), 'utf8');
  assert.match(bar, /tr\('bots\.chat\.readOnly'/);
  assert.match(bar, /tr\('bots\.chat\.readOnlyNewChat'/);
});

test('read-only Bot Chat with 0.3 bot activity: the stopped-run retry goes to a new chat, the working card and its Stop stay', () => {
  const src = readFileSync(new URL('../chat/ChatView.tsx', import.meta.url), 'utf8');
  // "Jetzt mit Freigabe nachholen" (StoppedRunCard) would be a turn in the gateway's chat: permission_denied on v0.22.3+
  const retry = src.slice(src.indexOf('const retryStopped = useCallback('), src.indexOf('const stopRemote = useCallback('));
  assert.match(retry, /if \(botReadOnly\) chatWithBot\(prompt\);\s*else sendText\(prompt\);/);
  assert.match(retry, /\[botReadOnly, chatWithBot, sendText, tr\]/);
  assert.match(src, /onRetry=\{retryStopped\}/);
  // a routine or another device's turn keeps its "<Name> is working" card with Stop (through the bridge, not the chat)
  const cards = src.slice(src.indexOf('{streamingAnswer ? ('), src.indexOf('<LiveAskChip />'));
  assert.match(cards, /<RemoteWorkingCard turn=\{remoteTurn\}[^>]*onStop=\{stopRemote\}/);
  assert.doesNotMatch(cards, /botReadOnly/, 'only the composer is swapped for the note');
  assert.doesNotMatch(src.slice(src.indexOf('const remoteTurn ='), src.indexOf('const botWorking =')), /botReadOnly/);
});

test('read-only Bot Chat has no composer: "Antworten" is not offered (it toasted "too many quotes"), tapping a quote still jumps', () => {
  const view = readFileSync(new URL('../chat/ChatView.tsx', import.meta.url), 'utf8');
  const actions = view.slice(view.indexOf('const replyActions = useMemo'), view.indexOf('"Im Chat suchen"'));
  assert.match(actions, /canQuote: !botReadOnly,/);
  assert.match(actions, /\[toast, tr, historyTruncated, botReadOnly\]/);
  assert.match(actions, /jump: \(fromId, quote\) =>/);
  const item = readFileSync(new URL('../chat/MessageItem.tsx', import.meta.url), 'utf8');
  // every way to "Antworten": long-press, answer menu, web hover button, swipe in the list
  assert.match(item, /const canReply = !!replyCtx\?\.canQuote/);
  assert.match(item, /canReply: !!replyCtx\?\.canQuote && /);
  assert.match(item, /Platform\.OS === 'web' && replyCtx\?\.canQuote && !ownLocal/);
  const list = readFileSync(new URL('../chat/MessageList.tsx', import.meta.url), 'utf8');
  assert.match(list, /const canQuote = !!replyCtx\?\.canQuote;/);
});
