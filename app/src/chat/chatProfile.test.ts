/// <reference types="node" />
// bugs review 2026-10-11 P0-3: a chat whose profile was deleted must never run on a profile of another kind
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyChatRebindTarget, resolveChatProfile } from './chatProfile.ts';
import type { ConnectionProfile, ProfileKind } from '../settings/profiles';

const prof = (id: string, kind: ProfileKind): ConnectionProfile => ({ id, kind, name: id, baseUrl: `https://${id}`, apiKey: `key-${id}` }) as ConnectionProfile;

const hermes = prof('h1', 'hermes');
const hermes2 = prof('h2', 'hermes');
const claude = prof('c1', 'demo');
const openai = prof('o1', 'demo');

test('own profile is used', () => {
  const r = resolveChatProfile({ profileId: 'c1', profileKind: 'demo' }, [hermes, claude], hermes);
  assert.deepEqual(r, { status: 'ok', profile: claude });
});

test('deleted Claude profile + active Hermes profile → missing, never the Hermes profile (its key would go to Anthropic)', () => {
  const r = resolveChatProfile({ profileId: 'c-deleted', profileKind: 'demo' }, [hermes], hermes);
  assert.equal(r.status, 'missing');
  assert.ok(r.status === 'missing' && r.kind === 'demo' && r.candidates.length === 0);
});

test('deleted Hermes profile + active OpenRouter profile → missing (history must not go to OpenRouter)', () => {
  const r = resolveChatProfile({ profileId: 'h-deleted', profileKind: 'hermes' }, [openai], openai);
  assert.equal(r.status, 'missing');
});

test('no silent fallback even to the same kind: the user picks explicitly', () => {
  const r = resolveChatProfile({ profileId: 'h-deleted', profileKind: 'hermes' }, [hermes, hermes2, claude], hermes);
  assert.equal(r.status, 'missing');
  assert.deepEqual(r.status === 'missing' ? r.candidates.map((p) => p.id) : [], ['h1', 'h2']);
});

test('a picked profile of the same kind is used; a picked profile of another kind is ignored', () => {
  const conv = { profileId: 'h-deleted', profileKind: 'hermes' as const };
  assert.deepEqual(resolveChatProfile(conv, [hermes, hermes2, claude], claude, 'h2'), { status: 'ok', profile: hermes2 });
  assert.equal(resolveChatProfile(conv, [hermes, claude], claude, 'c1').status, 'missing');
});

test('a profile id that now belongs to another kind is not used', () => {
  const r = resolveChatProfile({ profileId: 'x', profileKind: 'hermes' }, [prof('x', 'demo')], hermes);
  assert.equal(r.status, 'missing');
});

test('no open chat → active profile', () => {
  assert.deepEqual(resolveChatProfile(undefined, [hermes], hermes), { status: 'ok', profile: hermes });
});

// web test 2, N1: the empty start chat (demo) follows the profile that was just paired

const draft = (profileId: string, profileKind: ProfileKind, extra: Record<string, unknown> = {}) => ({ profileId, profileKind, messageCount: 0, preview: '', ...extra });

test('empty demo chat → rebinds to the newly active Hermes profile', () => {
  assert.deepEqual(emptyChatRebindTarget(draft('demo', 'demo'), hermes), { id: 'h1', kind: 'hermes' });
});

test('empty chat on another profile of the same kind → rebinds too', () => {
  assert.deepEqual(emptyChatRebindTarget(draft('h2', 'hermes'), hermes), { id: 'h1', kind: 'hermes' });
});

test('empty chat already on the active profile → no change', () => {
  assert.equal(emptyChatRebindTarget(draft('h1', 'hermes'), hermes), null);
});

test('chat with messages keeps its profile (history never moves to another backend)', () => {
  assert.equal(emptyChatRebindTarget(draft('demo', 'demo', { messageCount: 2, preview: 'Hallo' }), hermes), null);
  assert.equal(emptyChatRebindTarget(draft('c1', 'demo', { messageCount: 0, preview: 'x' }), hermes), null);
});

test('running first turn, synced or branched chats keep their profile', () => {
  assert.equal(emptyChatRebindTarget(draft('demo', 'demo'), hermes, true), null);
  assert.equal(emptyChatRebindTarget(draft('h2', 'hermes', { origin: 'remote' }), hermes), null);
  assert.equal(emptyChatRebindTarget(draft('h2', 'hermes', { branchSeed: 3 }), hermes), null);
  assert.equal(emptyChatRebindTarget(undefined, hermes), null);
});
