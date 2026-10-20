import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ShareDelivery } from '../share/inbox.ts';
import { askInNewChat, type AskConversations } from './askHermes.ts';

/** a conversation list: an open chat with messages, `create` like conversations/controller.ts (empty draft re-used) */
function fakeConvs(draft?: { id: string; profileId: string }) {
  const calls: { profile: string; bot?: string }[] = [];
  let n = 0;
  const convs: AskConversations & { calls: typeof calls } = {
    activeId: 'open-chat',
    calls,
    create(profile, opts) {
      calls.push({ profile: profile.id, bot: opts?.bot });
      const id = draft && draft.profileId === profile.id ? draft.id : `new-${++n}`;
      this.activeId = id;
      return { id };
    },
    setActiveId(id) {
      this.activeId = id;
    },
  };
  return convs;
}

const HERMES = { id: 'p-hermes', kind: 'hermes' as const };

test('ask Hermes: a new chat with the screen\'s bot, never the open chat', () => {
  const convs = fakeConvs();
  const sent: [string, ShareDelivery][] = [];
  const id = askInNewChat(convs, HERMES, 'research', 'Which skills do you have?', 'send', (c, d) => sent.push([c, d]));
  assert.equal(id, 'new-1');
  assert.notEqual(id, 'open-chat');
  assert.deepEqual(convs.calls, [{ profile: 'p-hermes', bot: 'research' }]);
  assert.equal(convs.activeId, 'new-1');
  assert.deepEqual(sent, [['new-1', { text: 'Which skills do you have?', files: [] }]]);
});

test('ask Hermes: the default bot has no bot option; "fill" only puts the text in; an empty draft is re-used', () => {
  const convs = fakeConvs({ id: 'draft-1', profileId: 'p-hermes' });
  const sent: [string, ShareDelivery][] = [];
  askInNewChat(convs, HERMES, 'default', 'Use the skill arxiv: ', 'fill', (c, d) => sent.push([c, d]));
  assert.deepEqual(convs.calls, [{ profile: 'p-hermes', bot: undefined }]);
  assert.deepEqual(sent, [['draft-1', { text: 'Use the skill arxiv: ', files: [], fillOnly: true }]]);
});

test('ask Hermes: nothing happens without a connection or text', () => {
  const convs = fakeConvs();
  const deliver = () => assert.fail('nothing to deliver');
  assert.equal(askInNewChat(convs, null, undefined, 'x', 'send', deliver), null);
  assert.equal(askInNewChat(convs, HERMES, undefined, '   ', 'send', deliver), null);
  assert.deepEqual(convs.calls, []);
  assert.equal(convs.activeId, 'open-chat');
});
