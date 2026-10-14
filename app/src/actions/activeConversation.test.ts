/// <reference types="node" />
// bugs review 2026-10-11 P2-1: a pending undo-window commit must not send into a chat the user left
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitOnUnmount, getActiveConversation, setActiveConversation } from './activeConversation.ts';

test('row virtualised away while its chat is still open → commit', () => {
  assert.equal(commitOnUnmount('c1', 'c1'), true);
});

test('user switched chat / started a new chat → cancel', () => {
  assert.equal(commitOnUnmount('c1', 'c2'), false);
});

test('chat shell gone (null) → cancel', () => {
  assert.equal(commitOnUnmount('c1', null), false);
});

test('outside a chat (gallery) or no shell known → commit as before', () => {
  assert.equal(commitOnUnmount(null, 'c2'), true);
  assert.equal(commitOnUnmount('c1', undefined), true);
});

test('registry: the default uses the conversation set by the shell', () => {
  setActiveConversation('a');
  assert.equal(getActiveConversation(), 'a');
  assert.equal(commitOnUnmount('a'), true);
  setActiveConversation('b'); // ChatScreen switched before the unmount cleanup runs
  assert.equal(commitOnUnmount('a'), false);
  setActiveConversation(undefined);
});
