import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeMeta } from './migrate.ts';
import { newSessionIdFor } from './ids.ts';
import { indexReducer } from './indexReducer.ts';
import { PROFILE_KINDS } from './types.ts';

test('all backend kinds survive a reload; unknown/missing → hermes', () => {
  for (const kind of PROFILE_KINDS) assert.equal(sanitizeMeta({ id: 'c1', profileKind: kind }, 1)?.profileKind, kind);
  assert.equal(sanitizeMeta({ id: 'c1' }, 1)?.profileKind, 'hermes');
  assert.equal(sanitizeMeta({ id: 'c1', profileKind: 'gemini' }, 1)?.profileKind, 'hermes');
});

test('session id prefix per kind', () => {
  assert.match(newSessionIdFor('hermes'), /^hui-[0-9a-f]{16}$/);
  assert.match(newSessionIdFor('demo'), /^demo-/);
});

test('rebindDraft: an empty draft moves to the new profile (fresh session, no model override); a chat with messages never', () => {
  let s = indexReducer({ items: [] }, { type: 'create', id: 'c1', profile: { id: 'demo', kind: 'demo' }, sessionId: 'demo-1', now: 1 });
  s = indexReducer(s, { type: 'setModel', id: 'c1', model: 'demo-model' });
  s = indexReducer(s, { type: 'rebindDraft', id: 'c1', profile: { id: 'h1', kind: 'hermes' }, sessionId: 'hui-2' });
  const c = s.items[0];
  assert.equal(c.profileId, 'h1');
  assert.equal(c.profileKind, 'hermes');
  assert.equal(c.hermesSessionId, 'hui-2');
  assert.equal(c.model, undefined);
  assert.equal(s.activeId, 'c1');

  s = indexReducer(s, { type: 'saved', id: 'c1', now: 2, firstUserText: 'Hallo', preview: 'Hallo', messageCount: 1 });
  const kept = indexReducer(s, { type: 'rebindDraft', id: 'c1', profile: { id: 'demo', kind: 'demo' }, sessionId: 'demo-3' });
  assert.equal(kept, s);
});
