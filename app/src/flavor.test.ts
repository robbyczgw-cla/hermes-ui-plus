// Flavor gating (flavor.ts): the official `hermes` build only knows Hermes + the offline demo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedKinds, allowedPairKinds, FLAVOR, isKindAllowed, pairScheme, parseFlavor, partitionByFlavor } from './flavor.ts';
import { parsePairLink, toPairLink } from './onboarding/pairLink.ts';
import { getSessionComponent, SESSION_COMPONENTS } from './chat/sessionRegistry.ts';

test('flavor defaults to hermes (unset, empty, unknown)', () => {
  assert.equal(parseFlavor(undefined), 'hermes');
  assert.equal(parseFlavor(''), 'hermes');
  assert.equal(parseFlavor('nope'), 'hermes');
  assert.equal(parseFlavor(' Personal '), 'personal');
  // tests run without EXPO_PUBLIC_FLAVOR → this bundle's flavor is the official one
  if (!process.env.EXPO_PUBLIC_FLAVOR) assert.equal(FLAVOR, 'hermes');
});

test('hermes: only hermes + demo kinds', () => {
  assert.deepEqual([...allowedKinds('hermes')], ['hermes', 'demo']);
  for (const k of ['claude', 'openai']) assert.equal(isKindAllowed(k, 'hermes'), false, k);
  assert.deepEqual([...allowedPairKinds('hermes')], ['hermes']);
  assert.equal(pairScheme('hermes'), 'hermesuiplus');
});

test('personal: own identity, the same connection kinds', () => {
  assert.deepEqual([...allowedKinds('personal')], ['hermes', 'demo']);
  assert.deepEqual([...allowedPairKinds('personal')], ['hermes']);
  assert.equal(pairScheme('personal'), 'hermesui');
});

test('stored profiles of hidden kinds are kept aside, not shown', () => {
  const list = [
    { id: 'a', kind: 'hermes' },
    { id: 'b', kind: 'claude' },
    { id: 'c', kind: 'openai' },
    { id: 'd', kind: 'demo' },
  ];
  const h = partitionByFlavor(list, 'hermes');
  assert.deepEqual(h.visible.map((p) => p.id), ['a', 'd']);
  assert.deepEqual(h.hidden.map((p) => p.id), ['b', 'c']);
  assert.equal(partitionByFlavor(list, 'personal').hidden.length, 2);
});

test('pair links: only Hermes links, in both flavors', () => {
  for (const flavor of ['hermes', 'personal'] as const) {
    const r = parsePairLink('hermesuiplus://pair?u=h.example.org&kind=claude', { flavor });
    assert.equal(r.ok ? 'ok' : r.error, 'unsupported-kind', flavor);
    assert.ok(parsePairLink('hermesuiplus://pair?u=h.example.org&kind=hermes', { flavor }).ok, flavor);
  }
});

test('pair links: all schemes (incl. the retired hermesiui) are accepted by both flavors', () => {
  for (const flavor of ['hermes', 'personal'] as const) {
    for (const scheme of ['hermesuiplus', 'hermesiui', 'hermesui', 'HermesIUI', 'HermesUIPlus']) {
      const r = parsePairLink(`${scheme}://pair?u=h.example.org&t=tok&n=Home`, { flavor });
      assert.ok(r.ok, `${flavor} ${scheme}`);
      if (r.ok) assert.equal(r.pair.baseUrl, 'https://h.example.org/v1');
    }
  }
  assert.equal(toPairLink('hermesiui://pair?u=x'), 'hermesiui://pair?u=x');
  assert.equal(toPairLink('hermesui://pair?u=x'), 'hermesui://pair?u=x');
  assert.equal(toPairLink('hermesuiplus://pair?u=x'), 'hermesuiplus://pair?u=x');
  assert.equal(parsePairLink('hermesuiplusx://pair?u=x', { flavor: 'hermes' }).ok, false);
  assert.equal(parsePairLink('hermesxui://pair?u=x', { flavor: 'hermes' }).ok, false);
});

test('hermes build never resolves a remote-backend session (their lazy chunk stays unloaded)', () => {
  for (const k of ['claude', 'openai']) {
    assert.equal(getSessionComponent(k, 'hermes'), null, k);
    assert.equal(getSessionComponent(k, 'personal'), null, k);
  }
  assert.ok(getSessionComponent('demo', 'hermes'));
  assert.equal(getSessionComponent('hermes', 'hermes'), null); // inline HermesSession
});

test('SESSION_COMPONENTS: one stable component per kind of this build (a re-render never remounts a session)', () => {
  for (const k of ['claude', 'openai', 'demo', 'hermes', 'nope']) {
    assert.equal(SESSION_COMPONENTS[k] ?? null, getSessionComponent(k), k);
    assert.equal(getSessionComponent(k), getSessionComponent(k), k); // same lazy() singleton on every call
  }
  assert.equal(SESSION_COMPONENTS.hermes, undefined); // inline HermesSession
  assert.ok(Object.isFrozen(SESSION_COMPONENTS));
});

test('isConversationVisible: stored chats of hidden kinds are not listed / restored in the official build (records stay on disk)', async () => {
  const { isConversationVisible, pickableKinds, otherBackendsAllowed } = await import('./flavor.ts');
  const list = [{ profileKind: 'hermes' }, { profileKind: 'demo' }, { profileKind: 'claude' }, { profileKind: 'openai' }];
  assert.deepEqual(list.filter((m) => isConversationVisible(m, 'hermes')).map((m) => m.profileKind), ['hermes', 'demo']);
  assert.equal(list.filter((m) => isConversationVisible(m, 'personal')).length, 2);
  assert.equal(isConversationVisible(undefined, 'hermes'), true);
  assert.deepEqual(pickableKinds('personal'), ['hermes']);
  assert.equal(otherBackendsAllowed('hermes'), false);
});
