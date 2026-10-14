/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from './types.ts';
import { branchSeedText, overrideConn, overrideHistory, stripTurnExtras, withContextSeed, withTurnNote } from './turnOverride.ts';
import { sameUserText, userTextCore } from './sessionMapping.ts';

const msg = (role: 'user' | 'assistant', text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `${role}-${text.length}-${Math.random()}`,
  role,
  text,
  tools: [],
  status: 'done',
  createdAt: 1,
  ...extra,
});

test('turn note / context block are hidden from transcript matching', () => {
  const sent = withTurnNote(withContextSeed('User: hi\n\nAssistant: hello', 'Und morgen?'), 'Beantworte ohne Websuche/Web-Tools.');
  assert.ok(sent.startsWith('[hui:context]'));
  assert.ok(sent.endsWith('[hui:note] Beantworte ohne Websuche/Web-Tools.'));
  assert.equal(stripTurnExtras(sent), 'Und morgen?');
  assert.equal(userTextCore(sent).core, 'Und morgen?');
  assert.ok(sameUserText(sent, 'Und morgen?'));
  // with an attachment part after the note
  assert.equal(userTextCore(`${withTurnNote('Was ist das?', 'x')}\n\n[Bild angehängt: a.png]`).core, 'Was ist das?');
  assert.equal(withTurnNote('a', undefined), 'a');
  assert.equal(withContextSeed('', 'a'), 'a');
});

test('overrideConn: model + web search per conn shape, untouched without override', () => {
  const claude = { apiKey: 'k', model: 'claude-sonnet-5-5', webSearch: true };
  assert.equal(overrideConn(claude, undefined), claude);
  assert.deepEqual(overrideConn(claude, { model: 'claude-opus-5-5' }), { apiKey: 'k', model: 'claude-opus-5-5', webSearch: true });
  assert.deepEqual(overrideConn(claude, { webSearch: false }), { apiKey: 'k', model: 'claude-sonnet-5-5', webSearch: false });
  const openai = { baseUrl: 'https://example.com/v1', model: 'm', webSearch: 'openrouter' as const };
  assert.equal('webSearch' in overrideConn(openai, { webSearch: false }), false);
  // a note alone does not change the conn
  assert.equal(overrideConn(claude, { note: 'x' }), claude);
});

test('overrideHistory: the note goes onto the last user message of a copy', () => {
  const h = [msg('user', 'a'), msg('assistant', 'b'), msg('user', 'c')];
  const out = overrideHistory(h, { note: 'kurz' });
  assert.equal(out[2].text, 'c\n\n[hui:note] kurz');
  assert.equal(h[2].text, 'c');
  assert.equal(overrideHistory(h, { model: 'x' }), h);
});

test('branchSeedText: labelled turns, attachments by name, newest kept when too long', () => {
  const seed = branchSeedText([msg('user', 'Frage 1', { attachments: [{ id: 'f', kind: 'file', name: 'a.pdf', uri: 'file:///a.pdf', mimeType: 'application/pdf', size: 1 } as never] }), msg('assistant', 'Antwort 1')]);
  assert.match(seed, /User: Frage 1\n\[attachment: a\.pdf\]/);
  assert.match(seed, /Assistant: Antwort 1/);
  assert.equal(branchSeedText([]), '');
  const long = branchSeedText([msg('user', 'x'.repeat(500)), msg('assistant', 'y'.repeat(500)), msg('user', 'neu')], undefined, 700);
  assert.ok(long.length <= 760);
  assert.match(long, /User: neu$/);
  assert.match(long, /\n…\n/);
});
